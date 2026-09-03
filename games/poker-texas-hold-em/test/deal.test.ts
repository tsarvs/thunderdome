import { cardId } from '@thunderdome/card-kit';
import { describe, expect, it } from 'vitest';
import { dealNewHand } from '../src/deal.js';
import { nextButton, preflopFirstToActIndex } from '../src/table.js';
import { rng, testConfig } from './fixtures.js';

const TWO_PLAYERS = ['alice', 'bob'];
const FOUR_PLAYERS = ['alice', 'bob', 'carol', 'dave'];

function stacksOf(participantIds: readonly string[], amount: number): Record<string, number> {
  return Object.fromEntries(participantIds.map((id) => [id, amount]));
}

describe('dealNewHand', () => {
  it('deals 2 unique hole cards per seat with no duplicates across the whole deal', () => {
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      new Set(),
      null,
      0,
      testConfig(),
      rng(),
    );
    const dealtCardIds = [
      ...Object.values(dealt.players).flatMap((player) => player.holeCards.map(cardId)),
      ...dealt.remainingBoardCards.map(cardId),
    ];
    expect(new Set(dealtCardIds).size).toBe(dealtCardIds.length);
    for (const id of dealt.seatOrder) {
      expect(dealt.players[id]?.holeCards).toHaveLength(2);
    }
  });

  it('picks a random button from the active roster on the very first hand', () => {
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      new Set(),
      null,
      0,
      testConfig(),
      rng(),
    );
    expect(FOUR_PLAYERS).toContain(dealt.buttonParticipantId);
  });

  it('rotates the button via table.nextButton on every later hand', () => {
    const bustedOut = new Set(['carol']);
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      bustedOut,
      'bob',
      1,
      testConfig(),
      rng(),
    );
    expect(dealt.buttonParticipantId).toBe(nextButton(FOUR_PLAYERS, 'bob', bustedOut));
    expect(dealt.seatOrder).not.toContain('carol');
  });

  it('heads-up: the button posts the small blind, the other seat posts the big blind', () => {
    const config = testConfig({ smallBlind: 10, bigBlind: 20 });
    const dealt = dealNewHand(
      TWO_PLAYERS,
      stacksOf(TWO_PLAYERS, 1000),
      new Set(),
      'bob',
      1,
      config,
      rng(),
    );
    const [button, other] = dealt.seatOrder;
    expect(button).toBeDefined();
    expect(other).toBeDefined();
    expect(dealt.players[button ?? '']?.committed).toBe(10);
    expect(dealt.players[other ?? '']?.committed).toBe(20);
    expect(dealt.currentBet).toBe(20);
    expect(dealt.minRaise).toBe(20);
  });

  it('3+ handed: seats 1 and 2 (not the button) post the blinds', () => {
    const config = testConfig({ smallBlind: 5, bigBlind: 10 });
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      new Set(),
      'alice',
      1,
      config,
      rng(),
    );
    const [button, sb, bb, utg] = dealt.seatOrder;
    expect(dealt.players[button ?? '']?.committed).toBe(0);
    expect(dealt.players[sb ?? '']?.committed).toBe(5);
    expect(dealt.players[bb ?? '']?.committed).toBe(10);
    expect(dealt.players[utg ?? '']?.committed).toBe(0);
  });

  // previousButtonParticipantId 'bob' -> button rotates to 'alice' in a 2-seat roster, so alice
  // is deterministically the small blind here.
  it('posts a short blind (and marks all-in) when a blind seat cannot cover it', () => {
    const config = testConfig({ smallBlind: 10, bigBlind: 20 });
    const stacks = { alice: 3, bob: 1000 };
    const dealt = dealNewHand(TWO_PLAYERS, stacks, new Set(), 'bob', 1, config, rng());
    expect(dealt.buttonParticipantId).toBe('alice');
    expect(dealt.players.alice?.committed).toBe(3);
    expect(dealt.players.alice?.allIn).toBe(true);
    expect(dealt.playersToAct).not.toContain('alice');
    expect(dealt.stacks.alice).toBe(0);
  });

  it('excludes busted participants from the dealt hand entirely', () => {
    const bustedOut = new Set(['bob']);
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      bustedOut,
      'alice',
      1,
      testConfig(),
      rng(),
    );
    expect(dealt.seatOrder).not.toContain('bob');
    expect(dealt.players.bob).toBeUndefined();
  });

  it('sets actingIndex as a one-before pointer to the true preflop first-to-act seat', () => {
    const dealt = dealNewHand(
      FOUR_PLAYERS,
      stacksOf(FOUR_PLAYERS, 1000),
      new Set(),
      'alice',
      1,
      testConfig(),
      rng(),
    );
    const n = dealt.seatOrder.length;
    expect((dealt.actingIndex + 1) % n).toBe(preflopFirstToActIndex(n));
  });

  it('emits hand-started and blinds-posted events', () => {
    const dealt = dealNewHand(
      TWO_PLAYERS,
      stacksOf(TWO_PLAYERS, 1000),
      new Set(),
      'bob',
      1,
      testConfig(),
      rng(),
    );
    expect(dealt.events.map((event) => event.type)).toEqual(['hand-started', 'blinds-posted']);
  });
});
