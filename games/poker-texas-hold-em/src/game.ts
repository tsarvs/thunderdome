import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import { advance } from './advance.js';
import { applyPlayerAction } from './betting.js';
import { dealNewHand } from './deal.js';
import {
  describeAction,
  describeObservation,
  describeRoundEvents,
  parseInput,
  validateInput,
} from './human.js';
import {
  PokerTexasHoldEmActionSchema,
  PokerTexasHoldEmConfigSchema,
  type PokerLegalActionType,
  type PokerOpponentView,
  type PokerTexasHoldEmAction,
  type PokerTexasHoldEmConfig,
  type PokerTexasHoldEmObservation,
  type PokerTexasHoldEmResult,
  type PokerTexasHoldEmState,
} from './types.js';

const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 10;

/**
 * Texas Hold Em — no-limit, 2-10 players. Each hand: hole cards and blinds are dealt
 * (deal.ts), players act in turn (betting.ts applies each action), and `advance()` (advance.ts)
 * drives every automatic transition in between — closing a betting round, dealing the next
 * street, running out an all-in, and settling a showdown or fold-win (showdown.ts) — until either
 * a real decision is needed or the match ends. See `config.matchFormat` (types.ts) for the two
 * supported ways a match ends: `elimination` (last stack standing) or `fixedHands` (play exactly
 * `totalHands` hands, then rank by chip count).
 *
 * `onMissingAction` is deliberately omitted, same as Connect Four: there's no sensible substitute
 * action for a no-show mid-hand (unlike Hearts, where "play the lowest legal card" is a
 * reasonable stand-in), so a missing required action just forfeits the match, the engine's
 * default.
 */
export const pokerTexasHoldEm: GameDefinition<
  PokerTexasHoldEmConfig,
  PokerTexasHoldEmState,
  PokerTexasHoldEmObservation,
  PokerTexasHoldEmAction,
  PokerTexasHoldEmResult
> = {
  id: 'poker-texas-hold-em',
  version: '0.1.0',

  parseConfig(raw) {
    const result = PokerTexasHoldEmConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  // Deals the opening hand, then runs it through `advance()` in case it's already un-actionable
  // (e.g. a short-stacked blind posting all-in). `initialize` has no events channel (unlike
  // `resolve`), so the deal's own events are deliberately dropped — only `advance`'s state-shaping
  // matters here.
  initialize({ participantIds, config, rng }) {
    if (participantIds.length < MIN_PARTICIPANTS || participantIds.length > MAX_PARTICIPANTS) {
      throw new Error(
        `poker-texas-hold-em requires between ${String(MIN_PARTICIPANTS)} and ${String(MAX_PARTICIPANTS)} participants, got ${String(participantIds.length)}`,
      );
    }
    const stacks: Record<string, number> = {};
    participantIds.forEach((id) => {
      stacks[id] = config.startingStack;
    });

    const dealt = dealNewHand(participantIds, stacks, new Set(), null, 0, config, rng);
    const initial: PokerTexasHoldEmState = {
      participantIds: [...participantIds],
      config,
      stacks: dealt.stacks,
      bustedOut: [],
      handNumber: dealt.handNumber,
      buttonParticipantId: dealt.buttonParticipantId,
      seatOrder: dealt.seatOrder,
      players: dealt.players,
      board: dealt.board,
      remainingBoardCards: dealt.remainingBoardCards,
      street: dealt.street,
      currentBet: dealt.currentBet,
      minRaise: dealt.minRaise,
      playersToAct: dealt.playersToAct,
      actingIndex: dealt.actingIndex,
      lastHandSummary: null,
      matchComplete: false,
    };
    return advance(initial, rng, []);
  },

  // The engine only ever calls this for a participant `getPendingActions` just named
  // (match-runner.ts), and a busted-out participant is never in `seatOrder` / never pending — so
  // `player === undefined` below is unreachable via normal engine use, guarded only defensively.
  getObservation(state, participantId) {
    if (!state.participantIds.includes(participantId)) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    const player = state.players[participantId];
    if (player === undefined) {
      throw new Error(`"${participantId}" is not seated in the current hand (likely busted out)`);
    }
    const stack = state.stacks[participantId] ?? 0;
    const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
    const maxRaiseTo = stack + player.committedThisStreet;
    const minRaiseTo = stack === 0 ? null : Math.min(state.currentBet + state.minRaise, maxRaiseTo);

    const legalActions: PokerLegalActionType[] = [];
    if (stack > 0) {
      legalActions.push('fold');
    }
    if (toCall === 0) {
      legalActions.push('check');
    } else {
      legalActions.push('call');
    }
    if (stack > 0 && maxRaiseTo > state.currentBet) {
      legalActions.push('raise');
    }
    if (stack > 0) {
      legalActions.push('allIn');
    }

    const selfIndex = state.seatOrder.indexOf(participantId);
    const n = state.seatOrder.length;
    const opponents: PokerOpponentView[] = state.seatOrder
      .filter((id) => id !== participantId)
      .map((id) => {
        const opponent = state.players[id];
        if (opponent === undefined) {
          throw new Error(`unreachable: "${id}" is in seatOrder`);
        }
        return {
          participantId: id,
          stack: state.stacks[id] ?? 0,
          committed: opponent.committed,
          committedThisStreet: opponent.committedThisStreet,
          folded: opponent.folded,
          allIn: opponent.allIn,
          isButton: id === state.buttonParticipantId,
        };
      })
      .sort((a, b) => {
        const offset = (id: string) => (state.seatOrder.indexOf(id) - selfIndex - 1 + n) % n;
        return offset(a.participantId) - offset(b.participantId);
      });

    const pot = state.seatOrder.reduce((sum, id) => sum + (state.players[id]?.committed ?? 0), 0);

    return {
      you: participantId,
      handNumber: state.handNumber,
      street: state.street,
      board: state.board,
      holeCards: player.holeCards,
      pot,
      yourStack: stack,
      yourCommittedThisStreet: player.committedThisStreet,
      toCall,
      minRaiseTo,
      maxRaiseTo,
      smallBlind: state.config.smallBlind,
      bigBlind: state.config.bigBlind,
      buttonParticipantId: state.buttonParticipantId,
      opponents,
      legalActions,
      lastHandSummary: state.lastHandSummary,
    };
  },

  getPendingActions(state) {
    if (state.matchComplete) {
      return [];
    }
    const participantId = state.seatOrder[state.actingIndex];
    if (participantId === undefined) {
      throw new Error(
        'unreachable: actingIndex is a valid seatOrder index while the match is in progress',
      );
    }
    return [{ participantId, required: true }];
  },

  validateAction(state, participantId, raw) {
    const parsed = PokerTexasHoldEmActionSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        'action must be { type: "fold" }, { type: "check" }, { type: "call" }, { type: "raise", amount } (total street commitment), or { type: "allIn" }',
      );
    }
    const action = parsed.data;
    const player = state.players[participantId];
    if (player === undefined) {
      return err(`"${participantId}" is not seated in the current hand`);
    }
    const stack = state.stacks[participantId] ?? 0;
    const toCall = state.currentBet - player.committedThisStreet;

    switch (action.type) {
      case 'fold':
        return ok(action);
      case 'check':
        return toCall === 0 ? ok(action) : err('cannot check: there is a bet to call');
      case 'call':
        return toCall > 0 ? ok(action) : err('nothing to call — use check');
      case 'allIn':
        return stack > 0 ? ok(action) : err('no chips left to move all-in with');
      case 'raise': {
        if (stack <= 0) {
          return err('no chips left to raise with');
        }
        const maxAmount = player.committedThisStreet + stack;
        if (action.amount > maxAmount) {
          return err(`cannot commit more than your stack (max ${String(maxAmount)})`);
        }
        if (action.amount <= state.currentBet) {
          return err('raise amount must exceed the current bet');
        }
        const isAllIn = action.amount === maxAmount;
        if (!isAllIn && action.amount < state.currentBet + state.minRaise) {
          return err(
            `raise must add at least ${String(state.minRaise)} to the current bet of ${String(state.currentBet)} (i.e. reach ${String(state.currentBet + state.minRaise)}), or go all-in for less`,
          );
        }
        return ok(action);
      }
    }
  },

  resolve({ state, actions, rng }) {
    const participantId = state.seatOrder[state.actingIndex];
    if (participantId === undefined) {
      throw new Error(
        'unreachable: actingIndex is a valid seatOrder index while the match is in progress',
      );
    }
    const action = actions.get(participantId);
    if (action === undefined) {
      throw new Error(
        `unreachable: resolve() called without a validated action for "${participantId}"`,
      );
    }
    const applied = applyPlayerAction(state, participantId, action);
    const events = [...applied.events];
    const nextState = advance(applied.state, rng, events);
    return { nextState, events };
  },

  isTerminal(state) {
    return state.matchComplete;
  },

  getResult(state) {
    return {
      participantIds: state.participantIds,
      stacks: state.stacks,
      bustedOut: state.bustedOut,
      handsPlayed: state.handNumber + 1,
    };
  },

  // Whoever busted later (or never busted) placed better than whoever busted earlier; players who
  // bust in the same hand tie. `tierOf` is that group's index in `bustedOut` for a busted
  // participant, or `bustedOut.length` (better than every busted tier) for anyone who still holds
  // chips at match end.
  getStandingOutcomes(result) {
    const { participantIds, stacks, bustedOut } = result;
    const tierOf = (id: string): number => {
      if ((stacks[id] ?? 0) > 0) {
        return bustedOut.length;
      }
      const index = bustedOut.findIndex((group) => group.includes(id));
      return index === -1 ? bustedOut.length : index;
    };
    const isBetter = (a: string, b: string): boolean => {
      const stackA = stacks[a] ?? 0;
      const stackB = stacks[b] ?? 0;
      return stackA !== stackB ? stackA > stackB : tierOf(a) > tierOf(b);
    };
    const isEqual = (a: string, b: string): boolean =>
      (stacks[a] ?? 0) === (stacks[b] ?? 0) && tierOf(a) === tierOf(b);

    const bestIds = participantIds.filter((id) =>
      participantIds.every((other) => !isBetter(other, id)),
    );
    const soleBestId = bestIds[0];

    return participantIds.map((id) => {
      const rank = 1 + participantIds.filter((other) => isBetter(other, id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        bestIds.length > 1
          ? bestIds.some((other) => isEqual(other, id))
            ? 'draw'
            : 'loss'
          : id === soleBestId
            ? 'win'
            : 'loss';
      return { participantId: id, rank, score: stacks[id] ?? 0, outcome };
    });
  },

  resourceLimits: { cpus: 0.5, memoryMb: 128, turnTimeoutMs: 5000 },

  humanInterface: {
    describeObservation,
    parseInput,
    validateInput,
    describeAction,
    describeRoundEvents,
  },
};
