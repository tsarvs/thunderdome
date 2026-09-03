import type { Rng, RoundEvent } from '@thunderdome/engine';
import { dealNewHand } from './deal.js';
import { awardPotToSoleWinner, doShowdown } from './showdown.js';
import { postflopFirstToActIndex } from './table.js';
import type { BettingStreet, PokerTexasHoldEmState } from './types.js';

function mapValues<T, U>(
  record: Readonly<Record<string, T>>,
  fn: (value: T) => U,
): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}

function nextStreet(street: BettingStreet): BettingStreet {
  if (street === 'preflop') return 'flop';
  if (street === 'flop') return 'turn';
  if (street === 'turn') return 'river';
  throw new Error('unreachable: there is no street after the river');
}

function dealNextStreetWithBetting(
  state: PokerTexasHoldEmState,
  events: RoundEvent[],
): PokerTexasHoldEmState {
  const street = nextStreet(state.street);
  const cardsToReveal = street === 'flop' ? 3 : 1;
  const revealed = state.remainingBoardCards.slice(0, cardsToReveal);
  const remainingBoardCards = state.remainingBoardCards.slice(cardsToReveal);
  const board = [...state.board, ...revealed];
  events.push({ type: 'street-dealt', data: { street, board } });

  const players = mapValues(state.players, (player) => ({ ...player, committedThisStreet: 0 }));
  const n = state.seatOrder.length;
  const liveNonAllIn = state.seatOrder.filter(
    (id) => players[id]?.folded !== true && players[id]?.allIn !== true,
  );

  return {
    ...state,
    board,
    remainingBoardCards,
    street,
    players,
    currentBet: 0,
    minRaise: state.config.bigBlind,
    playersToAct: liveNonAllIn,
    actingIndex: (postflopFirstToActIndex(n) - 1 + n) % n,
  };
}

/** No more betting is possible this hand (at most one live player isn't all-in) — deal every
 * remaining street's cards straight through to the river with no betting in between. */
function runOutRemainingStreets(
  state: PokerTexasHoldEmState,
  events: RoundEvent[],
): PokerTexasHoldEmState {
  let working = state;
  while (working.street !== 'river') {
    working = dealNextStreetWithBetting(working, events);
  }
  return { ...working, playersToAct: [] };
}

/** A hand just ended (fold-win or showdown, chips already paid out) — busts anyone left at 0
 * chips, then either ends the match (too few players left, or the configured hand count is
 * reached) or deals the next hand. */
function settleHandEnd(
  state: PokerTexasHoldEmState,
  rng: Rng,
  events: RoundEvent[],
): PokerTexasHoldEmState {
  const newlyBusted = state.seatOrder.filter((id) => (state.stacks[id] ?? 0) === 0);
  const bustedOut = newlyBusted.length > 0 ? [...state.bustedOut, newlyBusted] : state.bustedOut;
  if (newlyBusted.length > 0) {
    events.push({ type: 'busted', participantIds: newlyBusted, data: {} });
  }

  const bustedSet = new Set(bustedOut.flat());
  const activeCount = state.participantIds.filter((id) => !bustedSet.has(id)).length;
  const handsPlayed = state.handNumber + 1;
  const reachedFixedHandsLimit =
    state.config.matchFormat === 'fixedHands' && handsPlayed >= state.config.totalHands;

  if (activeCount <= 1 || reachedFixedHandsLimit) {
    events.push({ type: 'match-complete', data: { stacks: state.stacks } });
    return { ...state, bustedOut, matchComplete: true };
  }

  const dealt = dealNewHand(
    state.participantIds,
    state.stacks,
    bustedSet,
    state.buttonParticipantId,
    handsPlayed,
    state.config,
    rng,
  );
  events.push(...dealt.events);
  return {
    ...state,
    bustedOut,
    seatOrder: dealt.seatOrder,
    players: dealt.players,
    board: dealt.board,
    remainingBoardCards: dealt.remainingBoardCards,
    street: dealt.street,
    currentBet: dealt.currentBet,
    minRaise: dealt.minRaise,
    playersToAct: dealt.playersToAct,
    actingIndex: dealt.actingIndex,
    buttonParticipantId: dealt.buttonParticipantId,
    handNumber: dealt.handNumber,
    stacks: dealt.stacks,
  };
}

function advanceToNextActor(state: PokerTexasHoldEmState): PokerTexasHoldEmState {
  const n = state.seatOrder.length;
  const playersToActSet = new Set(state.playersToAct);
  for (let step = 1; step <= n; step += 1) {
    const index = (state.actingIndex + step) % n;
    const candidate = state.seatOrder[index];
    if (candidate !== undefined && playersToActSet.has(candidate)) {
      return { ...state, actingIndex: index };
    }
  }
  throw new Error('unreachable: advanceToNextActor requires a non-empty playersToAct');
}

/**
 * The single driver behind every state transition that doesn't require waiting on a human/bot
 * decision: closing a betting round, dealing the next street (or running out every remaining
 * street at once when no one left can act), settling a showdown or fold-win, busting players,
 * and dealing the next hand — repeating for as long as the resulting state still needs no
 * decision, and stopping the instant either an actor is found or the match ends. Used both right
 * after a real action is applied (`resolve`) and right after a fresh deal (`initialize`,
 * `settleHandEnd`), since a fresh deal can itself already be un-actionable (e.g. a short-stacked
 * blind posts all-in against another short-stacked blind).
 */
export function advance(
  state: PokerTexasHoldEmState,
  rng: Rng,
  events: RoundEvent[],
): PokerTexasHoldEmState {
  let working = state;
  for (;;) {
    const nonFolded = working.seatOrder.filter((id) => working.players[id]?.folded !== true);
    if (nonFolded.length === 1) {
      const winnerId = nonFolded[0];
      if (winnerId === undefined) {
        throw new Error('unreachable: nonFolded.length === 1 was just checked');
      }
      working = awardPotToSoleWinner(working, winnerId, events);
      working = settleHandEnd(working, rng, events);
      if (working.matchComplete) {
        return working;
      }
      continue;
    }

    if (working.playersToAct.length === 0) {
      if (working.street === 'river') {
        working = doShowdown(working, events);
        working = settleHandEnd(working, rng, events);
        if (working.matchComplete) {
          return working;
        }
        continue;
      }
      const liveNonAllIn = nonFolded.filter((id) => working.players[id]?.allIn !== true);
      if (liveNonAllIn.length <= 1) {
        working = runOutRemainingStreets(working, events);
        continue;
      }
      working = dealNextStreetWithBetting(working, events);
      continue;
    }

    return advanceToNextActor(working);
  }
}
