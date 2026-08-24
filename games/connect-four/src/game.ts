import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import {
  ConnectFourActionSchema,
  ConnectFourConfigSchema,
  type ConnectFourAction,
  type ConnectFourBoard,
  type ConnectFourConfig,
  type ConnectFourObservation,
  type ConnectFourResult,
  type ConnectFourState,
} from './types.js';

function emptyBoard(rows: number, columns: number): ConnectFourBoard {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
}

/** The row a piece dropped into `column` would land in, or `undefined` if the column is full. */
function landingRow(board: ConnectFourBoard, column: number): number | undefined {
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === null) {
      return row;
    }
  }
  return undefined;
}

function isColumnFull(board: ConnectFourBoard, column: number): boolean {
  return landingRow(board, column) === undefined;
}

/** How many consecutive cells owned by `participantId` extend from `(row, col)` in direction
 * `(dr, dc)`, not counting `(row, col)` itself. */
function runLength(
  board: ConnectFourBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  participantId: string,
): number {
  let count = 0;
  let r = row + dr;
  let c = col + dc;
  while (r >= 0 && r < board.length && c >= 0 && c < (board[r]?.length ?? 0)) {
    if (board[r]?.[c] !== participantId) {
      break;
    }
    count += 1;
    r += dr;
    c += dc;
  }
  return count;
}

/** True iff the piece just dropped at `(row, col)` completes a `winLength` line through it —
 * horizontal, vertical, or either diagonal. */
function completesLine(
  board: ConnectFourBoard,
  row: number,
  col: number,
  participantId: string,
  winLength: number,
): boolean {
  const axes: [number, number][] = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal, top-left to bottom-right
    [1, -1], // diagonal, top-right to bottom-left
  ];
  return axes.some(([dr, dc]) => {
    const total =
      1 +
      runLength(board, row, col, dr, dc, participantId) +
      runLength(board, row, col, -dr, -dc, participantId);
    return total >= winLength;
  });
}

export const connectFour: GameDefinition<
  ConnectFourConfig,
  ConnectFourState,
  ConnectFourObservation,
  ConnectFourAction,
  ConnectFourResult
> = {
  id: 'connect-four',
  version: '1.0.0',

  parseConfig(raw) {
    const result = ConnectFourConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  initialize({ participantIds, config, rng }) {
    const [a, b] = participantIds;
    if (a === undefined || b === undefined || participantIds.length !== 2) {
      throw new Error('connect-four requires exactly 2 participants');
    }
    return {
      participantIds: [a, b],
      config,
      board: emptyBoard(config.rows, config.columns),
      // A coin flip on the engine's own seeded rng (ADR-0004: engine-owned randomness delivered
      // as ordinary data, never a live handle) — without it, whichever participant a format
      // happens to list first would always move first, a real first-mover advantage repeated
      // identically across every match of a best-of-N series against the same opponent.
      currentPlayerIndex: rng.nextInt(2) === 0 ? 0 : 1,
      moveCount: 0,
      winnerId: null,
      isDraw: false,
    };
  },

  getObservation(state, participantId) {
    const opponentId = state.participantIds.find((id) => id !== participantId);
    if (opponentId === undefined) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    const legalColumns: number[] = [];
    for (let column = 0; column < state.config.columns; column += 1) {
      if (!isColumnFull(state.board, column)) {
        legalColumns.push(column);
      }
    }
    return {
      board: state.board.map((row) =>
        row.map((cell) => (cell === null ? null : cell === participantId ? 'you' : 'opponent')),
      ),
      columns: state.config.columns,
      rows: state.config.rows,
      winLength: state.config.winLength,
      legalColumns,
      opponentId,
      moveCount: state.moveCount,
    };
  },

  getPendingActions(state) {
    const participantId = state.participantIds[state.currentPlayerIndex];
    return [{ participantId, required: true }];
  },

  validateAction(state, _participantId, raw) {
    const result = ConnectFourActionSchema.safeParse(raw);
    if (!result.success) {
      return err('action must be { column: <non-negative int> }');
    }
    const { column } = result.data;
    if (column >= state.config.columns) {
      return err(`column must be between 0 and ${String(state.config.columns - 1)}`);
    }
    if (isColumnFull(state.board, column)) {
      return err(`column ${String(column)} is already full`);
    }
    return ok(result.data);
  },

  resolve({ state, actions }) {
    const currentParticipantId = state.participantIds[state.currentPlayerIndex];
    const action = actions.get(currentParticipantId);
    if (action === undefined) {
      // Unreachable: this game defines no `onMissingAction`, so the engine forfeits the match
      // (never calls resolve()) whenever the sole required participant's action doesn't arrive.
      throw new Error('unreachable: resolve() called with no action for the current player');
    }

    const row = landingRow(state.board, action.column);
    if (row === undefined) {
      // Unreachable: validateAction already rejects a full column before this point.
      throw new Error(`unreachable: column ${String(action.column)} has no room`);
    }

    const nextBoard = state.board.map((boardRow) => [...boardRow]);
    const targetRow = nextBoard[row];
    if (targetRow === undefined) {
      throw new Error(`unreachable: row ${String(row)} out of bounds`);
    }
    targetRow[action.column] = currentParticipantId;

    const won = completesLine(
      nextBoard,
      row,
      action.column,
      currentParticipantId,
      state.config.winLength,
    );
    const nextMoveCount = state.moveCount + 1;
    const boardFull = nextMoveCount >= state.config.rows * state.config.columns;

    return {
      nextState: {
        ...state,
        board: nextBoard,
        currentPlayerIndex: state.currentPlayerIndex === 0 ? 1 : 0,
        moveCount: nextMoveCount,
        winnerId: won ? currentParticipantId : null,
        isDraw: !won && boardFull,
      },
      events: [
        {
          type: 'move',
          participantIds: [currentParticipantId],
          data: {
            column: action.column,
            row,
            winner: won ? currentParticipantId : boardFull ? 'draw' : null,
          },
        },
      ],
    };
  },

  // No `onMissingAction` — unlike Rock-Paper-Scissors (which uses this hook to illustrate
  // opt-in leniency), Connect Four takes the engine's default: a missing/invalid move from the
  // one required (current) participant forfeits the match. There's no sensible "substitute"
  // move to auto-play on someone's behalf the way "auto-lose just this round" works for RPS.
  isTerminal(state) {
    return state.winnerId !== null || state.isDraw;
  },

  getResult(state) {
    return { winnerId: state.winnerId, participantIds: state.participantIds };
  },

  getStandingOutcomes(result) {
    if (result.winnerId === null) {
      return result.participantIds.map((participantId) => ({
        participantId,
        rank: 1,
        outcome: 'draw',
      }));
    }
    const loserId = result.participantIds.find((id) => id !== result.winnerId);
    const outcomes: StandingOutcome[] = [
      { participantId: result.winnerId, rank: 1, outcome: 'win' },
    ];
    if (loserId !== undefined) {
      outcomes.push({ participantId: loserId, rank: 2, outcome: 'loss' });
    }
    return outcomes;
  },

  resourceLimits: {
    cpus: 0.5,
    memoryMb: 128,
    turnTimeoutMs: 5000,
  },
};
