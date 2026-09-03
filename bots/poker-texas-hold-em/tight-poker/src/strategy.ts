import type { Action, Card, Observation, Rank } from './types.js';

const PREMIUM_PAIR_MIN_RANK = 10; // pocket TT or better

/**
 * Preflop hand strength, from hole cards alone: pocket tens or better, an ace with a jack-or-
 * better kicker, or king-queen suited — a standard tight opening range, nothing fancy.
 */
function isPremiumHoleCards(holeCards: [Card, Card]): boolean {
  const [a, b] = holeCards;
  const high = Math.max(a.rank, b.rank);
  const low = Math.min(a.rank, b.rank);
  const suited = a.suit === b.suit;
  if (high === low) {
    return high >= PREMIUM_PAIR_MIN_RANK;
  }
  if (high === 14) {
    return low >= 11;
  }
  return high === 13 && low === 12 && suited;
}

/**
 * Postflop hand strength: at least a pair that one of your own hole cards is actually part of
 * (an unimproved pocket pair counts too) — a deliberately simple made-hand check. It never
 * recognizes a straight or flush that doesn't also pair up, which only ever makes this bot too
 * cautious, never reckless — exactly the direction a "no bluffing" bot should err.
 */
function hasMadeHand(holeCards: [Card, Card], board: Card[]): boolean {
  const holeRanks = new Set(holeCards.map((card) => card.rank));
  const countByRank = new Map<Rank, number>();
  for (const card of [...holeCards, ...board]) {
    countByRank.set(card.rank, (countByRank.get(card.rank) ?? 0) + 1);
  }
  for (const [rank, count] of countByRank) {
    if (count >= 2 && holeRanks.has(rank)) {
      return true;
    }
  }
  return false;
}

function hasGoodHand(observation: Observation): boolean {
  return observation.board.length === 0
    ? isPremiumHoleCards(observation.holeCards)
    : hasMadeHand(observation.holeCards, observation.board);
}

/**
 * Only bets or raises with a good hand, and only calls a bet cheaply with a weak one — never
 * bluffs, never chases a big bet. `legalActions` still gates every choice below, since having a
 * "good" hand doesn't make check/call/raise legal on its own (e.g. `check` is illegal whenever
 * there's a bet to call).
 */
export function decideAction(observation: Observation): Action {
  const { legalActions, toCall, minRaiseTo, bigBlind } = observation;
  const goodHand = hasGoodHand(observation);

  if (goodHand && legalActions.includes('raise') && minRaiseTo !== null) {
    return { type: 'raise', amount: minRaiseTo };
  }
  if (legalActions.includes('check')) {
    return { type: 'check' };
  }
  if (goodHand && legalActions.includes('call')) {
    return { type: 'call' };
  }
  if (legalActions.includes('call') && toCall <= bigBlind) {
    return { type: 'call' };
  }
  return { type: 'fold' };
}
