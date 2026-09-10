// Verifies buy-and-hold-stock-market-2 against the real Docker runtime: it spends 90% of its
// starting cash on shares in round 0 (sized off the visible ask), then holds no matter what
// happens afterward. Requires: docker build -t thunderdome-buy-and-hold-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-buy-and-hold-stock-market-2';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

function observationFor(round, portfolio, market, openOrders = []) {
  return {
    round,
    totalRounds: 100,
    symbol: 'DENN',
    mode: 'HISTORICAL',
    portfolio,
    openOrders,
    market,
    event: { type: 'NO_NEWS', description: 'No regulatory disclosures today.' },
  };
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-buy-and-hold-2',
  participantId: 'buy-and-hold-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-buy-and-hold-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.2.0',
    participantId: 'buy-and-hold-stock-market-2',
    roster: ['buy-and-hold-stock-market-2', 'opponent'],
    rngSeed: 'deadbeef',
    config: { rounds: 100 },
  },
  { initTimeoutMs: 10_000 },
);

// Round 0: $10,000 cash, real DENN close of $9.11 (2016-01-19) with the visible ask pinned at the
// same $9.11 — 90% of cash is $9,000, so floor(9000 / 9.11) = 987 shares.
lifecycle.sendObservation(0, {
  state: observationFor(
    0,
    { cash: 10000, shares: 0, value: 10000, availableCash: 10000, availableShares: 0 },
    {
      date: '2016-01-19',
      lastClose: 9.11,
      bid: 9.09,
      ask: 9.11,
      bidSize: 400,
      askSize: 400,
      orderBook: { bids: [{ price: 9.09, quantity: 400 }], asks: [{ price: 9.11, quantity: 400 }] },
      priceHistory: [],
      lastRoundVolume: null,
    },
  ),
  awaitingAction: true,
});
const roundZero = await lifecycle.awaitAction(0, 10_000);
if (!roundZero.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(roundZero)}`);
}
assertEqual(
  roundZero.action,
  { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 987 }] },
  'buys 987 shares at market in round 0 (90% of $10,000 at the visible $9.11 ask)',
);

// Round 1: whatever the portfolio/price looks like now, it must hold (submit no orders).
lifecycle.sendObservation(1, {
  state: observationFor(
    1,
    { cash: 1013.43, shares: 987, value: 10009.86, availableCash: 1013.43, availableShares: 987 },
    {
      date: '2016-01-20',
      lastClose: 8.98,
      bid: 8.96,
      ask: 8.98,
      bidSize: 400,
      askSize: 400,
      orderBook: { bids: [{ price: 8.96, quantity: 400 }], asks: [{ price: 8.98, quantity: 400 }] },
      priceHistory: [{ date: '2016-01-19', open: 9.11, high: 9.11, low: 9.11, close: 9.11, volume: 987 }],
      lastRoundVolume: { sharesBought: 987, sharesSold: 0, netDemand: 987 },
    },
  ),
  awaitingAction: true,
});
const roundOne = await lifecycle.awaitAction(1, 10_000);
if (!roundOne.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(roundOne)}`);
}
assertEqual(roundOne.action, { orders: [] }, 'holds (submits no orders) in every round after round 0');

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
