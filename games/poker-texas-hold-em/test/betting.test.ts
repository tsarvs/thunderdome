import { describe, expect, it } from 'vitest';
import { applyPlayerAction } from '../src/betting.js';
import { player, pokerState } from './fixtures.js';

describe('applyPlayerAction — fold', () => {
  it('marks the player folded and drops them from playersToAct without moving chips', () => {
    const state = pokerState({
      currentBet: 20,
      players: { alice: player({ committedThisStreet: 0 }), bob: player({ committedThisStreet: 20 }) },
      playersToAct: ['alice'],
    });
    const result = applyPlayerAction(state, 'alice', { type: 'fold' });
    expect(result.state.players.alice?.folded).toBe(true);
    expect(result.state.playersToAct).toEqual([]);
    expect(result.state.stacks.alice).toBe(state.stacks.alice);
    expect(result.events).toEqual([{ type: 'action', participantIds: ['alice'], data: { action: 'fold' } }]);
  });
});

describe('applyPlayerAction — check', () => {
  it('drops the player from playersToAct without moving chips', () => {
    const state = pokerState({ currentBet: 0, playersToAct: ['alice'] });
    const result = applyPlayerAction(state, 'alice', { type: 'check' });
    expect(result.state.playersToAct).toEqual([]);
    expect(result.state.players.alice).toEqual(state.players.alice);
    expect(result.state.stacks.alice).toBe(state.stacks.alice);
  });
});

describe('applyPlayerAction — call', () => {
  it('commits exactly the amount needed to match currentBet', () => {
    const state = pokerState({ currentBet: 20, playersToAct: ['alice'] });
    const result = applyPlayerAction(state, 'alice', { type: 'call' });
    expect(result.state.players.alice?.committed).toBe(20);
    expect(result.state.players.alice?.committedThisStreet).toBe(20);
    expect(result.state.players.alice?.allIn).toBe(false);
    expect(result.state.stacks.alice).toBe(980);
    expect(result.state.playersToAct).toEqual([]);
    expect(result.events).toEqual([
      { type: 'action', participantIds: ['alice'], data: { action: 'call', amount: 20 } },
    ]);
  });

  it('caps the call at the remaining stack and marks the player all-in on a short call', () => {
    const state = pokerState({
      currentBet: 100,
      stacks: { alice: 40, bob: 1000 },
      playersToAct: ['alice'],
    });
    const result = applyPlayerAction(state, 'alice', { type: 'call' });
    expect(result.state.players.alice?.committed).toBe(40);
    expect(result.state.stacks.alice).toBe(0);
    expect(result.state.players.alice?.allIn).toBe(true);
  });
});

describe('applyPlayerAction — raise', () => {
  // 60 - 20 (the old currentBet) >= the old minRaise (20), so this is a full raise: minRaise
  // becomes that same 40 increment.
  it('a full raise updates currentBet/minRaise and reopens action for other live players', () => {
    const state = pokerState({
      participantIds: ['alice', 'bob', 'carol'],
      seatOrder: ['alice', 'bob', 'carol'],
      players: { alice: player(), bob: player(), carol: player() },
      currentBet: 20,
      minRaise: 20,
      playersToAct: ['alice'],
    });
    const result = applyPlayerAction(state, 'alice', { type: 'raise', amount: 60 });
    expect(result.state.currentBet).toBe(60);
    expect(result.state.minRaise).toBe(40);
    expect(result.state.players.alice?.committed).toBe(60);
    expect(result.state.playersToAct.sort()).toEqual(['bob', 'carol']);
  });

  it('a short (under-minRaise) raise still updates currentBet but leaves minRaise unchanged', () => {
    const state = pokerState({ currentBet: 20, minRaise: 20, playersToAct: ['alice'] });
    const result = applyPlayerAction(state, 'alice', { type: 'raise', amount: 30 });
    expect(result.state.currentBet).toBe(30);
    expect(result.state.minRaise).toBe(20);
    expect(result.state.playersToAct).toEqual(['bob']);
  });

  it('never reopens action for a folded or already-all-in player', () => {
    const state = pokerState({
      participantIds: ['alice', 'bob', 'carol'],
      seatOrder: ['alice', 'bob', 'carol'],
      players: {
        alice: player(),
        bob: player({ folded: true }),
        carol: player({ allIn: true }),
      },
      currentBet: 20,
      minRaise: 20,
      playersToAct: ['alice'],
    });
    const result = applyPlayerAction(state, 'alice', { type: 'raise', amount: 100 });
    expect(result.state.playersToAct).toEqual([]);
  });
});

describe('applyPlayerAction — allIn', () => {
  it('behaves like a call (no reopen) when the all-in amount does not exceed currentBet', () => {
    const state = pokerState({ currentBet: 100, stacks: { alice: 40, bob: 1000 }, playersToAct: ['alice'] });
    const result = applyPlayerAction(state, 'alice', { type: 'allIn' });
    expect(result.state.currentBet).toBe(100);
    expect(result.state.players.alice?.committed).toBe(40);
    expect(result.state.players.alice?.allIn).toBe(true);
    expect(result.state.playersToAct).toEqual([]);
    expect(result.events).toEqual([
      { type: 'action', participantIds: ['alice'], data: { action: 'allIn', amount: 40 } },
    ]);
  });

  it('behaves like a raise (reopens action) when the all-in amount exceeds currentBet', () => {
    const state = pokerState({ currentBet: 20, minRaise: 20, playersToAct: ['alice'] });
    const result = applyPlayerAction(state, 'alice', { type: 'allIn' });
    expect(result.state.currentBet).toBe(1000);
    expect(result.state.minRaise).toBe(980);
    expect(result.state.playersToAct).toEqual(['bob']);
  });
});
