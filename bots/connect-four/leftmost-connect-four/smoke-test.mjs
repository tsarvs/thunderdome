#!/usr/bin/env node
// Verifies leftmost-connect-four against the real Docker runtime. Requires:
// docker build -t thunderdome-leftmost-connect-four .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-leftmost-connect-four';
const MATCH_ID = 'leftmost-connect-four-smoke-test';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: MATCH_ID,
  participantId: 'leftmost-connect-four',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();

const lifecycle = new BotLifecycle({ process: botProcess, matchId: MATCH_ID });

const initOutcome = await lifecycle.initialize(
  {
    gameId: 'connect-four',
    gameVersion: '1.0.0',
    participantId: 'leftmost-connect-four',
    roster: ['leftmost-connect-four', 'opponent'],
    rngSeed: 'deadbeef',
    config: { columns: 7, rows: 6, winLength: 4 },
  },
  { initTimeoutMs: 10_000 },
);
assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

for (const [roundId, legalColumns] of [
  [0, [0, 1, 2, 3, 4, 5, 6]],
  [1, [1, 2, 3, 4, 5, 6]], // column 0 is now full, per this observation
]) {
  lifecycle.sendObservation(roundId, {
    state: {
      board: [],
      columns: 7,
      rows: 6,
      winLength: 4,
      legalColumns,
      opponentId: 'opponent',
      moveCount: roundId,
    },
    awaitingAction: true,
  });
  const outcome = await lifecycle.awaitAction(roundId, 10_000);
  assertEqual(
    outcome,
    { ok: true, action: { column: legalColumns[0] } },
    `round ${roundId}: always picks the first legal column`,
  );
}

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

console.log('\nAll checks passed.');
