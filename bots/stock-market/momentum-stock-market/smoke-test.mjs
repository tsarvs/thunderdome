// Verifies momentum-stock-market against the real Docker runtime: it buys after a price rise,
// sells after a price fall, and holds when there's no move (or no history) to react to.
// Requires: docker build -t thunderdome-momentum-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-momentum-stock-market';

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
    participantId: 'momentum-stock-market',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'momentum-stock-market',
      roster: ['momentum-stock-market', 'opponent'],
      rngSeed: 'deadbeef',
      config: { rounds: 100 },
    },
    { initTimeoutMs: 10_000 },
  );

  const price = priceHistory[priceHistory.length - 1];
  lifecycle.sendObservation(0, {
    state: {
      round: 1,
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

assertEqual(
  await playOneRound('smoke-up', richPortfolio, [100, 101]),
  { action: 'BUY', quantity: 10 },
  'buys the max trade size after a price rise',
);
assertEqual(
  await playOneRound('smoke-down', richPortfolio, [100, 99]),
  { action: 'SELL', quantity: 10 },
  'sells the max trade size after a price fall',
);
assertEqual(
  await playOneRound('smoke-flat', richPortfolio, [100, 100]),
  { action: 'HOLD' },
  'holds when the price is unchanged',
);
assertEqual(
  await playOneRound('smoke-first-round', richPortfolio, [100]),
  { action: 'HOLD' },
  'holds on the very first round, before there is a previous price to compare against',
);

console.log('\nAll checks passed.');
