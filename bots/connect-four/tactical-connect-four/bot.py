#!/usr/bin/env python3
"""Tactical Connect Four — plays an immediate winning move when one is available, otherwise
blocks the opponent's immediate winning move, otherwise prefers the column closest to center.

All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting on
"match-end") lives in thunderdome_bot_sdk's run_bot() — the Python analog of
@thunderdome/bot-sdk's runBot() for TS/JS bots (packages/bot-sdk-python/). This file only needs
to decide each turn's action — see games/connect-four/src/types.ts for the exact
config/observation/action shapes used below.
"""
from thunderdome_bot_sdk import run_bot


def drop(board, column, mark, rows):
    """Returns a new board with `mark` dropped into `column` (settling at the lowest empty row)."""
    new_board = [row[:] for row in board]
    for row in range(rows - 1, -1, -1):
        if new_board[row][column] is None:
            new_board[row][column] = mark
            break
    return new_board


def has_win(board, rows, columns, win_length, mark):
    """Whether `board` contains `win_length` consecutive `mark` cells, in any direction."""
    for row in range(rows):
        for col in range(columns):
            if board[row][col] != mark:
                continue
            for delta_row, delta_col in ((0, 1), (1, 0), (1, 1), (1, -1)):
                count = 1
                r, c = row + delta_row, col + delta_col
                while 0 <= r < rows and 0 <= c < columns and board[r][c] == mark:
                    count += 1
                    r += delta_row
                    c += delta_col
                if count >= win_length:
                    return True
    return False


def decide_action(state):
    board = state["board"]
    rows = state["rows"]
    columns = state["columns"]
    win_length = state["winLength"]
    legal_columns = state["legalColumns"]

    for column in legal_columns:
        if has_win(drop(board, column, "you", rows), rows, columns, win_length, "you"):
            return {"column": column}

    for column in legal_columns:
        if has_win(drop(board, column, "opponent", rows), rows, columns, win_length, "opponent"):
            return {"column": column}

    center = (columns - 1) / 2
    best_column = min(legal_columns, key=lambda column: (abs(column - center), column))
    return {"column": best_column}


run_bot(decide_action)
