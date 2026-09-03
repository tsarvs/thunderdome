import type { RoundEvent } from '@thunderdome/engine';
import { describe, expect, it } from 'vitest';
import {
  describeAction,
  describeObservation,
  describeRoundEvents,
  parseInput,
  validateInput,
} from '../src/human.js';
import type { PokerTexasHoldEmObservation } from '../src/types.js';
import { cards, holeCards } from './fixtures.js';

function observation(
  overrides?: Partial<PokerTexasHoldEmObservation>,
): PokerTexasHoldEmObservation {
  return {
    you: 'alice',
    handNumber: 0,
    street: 'preflop',
    board: [],
    holeCards: holeCards('AS', 'KS'),
    pot: 15,
    yourStack: 195,
    yourCommittedThisStreet: 5,
    toCall: 5,
    minRaiseTo: 20,
    maxRaiseTo: 200,
    smallBlind: 5,
    bigBlind: 10,
    buttonParticipantId: 'alice',
    opponents: [
      {
        participantId: 'bob',
        stack: 190,
        committed: 10,
        committedThisStreet: 10,
        folded: false,
        allIn: false,
        isButton: false,
      },
    ],
    legalActions: ['fold', 'call', 'raise', 'allIn'],
    lastHandSummary: null,
    ...overrides,
  };
}

describe('parseInput', () => {
  it('parses fold/check/call/allIn and their shorthand aliases', () => {
    expect(parseInput('fold')).toEqual({ type: 'fold' });
    expect(parseInput('F')).toEqual({ type: 'fold' });
    expect(parseInput('check')).toEqual({ type: 'check' });
    expect(parseInput('x')).toEqual({ type: 'check' });
    expect(parseInput('call')).toEqual({ type: 'call' });
    expect(parseInput('allin')).toEqual({ type: 'allIn' });
    expect(parseInput('shove')).toEqual({ type: 'allIn' });
  });

  it('parses a raise amount, case-insensitively and with extra whitespace', () => {
    expect(parseInput('raise 80')).toEqual({ type: 'raise', amount: 80 });
    expect(parseInput('  Bet   120  ')).toEqual({ type: 'raise', amount: 120 });
  });

  it('rejects a non-numeric or non-positive raise amount', () => {
    expect(parseInput('raise abc')).toBeUndefined();
    expect(parseInput('raise -5')).toBeUndefined();
    expect(parseInput('raise 0')).toBeUndefined();
    expect(parseInput('raise 10.5')).toBeUndefined();
  });

  it('rejects garbage and extra tokens', () => {
    expect(parseInput('')).toBeUndefined();
    expect(parseInput('fold now')).toBeUndefined();
    expect(parseInput('raise')).toBeUndefined();
    expect(parseInput('banana')).toBeUndefined();
  });
});

describe('validateInput', () => {
  it('accepts a raise within the observation min/max', () => {
    expect(validateInput({ type: 'raise', amount: 20 }, observation())).toBeUndefined();
    expect(validateInput({ type: 'raise', amount: 200 }, observation())).toBeUndefined();
  });

  it('rejects a raise below the observed minimum instead of letting it through', () => {
    expect(validateInput({ type: 'raise', amount: 15 }, observation())).toBe(
      'Your raise must reach at least 20 (or go all-in for less)',
    );
  });

  it('rejects a raise above the observed maximum instead of letting it through', () => {
    expect(validateInput({ type: 'raise', amount: 999 }, observation())).toBe(
      "You can't commit more than your stack (max 200)",
    );
  });

  it('rejects a raise that does not exceed the current bet', () => {
    expect(validateInput({ type: 'raise', amount: 10 }, observation())).toBe(
      'Your raise must exceed the current bet',
    );
  });

  it('rejects any raise once the observation reports no chips left', () => {
    expect(validateInput({ type: 'raise', amount: 50 }, observation({ minRaiseTo: null }))).toBe(
      'You have no chips left to raise with',
    );
  });

  it('leaves every non-raise action alone', () => {
    expect(validateInput({ type: 'fold' }, observation())).toBeUndefined();
    expect(validateInput({ type: 'check' }, observation())).toBeUndefined();
    expect(validateInput({ type: 'call' }, observation())).toBeUndefined();
    expect(validateInput({ type: 'allIn' }, observation())).toBeUndefined();
  });
});

describe('describeAction', () => {
  it('confirms each action type in plain language', () => {
    expect(describeAction({ type: 'fold' })).toBe('You folded.');
    expect(describeAction({ type: 'check' })).toBe('You checked.');
    expect(describeAction({ type: 'call' })).toBe('You called.');
    expect(describeAction({ type: 'allIn' })).toBe('You went all-in.');
  });

  it('confirms a raise with the amount that was actually understood', () => {
    expect(describeAction({ type: 'raise', amount: 80 })).toBe('You raised to 80.');
  });
});

describe('describeObservation', () => {
  it('renders the pot, call amount, and legal actions with their bounds', () => {
    const text = describeObservation(observation());
    expect(text).toContain('Pot: 15');
    expect(text).toContain('(to call: 5)');
    expect(text).toContain('CALL (5)');
    expect(text).toContain('RAISE <amount> (min 20, max 200)');
    expect(text).toContain('ALLIN (200)');
  });

  it('shows CHECK instead of CALL when nothing is owed', () => {
    const text = describeObservation(
      observation({ toCall: 0, legalActions: ['fold', 'check', 'raise', 'allIn'] }),
    );
    expect(text).toContain('CHECK');
    expect(text).not.toContain('CALL (');
  });

  it('never mentions a hand result — that lives in describeRoundEvents now', () => {
    expect(describeObservation(observation())).not.toContain('Hand result');
  });
});

describe('describeRoundEvents', () => {
  it('returns undefined for a round with nothing worth narrating', () => {
    expect(describeRoundEvents([], 'alice')).toBeUndefined();
  });

  it('narrates an opponent’s action but skips your own (describeAction already confirmed it)', () => {
    const events: RoundEvent[] = [
      { type: 'action', participantIds: ['alice'], data: { action: 'call', amount: 20 } },
      { type: 'action', participantIds: ['bob'], data: { action: 'raise', amount: 60 } },
    ];
    const text = describeRoundEvents(events, 'alice');
    expect(text).not.toContain('alice');
    expect(text).toContain('bob raises to 60.');
  });

  it('narrates a street being dealt, but never a (nonexistent) preflop deal', () => {
    const events: RoundEvent[] = [
      { type: 'street-dealt', data: { street: 'flop', board: cards(['2C', '5D', '9H']) } },
    ];
    expect(describeRoundEvents(events, 'alice')).toBe('Flop: 2C 5D 9H');
  });

  it('narrates a fold-won hand without revealing any cards', () => {
    const events: RoundEvent[] = [
      {
        type: 'hand-complete',
        participantIds: ['bob'],
        data: {
          handNumber: 0,
          winners: [{ participantId: 'bob', amount: 40 }],
          reason: 'fold',
          board: [],
        },
      },
    ];
    expect(describeRoundEvents(events, 'alice')).toBe(
      'Hand result: everyone else folded — winner: bob +40',
    );
  });

  it('narrates a showdown with every revealed hand, relabeling your own id to "you"', () => {
    const events: RoundEvent[] = [
      {
        type: 'showdown',
        participantIds: ['alice', 'bob'],
        data: {
          handNumber: 0,
          winners: [{ participantId: 'alice', amount: 80 }],
          reason: 'showdown',
          board: cards(['2C', '5D', '9H', 'QS', 'QC']),
          showdown: [
            { participantId: 'alice', holeCards: holeCards('AC', 'AD'), category: 'two-pair' },
            { participantId: 'bob', holeCards: holeCards('KC', 'KD'), category: 'two-pair' },
          ],
        },
      },
    ];
    const text = describeRoundEvents(events, 'alice');
    expect(text).toContain('Hand result (showdown) — winner: you +80');
    expect(text).toContain('you: AC AD (two-pair)');
    expect(text).toContain('bob: KC KD (two-pair)');
  });

  it('lists every winner on a split or side-pot showdown', () => {
    const events: RoundEvent[] = [
      {
        type: 'showdown',
        data: {
          handNumber: 0,
          winners: [
            { participantId: 'alice', amount: 50 },
            { participantId: 'bob', amount: 30 },
          ],
          reason: 'showdown',
          board: cards(['2C', '5D', '9H', 'QS', 'QC']),
          showdown: [
            { participantId: 'alice', holeCards: holeCards('AC', 'AD'), category: 'two-pair' },
            { participantId: 'bob', holeCards: holeCards('KC', 'KD'), category: 'two-pair' },
          ],
        },
      },
    ];
    expect(describeRoundEvents(events, 'alice')).toContain(
      'Hand result (showdown) — winner: you +50, bob +30',
    );
  });

  it('narrates busting out, telling you directly when it is you', () => {
    const youBusted = describeRoundEvents([{ type: 'busted', participantIds: ['alice'] }], 'alice');
    expect(youBusted).toBe('You are out of chips!');

    const opponentBusted = describeRoundEvents(
      [{ type: 'busted', participantIds: ['bob'] }],
      'alice',
    );
    expect(opponentBusted).toBe('bob is out of chips!');
  });
});
