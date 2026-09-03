import { type Card, cardId, containsCard, removeCards, sortCards } from '@thunderdome/card-kit';
import {
  err,
  ok,
  type GameDefinition,
  type RoundEvent,
  type RoundOutcome,
  type Rng,
  type StandingOutcome,
} from '@thunderdome/engine';
import { describeAction, describeObservation, parseInput } from './human.js';
import {
  applyShootTheMoon,
  dealNewHand,
  deterministicPass,
  deterministicPlay,
  findTwoOfClubsHolder,
  isLegalPlay,
  legalPlaysFor,
  nextSeatIndex,
  passDirectionForHand,
  passTargetIndex,
  seatIndexOf,
  trickPoints,
  trickWinner,
} from './rules.js';
import {
  HeartsActionSchema,
  HeartsConfigSchema,
  type CompletedTrick,
  type HeartsAction,
  type HeartsConfig,
  type HeartsObservation,
  type HeartsResult,
  type HeartsState,
} from './types.js';

type PassingState = Extract<HeartsState, { phase: 'passing' }>;
type PlayingState = Extract<HeartsState, { phase: 'playing' }>;

function resolvePassing(
  state: PassingState,
  actions: ReadonlyMap<string, HeartsAction>,
): RoundOutcome<HeartsState> {
  const direction = passDirectionForHand(state.handNumber);
  if (direction === 'hold') {
    throw new Error('unreachable: a hold hand never enters the passing phase');
  }

  const passedCardsById = new Map<string, [Card, Card, Card]>();
  state.participantIds.forEach((participantId) => {
    const action = actions.get(participantId);
    if (action?.type !== 'pass') {
      throw new Error(
        `unreachable: resolve() called without a validated pass action for "${participantId}"`,
      );
    }
    passedCardsById.set(participantId, action.cards);
  });

  const newHands: Record<string, Card[]> = {};
  state.participantIds.forEach((participantId) => {
    const cards = passedCardsById.get(participantId);
    if (cards === undefined) {
      throw new Error('unreachable: every participant passed cards above');
    }
    newHands[participantId] = removeCards(state.hands[participantId] ?? [], cards);
  });

  const passedTo: Record<string, string> = {};
  state.participantIds.forEach((participantId, index) => {
    const seat = index as 0 | 1 | 2 | 3;
    const targetId = state.participantIds[passTargetIndex(direction, seat)];
    const cards = passedCardsById.get(participantId);
    if (cards === undefined) {
      throw new Error('unreachable: every participant passed cards above');
    }
    newHands[targetId] = [...(newHands[targetId] ?? []), ...cards];
    passedTo[participantId] = targetId;
  });

  const leaderId = findTwoOfClubsHolder(newHands, state.participantIds);
  const nextState: HeartsState = {
    ...state,
    phase: 'playing',
    hands: newHands,
    currentTrick: { leaderId, plays: [] },
    currentPlayerIndex: seatIndexOf(state.participantIds, leaderId),
  };

  return {
    nextState,
    // Deliberately omits which cards were passed — card contents aren't legitimately public
    // until played to a trick, so the event channel stays as conservative as getObservation.
    events: [
      {
        type: 'cards-passed',
        participantIds: [...state.participantIds],
        data: { direction, passedTo },
      },
    ],
  };
}

function resolvePlay(
  state: PlayingState,
  actions: ReadonlyMap<string, HeartsAction>,
  rng: Rng,
): RoundOutcome<HeartsState> {
  const participantId = state.participantIds[state.currentPlayerIndex];
  const action = actions.get(participantId);
  if (action?.type !== 'play') {
    throw new Error(
      `unreachable: resolve() called without a validated play action for "${participantId}"`,
    );
  }
  const { card } = action;

  const hands: Record<string, Card[]> = {
    ...state.hands,
    [participantId]: removeCards(state.hands[participantId] ?? [], [card]),
  };
  const heartsBroken = state.heartsBroken || card.suit === 'hearts';
  const plays = [...state.currentTrick.plays, { participantId, card }];

  const events: RoundEvent[] = [
    {
      type: 'card-played',
      participantIds: [participantId],
      data: { card, trickPosition: plays.length },
    },
  ];

  if (plays.length < 4) {
    const nextState: HeartsState = {
      ...state,
      hands,
      heartsBroken,
      currentTrick: { ...state.currentTrick, plays },
      currentPlayerIndex: nextSeatIndex(state.currentPlayerIndex),
    };
    return { nextState, events };
  }

  // Trick complete.
  const winnerId = trickWinner(plays);
  const wonPoints = trickPoints(plays);
  const handPoints: Record<string, number> = {
    ...state.handPoints,
    [winnerId]: (state.handPoints[winnerId] ?? 0) + wonPoints,
  };
  const tricksCompleted = state.tricksCompleted + 1;
  const lastTrick: CompletedTrick = { plays, winnerId };
  events.push({
    type: 'trick-won',
    participantIds: [winnerId],
    data: { winnerId, cardsWon: plays.map((play) => play.card) },
  });

  if (tricksCompleted < 13) {
    const nextState: HeartsState = {
      ...state,
      hands,
      heartsBroken,
      tricksCompleted,
      handPoints,
      lastTrick,
      currentTrick: { leaderId: winnerId, plays: [] },
      currentPlayerIndex: seatIndexOf(state.participantIds, winnerId),
    };
    return { nextState, events };
  }

  // Hand complete: score it (including shoot-the-moon), then either end the match or deal the
  // next hand.
  const finalHandPoints = applyShootTheMoon(handPoints);
  const shooterId = Object.entries(handPoints).find(([, points]) => points === 26)?.[0] ?? null;
  const scores: Record<string, number> = { ...state.scores };
  state.participantIds.forEach((id) => {
    scores[id] = (scores[id] ?? 0) + (finalHandPoints[id] ?? 0);
  });
  const matchComplete = Object.values(scores).some((score) => score >= state.config.pointLimit);

  events.push({
    type: 'hand-scored',
    data: {
      handNumber: state.handNumber,
      handPoints: finalHandPoints,
      shotTheMoon: shooterId,
      scores,
    },
  });

  if (matchComplete) {
    events.push({ type: 'match-complete', data: { scores } });
    const nextState: HeartsState = {
      ...state,
      hands,
      heartsBroken,
      tricksCompleted,
      handPoints: finalHandPoints,
      lastTrick,
      scores,
      matchComplete: true,
      currentTrick: { leaderId: winnerId, plays: [] },
      currentPlayerIndex: seatIndexOf(state.participantIds, winnerId),
    };
    return { nextState, events };
  }

  // `dealNewHand`'s own setup resets `lastTrick` to null for the new hand — this hand's final
  // trick (computed above) was already shown to the human as it happened, via the *previous*
  // observation; it doesn't carry forward into the next hand's passing round.
  const setup = dealNewHand(state.participantIds, state.handNumber + 1, rng);
  const nextState: HeartsState = {
    participantIds: state.participantIds,
    config: state.config,
    scores,
    matchComplete: false,
    ...setup,
  };
  return { nextState, events };
}

/**
 * Hearts — classic 4-player trick-taking. Each hand: players simultaneously pass 3 cards
 * (left/right/across/hold, rotating), then the 2♣ holder leads tricks until all 13 are played.
 * Hearts (1pt) and the Q♠ (13pts) are penalties; whoever captures all 26 in a hand "shoots the
 * moon" and flips the scoring instead. Match ends once a player's cumulative score reaches
 * `config.pointLimit`; lowest score wins.
 */
export const hearts: GameDefinition<
  HeartsConfig,
  HeartsState,
  HeartsObservation,
  HeartsAction,
  HeartsResult
> = {
  id: 'card-game-hearts',
  version: '0.1.0',

  parseConfig(raw) {
    const result = HeartsConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  initialize({ participantIds, config, rng }) {
    const [a, b, c, d] = participantIds;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined ||
      participantIds.length !== 4
    ) {
      throw new Error(
        `card-game-hearts requires exactly 4 participants, got ${String(participantIds.length)}`,
      );
    }
    const ids: [string, string, string, string] = [a, b, c, d];
    const scores: Record<string, number> = {};
    ids.forEach((id) => {
      scores[id] = 0;
    });
    const setup = dealNewHand(ids, 0, rng);
    const state: HeartsState = {
      participantIds: ids,
      config,
      scores,
      matchComplete: false,
      ...setup,
    };
    return state;
  },

  getObservation(state, participantId) {
    if (!state.participantIds.includes(participantId)) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    const handSizes: Record<string, number> = {};
    state.participantIds.forEach((id) => {
      handSizes[id] = (state.hands[id] ?? []).length;
    });
    const isYourTurn =
      state.phase === 'playing' && state.participantIds[state.currentPlayerIndex] === participantId;

    const base: HeartsObservation = {
      you: participantId,
      participantIds: state.participantIds,
      phase: state.phase,
      handNumber: state.handNumber,
      passDirection: passDirectionForHand(state.handNumber),
      hand: sortCards(state.hands[participantId] ?? []),
      handSizes,
      heartsBroken: state.heartsBroken,
      tricksCompleted: state.tricksCompleted,
      isFirstTrick: state.tricksCompleted === 0,
      currentTrick: state.phase === 'playing' ? state.currentTrick : null,
      lastTrick: state.lastTrick,
      handPoints: state.handPoints,
      scores: state.scores,
      pointLimit: state.config.pointLimit,
      youMustAct: state.phase === 'passing' || isYourTurn,
    };
    return isYourTurn ? { ...base, legalPlays: legalPlaysFor(state, participantId) } : base;
  },

  getPendingActions(state) {
    if (state.matchComplete) {
      return [];
    }
    if (state.phase === 'passing') {
      return state.participantIds.map((participantId) => ({ participantId, required: true }));
    }
    return [{ participantId: state.participantIds[state.currentPlayerIndex], required: true }];
  },

  validateAction(state, participantId, raw) {
    const parsed = HeartsActionSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        'action must be { type: "pass", cards: [Card,Card,Card] } or { type: "play", card: Card }',
      );
    }
    const action = parsed.data;

    if (action.type === 'pass') {
      if (state.phase !== 'passing') {
        return err('cards may only be passed during the passing phase');
      }
      const hand = state.hands[participantId] ?? [];
      if (new Set(action.cards.map(cardId)).size !== 3) {
        return err('must pass 3 distinct cards');
      }
      if (!action.cards.every((card) => containsCard(hand, card))) {
        return err('you can only pass cards you hold');
      }
      return ok(action);
    }

    if (state.phase !== 'playing') {
      return err('you may only play a card during the playing phase');
    }
    const hand = state.hands[participantId] ?? [];
    if (!containsCard(hand, action.card)) {
      return err('you do not hold that card');
    }
    if (!isLegalPlay(state, participantId, action.card)) {
      return err('that card is not a legal play right now');
    }
    return ok(action);
  },

  resolve({ state, actions, rng }) {
    return state.phase === 'passing'
      ? resolvePassing(state, actions)
      : resolvePlay(state, actions, rng);
  },

  onMissingAction({ state, participantId }) {
    if (state.phase === 'passing') {
      const hand = state.hands[participantId] ?? [];
      return { policy: 'substitute', action: { type: 'pass', cards: deterministicPass(hand) } };
    }
    return {
      policy: 'substitute',
      action: { type: 'play', card: deterministicPlay(state, participantId) },
    };
  },

  isTerminal(state) {
    return state.matchComplete;
  },

  getResult(state) {
    return {
      participantIds: state.participantIds,
      scores: state.scores,
      handsPlayed: state.handNumber + 1,
    };
  },

  getStandingOutcomes(result) {
    const ids = result.participantIds;
    const scoreOf = (id: string) => result.scores[id] ?? 0;
    const bestScore = Math.min(...ids.map(scoreOf));
    const bestIds = ids.filter((id) => scoreOf(id) === bestScore);

    return ids.map((id) => {
      const rank = 1 + ids.filter((other) => scoreOf(other) < scoreOf(id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        bestIds.length > 1
          ? bestIds.includes(id)
            ? 'draw'
            : 'loss'
          : id === bestIds[0]
            ? 'win'
            : 'loss';
      return { participantId: id, rank, score: scoreOf(id), outcome };
    });
  },

  resourceLimits: { cpus: 0.5, memoryMb: 128, turnTimeoutMs: 5000 },

  humanInterface: { describeObservation, parseInput, describeAction },
};
