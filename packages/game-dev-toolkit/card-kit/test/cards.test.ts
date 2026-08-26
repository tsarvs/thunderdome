import { describe, expect, it } from 'vitest';
import {
  RANKS,
  SUITS,
  cardId,
  cardsEqual,
  containsCard,
  parseCardId,
  removeCards,
  sortCards,
  standardDeck,
} from '../src/cards.js';

describe('standardDeck', () => {
  it('contains exactly 52 unique cards, 13 per suit', () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(13);
    }
  });

  it('covers every suit/rank combination exactly once', () => {
    const deck = standardDeck();
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        expect(deck.some((card) => card.suit === suit && card.rank === rank)).toBe(true);
      }
    }
  });
});

describe('cardId / parseCardId', () => {
  it.each([
    [{ suit: 'clubs', rank: 2 } as const, '2C'],
    [{ suit: 'hearts', rank: 10 } as const, 'TH'],
    [{ suit: 'spades', rank: 12 } as const, 'QS'],
    [{ suit: 'diamonds', rank: 14 } as const, 'AD'],
  ])('round-trips %j <-> %s', (card, id) => {
    expect(cardId(card)).toBe(id);
    expect(parseCardId(id)).toEqual(card);
  });

  it('accepts "10X" as an alias for "TX"', () => {
    expect(parseCardId('10H')).toEqual({ suit: 'hearts', rank: 10 });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(parseCardId(' qs ')).toEqual({ suit: 'spades', rank: 12 });
  });

  it('returns undefined for malformed input', () => {
    expect(parseCardId('')).toBeUndefined();
    expect(parseCardId('1Z')).toBeUndefined();
    expect(parseCardId('QSS')).toBeUndefined();
    expect(parseCardId('Q')).toBeUndefined();
  });
});

describe('cardsEqual / containsCard', () => {
  const queenOfSpades = { suit: 'spades', rank: 12 } as const;

  it('treats structurally-identical cards as equal', () => {
    expect(cardsEqual(queenOfSpades, { suit: 'spades', rank: 12 })).toBe(true);
    expect(cardsEqual(queenOfSpades, { suit: 'hearts', rank: 12 })).toBe(false);
  });

  it('finds a structurally-identical card in a list', () => {
    const hand = [queenOfSpades, { suit: 'clubs', rank: 2 } as const];
    expect(containsCard(hand, { suit: 'spades', rank: 12 })).toBe(true);
    expect(containsCard(hand, { suit: 'hearts', rank: 2 })).toBe(false);
  });
});

describe('removeCards', () => {
  it('removes exactly the requested cards, leaving the rest untouched', () => {
    const hand = [
      { suit: 'clubs', rank: 2 } as const,
      { suit: 'hearts', rank: 5 } as const,
      { suit: 'spades', rank: 12 } as const,
    ];
    const result = removeCards(hand, [{ suit: 'hearts', rank: 5 }]);
    expect(result.map(cardId)).toEqual(['2C', 'QS']);
  });

  it('throws if a requested card is not present', () => {
    const hand = [{ suit: 'clubs', rank: 2 } as const];
    expect(() => removeCards(hand, [{ suit: 'hearts', rank: 5 }])).toThrow();
  });
});

describe('sortCards', () => {
  it('orders by suit (clubs, diamonds, hearts, spades), then rank ascending', () => {
    const shuffled = [
      { suit: 'spades', rank: 2 } as const,
      { suit: 'hearts', rank: 14 } as const,
      { suit: 'clubs', rank: 10 } as const,
      { suit: 'clubs', rank: 2 } as const,
      { suit: 'diamonds', rank: 5 } as const,
    ];
    expect(sortCards(shuffled).map(cardId)).toEqual(['2C', 'TC', '5D', 'AH', '2S']);
  });
});
