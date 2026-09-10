// Verifies mean-reversion-stock-market-2 against the real Docker runtime: holds while the price
// is within 3% of its own recent average, buys once it's drifted 3% below, sells once it's
// drifted 3% above. Requires: docker build -t thunderdome-mean-reversion-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-mean-reversion-stock-market-2';

function candle(date, close) {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

function observationFor(round, portfolio, market) {
  return {
    round,
    totalRounds: 50,
    symbol: 'SYNTH',
    mode: 'SYNTHETIC',
    portfolio,
    openOrders: [],
    market,
    event: { type: 'NO_NEWS', description: 'No news today.' },
  };
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-mean-reversion-2',
  participantId: 'mean-reversion-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-mean-reversion-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.3.0',
    participantId: 'mean-reversion-stock-market-2',
    roster: ['mean-reversion-stock-market-2', 'opponent'],
    rngSeed: 'deadbeef',
    config: {},
  },
  { initTimeoutMs: 10_000 },
);

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

const richPortfolio = (shares) => ({
  cash: 100_000,
  shares,
  value: 100_000,
  availableCash: 100_000,
  availableShares: shares,
  buyingPower: 0,
  marginUsed: 0,
  maintenanceRequirement: 0,
  realizedPnl: 0,
  bankrupt: false,
});

async function ask(round, lastClose, priceHistory, shares) {
  lifecycle.sendObservation(round, {
    state: observationFor(round, richPortfolio(shares), {
      date: `synthetic-day-${round}`,
      lastClose,
      bid: lastClose - 0.1,
      ask: lastClose + 0.1,
      bidSize: 100,
      askSize: 100,
      orderBook: { bids: [], asks: [] },
      priceHistory,
      lastRoundVolume: null,
    }),
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(round, 10_000);
  if (!result.ok) {
    throw new Error(`round ${String(round)}: bot did not produce an action: ${JSON.stringify(result)}`);
  }
  return result.action;
}

const flatHistory = [candle('d0', 100), candle('d1', 100), candle('d2', 100)];
assertEqual(await ask(0, 100, [], 0), { orders: [] }, 'round 0: holds, no history yet');
assertEqual(await ask(1, 100, flatHistory, 0), { orders: [] }, 'round 1: holds, right at the average');
assertEqual(
  await ask(2, 95, flatHistory, 0),
  { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] },
  'round 2: buys 5% below the recent average',
);
assertEqual(
  await ask(3, 106, flatHistory, 7),
  { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 7 }] },
  'round 3: sells (capped by held shares) 6% above the recent average',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
