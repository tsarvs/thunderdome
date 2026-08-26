// Verifies random-rps against the real Docker runtime, and specifically that its choices are a
// deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md) — not
// uncontrolled Math.random(). Requires: docker build -t thunderdome-random-rps .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-rps';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneRound(matchId, rngSeed) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'random-rps',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'rock-paper-scissors',
      gameVersion: '1.0.0',
      participantId: 'random-rps',
      roster: ['random-rps', 'opponent'],
      rngSeed,
      config: { totalRounds: 3, onMissingAction: 'forfeitMatch' },
    },
    { initTimeoutMs: 10_000 },
  );

  lifecycle.sendObservation(0, {
    state: { round: 0, totalRounds: 3, yourWins: 0, opponentWins: 0, opponentId: 'opponent', history: [] },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(0, 10_000);

  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
  return result;
}

const first = await playOneRound('det-check-1', 'deadbeef');
if (!first.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(first)}`);
}
console.log(`ok - responds with a valid action: ${JSON.stringify(first.action)}`);

const second = await playOneRound('det-check-2', 'deadbeef');
assertEqual(second, first, 'same rngSeed produces the same choice (deterministic, not Math.random())');

const third = await playOneRound('det-check-3', 'cafef00d');
if (JSON.stringify(third) === JSON.stringify(first)) {
  console.log(
    'note - a different rngSeed happened to produce the same choice (possible by chance with 3 options); re-run to confirm it varies across seeds.',
  );
} else {
  console.log('ok - a different rngSeed produced a different choice');
}

console.log('\nAll checks passed.');
