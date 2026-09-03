import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { pokerTexasHoldEm } from '../src/game.js';
import type { PokerTexasHoldEmAction, PokerTexasHoldEmState } from '../src/types.js';

function rng(seed = 1) {
  return createRng(Buffer.alloc(16, seed));
}

const TWO_PLAYERS = ['alice', 'bob'];

function config(overrides?: Partial<Parameters<typeof pokerTexasHoldEm.parseConfig>[0]>) {
  const result = pokerTexasHoldEm.parseConfig({
    startingStack: 200,
    smallBlind: 5,
    bigBlind: 10,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(participantIds: string[], overrides?: Parameters<typeof config>[0], seed = 1) {
  return pokerTexasHoldEm.initialize({ config: config(overrides), participantIds, rng: rng(seed) });
}

function actingParticipant(state: PokerTexasHoldEmState): string {
  const [entry] = pokerTexasHoldEm.getPendingActions(state);
  if (entry === undefined) {
    throw new Error('no pending action — state is terminal');
  }
  return entry.participantId;
}

/** Drives one action from whoever's currently up. */
function act(state: PokerTexasHoldEmState, action: PokerTexasHoldEmAction, seed = 1) {
  const participantId = actingParticipant(state);
  const validated = pokerTexasHoldEm.validateAction(state, participantId, action);
  if (!validated.ok) {
    throw new Error(`${participantId}'s ${action.type} rejected: ${validated.reason}`);
  }
  const actions = new Map([[participantId, validated.value]]);
  return { participantId, ...pokerTexasHoldEm.resolve({ state, actions, rng: rng(seed) }) };
}

describe('pokerTexasHoldEm.parseConfig', () => {
  it('defaults to an elimination match with sensible blinds/stack', () => {
    const result = pokerTexasHoldEm.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        matchFormat: 'elimination',
        totalHands: 10,
        startingStack: 1000,
        smallBlind: 10,
        bigBlind: 20,
      });
    }
  });

  it('rejects a bigBlind that does not exceed smallBlind', () => {
    expect(pokerTexasHoldEm.parseConfig({ smallBlind: 10, bigBlind: 10 }).ok).toBe(false);
  });

  it('rejects a startingStack too small to post blinds twice over', () => {
    expect(pokerTexasHoldEm.parseConfig({ bigBlind: 20, startingStack: 30 }).ok).toBe(false);
  });
});

describe('pokerTexasHoldEm.initialize', () => {
  it('rejects a roster outside [2, 10]', () => {
    expect(() =>
      pokerTexasHoldEm.initialize({ config: config(), participantIds: ['alice'], rng: rng() }),
    ).toThrow();
    expect(() =>
      pokerTexasHoldEm.initialize({
        config: config(),
        participantIds: Array.from({ length: 11 }, (_, i) => `p${String(i)}`),
        rng: rng(),
      }),
    ).toThrow();
  });

  // This config's blinds are smallBlind: 5, bigBlind: 10 (see `config()` above).
  it('deals two hole cards to every seated participant and posts blinds', () => {
    const state = initialState(TWO_PLAYERS);
    expect(state.seatOrder.sort()).toEqual([...TWO_PLAYERS].sort());
    for (const id of TWO_PLAYERS) {
      expect(state.players[id]?.holeCards).toHaveLength(2);
    }
    const totalCommitted = TWO_PLAYERS.reduce((sum, id) => sum + (state.players[id]?.committed ?? 0), 0);
    expect(totalCommitted).toBe(15);
    expect(state.street).toBe('preflop');
    expect(state.matchComplete).toBe(false);
  });

  it('heads-up: the button posts the small blind and acts first preflop', () => {
    const state = initialState(TWO_PLAYERS);
    const button = state.buttonParticipantId;
    const other = TWO_PLAYERS.find((id) => id !== button);
    expect(other).toBeDefined();
    expect(state.players[button]?.committed).toBe(5);
    expect(state.players[other ?? '']?.committed).toBe(10);
    expect(actingParticipant(state)).toBe(button);
  });
});

describe('pokerTexasHoldEm.getObservation', () => {
  it("reveals only your own hole cards and exposes opponents' public info", () => {
    const state = initialState(TWO_PLAYERS);
    const [firstId] = TWO_PLAYERS;
    if (firstId === undefined) throw new Error('unreachable');
    const observation = pokerTexasHoldEm.getObservation(state, firstId);
    expect(observation.holeCards).toHaveLength(2);
    expect(observation.opponents).toHaveLength(1);
    expect(observation.opponents[0]).not.toHaveProperty('holeCards');
    expect(observation.pot).toBe(15);
  });

  // `actor` here is the button/small-blind, facing the big blind.
  it('reports toCall/legalActions correctly for the player facing the big blind preflop', () => {
    const state = initialState(TWO_PLAYERS);
    const actor = actingParticipant(state);
    const observation = pokerTexasHoldEm.getObservation(state, actor);
    expect(observation.toCall).toBe(5);
    expect(observation.legalActions).toContain('call');
    expect(observation.legalActions).not.toContain('check');
  });

  it('throws for a participant id outside the roster', () => {
    const state = initialState(TWO_PLAYERS);
    expect(() => pokerTexasHoldEm.getObservation(state, 'eve')).toThrow();
  });
});

describe('pokerTexasHoldEm.validateAction', () => {
  it('rejects a check when there is a bet to call', () => {
    const state = initialState(TWO_PLAYERS);
    const actor = actingParticipant(state);
    expect(pokerTexasHoldEm.validateAction(state, actor, { type: 'check' }).ok).toBe(false);
  });

  // currentBet=10 (bigBlind), minRaise=10 -> a legal raise must reach >= 20.
  it('rejects a raise below the minimum raise size unless it is an all-in', () => {
    const state = initialState(TWO_PLAYERS);
    const actor = actingParticipant(state);
    expect(pokerTexasHoldEm.validateAction(state, actor, { type: 'raise', amount: 15 }).ok).toBe(false);
    expect(pokerTexasHoldEm.validateAction(state, actor, { type: 'raise', amount: 20 }).ok).toBe(true);
  });

  it('rejects committing more than your stack', () => {
    const state = initialState(TWO_PLAYERS, { startingStack: 200 });
    const actor = actingParticipant(state);
    expect(pokerTexasHoldEm.validateAction(state, actor, { type: 'raise', amount: 10_000 }).ok).toBe(false);
  });

  it('rejects malformed actions', () => {
    const state = initialState(TWO_PLAYERS);
    const actor = actingParticipant(state);
    expect(pokerTexasHoldEm.validateAction(state, actor, { type: 'raise' }).ok).toBe(false);
    expect(pokerTexasHoldEm.validateAction(state, actor, { noop: true }).ok).toBe(false);
  });
});

describe('pokerTexasHoldEm.resolve — betting progression', () => {
  it('advances preflop -> flop once both players call/check through', () => {
    let state = initialState(TWO_PLAYERS);
    ({ nextState: state } = act(state, { type: 'call' }));
    ({ nextState: state } = act(state, { type: 'check' }));
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(Object.values(state.players).every((p) => p.committedThisStreet === 0)).toBe(true);
  });

  // A new hand is already dealt by the time resolve() returns (2 players never bust from a
  // single small-blind hand), so the fold-win itself is checked via the *previous* hand's
  // recorded lastHandSummary rather than the fresh live state.
  it('ends the hand immediately when everyone but one player folds', () => {
    let state = initialState(TWO_PLAYERS);
    const button = state.buttonParticipantId;
    ({ nextState: state } = act(state, { type: 'fold' }));
    const winner = TWO_PLAYERS.find((id) => id !== button);
    expect(winner).toBeDefined();
    expect(state.lastHandSummary?.reason).toBe('fold');
    expect(state.lastHandSummary?.winners[0]?.participantId).toBe(winner);
    expect(state.lastHandSummary?.winners[0]?.amount).toBe(15);
    expect(state.handNumber).toBe(1);
  });

  // Everyone just checks through every street, so the final pot is only the two blinds.
  it('runs a hand all the way to a river showdown and pays the winner', () => {
    let state = initialState(TWO_PLAYERS, { startingStack: 1000 });
    ({ nextState: state } = act(state, { type: 'call' }));
    ({ nextState: state } = act(state, { type: 'check' }));
    expect(state.street).toBe('flop');
    ({ nextState: state } = act(state, { type: 'check' }));
    ({ nextState: state } = act(state, { type: 'check' }));
    expect(state.street).toBe('turn');
    ({ nextState: state } = act(state, { type: 'check' }));
    ({ nextState: state } = act(state, { type: 'check' }));
    expect(state.street).toBe('river');
    ({ nextState: state } = act(state, { type: 'check' }));
    ({ nextState: state } = act(state, { type: 'check' }));

    expect(state.lastHandSummary?.reason).toBe('showdown');
    expect(state.lastHandSummary?.showdown).toHaveLength(2);
    const totalWon = state.lastHandSummary?.winners.reduce((sum, w) => sum + w.amount, 0) ?? 0;
    expect(totalWon).toBe(20);
    expect(state.handNumber).toBe(1);
  });

  it('runs out remaining streets automatically once both players are all-in', () => {
    let state = initialState(TWO_PLAYERS, { startingStack: 100 });
    ({ nextState: state } = act(state, { type: 'allIn' }));
    ({ nextState: state } = act(state, { type: 'allIn' }));
    expect(state.lastHandSummary).not.toBeNull();
    expect(state.lastHandSummary?.board).toHaveLength(5);
  });

  it('busts the loser of an all-in and ends the heads-up match', () => {
    let state = initialState(TWO_PLAYERS, { startingStack: 100 });
    ({ nextState: state } = act(state, { type: 'allIn' }));
    ({ nextState: state } = act(state, { type: 'allIn' }));
    expect(pokerTexasHoldEm.isTerminal(state)).toBe(true);
    const stacks = Object.values(state.stacks);
    expect(stacks.filter((s) => s > 0)).toHaveLength(1);
    expect(stacks.reduce((a, b) => a + b, 0)).toBe(200);
  });
});

describe('pokerTexasHoldEm — fixedHands format', () => {
  // getResult().handsPlayed is 1-indexed; state.handNumber itself stays 0-indexed.
  it('ends the match once totalHands hands have been played', () => {
    let state = initialState(TWO_PLAYERS, { matchFormat: 'fixedHands', totalHands: 2, startingStack: 5000 });
    for (let hand = 0; hand < 2 && !pokerTexasHoldEm.isTerminal(state); hand += 1) {
      let guard = 0;
      while (!pokerTexasHoldEm.isTerminal(state) && guard < 20) {
        const actor = actingParticipant(state);
        const observation = pokerTexasHoldEm.getObservation(state, actor);
        const action: PokerTexasHoldEmAction = observation.toCall === 0 ? { type: 'check' } : { type: 'call' };
        ({ nextState: state } = act(state, action));
        guard += 1;
        if (state.handNumber > hand) break;
      }
    }
    expect(pokerTexasHoldEm.isTerminal(state)).toBe(true);
    expect(pokerTexasHoldEm.getResult(state).handsPlayed).toBe(2);
  });
});

describe('pokerTexasHoldEm.getResult / getStandingOutcomes', () => {
  it('ranks the sole chip leader as the winner once the match ends', () => {
    let state = initialState(TWO_PLAYERS, { startingStack: 100 });
    ({ nextState: state } = act(state, { type: 'allIn' }));
    ({ nextState: state } = act(state, { type: 'allIn' }));
    const result = pokerTexasHoldEm.getResult(state);
    const outcomes = pokerTexasHoldEm.getStandingOutcomes(result);
    const winner = outcomes.find((o) => o.rank === 1);
    const loser = outcomes.find((o) => o.rank === 2);
    expect(winner?.outcome).toBe('win');
    expect(loser?.outcome).toBe('loss');
    expect(result.stacks[winner?.participantId ?? '']).toBe(200);
  });
});
