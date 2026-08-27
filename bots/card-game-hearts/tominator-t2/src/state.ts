import { cardKey, fullDeck } from './deck.js';
import type { Card, Observation, Suit } from './types.js';

/** Every card seen played this hand (keyed by `cardKey`). Reset whenever `handNumber` changes. */
let cardsPlayedThisHand = new Set<string>();
/** Suits each participant has proven "out of" by not following suit when they could have led
 * differently. Reset whenever `handNumber` changes. */
let suitsOutOf: Record<string, Set<Suit>> = {};
/** Sticky once true for the rest of the hand — see the module doc on `checkShootTheMoonSignal`
 * in play.ts for why this never gets re-evaluated or reversed mid-hand. */
let shootingTheMoon = false;
let currentHandNumber: number | undefined;

function recordTrickPlays(plays: readonly { participantId: string; card: Card }[]): void {
  const ledCard = plays[0];
  if (ledCard === undefined) {
    return;
  }
  const ledSuit = ledCard.card.suit;
  for (const play of plays) {
    cardsPlayedThisHand.add(cardKey(play.card));
    if (play.card.suit !== ledSuit) {
      const outOf = suitsOutOf[play.participantId] ?? new Set<Suit>();
      outOf.add(ledSuit);
      suitsOutOf[play.participantId] = outOf;
    }
  }
}

/** Call at the top of every `decideAction` — resets tracking on a new hand, then idempotently
 * replays this hand's known trick history (`currentTrick`/`lastTrick`) into the tracked state.
 * Safe to call every time: both `Set.add` and the suit-violation marking above are naturally
 * idempotent, so no "have I already seen this trick" bookkeeping is needed. */
export function updateStateFromObservation(observation: Observation): void {
  if (observation.handNumber !== currentHandNumber) {
    currentHandNumber = observation.handNumber;
    cardsPlayedThisHand = new Set<string>();
    suitsOutOf = {};
    shootingTheMoon = false;
  }
  if (observation.currentTrick !== null) {
    recordTrickPlays(observation.currentTrick.plays);
  }
  if (observation.lastTrick !== null) {
    recordTrickPlays(observation.lastTrick.plays);
  }
}

export const isKnownOutOfSuit = (participantId: string, suit: Suit): boolean =>
  suitsOutOf[participantId]?.has(suit) ?? false;

export const isShootingTheMoon = (): boolean => shootingTheMoon;

export const startShootingTheMoon = (): void => {
  shootingTheMoon = true;
};

/** The full 52-card deck minus our hand minus every card seen played this hand — exactly the
 * pooled contents of the 3 opponents' current hands, since Hearts deals the whole deck with no
 * hidden draw pile. */
export function unseenCards(hand: readonly Card[]): Card[] {
  const known = new Set(hand.map(cardKey));
  for (const key of cardsPlayedThisHand) {
    known.add(key);
  }
  return fullDeck().filter(card => !known.has(cardKey(card)));
}

/**
 * Approximates P(`participantId` holds at least one card from `candidates`) by treating their
 * hand as a uniform random sample (without replacement) of size `handSizes[participantId]` drawn
 * from `pool` (the full unseen-card set). `candidates` is first narrowed to cards of suits that
 * participant isn't already known to be out of — a known-out suit contributes 0 regardless of how
 * many `candidates` are in it.
 *
 * This treats each opponent's hand as an independent sample rather than jointly conditioning on
 * all three at once — a standard, tractable approximation, not a full Bayesian card-counter.
 */
export function probabilityHoldsAny(
  participantId: string,
  candidates: readonly Card[],
  observation: Observation,
  pool: readonly Card[],
): number {
  const viable = candidates.filter(card => !isKnownOutOfSuit(participantId, card.suit));
  if (viable.length === 0) {
    return 0;
  }
  const handSize = observation.handSizes[participantId] ?? 0;
  const poolSize = pool.length;
  if (handSize <= 0 || poolSize <= 0) {
    return 0;
  }

  // P(0 hits) via a running product of fractions — avoids factorials/big numbers entirely.
  let probabilityOfNoHits = 1;
  for (let i = 0; i < handSize; i += 1) {
    const remainingPool = poolSize - i;
    if (remainingPool <= 0) {
      break;
    }
    const remainingNonViable = Math.max(0, remainingPool - viable.length);
    probabilityOfNoHits *= remainingNonViable / remainingPool;
  }
  return 1 - probabilityOfNoHits;
}
