// Verifies short-momentum-stock-market-2 against the real Docker runtime: never trades when
// margin is off (buyingPower 0), opens a short after two consecutive down closes when margin is
// on, and covers the moment the price bounces. Requires:
// docker build -t thunderdome-short-momentum-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-short-momentum-stock-market-2';

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
  matchId: 'smoke-short-momentum-2',
  participantId: 'short-momentum-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-short-momentum-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.3.0',
    participantId: 'short-momentum-stock-market-2',
    roster: ['short-momentum-stock-market-2', 'opponent'],
    rngSeed: 'deadbeef',
    config: { risk: { allowShortSelling: true } },
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

function portfolio(shares, buyingPower) {
  return {
    cash: 100_000,
    shares,
    value: 100_000,
    availableCash: 100_000,
    availableShares: Math.max(0, shares),
    buyingPower,
    marginUsed: Math.abs(shares) * 100,
    maintenanceRequirement: 0,
    realizedPnl: 0,
    bankrupt: false,
  };
}

async function ask(round, lastClose, priceHistory, shares, buyingPower) {
  lifecycle.sendObservation(round, {
    state: observationFor(round, portfolio(shares, buyingPower), {
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

const downtrend = [candle('d0', 105), candle('d1', 102)];
assertEqual(
  await ask(0, 100, downtrend, 0, 0),
  { orders: [] },
  'round 0: never trades when margin/shorting is off (buyingPower 0)',
);
assertEqual(
  await ask(1, 100, downtrend, 0, 20_000),
  { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] },
  'round 1: opens a short after two consecutive down closes, once margin is available',
);
assertEqual(
  await ask(2, 108, [candle('d1', 102), candle('d2', 100)], -10, 20_000),
  { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] },
  'round 2: covers the entire short the moment the price bounces',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
