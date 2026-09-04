import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { cardId, standardDeck } from '../src/cards.js';
import { dealHands, shuffle } from '../src/deck.js';

describe('shuffle', () => {
  it('is deterministic for a fixed seed', () => {
    const deck = standardDeck();
    const a = shuffle(deck, createRng(Buffer.alloc(16, 1)));
    const b = shuffle(deck, createRng(Buffer.alloc(16, 1)));
    expect(a.map(cardId)).toEqual(b.map(cardId));
  });

  it('produces a different order for a different seed', () => {
    const deck = standardDeck();
    const a = shuffle(deck, createRng(Buffer.alloc(16, 1)));
    const b = shuffle(deck, createRng(Buffer.alloc(16, 2)));
    expect(a.map(cardId)).not.toEqual(b.map(cardId));
  });

  it('is a true permutation: same multiset in and out', () => {
    const deck = standardDeck();
    const shuffled = shuffle(deck, createRng(Buffer.alloc(16, 1)));
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map(cardId))).toEqual(new Set(deck.map(cardId)));
  });

  it('does not mutate the input array', () => {
    const deck = standardDeck();
    const original = deck.map(cardId);
    shuffle(deck, createRng(Buffer.alloc(16, 1)));
    expect(deck.map(cardId)).toEqual(original);
  });
});

describe('dealHands', () => {
  it('splits into even, non-overlapping groups covering every input card', () => {
    const deck = shuffle(standardDeck(), createRng(Buffer.alloc(16, 1)));
    const hands = dealHands(deck, 4);
    expect(hands).toHaveLength(4);
    for (const hand of hands) {
      expect(hand).toHaveLength(13);
    }
    const allIds = hands.flat().map(cardId);
    expect(new Set(allIds).size).toBe(52);
    expect(new Set(allIds)).toEqual(new Set(deck.map(cardId)));
  });

  it('throws when the deck does not divide evenly among the hands', () => {
    const deck = standardDeck();
    expect(() => dealHands(deck, 5)).toThrow();
  });

  it('throws for a non-positive or non-integer numHands', () => {
    const deck = standardDeck();
    expect(() => dealHands(deck, 0)).toThrow();
    expect(() => dealHands(deck, -1)).toThrow();
    expect(() => dealHands(deck, 1.5)).toThrow();
  });
});
