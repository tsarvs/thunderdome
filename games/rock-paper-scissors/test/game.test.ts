import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { rockPaperScissors } from '../src/game.js';
import type { RpsChoice } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

function initialState(
  totalRounds = 3,
  onMissingAction: 'loseRound' | 'forfeitMatch' = 'forfeitMatch',
) {
  const configResult = rockPaperScissors.parseConfig({ totalRounds, onMissingAction });
  if (!configResult.ok) {
    throw new Error(configResult.reason);
  }
  return rockPaperScissors.initialize({
    config: configResult.value,
    participantIds: ['alice', 'bob'],
    rng,
  });
}

function playRound(state: ReturnType<typeof initialState>, choiceA: RpsChoice, choiceB: RpsChoice) {
  return rockPaperScissors.resolve({
    state,
    actions: new Map([
      ['alice', { choice: choiceA }],
      ['bob', { choice: choiceB }],
    ]),
    rng,
  }).nextState;
}

describe('rockPaperScissors.parseConfig', () => {
  it('accepts a valid totalRounds and defaults onMissingAction', () => {
    const result = rockPaperScissors.parseConfig({ totalRounds: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ totalRounds: 3, onMissingAction: 'forfeitMatch' });
    }
  });

  it('defaults totalRounds to 300 when omitted', () => {
    const result = rockPaperScissors.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRounds).toBe(300);
    }
  });

  it('accepts an even totalRounds — no odd-number constraint anymore', () => {
    expect(rockPaperScissors.parseConfig({ totalRounds: 4 }).ok).toBe(true);
  });

  it('rejects a non-positive totalRounds', () => {
    expect(rockPaperScissors.parseConfig({ totalRounds: -1 }).ok).toBe(false);
  });
});

describe('rockPaperScissors.getObservation', () => {
  it('never reveals the opponent identity as ambiguous and starts with no history', () => {
    const state = initialState();
    const aliceView = rockPaperScissors.getObservation(state, 'alice');
    expect(aliceView).toEqual({
      round: 0,
      totalRounds: 3,
      yourWins: 0,
      opponentWins: 0,
      opponentId: 'bob',
      history: [],
    });
  });

  it('is symmetric — bob sees alice as the opponent', () => {
    const state = initialState();
    const bobView = rockPaperScissors.getObservation(state, 'bob');
    expect(bobView.opponentId).toBe('alice');
  });
});

describe('rockPaperScissors.validateAction', () => {
  it('accepts a valid choice', () => {
    const state = initialState();
    const result = rockPaperScissors.validateAction(state, 'alice', { choice: 'rock' });
    expect(result).toEqual({ ok: true, value: { choice: 'rock' } });
  });

  it('rejects an invalid choice', () => {
    const state = initialState();
    expect(rockPaperScissors.validateAction(state, 'alice', { choice: 'lizard' }).ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const state = initialState();
    expect(rockPaperScissors.validateAction(state, 'alice', 'rock').ok).toBe(false);
  });
});

describe('rockPaperScissors.resolve', () => {
  it('rock beats scissors', () => {
    const state = initialState();
    const outcome = rockPaperScissors.resolve({
      state,
      actions: new Map([
        ['alice', { choice: 'rock' }],
        ['bob', { choice: 'scissors' }],
      ]),
      rng,
    });
    expect(outcome.nextState.roundWins.get('alice')).toBe(1);
    expect(outcome.nextState.roundWins.get('bob')).toBe(0);
    expect(outcome.nextState.round).toBe(1);
    expect(outcome.events).toEqual([
      {
        type: 'round-result',
        participantIds: ['alice', 'bob'],
        data: { winner: 'alice', choiceA: 'rock', choiceB: 'scissors' },
      },
    ]);
  });

  it('a tie awards no round win to anyone, but still consumes a round', () => {
    const state = initialState();
    const outcome = rockPaperScissors.resolve({
      state,
      actions: new Map([
        ['alice', { choice: 'paper' }],
        ['bob', { choice: 'paper' }],
      ]),
      rng,
    });
    expect(outcome.nextState.roundWins.get('alice')).toBe(0);
    expect(outcome.nextState.roundWins.get('bob')).toBe(0);
    expect(outcome.nextState.round).toBe(1);
  });

  it('records history visible from each participant’s own perspective', () => {
    const state = initialState();
    const { nextState } = rockPaperScissors.resolve({
      state,
      actions: new Map([
        ['alice', { choice: 'rock' }],
        ['bob', { choice: 'scissors' }],
      ]),
      rng,
    });
    expect(rockPaperScissors.getObservation(nextState, 'alice').history).toEqual([
      { round: 0, you: 'rock', opponent: 'scissors', winner: 'you' },
    ]);
    expect(rockPaperScissors.getObservation(nextState, 'bob').history).toEqual([
      { round: 0, you: 'scissors', opponent: 'rock', winner: 'opponent' },
    ]);
  });

  it('a forfeited round (substitute action) awards the round to the other participant', () => {
    const state = initialState();
    const outcome = rockPaperScissors.resolve({
      state,
      actions: new Map<string, { choice: 'rock' } | { forfeitedRound: true }>([
        ['alice', { choice: 'rock' }],
        ['bob', { forfeitedRound: true }],
      ]),
      rng,
    });
    expect(outcome.nextState.roundWins.get('alice')).toBe(1);
  });
});

describe('rockPaperScissors.onMissingAction', () => {
  it('forfeits the match by default', () => {
    const state = initialState(3, 'forfeitMatch');
    const decision = rockPaperScissors.onMissingAction?.({
      state,
      participantId: 'bob',
      reason: 'timeout',
    });
    expect(decision).toEqual({ policy: 'forfeit-match' });
  });

  it('substitutes a forfeited-round action when configured for leniency', () => {
    const state = initialState(3, 'loseRound');
    const decision = rockPaperScissors.onMissingAction?.({
      state,
      participantId: 'bob',
      reason: 'timeout',
    });
    expect(decision).toEqual({ policy: 'substitute', action: { forfeitedRound: true } });
  });
});

describe('rockPaperScissors.isTerminal / getResult / getStandingOutcomes', () => {
  it('is terminal only once exactly totalRounds hands have been played — not on an early lead', () => {
    let state = initialState(3);
    expect(rockPaperScissors.isTerminal(state)).toBe(false);
    state = playRound(state, 'rock', 'scissors'); // alice takes an early 1-0 lead
    expect(rockPaperScissors.isTerminal(state)).toBe(false); // not terminal despite the lead
    state = playRound(state, 'rock', 'scissors');
    expect(rockPaperScissors.isTerminal(state)).toBe(false); // still one hand left
    state = playRound(state, 'paper', 'paper'); // a tie for the final hand
    expect(rockPaperScissors.isTerminal(state)).toBe(true);

    const result = rockPaperScissors.getResult(state);
    expect(result).toEqual({ winnerId: 'alice', roundWins: { alice: 2, bob: 0 }, totalRounds: 3 });
    expect(rockPaperScissors.getStandingOutcomes(result)).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'win', score: 2 },
      { participantId: 'bob', rank: 2, outcome: 'loss', score: 0 },
    ]);
  });

  it('an even split in the tally after all hands are played is a genuine tie', () => {
    let state = initialState(2);
    state = playRound(state, 'rock', 'scissors'); // alice wins
    state = playRound(state, 'scissors', 'rock'); // bob wins
    expect(rockPaperScissors.isTerminal(state)).toBe(true);

    const result = rockPaperScissors.getResult(state);
    expect(result).toEqual({ winnerId: null, roundWins: { alice: 1, bob: 1 }, totalRounds: 2 });
    expect(rockPaperScissors.getStandingOutcomes(result)).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'draw', score: 1 },
      { participantId: 'bob', rank: 1, outcome: 'draw', score: 1 },
    ]);
  });

  it('never terminates early even given a long run of ties (bounded by totalRounds, not a majority)', () => {
    let state = initialState(5);
    for (let i = 0; i < 4; i += 1) {
      state = playRound(state, 'rock', 'rock'); // every hand a draw
      expect(rockPaperScissors.isTerminal(state)).toBe(false);
    }
    state = playRound(state, 'rock', 'rock');
    expect(rockPaperScissors.isTerminal(state)).toBe(true);
    expect(rockPaperScissors.getResult(state)).toEqual({
      winnerId: null,
      roundWins: { alice: 0, bob: 0 },
      totalRounds: 5,
    });
  });
});

describe('rockPaperScissors.humanInterface', () => {
  const humanInterface = rockPaperScissors.humanInterface;
  if (!humanInterface) {
    throw new Error('rockPaperScissors is expected to declare a humanInterface');
  }

  describe('describeObservation', () => {
    it("omits a 'Last round' line before any round has been played", () => {
      const state = initialState(3);
      const observation = rockPaperScissors.getObservation(state, 'alice');
      expect(humanInterface.describeObservation(observation)).not.toContain('Last round');
    });

    it("includes a 'Last round' line summarizing the previous round once one's been played", () => {
      let state = initialState(3);
      state = playRound(state, 'paper', 'rock'); // alice wins
      const observation = rockPaperScissors.getObservation(state, 'alice');
      const description = humanInterface.describeObservation(observation);
      expect(description).toContain('Last round — you: paper, bob: rock (you won)');
      expect(description).toContain('Round 2/3');
    });
  });

  describe('parseInput', () => {
    it.each([
      ['r', 'rock'],
      ['R', 'rock'],
      ['rock', 'rock'],
      [' rock \n', 'rock'],
      ['p', 'paper'],
      ['paper', 'paper'],
      ['s', 'scissors'],
      ['scissors', 'scissors'],
    ])('parses %j as %s', (raw, choice) => {
      expect(humanInterface.parseInput(raw)).toEqual({ choice });
    });

    it.each(['', 'banana', 'roc', 'quit'])('returns undefined for unparseable input %j', (raw) => {
      expect(humanInterface.parseInput(raw)).toBeUndefined();
    });
  });
});
