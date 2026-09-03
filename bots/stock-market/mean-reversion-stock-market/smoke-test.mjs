// Verifies mean-reversion-stock-market against the real Docker runtime: it buys once the price
// has drifted well below its own recent average, sells once it's drifted well above it, and
// holds in between. Requires: docker build -t thunderdome-mean-reversion-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-mean-reversion-stock-market';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneRound(matchId, portfolio, priceHistory) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'mean-reversion-stock-market',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'mean-reversion-stock-market',
      roster: ['mean-reversion-stock-market', 'opponent'],
      rngSeed: 'deadbeef',
      config: { rounds: 100 },
    },
    { initTimeoutMs: 10_000 },
  );

  const price = priceHistory[priceHistory.length - 1];
  lifecycle.sendObservation(0, {
    state: {
      round: priceHistory.length - 1,
      totalRounds: 100,
      portfolio,
      market: { price, priceHistory, lastRoundVolume: { sharesBought: 0, sharesSold: 0, netDemand: 0 } },
      event: { type: 'NO_NEWS', description: 'No significant news today.' },
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

const richPortfolio = { cash: 10000, shares: 20, value: 12000 };
// Average of [100, 100, 100, 100, 100] is 100 throughout; only the final price moves.

assertEqual(
  await playOneRound('smoke-below', richPortfolio, [100, 100, 100, 100, 90]),
  { action: 'BUY', quantity: 10 },
  'buys the max trade size once price has drifted >3% below its recent average',
);
assertEqual(
  await playOneRound('smoke-above', richPortfolio, [100, 100, 100, 100, 110]),
  { action: 'SELL', quantity: 10 },
  'sells the max trade size once price has drifted >3% above its recent average',
);
assertEqual(
  await playOneRound('smoke-near', richPortfolio, [100, 100, 100, 100, 101]),
  { action: 'HOLD' },
  'holds while price stays within the drift threshold of its recent average',
);

console.log('\nAll checks passed.');
