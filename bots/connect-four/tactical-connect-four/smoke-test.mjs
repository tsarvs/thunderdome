// Verifies tactical-connect-four against the real Docker runtime: it takes an immediate winning
// move when one exists, otherwise blocks the opponent's immediate winning move, otherwise prefers
// the column closest to center. Requires:
// docker build -t thunderdome-tactical-connect-four .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tactical-connect-four';
const COLUMNS = 7;
const ROWS = 6;
const WIN_LENGTH = 4;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`ok - ${label}`);
}

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));
}

async function playOneTurn(matchId, board, legalColumns) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'tactical-connect-four',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'connect-four',
      gameVersion: '1.0.0',
      participantId: 'tactical-connect-four',
      roster: ['tactical-connect-four', 'opponent'],
      rngSeed: 'deadbeef',
      config: { columns: COLUMNS, rows: ROWS, winLength: WIN_LENGTH },
    },
    { initTimeoutMs: 10_000 },
  );

  lifecycle.sendObservation(0, {
    state: {
      board,
      columns: COLUMNS,
      rows: ROWS,
      winLength: WIN_LENGTH,
      legalColumns,
      opponentId: 'opponent',
      moveCount: 0,
    },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(0, 10_000);

  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
  if (!result.ok) {
    throw new Error(`bot did not produce an action: ${JSON.stringify(result)}`);
  }
  return result.action;
}

// Bottom row (row 5) has "you" three-in-a-row at columns 0-2, open at column 3 — dropping there
// completes a horizontal win, and nothing else does.
const winningBoard = emptyBoard();
winningBoard[5] = ['you', 'you', 'you', null, null, null, null];
const winAction = await playOneTurn('smoke-win', winningBoard, [0, 1, 2, 3, 4, 5, 6]);
assertEqual(winAction.column, 3, 'takes an immediate winning move over anything else');

// Bottom row has "opponent" three-in-a-row at columns 0-2, open at column 3 — the bot has no
// winning move of its own, so it must block there instead.
const blockingBoard = emptyBoard();
blockingBoard[5] = ['opponent', 'opponent', 'opponent', null, null, null, null];
const blockAction = await playOneTurn('smoke-block', blockingBoard, [0, 1, 2, 3, 4, 5, 6]);
assertEqual(blockAction.column, 3, 'blocks the opponent\'s immediate winning move');

// Empty board, no win or block available anywhere — falls back to the center column (3 of 0-6).
const openAction = await playOneTurn('smoke-center', emptyBoard(), [0, 1, 2, 3, 4, 5, 6]);
assertEqual(openAction.column, 3, 'prefers the center column with no tactical move available');

console.log('\nAll checks passed.');
