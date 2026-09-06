// Verifies market-maker-stock-market-2 against the real Docker runtime: quotes a fresh DAY LIMIT
// buy and sell around the visible mid-price every round, sized within what's affordable/held, and
// keeps quoting a sell (opening a short) once its own share inventory runs out, given margin.
// Requires: docker build -t thunderdome-market-maker-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-market-maker-stock-market-2';

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
  matchId: 'smoke-market-maker-2',
  participantId: 'market-maker-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-market-maker-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.3.0',
    participantId: 'market-maker-stock-market-2',
    roster: ['market-maker-stock-market-2', 'opponent'],
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

async function ask(round, bid, askPrice, shares, buyingPower) {
  lifecycle.sendObservation(round, {
    state: observationFor(round, portfolio(shares, buyingPower), {
      date: `synthetic-day-${round}`,
      lastClose: (bid + askPrice) / 2,
      bid,
      ask: askPrice,
      bidSize: 100,
      askSize: 100,
      orderBook: { bids: [], asks: [] },
      priceHistory: [],
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

assertEqual(
  await ask(0, 99.9, 100.1, 100, 0),
  {
    orders: [
      { kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 99.5, timeInForce: 'DAY' },
      { kind: 'LIMIT', side: 'SELL', quantity: 5, limitPrice: 100.5, timeInForce: 'DAY' },
    ],
  },
  'round 0: quotes both sides around the mid-price with shares to sell',
);
assertEqual(
  await ask(1, 99.9, 100.1, 0, 0),
  { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 99.5, timeInForce: 'DAY' }] },
  'round 1: only quotes the buy side once out of inventory and margin is off',
);
assertEqual(
  await ask(2, 99.9, 100.1, 0, 10_000),
  {
    orders: [
      { kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 99.5, timeInForce: 'DAY' },
      { kind: 'LIMIT', side: 'SELL', quantity: 5, limitPrice: 100.5, timeInForce: 'DAY' },
    ],
  },
  'round 2: still quotes the sell side (opening a short) once margin is available',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
