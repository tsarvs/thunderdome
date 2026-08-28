import { probabilityHoldsAny, isKnownOutOfSuit, isShootingTheMoon, startShootingTheMoon, unseenCards } from './state.js';
import type { Card, HeartsTrick, Observation, Rank, Suit } from './types.js';

const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

// Reused from T1's passing logic — a suit at this count or fewer is worth actively shedding.
const OUT_OF_SUIT_COUNT_THRESHOLD = 2;

// Shoot-the-moon signal (see the plan doc for the reasoning behind these numbers — a first-pass
// heuristic with no empirical tuning behind it yet, the most guessable constants in this bot).
const MOON_EVAL_TRICK_LIMIT = 4;
const MOON_SCORE_THRESHOLD = 15;
const LAST_PLAYER_BEATS_THRESHOLD = 0.5;
const MOON_THREAT_POINTS_THRESHOLD = 8;

const pointValue = (card: Card): number => {
  if (card.suit === 'hearts') return 1;
  if (card.suit === 'spades' && card.rank === 12) return 13;
  return 0;
};

const opponentIds = (observation: Observation): string[] =>
  observation.participantIds.filter(id => id !== observation.you);

const highestOf = (cards: Card[]): Card => [...cards].sort((a, b) => b.rank - a.rank)[0]!;
const lowestOf = (cards: Card[]): Card => [...cards].sort((a, b) => a.rank - b.rank)[0]!;

const countInSuit = (hand: Card[], suit: Suit): number => hand.filter(c => c.suit === suit).length;
const countRank = (hand: Card[], rank: Rank): number => hand.filter(c => c.rank === rank).length;

const averageRank = (hand: Card[], suit: Suit): number => {
  const cards = hand.filter(c => c.suit === suit);
  return cards.reduce((sum, c) => sum + c.rank, 0) / cards.length;
};

/** All legal plays share `suit` iff we're following it — the game only allows an off-suit play
 * when we hold none of the led suit at all. */
const isInSuit = (legalPlays: Card[], suit: Suit): boolean =>
  legalPlays.length > 0 && legalPlays[0]!.suit === suit;

/** The participant who acts 4th (last) in the current trick's rotation, regardless of our own
 * position — used both to detect "we are last" and, from 2nd/3rd, to reason about them. */
const lastActorId = (observation: Observation): string => {
  const leaderIndex = observation.participantIds.indexOf(observation.currentTrick!.leaderId);
  return observation.participantIds[(leaderIndex + 3) % 4]!;
};

/** Whoever currently holds the highest led-suit card in this trick — since an off-suit play can
 * never win, this is the definitive trick winner once we're the last to act. */
const currentTrickWinnerSoFar = (currentTrick: HeartsTrick): string => {
  const led = currentTrick.plays[0]!.card.suit;
  const inSuitPlays = currentTrick.plays.filter(play => play.card.suit === led);
  return inSuitPlays.reduce((best, play) => (play.card.rank > best.card.rank ? play : best)).participantId;
};

/** Q♠ if legal, else our highest heart, else (nothing dangerous to give away) our overall
 * highest legal card. */
const dumpDangerousPoint = (legalPlays: Card[]): Card => {
  const queenOfSpades = legalPlays.find(card => card.suit === 'spades' && card.rank === 12);
  if (queenOfSpades) return queenOfSpades;
  const hearts = legalPlays.filter(card => card.suit === 'hearts');
  if (hearts.length > 0) return highestOf(hearts);
  return highestOf(legalPlays);
};

/** A non-led suit we hold 1-2 of, preferring whichever has the higher average rank (the more
 * dangerous near-empty suit to be rid of first) — `undefined` if no such suit is playable. */
const tryShedNearEmptySuit = (hand: Card[], legalPlays: Card[], excludeSuit: Suit): Card | undefined => {
  const nearEmpty = SUITS.filter(suit => suit !== excludeSuit)
    .filter(suit => {
      const count = countInSuit(hand, suit);
      return count >= 1 && count <= OUT_OF_SUIT_COUNT_THRESHOLD;
    })
    .filter(suit => legalPlays.some(card => card.suit === suit));
  if (nearEmpty.length === 0) return undefined;
  const bestSuit = nearEmpty.reduce((best, suit) =>
    averageRank(hand, suit) > averageRank(hand, best) ? suit : best,
  );
  return highestOf(legalPlays.filter(card => card.suit === bestSuit));
};

// --- Shoot-the-moon signal -------------------------------------------------------------------

/** Evaluated only from a lead, only while not already shooting the moon. See the plan doc for
 * the full reasoning; summary: a hard mathematical gate (no opponent may already hold any points
 * this hand, and it must still be early), then a hand-strength score against a threshold. */
const shouldStartShootingTheMoon = (observation: Observation): boolean => {
  const opponents = opponentIds(observation);
  const noOpponentHasPoints = opponents.every(id => (observation.handPoints[id] ?? 0) === 0);
  if (!noOpponentHasPoints || observation.tricksCompleted >= MOON_EVAL_TRICK_LIMIT) {
    return false;
  }

  const hand = observation.hand;
  let score = 0;
  score += countRank(hand, 14) * 3; // aces
  score += countRank(hand, 13) * 2; // kings
  score += hand.filter(card => pointValue(card) > 0).length; // point cards already in hand
  const hasAceSpades = hand.some(card => card.suit === 'spades' && card.rank === 14);
  const hasKingSpades = hand.some(card => card.suit === 'spades' && card.rank === 13);
  if (hasAceSpades && hasKingSpades) score += 4;
  for (const suit of SUITS) {
    const count = countInSuit(hand, suit);
    if (count === 0) score -= 3;
    else if (count === 1) score -= 2;
  }

  return score >= MOON_SCORE_THRESHOLD;
};

// --- Leading -----------------------------------------------------------------------------------

const chooseMoonLead = (observation: Observation, legalPlays: Card[], hand: Card[]): Card => {
  const opponents = opponentIds(observation);

  // Every opponent already out of some suit we hold: leading it is a guaranteed win, and per
  // spec it doesn't matter which of our cards in that suit we pick.
  const universallyOutSuits = SUITS.filter(
    suit =>
      legalPlays.some(card => card.suit === suit) &&
      opponents.every(id => isKnownOutOfSuit(id, suit)),
  );
  if (universallyOutSuits.length > 0) {
    const bestSuit = universallyOutSuits.reduce((best, suit) =>
      countInSuit(hand, suit) > countInSuit(hand, best) ? suit : best,
    );
    return highestOf(legalPlays.filter(card => card.suit === bestSuit));
  }

  // Otherwise, lead our highest card from whichever suit the most opponents are already known
  // out of — maximizes trick-winning odds and further exhausts opponents for future rounds.
  const candidateSuits = SUITS.filter(suit => legalPlays.some(card => card.suit === suit));
  const outCountFor = (suit: Suit): number => opponents.filter(id => isKnownOutOfSuit(id, suit)).length;
  const highestRankFor = (suit: Suit): number => highestOf(legalPlays.filter(card => card.suit === suit)).rank;
  const bestSuit = candidateSuits.reduce((best, suit) => {
    if (outCountFor(suit) !== outCountFor(best)) {
      return outCountFor(suit) > outCountFor(best) ? suit : best;
    }
    return highestRankFor(suit) > highestRankFor(best) ? suit : best;
  });
  return highestOf(legalPlays.filter(card => card.suit === bestSuit));
};

const chooseLead = (observation: Observation, legalPlays: Card[], hand: Card[]): Card => {
  if (!isShootingTheMoon() && shouldStartShootingTheMoon(observation)) {
    startShootingTheMoon();
  }
  if (isShootingTheMoon()) {
    return chooseMoonLead(observation, legalPlays, hand);
  }
  // Non-moon default: play the lowest card possible, same as T1.
  return lowestOf(legalPlays);
};

// --- Following, shoot-the-moon mode -------------------------------------------------------------

const chooseMoonFollow = (hand: Card[], legalPlays: Card[], ledSuit: Suit): Card => {
  if (isInSuit(legalPlays, ledSuit)) {
    return highestOf(legalPlays); // always try to win
  }
  // Forced off-suit — this trick's points are already lost to whoever wins it, so there's
  // nothing moon-specific left to optimize; fall back to ordinary out-of-suit shedding.
  return tryShedNearEmptySuit(hand, legalPlays, ledSuit) ?? dumpDangerousPoint(legalPlays);
};

// --- Following, non-moon, in suit ---------------------------------------------------------------

const chooseSecondOrThirdInSuit = (observation: Observation, legalPlays: Card[]): Card => {
  const currentTrick = observation.currentTrick!;
  const highestInTrick = Math.max(...currentTrick.plays.map(play => play.card.rank));
  const below = legalPlays.filter(card => card.rank < highestInTrick);
  if (below.length > 0) {
    return highestOf(below); // duck as high as safely possible
  }

  // Every in-suit option we have would currently take the trick — will the actual last-to-act
  // player likely out-rank us anyway regardless of what we play?
  const myLowest = lowestOf(legalPlays);
  const lastId = lastActorId(observation);
  const pool = unseenCards(observation.hand);
  const ledSuit = currentTrick.plays[0]!.card.suit;
  const candidates = pool.filter(card => card.suit === ledSuit && card.rank > myLowest.rank);
  const probability = probabilityHoldsAny(lastId, candidates, observation, pool);

  return probability > LAST_PLAYER_BEATS_THRESHOLD ? highestOf(legalPlays) : myLowest;
};

const chooseLastInSuit = (currentTrick: HeartsTrick, legalPlays: Card[]): Card => {
  const highestInTrick = Math.max(...currentTrick.plays.map(play => play.card.rank));
  const below = legalPlays.filter(card => card.rank < highestInTrick);
  return below.length > 0 ? highestOf(below) : highestOf(legalPlays);
};

// --- Following, non-moon, out of suit ------------------------------------------------------------

const chooseSecondOrThirdOutOfSuit = (hand: Card[], legalPlays: Card[], ledSuit: Suit): Card =>
  tryShedNearEmptySuit(hand, legalPlays, ledSuit) ?? dumpDangerousPoint(legalPlays);

const chooseLastOutOfSuit = (
  hand: Card[],
  legalPlays: Card[],
  ledSuit: Suit,
  currentTrick: HeartsTrick,
  handPoints: Record<string, number>,
): Card => {
  const hasDangerousPointCard = legalPlays.some(card => pointValue(card) > 0);
  if (hasDangerousPointCard) {
    const winnerId = currentTrickWinnerSoFar(currentTrick);
    const winnerPoints = handPoints[winnerId] ?? 0;
    if (winnerPoints >= MOON_THREAT_POINTS_THRESHOLD) {
      // Withhold our most dangerous point cards from a likely moon attempt — play the lowest
      // safe (non-point) off-suit card instead, falling back to the lowest legal card if every
      // legal play happens to be a point card.
      const safe = legalPlays.filter(card => pointValue(card) === 0);
      return safe.length > 0 ? lowestOf(safe) : lowestOf(legalPlays);
    }
    return dumpDangerousPoint(legalPlays);
  }
  // We hold no point cards — the point-dump decision doesn't apply, fall back to suit shedding.
  return tryShedNearEmptySuit(hand, legalPlays, ledSuit) ?? highestOf(legalPlays);
};

// --- Entry point ---------------------------------------------------------------------------------

export const choosePlay = (observation: Observation): Card => {
  const legalPlays = observation.legalPlays!;
  const hand = observation.hand;

  // First trick of the match: unchanged from T1, play the highest card possible.
  if (observation.isFirstTrick) {
    return highestOf(legalPlays);
  }

  const currentTrick = observation.currentTrick!;
  if (currentTrick.plays.length === 0) {
    return chooseLead(observation, legalPlays, hand);
  }

  const ledSuit = currentTrick.plays[0]!.card.suit;
  const last = currentTrick.plays.length === 3;

  if (isShootingTheMoon()) {
    return chooseMoonFollow(hand, legalPlays, ledSuit);
  }

  const inSuit = isInSuit(legalPlays, ledSuit);
  if (inSuit) {
    return last ? chooseLastInSuit(currentTrick, legalPlays) : chooseSecondOrThirdInSuit(observation, legalPlays);
  }
  return last
    ? chooseLastOutOfSuit(hand, legalPlays, ledSuit, currentTrick, observation.handPoints)
    : chooseSecondOrThirdOutOfSuit(hand, legalPlays, ledSuit);
};
