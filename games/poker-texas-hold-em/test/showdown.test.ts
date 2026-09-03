import type { RoundEvent } from '@thunderdome/engine';
import { describe, expect, it } from 'vitest';
import { awardPotToSoleWinner, doShowdown } from '../src/showdown.js';
import { cards, holeCards, player, pokerState } from './fixtures.js';

describe('awardPotToSoleWinner', () => {
  it('awards the entire pot, including a folded opponent’s dead chips, to the sole winner', () => {
    const state = pokerState({
      players: {
        alice: player({ committed: 30 }),
        bob: player({ committed: 30, folded: true }),
      },
      stacks: { alice: 970, bob: 970 },
      board: [],
    });
    const events: RoundEvent[] = [];
    const result = awardPotToSoleWinner(state, 'alice', events);
    expect(result.stacks.alice).toBe(1030);
    expect(result.stacks.bob).toBe(970);
    expect(result.lastHandSummary).toEqual({
      handNumber: 0,
      winners: [{ participantId: 'alice', amount: 60 }],
      reason: 'fold',
      board: [],
    });
    expect(events).toEqual([
      { type: 'hand-complete', participantIds: ['alice'], data: result.lastHandSummary },
    ]);
  });
});

// `board` is a pair of queens, shared by every `doShowdown` test below.
describe('doShowdown', () => {
  const board = cards(['2C', '5D', '9H', 'QS', 'QC']);

  // alice (AA) makes two pair, Q+A; bob (KK) makes two pair, Q+K — alice's the better hand and
  // takes the full 200 pot on top of her existing 900 stack.
  it('awards a single pot to the best hand among equal contributions', () => {
    const state = pokerState({
      players: {
        alice: player({ holeCards: holeCards('AC', 'AD'), committed: 100 }),
        bob: player({ holeCards: holeCards('KC', 'KD'), committed: 100 }),
      },
      stacks: { alice: 900, bob: 900 },
      board,
      street: 'river',
    });
    const result = doShowdown(state, []);
    expect(result.stacks.alice).toBe(1100);
    expect(result.stacks.bob).toBe(900);
    expect(result.lastHandSummary?.reason).toBe('showdown');
    expect(result.lastHandSummary?.winners).toEqual([{ participantId: 'alice', amount: 200 }]);
    expect(result.lastHandSummary?.showdown).toHaveLength(2);
  });

  // a is a short all-in (30); b and c each put in 100; d folded after committing 20. a's hand
  // (AA) beats everyone, but a is only eligible for the 30-per-player main pot layer(s) — the b/c
  // side pot goes to whichever of them has the better hand (b, with KK over c's JJ). Expected
  // payouts: main-pot layers (80 + 30, both a/b/c-eligible) go to a = 110; the b/c-only side pot
  // (140) goes to b; c and folded d get nothing. Every committed chip is accounted for: 30 + 100
  // + 100 + 20 = 250 = 110 + 140.
  it('splits side pots by contribution layer, each layer’s winner decided independently', () => {
    const state = pokerState({
      participantIds: ['a', 'b', 'c', 'd'],
      seatOrder: ['a', 'b', 'c', 'd'],
      players: {
        a: player({ holeCards: holeCards('AC', 'AD'), committed: 30, allIn: true }),
        b: player({ holeCards: holeCards('KC', 'KD'), committed: 100 }),
        c: player({ holeCards: holeCards('JC', 'JD'), committed: 100 }),
        d: player({ holeCards: holeCards('7C', '7D'), committed: 20, folded: true }),
      },
      stacks: { a: 0, b: 900, c: 900, d: 980 },
      board,
      street: 'river',
    });
    const result = doShowdown(state, []);
    expect(result.stacks.a).toBe(110);
    expect(result.stacks.b).toBe(1040);
    expect(result.stacks.c).toBe(900);
    expect(result.stacks.d).toBe(980);
    expect(result.lastHandSummary?.winners).toEqual([
      { participantId: 'a', amount: 110 },
      { participantId: 'b', amount: 140 },
    ]);
    expect(result.lastHandSummary?.showdown).toHaveLength(3);
  });

  // The board alone is a royal flush — the unbeatable nuts — so x and y necessarily tie
  // regardless of their hole cards (x is the button); z folded after contributing just 1 chip,
  // which peels off a tiny first layer (3, eligible x/y) ahead of a larger second layer (98,
  // eligible x/y). Both layers split evenly between the tied x/y, so the only remainder is the
  // first layer's odd chip (3 / 2 players), which goes to y as the seat right after the button.
  it('splits a tied pot evenly, handing any odd remainder chip to the seat after the button first', () => {
    const nuts = cards(['TS', 'JS', 'QS', 'KS', 'AS']);
    const state = pokerState({
      participantIds: ['x', 'y', 'z'],
      seatOrder: ['x', 'y', 'z'],
      players: {
        x: player({ holeCards: holeCards('2C', '3C'), committed: 50 }),
        y: player({ holeCards: holeCards('4D', '5D'), committed: 50 }),
        z: player({ holeCards: holeCards('6H', '7H'), committed: 1, folded: true }),
      },
      stacks: { x: 950, y: 950, z: 999 },
      board: nuts,
      street: 'river',
    });
    const result = doShowdown(state, []);
    expect(result.stacks.x).toBe(1000);
    expect(result.stacks.y).toBe(1001);
    expect(result.stacks.z).toBe(999);
  });
});
