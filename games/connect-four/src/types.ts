import { z } from 'zod';

export const ConnectFourConfigSchema = z
  .object({
    columns: z.number().int().min(4).max(20).default(7),
    rows: z.number().int().min(4).max(20).default(6),
    /** How many in a row (horizontal, vertical, or either diagonal) wins. */
    winLength: z.number().int().min(3).max(10).default(4),
  })
  .refine((config) => config.winLength <= Math.max(config.columns, config.rows), {
    message: 'winLength must be <= max(columns, rows), or no line could ever reach it',
    path: ['winLength'],
  });
export type ConnectFourConfig = z.infer<typeof ConnectFourConfigSchema>;

export const ConnectFourActionSchema = z.object({ column: z.number().int().nonnegative() });
export type ConnectFourAction = z.infer<typeof ConnectFourActionSchema>;

/** `board[row][col]`; row `0` is the top of the board, row `rows - 1` the bottom (where a
 * dropped piece settles first). `null` is an empty cell. */
export type ConnectFourBoard = (string | null)[][];

export interface ConnectFourState {
  participantIds: [string, string];
  config: ConnectFourConfig;
  board: ConnectFourBoard;
  currentPlayerIndex: 0 | 1;
  moveCount: number;
  /** Set the moment a drop completes a `winLength` line; `null` until then. */
  winnerId: string | null;
  /** Set once the board is full with no winner. */
  isDraw: boolean;
}

/**
 * Fully observable — the same board every participant would see, just relabeled to their own
 * perspective (`'you'`/`'opponent'`/`null`) rather than raw participant ids, matching
 * Rock-Paper-Scissors' `history` convention (games/rock-paper-scissors/src/types.ts). Sent only
 * when it's this participant's turn (`getPendingActions` returns just the current player), so
 * receiving one at all already means "act now" — there's no separate "is it my turn" field.
 */
export interface ConnectFourObservation {
  board: ('you' | 'opponent' | null)[][];
  columns: number;
  rows: number;
  winLength: number;
  /** Columns not yet full — the only legal `column` values for this move. */
  legalColumns: number[];
  opponentId: string;
  moveCount: number;
}

export interface ConnectFourResult {
  winnerId: string | null;
  participantIds: [string, string];
}
