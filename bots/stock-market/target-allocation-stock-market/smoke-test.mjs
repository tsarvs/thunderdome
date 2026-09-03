// Verifies target-allocation-stock-market against the real Docker runtime: it buys when shares
// are underweight relative to its 50% target, sells when overweight, and holds inside the
// tolerance band. Requires:
// docker build -t thunderdome-target-allocation-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-target-allocation-stock-market';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneRound(matchId, portfolio) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'target-allocation-stock-market',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'target-allocation-stock-market',
      roster: ['target-allocation-stock-market', 'opponent'],
      rngSeed: 'deadbeef',
      config: { rounds: 100 },
    },
    { initTimeoutMs: 10_000 },
  );

  lifecycle.sendObservation(0, {
    state: {
      round: 5,
      totalRounds: 100,
      portfolio,
      market: {
        price: 100,
        priceHistory: [100],
        lastRoundVolume: { sharesBought: 0, sharesSold: 0, netDemand: 0 },
      },
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

// All-cash portfolio: 0% in shares, way under the 50% target — should buy.
assertEqual(
  await playOneRound('smoke-underweight', { cash: 10000, shares: 0, value: 10000 }),
  { action: 'BUY', quantity: 10 },
  'buys when shares are far below the 50% target allocation',
);

// Almost all-shares portfolio: value is $10,000 (100 cash + 99 shares * $100 = $9,900+100), about
// 99% in shares — way over the 50% target — should sell.
assertEqual(
  await playOneRound('smoke-overweight', { cash: 100, shares: 99, value: 10000 }),
  { action: 'SELL', quantity: 10 },
  'sells when shares are far above the 50% target allocation',
);

// Exactly at the target: $5,000 cash, 50 shares at $100 = $5,000 in shares, $10,000 total.
assertEqual(
  await playOneRound('smoke-balanced', { cash: 5000, shares: 50, value: 10000 }),
  { action: 'HOLD' },
  'holds when already at the target allocation',
);

console.log('\nAll checks passed.');
