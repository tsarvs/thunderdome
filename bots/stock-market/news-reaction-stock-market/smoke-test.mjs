// Verifies news-reaction-stock-market against the real Docker runtime: it buys on clearly
// positive news, sells on clearly negative news, and holds on NO_NEWS — regardless of price
// history. Requires: docker build -t thunderdome-news-reaction-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-news-reaction-stock-market';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneRound(matchId, portfolio, event) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'news-reaction-stock-market',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'news-reaction-stock-market',
      roster: ['news-reaction-stock-market', 'opponent'],
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
      event,
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
  await playOneRound('smoke-positive', richPortfolio, {
    type: 'EARNINGS_BEAT',
    description: 'The company reported earnings significantly above expectations.',
  }),
  { action: 'BUY', quantity: 10 },
  'buys the max trade size on clearly positive news',
);
assertEqual(
  await playOneRound('smoke-negative', richPortfolio, {
    type: 'EARNINGS_MISS',
    description: 'The company reported earnings significantly below expectations.',
  }),
  { action: 'SELL', quantity: 10 },
  'sells the max trade size on clearly negative news',
);
assertEqual(
  await playOneRound('smoke-no-news', richPortfolio, {
    type: 'NO_NEWS',
    description: 'No significant news today.',
  }),
  { action: 'HOLD' },
  'holds on NO_NEWS',
);

console.log('\nAll checks passed.');
