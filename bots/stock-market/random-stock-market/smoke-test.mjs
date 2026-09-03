// Verifies random-stock-market against the real Docker runtime, and specifically that its
// choices are a deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md)
// — not uncontrolled Math.random(). Requires:
// docker build -t thunderdome-random-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-stock-market';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

function observationFor(round) {
  return {
    round,
    totalRounds: 100,
    portfolio: { cash: 10000, shares: 0, value: 10000 },
    market: { price: 100, priceHistory: [100], lastRoundVolume: null },
    event: { type: 'NO_NEWS', description: 'No significant news today.' },
  };
}

async function playOneTurn(matchId, rngSeed) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'random-stock-market',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'random-stock-market',
      roster: ['random-stock-market', 'opponent'],
      rngSeed,
      config: { rounds: 100 },
    },
    { initTimeoutMs: 10_000 },
  );

  lifecycle.sendObservation(0, { state: observationFor(0), awaitingAction: true });
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
assertEqual(second, first, 'same rngSeed produces the same action (deterministic, not Math.random())');

const third = await playOneTurn('det-check-3', 'cafef00d');
if (JSON.stringify(third) === JSON.stringify(first)) {
  console.log(
    'note - a different rngSeed happened to produce the same action (possible by chance); re-run to confirm it varies across seeds.',
  );
} else {
  console.log('ok - a different rngSeed produced a different action');
}

console.log('\nAll checks passed.');
