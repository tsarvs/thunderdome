export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** 2..10, then 11=J, 12=Q, 13=K, 14=A — numeric so "highest of suit" is a plain `>`. */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

const SUIT_LETTERS: Record<Suit, string> = {
  clubs: 'C',
  diamonds: 'D',
  hearts: 'H',
  spades: 'S',
};

const LETTER_SUITS: Record<string, Suit> = {
  C: 'clubs',
  D: 'diamonds',
  H: 'hearts',
  S: 'spades',
};

const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const LABEL_RANKS: Record<string, Rank> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const SUIT_ORDER: Record<Suit, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

/**
 * Canonical serialization — the ONLY thing ever used for card equality/Set-membership, since
 * `Card` is a plain object and `===`/`Set<Card>` would never match two structurally-identical
 * cards. `T` (not `'10'`) keeps every id exactly 2 characters, e.g. `{suit:'spades',rank:12}` ->
 * `"QS"`.
 */
export function cardId(card: Card): string {
  return `${RANK_LABELS[card.rank]}${SUIT_LETTERS[card.suit]}`;
}

const CARD_ID_PATTERN = /^(10|[2-9TJQKA])([CDHS])$/;

/** Inverse of `cardId`; also accepts `"10X"` as an alias for `"TX"`. Never throws — returns
 * `undefined` for anything malformed, which is what both test helpers and a `humanInterface`'s
 * `parseInput` need (neither has anywhere better to put a thrown error). */
export function parseCardId(text: string): Card | undefined {
  const match = CARD_ID_PATTERN.exec(text.trim().toUpperCase());
  if (match === null) {
    return undefined;
  }
  const [, rankLabel, suitLetter] = match;
  const rank = rankLabel === '10' ? 10 : LABEL_RANKS[rankLabel ?? ''];
  const suit = LETTER_SUITS[suitLetter ?? ''];
  if (rank === undefined || suit === undefined) {
    return undefined;
  }
  return { suit, rank };
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function containsCard(cards: readonly Card[], target: Card): boolean {
  return cards.some((card) => cardsEqual(card, target));
}

/** Cards in `cards` minus every card in `toRemove` (by id). Throws if any card in `toRemove`
 * isn't actually present — callers only ever call this on already-validated actions, so a miss
 * here is a real bug, not user input. */
export function removeCards(cards: readonly Card[], toRemove: readonly Card[]): Card[] {
  const remaining = new Set(toRemove.map(cardId));
  const result: Card[] = [];
  for (const card of cards) {
    const id = cardId(card);
    if (remaining.has(id)) {
      remaining.delete(id);
    } else {
      result.push(card);
    }
  }
  if (remaining.size > 0) {
    throw new Error(`removeCards: card(s) not present in the input: ${[...remaining].join(', ')}`);
  }
  return result;
}

/** Canonical suit order (clubs < diamonds < hearts < spades), then rank ascending — used for
 * display and for fully-deterministic tie-breaking. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) =>
    a.suit === b.suit ? a.rank - b.rank : SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit],
  );
}

/** All 52 standard playing cards (no jokers), freshly generated each call. */
export function standardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}
