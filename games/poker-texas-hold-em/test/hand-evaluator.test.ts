import { describe, expect, it } from 'vitest';
import { bestHand, compareHandRank, evaluateFiveCardHand } from '../src/hand-evaluator.js';
import { cards } from './fixtures.js';

describe('evaluateFiveCardHand', () => {
  it('recognizes a straight flush, including the wheel (A-2-3-4-5) as 5-high', () => {
    const broadway = evaluateFiveCardHand(cards(['TC', 'JC', 'QC', 'KC', 'AC']));
    expect(broadway.category).toBe('straight-flush');
    expect(broadway.tiebreakers).toEqual([14]);

    const wheel = evaluateFiveCardHand(cards(['AC', '2D', '3H', '4S', '5C']));
    expect(wheel.category).toBe('straight');
    expect(wheel.tiebreakers).toEqual([5]);
  });

  it('recognizes four of a kind with the correct kicker', () => {
    const hand = evaluateFiveCardHand(cards(['AC', 'AD', 'AH', 'AS', '2C']));
    expect(hand.category).toBe('four-of-a-kind');
    expect(hand.tiebreakers).toEqual([14, 2]);
  });

  it('recognizes a full house ordered trips-then-pair', () => {
    const hand = evaluateFiveCardHand(cards(['8C', '8D', '8H', '2S', '2C']));
    expect(hand.category).toBe('full-house');
    expect(hand.tiebreakers).toEqual([8, 2]);
  });

  it('recognizes a flush ranked by all 5 cards descending', () => {
    const hand = evaluateFiveCardHand(cards(['2C', '5C', '9C', 'JC', 'KC']));
    expect(hand.category).toBe('flush');
    expect(hand.tiebreakers).toEqual([13, 11, 9, 5, 2]);
  });

  it('recognizes a non-flush straight', () => {
    const hand = evaluateFiveCardHand(cards(['4C', '5D', '6H', '7S', '8C']));
    expect(hand.category).toBe('straight');
    expect(hand.tiebreakers).toEqual([8]);
  });

  it('recognizes three of a kind with kickers descending', () => {
    const hand = evaluateFiveCardHand(cards(['9C', '9D', '9H', 'KC', '3D']));
    expect(hand.category).toBe('three-of-a-kind');
    expect(hand.tiebreakers).toEqual([9, 13, 3]);
  });

  it('recognizes two pair, breaking a tie on the kicker', () => {
    const better = evaluateFiveCardHand(cards(['TC', 'TD', '8H', '8S', 'AC']));
    const worse = evaluateFiveCardHand(cards(['TC', 'TD', '8H', '8S', '2C']));
    expect(better.category).toBe('two-pair');
    expect(better.tiebreakers).toEqual([10, 8, 14]);
    expect(compareHandRank(better, worse)).toBeGreaterThan(0);
  });

  it('recognizes one pair with kickers descending', () => {
    const hand = evaluateFiveCardHand(cards(['6C', '6D', 'KC', '9H', '2S']));
    expect(hand.category).toBe('pair');
    expect(hand.tiebreakers).toEqual([6, 13, 9, 2]);
  });

  it('falls back to high card, ranked by all 5 cards descending', () => {
    const hand = evaluateFiveCardHand(cards(['2C', '5D', '9H', 'JC', 'KC']));
    expect(hand.category).toBe('high-card');
    expect(hand.tiebreakers).toEqual([13, 11, 9, 5, 2]);
  });

  it('throws unless given exactly 5 cards', () => {
    expect(() => evaluateFiveCardHand(cards(['2C', '5D']))).toThrow();
    expect(() => evaluateFiveCardHand(cards(['2C', '5D', '9H', 'JC', 'KC', 'AC']))).toThrow();
  });
});

describe('compareHandRank', () => {
  it('ranks a straight flush above four of a kind', () => {
    const straightFlush = evaluateFiveCardHand(cards(['5C', '6C', '7C', '8C', '9C']));
    const quads = evaluateFiveCardHand(cards(['AC', 'AD', 'AH', 'AS', '2C']));
    expect(compareHandRank(straightFlush, quads)).toBeGreaterThan(0);
  });

  it('treats two identically-ranked hands as a tie', () => {
    const a = evaluateFiveCardHand(cards(['AC', 'AD', '8H', '8S', '2C']));
    const b = evaluateFiveCardHand(cards(['AS', 'AH', '8C', '8D', '2S']));
    expect(compareHandRank(a, b)).toBe(0);
  });
});

describe('bestHand', () => {
  // The board alone is already trip nines with 5/4 kickers; the hole cards (2, 3) are worse than
  // both board kickers, so the best hand is the board's own 5 cards, untouched.
  it('picks the best 5 of 7 cards, ignoring hole cards that do not help', () => {
    const hand = bestHand(cards(['2C', '3D', '9C', '9D', '9H', '4S', '5H']));
    expect(hand.category).toBe('three-of-a-kind');
    expect(hand.tiebreakers).toEqual([9, 5, 4]);
  });

  it('uses both hole cards to complete a flush not fully on the board', () => {
    const hand = bestHand(cards(['AS', 'KS', '2S', '7S', '9S', 'QC', '3D']));
    expect(hand.category).toBe('flush');
    expect(hand.tiebreakers).toEqual([14, 13, 9, 7, 2]);
  });

  it('throws unless given at least 5 cards', () => {
    expect(() => bestHand(cards(['2C', '5D', '9H', 'JC']))).toThrow();
  });
});
