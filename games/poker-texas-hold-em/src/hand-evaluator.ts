import type { Card, Rank } from '@thunderdome/deck-of-cards';

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

/** Ordinal strength of each category — higher wins, compared before either hand's `tiebreakers`. */
const CATEGORY_STRENGTH: Record<HandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
};

export interface HandRank {
  category: HandCategory;
  /** Ranks that break a tie within the same category, most significant first — e.g. `[quadRank,
   * kicker]` for four-of-a-kind, all 5 ranks descending for high-card/flush. Compared
   * lexicographically after `category`. */
  tiebreakers: number[];
}

/** `-1`/`0`/`1` per the usual comparator contract: positive means `a` beats `b`. */
export function compareHandRank(a: HandRank, b: HandRank): number {
  const strengthDiff = CATEGORY_STRENGTH[a.category] - CATEGORY_STRENGTH[b.category];
  if (strengthDiff !== 0) {
    return strengthDiff;
  }
  const length = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** `null` unless `ranks` (deduplicated, descending) forms 5 consecutive ranks — including the
 * wheel (A-2-3-4-5, which plays as a 5-high straight, the one case where an Ace counts low). */
function straightHighCard(uniqueRanksDesc: readonly Rank[]): number | null {
  if (uniqueRanksDesc.length < 5) {
    return null;
  }
  for (let start = 0; start + 4 < uniqueRanksDesc.length; start += 1) {
    const high = uniqueRanksDesc[start];
    const low = uniqueRanksDesc[start + 4];
    if (high === undefined || low === undefined) {
      throw new Error('unreachable: index bounds checked above');
    }
    if (high - low === 4) {
      return high;
    }
  }
  const wheel = [14, 5, 4, 3, 2];
  if (wheel.every((rank) => uniqueRanksDesc.includes(rank as Rank))) {
    return 5;
  }
  return null;
}

/**
 * Ranks the best 5-card poker hand out of exactly 5 cards. Same-rank cards are grouped into
 * `groups`, largest group first and same-size groups broken by rank descending, so every category
 * below can just read `groups[0]`/`groups[1]` for "the pair/trips/quads rank" without re-deriving
 * it.
 */
export function evaluateFiveCardHand(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`evaluateFiveCardHand requires exactly 5 cards, got ${String(cards.length)}`);
  }
  const ranksDesc = [...cards].map((card) => card.rank).sort((a, b) => b - a);
  const isFlush = cards.every((card) => card.suit === cards[0]?.suit);
  const uniqueRanksDesc = [...new Set(ranksDesc)];
  const straightHigh = straightHighCard(uniqueRanksDesc);

  const countByRank = new Map<number, number>();
  ranksDesc.forEach((rank) => countByRank.set(rank, (countByRank.get(rank) ?? 0) + 1));
  const groups = [...countByRank.entries()].sort(([rankA, countA], [rankB, countB]) =>
    countA === countB ? rankB - rankA : countB - countA,
  );
  const [topGroup, secondGroup, thirdGroup] = groups;
  if (topGroup === undefined) {
    throw new Error('unreachable: 5 cards always produce at least one rank group');
  }

  if (straightHigh !== null && isFlush) {
    return { category: 'straight-flush', tiebreakers: [straightHigh] };
  }
  if (topGroup[1] === 4) {
    const kicker = secondGroup?.[0] ?? 0;
    return { category: 'four-of-a-kind', tiebreakers: [topGroup[0], kicker] };
  }
  if (topGroup[1] === 3 && secondGroup?.[1] === 2) {
    return { category: 'full-house', tiebreakers: [topGroup[0], secondGroup[0]] };
  }
  if (isFlush) {
    return { category: 'flush', tiebreakers: ranksDesc };
  }
  if (straightHigh !== null) {
    return { category: 'straight', tiebreakers: [straightHigh] };
  }
  if (topGroup[1] === 3) {
    const kickers = groups.slice(1).map(([rank]) => rank);
    return { category: 'three-of-a-kind', tiebreakers: [topGroup[0], ...kickers] };
  }
  if (topGroup[1] === 2 && secondGroup?.[1] === 2) {
    const kicker = thirdGroup?.[0] ?? 0;
    return { category: 'two-pair', tiebreakers: [topGroup[0], secondGroup[0], kicker] };
  }
  if (topGroup[1] === 2) {
    const kickers = groups.slice(1).map(([rank]) => rank);
    return { category: 'pair', tiebreakers: [topGroup[0], ...kickers] };
  }
  return { category: 'high-card', tiebreakers: ranksDesc };
}

/** Every k-combination of `items`, order-preserving within each combination. */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) {
    return [[]];
  }
  if (items.length < k) {
    return [];
  }
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error('unreachable: items.length >= k >= 1 checked above');
  }
  const withFirst = combinations(rest, k - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

export interface BestHand extends HandRank {
  /** The specific 5 cards (a subset of the input) that produced this ranking. */
  cards: Card[];
}

/** The best 5-card hand reachable from `cards` (typically 7: 2 hole + 5 board). Requires at
 * least 5 cards. */
export function bestHand(cards: readonly Card[]): BestHand {
  if (cards.length < 5) {
    throw new Error(`bestHand requires at least 5 cards, got ${String(cards.length)}`);
  }
  let best: BestHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const rank = evaluateFiveCardHand(combo);
    if (best === null || compareHandRank(rank, best) > 0) {
      best = { ...rank, cards: combo };
    }
  }
  if (best === null) {
    throw new Error('unreachable: combinations(cards, 5) is non-empty whenever cards.length >= 5');
  }
  return best;
}
