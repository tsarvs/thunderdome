// Verifies momentum-stock-market-2 against the real Docker runtime: holds until there are at
// least two realized candles to compare, then buys after an up move and sells after a down move.
// Requires: docker build -t thunderdome-momentum-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-momentum-stock-market-2';

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
  matchId: 'smoke-momentum-2',
  participantId: 'momentum-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-momentum-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.3.0',
    participantId: 'momentum-stock-market-2',
    roster: ['momentum-stock-market-2', 'opponent'],
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

async function ask(round, priceHistory, shares) {
  lifecycle.sendObservation(round, {
    state: observationFor(round, richPortfolio(shares), {
      date: `synthetic-day-${round}`,
      lastClose: priceHistory[priceHistory.length - 1]?.close ?? 100,
      bid: 99.9,
      ask: 100.1,
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

assertEqual(await ask(0, [], 0), { orders: [] }, 'round 0: holds, no history yet');
assertEqual(await ask(1, [candle('d0', 100)], 0), { orders: [] }, 'round 1: holds, only one candle yet');
assertEqual(
  await ask(2, [candle('d0', 100), candle('d1', 105)], 0),
  { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] },
  'round 2: buys after an up move',
);
assertEqual(
  await ask(3, [candle('d1', 105), candle('d2', 95)], 8),
  { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 8 }] },
  'round 3: sells (capped by held shares) after a down move',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
