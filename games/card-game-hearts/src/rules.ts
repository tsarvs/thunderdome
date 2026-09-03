import {
  type Card,
  containsCard,
  dealHands,
  shuffle,
  sortCards,
  standardDeck,
} from '@thunderdome/card-kit';
import type { Rng } from '@thunderdome/engine';
import type { HeartsState, HeartsTrick, PassDirection } from './types.js';

export function pointValue(card: Card): number {
  if (card.suit === 'hearts') {
    return 1;
  }
  if (card.suit === 'spades' && card.rank === 12) {
    return 13; // Q♠
  }
  return 0;
}

export const isPointCard = (card: Card): boolean => pointValue(card) > 0;
export const isTwoOfClubs = (card: Card): boolean => card.suit === 'clubs' && card.rank === 2;

const PASS_DIRECTIONS: readonly PassDirection[] = ['left', 'right', 'across', 'hold'];

/** `handNumber` is 0-based (hand 1 in user-facing terms = `handNumber` 0). Cycle: 0=left,
 * 1=right, 2=across, 3=hold, repeating every 4 hands. */
export function passDirectionForHand(handNumber: number): PassDirection {
  const direction = PASS_DIRECTIONS[handNumber % 4];
  if (direction === undefined) {
    throw new Error('unreachable: handNumber % 4 is always a valid index into PASS_DIRECTIONS');
  }
  return direction;
}

/**
 * Turn order is clockwise (`participantIds` array order): "pass left" sends your 3 cards to the
 * next seat in turn order (the player who acts right after you); "pass right" to the previous
 * seat; "pass across" to the seat two away. Never called with `'hold'` — hold hands skip the
 * passing sub-phase entirely (see `dealNewHand`), so there is no pass target to compute.
 */
export function passTargetIndex(
  direction: Exclude<PassDirection, 'hold'>,
  fromIndex: 0 | 1 | 2 | 3,
): 0 | 1 | 2 | 3 {
  const offset = direction === 'left' ? 1 : direction === 'right' ? 3 : 2; // 'across'
  return ((fromIndex + offset) % 4) as 0 | 1 | 2 | 3;
}

/**
 * The ONE legality function. Returns exactly the set of cards `participantId` may legally play
 * right now, given `state`. Both `validateAction` (is the submitted card in this list?) and
 * `getObservation` (the optional `legalPlays` hint) call this — legality is never reimplemented
 * anywhere else.
 *
 * Returns `[]` if it isn't actually this participant's turn to play a card (wrong phase, or not
 * `state.currentPlayerIndex`).
 */
export function legalPlaysFor(state: HeartsState, participantId: string): Card[] {
  if (
    state.phase !== 'playing' ||
    state.participantIds[state.currentPlayerIndex] !== participantId
  ) {
    return [];
  }
  const hand = state.hands[participantId] ?? [];
  const isLeading = state.currentTrick.plays.length === 0;
  const isFirstTrick = state.tricksCompleted === 0;

  if (isLeading) {
    if (isFirstTrick) {
      // The forced 2♣ opening lead — the true leader always holds 2♣ by construction
      // (dealNewHand/resolve's post-pass lookup), so the `hand` fallback is defensive, not the
      // actual enforcement mechanism.
      const twoOfClubs = hand.find(isTwoOfClubs);
      return twoOfClubs ? [twoOfClubs] : hand;
    }
    if (!state.heartsBroken) {
      const nonHearts = hand.filter((card) => card.suit !== 'hearts');
      return nonHearts.length > 0 ? nonHearts : hand; // forced: entire hand is hearts
    }
    return hand;
  }

  const ledPlay = state.currentTrick.plays[0];
  if (ledPlay === undefined) {
    throw new Error('unreachable: a non-leading play means the trick already has a first play');
  }
  const followSuit = hand.filter((card) => card.suit === ledPlay.card.suit);
  const candidates = followSuit.length > 0 ? followSuit : hand; // void in led suit -> anything

  if (isFirstTrick) {
    const noPoints = candidates.filter((card) => !isPointCard(card));
    return noPoints.length > 0 ? noPoints : candidates; // forced: only point cards available
  }
  return candidates;
}

export function isLegalPlay(state: HeartsState, participantId: string, card: Card): boolean {
  return containsCard(legalPlaysFor(state, participantId), card);
}

/** Highest card of the led suit wins — there is no trump suit in Hearts, so an off-suit card
 * (even a higher-ranked one) never wins a trick. */
export function trickWinner(plays: readonly { participantId: string; card: Card }[]): string {
  const first = plays[0];
  if (first === undefined) {
    throw new Error('unreachable: trickWinner called on an empty trick');
  }
  const ledSuit = first.card.suit;
  let best = first;
  for (const play of plays.slice(1)) {
    if (play.card.suit === ledSuit && play.card.rank > best.card.rank) {
      best = play;
    }
  }
  return best.participantId;
}

export function trickPoints(plays: readonly { participantId: string; card: Card }[]): number {
  return plays.reduce((sum, play) => sum + pointValue(play.card), 0);
}

/**
 * Applies shoot-the-moon: if exactly one participant's tally is 26 (all 13 hearts + Q♠ — the
 * only way to reach 26 in a single hand, since that's the entire point pool), that participant's
 * contribution becomes 0 and every other participant's becomes 26. Otherwise returns
 * `handPoints` unchanged.
 */
export function applyShootTheMoon(handPoints: Record<string, number>): Record<string, number> {
  const shooterEntry = Object.entries(handPoints).find(([, points]) => points === 26);
  if (shooterEntry === undefined) {
    return handPoints;
  }
  const shooterId = shooterEntry[0];
  const adjusted: Record<string, number> = {};
  for (const id of Object.keys(handPoints)) {
    adjusted[id] = id === shooterId ? 0 : 26;
  }
  return adjusted;
}

/** Resolves a participant's seat as the literal `0 | 1 | 2 | 3` that `HeartsState.currentPlayerIndex`
 * uses, so `participantIds` indexing stays `string` (not `string | undefined`) under
 * `noUncheckedIndexedAccess`, mirroring Connect Four's `currentPlayerIndex: 0 | 1` convention. */
export function seatIndexOf(
  participantIds: readonly [string, string, string, string],
  participantId: string,
): 0 | 1 | 2 | 3 {
  const index = participantIds.indexOf(participantId);
  if (index < 0 || index > 3) {
    throw new Error(`unreachable: "${participantId}" is not one of participantIds`);
  }
  return index as 0 | 1 | 2 | 3;
}

export function nextSeatIndex(index: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  return ((index + 1) % 4) as 0 | 1 | 2 | 3;
}

export function findTwoOfClubsHolder(
  hands: Record<string, Card[]>,
  participantIds: readonly string[],
): string {
  const holder = participantIds.find((id) => (hands[id] ?? []).some(isTwoOfClubs));
  if (holder === undefined) {
    throw new Error('unreachable: no participant holds the 2 of clubs');
  }
  return holder;
}

export type HandSetup =
  | {
      phase: 'passing';
      handNumber: number;
      hands: Record<string, Card[]>;
      heartsBroken: false;
      tricksCompleted: 0;
      handPoints: Record<string, number>;
      lastTrick: null;
    }
  | {
      phase: 'playing';
      handNumber: number;
      hands: Record<string, Card[]>;
      heartsBroken: false;
      tricksCompleted: 0;
      handPoints: Record<string, number>;
      lastTrick: null;
      currentTrick: HeartsTrick;
      currentPlayerIndex: 0 | 1 | 2 | 3;
    };

/**
 * Shuffles a fresh 52-card deck, deals 13 to each participant, and decides the phase for
 * `handNumber` from its passing direction: `'hold'` hands skip straight to `'playing'` (with the
 * 2♣ holder as leader); every other direction starts in `'passing'`. Shared by `initialize` and
 * by `resolve`'s hand-boundary transition — the engine's `rng` argument to `resolve` is exactly
 * for this kind of mid-match reshuffling.
 */
export function dealNewHand(
  participantIds: readonly [string, string, string, string],
  handNumber: number,
  rng: Rng,
): HandSetup {
  const dealt = dealHands(shuffle(standardDeck(), rng), 4);
  const hands: Record<string, Card[]> = {};
  participantIds.forEach((id, index) => {
    const hand = dealt[index];
    if (hand === undefined) {
      throw new Error('unreachable: dealHands(..., 4) always returns 4 hands');
    }
    hands[id] = hand;
  });
  const handPoints: Record<string, number> = {};
  participantIds.forEach((id) => {
    handPoints[id] = 0;
  });

  const direction = passDirectionForHand(handNumber);
  if (direction === 'hold') {
    const leaderId = findTwoOfClubsHolder(hands, participantIds);
    return {
      phase: 'playing',
      handNumber,
      hands,
      heartsBroken: false,
      tricksCompleted: 0,
      handPoints,
      lastTrick: null,
      currentTrick: { leaderId, plays: [] },
      currentPlayerIndex: seatIndexOf(participantIds, leaderId),
    };
  }
  return {
    phase: 'passing',
    handNumber,
    hands,
    heartsBroken: false,
    tricksCompleted: 0,
    handPoints,
    lastTrick: null,
  };
}

/** Deterministic, not "smart": passes the 3 highest-ranked cards (ties broken by canonical suit
 * order via `sortCards`, since `Array.prototype.sort` is stable). Good enough for "don't forfeit
 * the whole match over one hiccup" — strategic quality of the substitute isn't the goal. */
export function deterministicPass(hand: readonly Card[]): [Card, Card, Card] {
  const highestFirst = [...sortCards(hand)].sort((a, b) => b.rank - a.rank);
  const [a, b, c] = highestFirst;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error('unreachable: a 13-card hand always has 3 cards to pass');
  }
  return [a, b, c];
}

/** Deterministic: the lowest card in `legalPlaysFor`'s own result — legal by construction, and
 * (crucially) automatically plays 2♣ when that's the only legal card. */
export function deterministicPlay(state: HeartsState, participantId: string): Card {
  const [card] = sortCards(legalPlaysFor(state, participantId));
  if (card === undefined) {
    throw new Error('unreachable: legalPlaysFor never returns empty for the current player');
  }
  return card;
}
