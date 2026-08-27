// Verifies random-connect-four against the real Docker runtime, and specifically that its
// choices are a deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md)
// — not uncontrolled Math.random(). Requires:
// docker build -t thunderdome-random-connect-four .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-connect-four';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneTurn(matchId, rngSeed) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'random-connect-four',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'connect-four',
      gameVersion: '1.0.0',
      participantId: 'random-connect-four',
      roster: ['random-connect-four', 'opponent'],
      rngSeed,
      config: { columns: 7, rows: 6, winLength: 4 },
    },
    { initTimeoutMs: 10_000 },
  );

  lifecycle.sendObservation(0, {
    state: {
      board: [],
      columns: 7,
      rows: 6,
      winLength: 4,
      legalColumns: [0, 1, 2, 3, 4, 5, 6],
      opponentId: 'opponent',
      moveCount: 0,
    },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(0, 10_000);

  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
  return result;
}

const first = await playOneTurn('det-check-1', 'deadbeef');
if (!first.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(first)}`);
}
console.log(`ok - responds with a valid action: ${JSON.stringify(first.action)}`);

const second = await playOneTurn('det-check-2', 'deadbeef');
assertEqual(second, first, 'same rngSeed produces the same column (deterministic, not Math.random())');

const third = await playOneTurn('det-check-3', 'cafef00d');
if (JSON.stringify(third) === JSON.stringify(first)) {
  console.log(
    'note - a different rngSeed happened to produce the same column (possible by chance with 7 options); re-run to confirm it varies across seeds.',
  );
} else {
  console.log('ok - a different rngSeed produced a different column');
}

console.log('\nAll checks passed.');
