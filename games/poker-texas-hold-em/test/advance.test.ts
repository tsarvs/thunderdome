import { describe, expect, it } from 'vitest';
import { advance } from '../src/advance.js';
import { postflopFirstToActIndex } from '../src/table.js';
import { cards, holeCards, player, pokerState, rng, testConfig } from './fixtures.js';

describe('advance — passthrough when someone still needs to act', () => {
  // actingIndex 1 ("bob") stands in for "bob just acted" — advance() walks forward from there to
  // the first live member of playersToAct, landing on carol at index 2.
  it('finds the next live actor via the playersToAct/actingIndex pointer and changes nothing else', () => {
    const state = pokerState({
      participantIds: ['alice', 'bob', 'carol'],
      seatOrder: ['alice', 'bob', 'carol'],
      players: { alice: player(), bob: player(), carol: player() },
      playersToAct: ['carol'],
      actingIndex: 1,
    });
    const result = advance(state, rng(), []);
    expect(result.actingIndex).toBe(2);
    expect(result.street).toBe(state.street);
    expect(result.board).toEqual(state.board);
  });
});

describe('advance — closing a betting round', () => {
  // remainingBoardCards supplies only the turn card — this test never reaches the river.
  it('deals the next street once playersToAct empties, with a fresh betting round', () => {
    const config = testConfig({ bigBlind: 20 });
    const state = pokerState({
      config,
      street: 'flop',
      board: cards(['2C', '5D', '9H']),
      remainingBoardCards: cards(['JS']),
      players: {
        alice: player({ committedThisStreet: 30 }),
        bob: player({ committedThisStreet: 30 }),
      },
      currentBet: 30,
      minRaise: 20,
      playersToAct: [],
    });
    const result = advance(state, rng(), []);
    expect(result.street).toBe('turn');
    expect(result.board).toEqual(cards(['2C', '5D', '9H', 'JS']));
    expect(result.currentBet).toBe(0);
    expect(result.minRaise).toBe(20);
    expect(Object.values(result.players).every((p) => p.committedThisStreet === 0)).toBe(true);
    expect(result.actingIndex).toBe(postflopFirstToActIndex(2));
  });
});

describe('advance — river showdown', () => {
  it('settles a showdown and deals the next hand when the match is not over', () => {
    const state = pokerState({
      street: 'river',
      board: cards(['2C', '5D', '9H', 'QS', 'QC']),
      remainingBoardCards: [],
      players: {
        alice: player({ holeCards: holeCards('AC', 'AD'), committed: 100 }),
        bob: player({ holeCards: holeCards('KC', 'KD'), committed: 100 }),
      },
      stacks: { alice: 900, bob: 900 },
      playersToAct: [],
    });
    const result = advance(state, rng(), []);
    expect(result.lastHandSummary?.reason).toBe('showdown');
    expect(result.lastHandSummary?.winners).toEqual([{ participantId: 'alice', amount: 200 }]);
    expect(result.matchComplete).toBe(false);
    expect(result.handNumber).toBe(1);
    expect(result.street).toBe('preflop');
  });
});

describe('advance — fold to one player', () => {
  it('awards the pot without a showdown and deals the next hand', () => {
    const state = pokerState({
      participantIds: ['alice', 'bob', 'carol'],
      seatOrder: ['alice', 'bob', 'carol'],
      players: {
        alice: player({ folded: true, committed: 20 }),
        bob: player({ folded: true, committed: 20 }),
        carol: player({ committed: 20 }),
      },
      stacks: { alice: 980, bob: 980, carol: 980 },
      playersToAct: [],
    });
    const result = advance(state, rng(), []);
    expect(result.lastHandSummary?.reason).toBe('fold');
    expect(result.lastHandSummary?.winners).toEqual([{ participantId: 'carol', amount: 60 }]);
    expect(result.matchComplete).toBe(false);
    expect(result.handNumber).toBe(1);
  });
});

describe('advance — all-in runout and match completion', () => {
  it('runs the board out to the river, shows down, busts the loser, and ends the match', () => {
    const state = pokerState({
      street: 'preflop',
      board: [],
      remainingBoardCards: cards(['2C', '6D', '9H', 'JS', '2D']),
      players: {
        alice: player({ holeCards: holeCards('AC', 'AD'), committed: 100, allIn: true }),
        bob: player({ holeCards: holeCards('3C', '4D'), committed: 100, allIn: true }),
      },
      stacks: { alice: 0, bob: 0 },
      playersToAct: [],
    });
    const result = advance(state, rng(), []);
    expect(result.matchComplete).toBe(true);
    expect(result.stacks.alice).toBe(200);
    expect(result.stacks.bob).toBe(0);
    expect(result.bustedOut).toEqual([['bob']]);
  });

  // handNumber 0 -> handsPlayed 1, which already meets totalHands: 1, so the match ends here even
  // though both players still have plenty of chips.
  it('ends the match once the configured hand count is reached, even with 2+ players left', () => {
    const state = pokerState({
      config: testConfig({ matchFormat: 'fixedHands', totalHands: 1 }),
      handNumber: 0,
      players: {
        alice: player({ folded: true, committed: 20 }),
        bob: player({ committed: 20 }),
      },
      stacks: { alice: 980, bob: 980 },
      playersToAct: [],
    });
    const result = advance(state, rng(), []);
    expect(result.matchComplete).toBe(true);
    expect(result.handNumber).toBe(0);
    expect(result.stacks.bob).toBe(1020);
  });
});
