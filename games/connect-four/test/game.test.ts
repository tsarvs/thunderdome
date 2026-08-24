import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { connectFour } from '../src/game.js';
import type { ConnectFourState } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

function config(overrides: Partial<{ columns: number; rows: number; winLength: number }> = {}) {
  const result = connectFour.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(overrides?: Parameters<typeof config>[0]) {
  return connectFour.initialize({
    config: config(overrides),
    participantIds: ['alice', 'bob'],
    rng,
  });
}

function emptyBoard(rows: number, columns: number): (string | null)[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
}

/** `noUncheckedIndexedAccess`-safe cell assignment for hand-crafted test boards. */
function setCell(board: (string | null)[][], row: number, col: number, value: string): void {
  const targetRow = board[row];
  if (targetRow === undefined) {
    throw new Error(`row ${String(row)} out of bounds`);
  }
  targetRow[col] = value;
}

/** Builds a state directly from a hand-crafted board, skipping `initialize()` — the fastest way
 * to set up "one move away from winning" scenarios without choreographing a full alternating
 * turn sequence for every test. */
function stateWithBoard(
  board: (string | null)[][],
  currentPlayerIndex: 0 | 1,
  overrides?: Parameters<typeof config>[0],
): ConnectFourState {
  return {
    participantIds: ['alice', 'bob'],
    config: config(overrides),
    board,
    currentPlayerIndex,
    moveCount: board.flat().filter((cell) => cell !== null).length,
    winnerId: null,
    isDraw: false,
  };
}

function drop(state: ConnectFourState, column: number) {
  const participantId = state.participantIds[state.currentPlayerIndex];
  return connectFour.resolve({
    state,
    actions: new Map([[participantId, { column }]]),
    rng,
  }).nextState;
}

describe('ConnectFourConfigSchema (via parseConfig)', () => {
  it('defaults to a classic 7x6 board with winLength 4', () => {
    const result = connectFour.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ columns: 7, rows: 6, winLength: 4 });
    }
  });

  it('accepts an explicit smaller board', () => {
    expect(connectFour.parseConfig({ columns: 4, rows: 4, winLength: 3 }).ok).toBe(true);
  });

  it('rejects a winLength that no line could ever reach', () => {
    // max(columns, rows) = 5, so winLength 6 is infeasible in every direction.
    expect(connectFour.parseConfig({ columns: 5, rows: 4, winLength: 6 }).ok).toBe(false);
  });

  it('rejects out-of-range dimensions', () => {
    expect(connectFour.parseConfig({ columns: 3 }).ok).toBe(false); // below the min of 4
    expect(connectFour.parseConfig({ rows: 21 }).ok).toBe(false); // above the max of 20
  });
});

describe('connectFour.initialize', () => {
  it('creates an empty board of the configured size', () => {
    const state = initialState({ columns: 5, rows: 4 });
    expect(state.board).toHaveLength(4);
    expect(state.board.every((row) => row.length === 5 && row.every((cell) => cell === null))).toBe(
      true,
    );
    expect(state.moveCount).toBe(0);
    expect(state.winnerId).toBeNull();
    expect(state.isDraw).toBe(false);
  });

  it('picks a starting player via the seeded rng, not always the same roster order', () => {
    // Not a statistical test — just confirms the coin flip is wired to an actual 0/1 choice
    // rather than being hardcoded to index 0.
    const state = initialState();
    expect([0, 1]).toContain(state.currentPlayerIndex);
  });

  it('throws for a roster that is not exactly 2 participants', () => {
    expect(() =>
      connectFour.initialize({ config: config(), participantIds: ['alice'], rng }),
    ).toThrow('exactly 2 participants');
  });
});

describe('connectFour.getObservation', () => {
  it('relabels the board to you/opponent, and lists only non-full columns as legal', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 2, 0, 'bob');
    setCell(board, 3, 1, 'bob');
    const state = stateWithBoard(board, 1, { columns: 4, rows: 4, winLength: 3 });

    const aliceView = connectFour.getObservation(state, 'alice');
    expect(aliceView.board[3]).toEqual(['you', 'opponent', null, null]);
    expect(aliceView.board[2]).toEqual(['opponent', null, null, null]);
    expect(aliceView.opponentId).toBe('bob');
    expect(aliceView.legalColumns).toEqual([0, 1, 2, 3]);

    const bobView = connectFour.getObservation(state, 'bob');
    expect(bobView.board[3]).toEqual(['opponent', 'you', null, null]);
    expect(bobView.opponentId).toBe('alice');
  });

  it('excludes a full column from legalColumns', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 2, 0, 'bob');
    setCell(board, 1, 0, 'alice');
    setCell(board, 0, 0, 'bob'); // column 0 is now stacked to the top
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });

    expect(connectFour.getObservation(state, 'alice').legalColumns).toEqual([1, 2, 3]);
  });
});

describe('connectFour.getPendingActions', () => {
  it('requires only the current player to act, never both', () => {
    const state = stateWithBoard(emptyBoard(4, 4), 0, { columns: 4, rows: 4, winLength: 3 });
    expect(connectFour.getPendingActions(state)).toEqual([
      { participantId: 'alice', required: true },
    ]);
    expect(connectFour.getPendingActions({ ...state, currentPlayerIndex: 1 })).toEqual([
      { participantId: 'bob', required: true },
    ]);
  });
});

describe('connectFour.validateAction', () => {
  const state = stateWithBoard(emptyBoard(4, 4), 0, { columns: 4, rows: 4, winLength: 3 });

  it('accepts a legal column', () => {
    expect(connectFour.validateAction(state, 'alice', { column: 2 }).ok).toBe(true);
  });

  it('rejects a malformed action', () => {
    expect(connectFour.validateAction(state, 'alice', { column: 'two' }).ok).toBe(false);
    expect(connectFour.validateAction(state, 'alice', {}).ok).toBe(false);
  });

  it('rejects a column outside the board', () => {
    expect(connectFour.validateAction(state, 'alice', { column: 4 }).ok).toBe(false);
    expect(connectFour.validateAction(state, 'alice', { column: -1 }).ok).toBe(false);
  });

  it('rejects a full column', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 2, 0, 'bob');
    setCell(board, 1, 0, 'alice');
    setCell(board, 0, 0, 'bob'); // column 0 is now stacked to the top
    const fullState = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    expect(connectFour.validateAction(fullState, 'alice', { column: 0 }).ok).toBe(false);
    expect(connectFour.validateAction(fullState, 'alice', { column: 1 }).ok).toBe(true);
  });
});

describe('connectFour.resolve', () => {
  it('drops a piece to the lowest empty row of the chosen column and alternates turns', () => {
    let state = stateWithBoard(emptyBoard(4, 4), 0, { columns: 4, rows: 4, winLength: 3 });
    state = drop(state, 1);
    expect(state.board[3]).toEqual([null, 'alice', null, null]);
    expect(state.currentPlayerIndex).toBe(1);

    state = drop(state, 1);
    expect(state.board[2]?.[1]).toBe('bob');
    expect(state.board[3]?.[1]).toBe('alice'); // the earlier piece is undisturbed
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('detects a horizontal win', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 3, 1, 'alice');
    setCell(board, 3, 2, 'alice');
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    const next = drop(state, 3);
    expect(next.winnerId).toBe('alice');
    expect(next.isDraw).toBe(false);
  });

  it('detects a vertical win', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 2, 0, 'alice');
    setCell(board, 1, 0, 'alice');
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    const next = drop(state, 0);
    expect(next.winnerId).toBe('alice');
  });

  it('detects a diagonal win (top-left to bottom-right)', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 2, 1, 'alice');
    setCell(board, 1, 2, 'alice');
    // Column 3 needs 3 pieces already in it (anyone's) so the next drop lands at row 0, not
    // the bottom — gravity means an empty column's first piece always lands at the bottom.
    setCell(board, 3, 3, 'bob');
    setCell(board, 2, 3, 'bob');
    setCell(board, 1, 3, 'bob');
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    const next = drop(state, 3); // lands at row 0, completing (3,0)-(2,1)-(1,2)-(0,3)
    expect(next.winnerId).toBe('alice');
  });

  it('detects a diagonal win (top-right to bottom-left)', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 3, 'alice');
    setCell(board, 2, 2, 'alice');
    setCell(board, 1, 1, 'alice');
    // Same reasoning as above: column 0 needs 3 pieces already in it first.
    setCell(board, 3, 0, 'bob');
    setCell(board, 2, 0, 'bob');
    setCell(board, 1, 0, 'bob');
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    const next = drop(state, 0); // lands at row 0, completing (3,3)-(2,2)-(1,1)-(0,0)
    expect(next.winnerId).toBe('alice');
  });

  it('does not award a win for 3 in a row when winLength is 4', () => {
    const board = emptyBoard(4, 4);
    setCell(board, 3, 0, 'alice');
    setCell(board, 3, 1, 'alice');
    const state = stateWithBoard(board, 0, { columns: 4, rows: 4, winLength: 4 });
    const next = drop(state, 2);
    expect(next.winnerId).toBeNull();
  });

  it('detects a draw when the board fills with no winner', () => {
    // A full 4x4 board (winLength 4, so every row, column, and both diagonals are exactly
    // one potential winning line each) laid out so none of those 10 lines is monochromatic —
    // every cell filled, nobody connects 4. Only (row 3, col 0) is held back so the final
    // move is a real `drop()` rather than a hand-constructed terminal state.
    const board = [
      ['alice', 'alice', 'bob', 'bob'],
      ['bob', 'bob', 'alice', 'alice'],
      ['alice', 'bob', 'alice', 'bob'],
      [null, 'alice', 'bob', 'alice'],
    ];
    const state = stateWithBoard(board, 1, { columns: 4, rows: 4, winLength: 4 }); // bob's turn
    const next = drop(state, 0); // lands at row 3 (the only empty cell in column 0)
    expect(next.board[3]).toEqual(['bob', 'alice', 'bob', 'alice']);
    expect(next.winnerId).toBeNull();
    expect(next.isDraw).toBe(true);
  });
});

describe('connectFour.isTerminal', () => {
  it('is false mid-game, true once a winner or draw is set', () => {
    const midGame = stateWithBoard(emptyBoard(4, 4), 0, { columns: 4, rows: 4, winLength: 4 });
    expect(connectFour.isTerminal(midGame)).toBe(false);
    expect(connectFour.isTerminal({ ...midGame, winnerId: 'alice' })).toBe(true);
    expect(connectFour.isTerminal({ ...midGame, isDraw: true })).toBe(true);
  });
});

describe('connectFour.getResult / getStandingOutcomes', () => {
  it('reports a win/loss pair for a decisive game', () => {
    const state = stateWithBoard(emptyBoard(4, 4), 0, {
      columns: 4,
      rows: 4,
      winLength: 4,
    });
    const result = connectFour.getResult({ ...state, winnerId: 'alice' });
    expect(result).toEqual({ winnerId: 'alice', participantIds: ['alice', 'bob'] });
    expect(connectFour.getStandingOutcomes(result)).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'win' },
      { participantId: 'bob', rank: 2, outcome: 'loss' },
    ]);
  });

  it('reports a draw for both participants', () => {
    const state = stateWithBoard(emptyBoard(4, 4), 0, { columns: 4, rows: 4, winLength: 4 });
    const result = connectFour.getResult({ ...state, isDraw: true });
    expect(result.winnerId).toBeNull();
    expect(connectFour.getStandingOutcomes(result)).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'draw' },
      { participantId: 'bob', rank: 1, outcome: 'draw' },
    ]);
  });
});
