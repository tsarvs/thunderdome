import { describe, expect, it } from 'vitest';
import {
  bigBlindSeatIndex,
  buildSeatOrder,
  computeSidePots,
  nextButton,
  oddChipOrder,
  postflopFirstToActIndex,
  preflopFirstToActIndex,
  smallBlindSeatIndex,
} from '../src/table.js';

const ALICE_BOB_CAROL_DAVE = ['alice', 'bob', 'carol', 'dave'];

describe('buildSeatOrder', () => {
  it('rotates the roster to start at the button', () => {
    expect(buildSeatOrder(ALICE_BOB_CAROL_DAVE, 'carol', new Set())).toEqual([
      'carol',
      'dave',
      'alice',
      'bob',
    ]);
  });

  it('filters out busted participants while preserving relative order', () => {
    expect(buildSeatOrder(ALICE_BOB_CAROL_DAVE, 'carol', new Set(['bob']))).toEqual([
      'carol',
      'dave',
      'alice',
    ]);
  });

  it('throws when the button id is not in the roster', () => {
    expect(() => buildSeatOrder(ALICE_BOB_CAROL_DAVE, 'eve', new Set())).toThrow();
  });
});

describe('nextButton', () => {
  it('moves to the next participant in fixed table order, wrapping', () => {
    expect(nextButton(ALICE_BOB_CAROL_DAVE, 'dave', new Set())).toBe('alice');
    expect(nextButton(ALICE_BOB_CAROL_DAVE, 'alice', new Set())).toBe('bob');
  });

  it('skips busted participants', () => {
    expect(nextButton(ALICE_BOB_CAROL_DAVE, 'alice', new Set(['bob', 'carol']))).toBe('dave');
  });

  it('throws when the current button id is not in the roster', () => {
    expect(() => nextButton(ALICE_BOB_CAROL_DAVE, 'eve', new Set())).toThrow();
  });

  // Busting 3 of 4 still lets the button wrap back around to itself (the one remaining active
  // seat) — only busting every seat, the current button included, leaves no candidate at all.
  it('throws when every participant, including the current button, has busted', () => {
    expect(() =>
      nextButton(ALICE_BOB_CAROL_DAVE, 'alice', new Set(ALICE_BOB_CAROL_DAVE)),
    ).toThrow();
  });
});

describe('blind and first-to-act positions', () => {
  it('heads-up: the button is the small blind and acts first preflop, big blind acts first postflop', () => {
    expect(smallBlindSeatIndex(2)).toBe(0);
    expect(bigBlindSeatIndex(2)).toBe(1);
    expect(preflopFirstToActIndex(2)).toBe(0);
    expect(postflopFirstToActIndex(2)).toBe(1);
  });

  it('3-handed: seats 1/2 post blinds, and with no UTG seat the button acts first preflop', () => {
    expect(smallBlindSeatIndex(3)).toBe(1);
    expect(bigBlindSeatIndex(3)).toBe(2);
    expect(preflopFirstToActIndex(3)).toBe(0);
    expect(postflopFirstToActIndex(3)).toBe(1);
  });

  it('4+-handed: the seat after the big blind (UTG) acts first preflop', () => {
    expect(preflopFirstToActIndex(4)).toBe(3);
    expect(preflopFirstToActIndex(6)).toBe(3);
    expect(postflopFirstToActIndex(4)).toBe(1);
    expect(postflopFirstToActIndex(6)).toBe(1);
  });
});

describe('computeSidePots', () => {
  it('returns a single main pot when every contribution is equal', () => {
    expect(computeSidePots({ a: 50, b: 50, c: 50 }, new Set())).toEqual([
      { amount: 150, eligibleParticipantIds: ['a', 'b', 'c'] },
    ]);
  });

  it('layers a side pot for a short all-in', () => {
    const pots = computeSidePots({ a: 30, b: 100, c: 100 }, new Set());
    expect(pots).toEqual([
      { amount: 90, eligibleParticipantIds: ['a', 'b', 'c'] },
      { amount: 140, eligibleParticipantIds: ['b', 'c'] },
    ]);
  });

  it('still counts a folded contributor toward a layer amount but excludes them from eligibility', () => {
    const pots = computeSidePots({ a: 30, b: 100, c: 100, d: 20 }, new Set(['d']));
    expect(pots).toEqual([
      { amount: 80, eligibleParticipantIds: ['a', 'b', 'c'] },
      { amount: 30, eligibleParticipantIds: ['a', 'b', 'c'] },
      { amount: 140, eligibleParticipantIds: ['b', 'c'] },
    ]);
    const totalAwarded = pots.reduce((sum, pot) => sum + pot.amount, 0);
    expect(totalAwarded).toBe(30 + 100 + 100 + 20);
  });

  it('returns no pots when nobody committed anything', () => {
    expect(computeSidePots({}, new Set())).toEqual([]);
  });
});

describe('oddChipOrder', () => {
  // seatOrder[0] ("alice") is the button throughout.
  it('orders winners starting right after the button, button last', () => {
    const seatOrder = ['alice', 'bob', 'carol', 'dave'];
    expect(oddChipOrder(['dave', 'bob'], seatOrder)).toEqual(['bob', 'dave']);
    expect(oddChipOrder(['alice', 'carol'], seatOrder)).toEqual(['carol', 'alice']);
  });
});
