// Verifies cross-sectional-momentum-stock-market-3 against the real Docker runtime: holds during
// warmup and between rebalances, then on a rebalance round buys the top-momentum equities (and
// shorts the bottom ones once margin/short-selling is available).
// Requires: docker build -t thunderdome-cross-sectional-momentum-stock-market-3 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-cross-sectional-momentum-stock-market-3';

function candlesTrending(startClose, stepPerRound, count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = startClose + stepPerRound * i;
    candles.push({ date: `day-${String(i)}`, open: close, high: close, low: close, close, volume: 1000 });
  }
  return candles;
}

function security(symbol, priceHistory, { ask = 100, bid = 99.9 } = {}) {
  return {
    symbol,
    kind: 'EQUITY',
    sector: 'TECHNOLOGY',
    active: true,
    sharesOutstanding: 100_000_000,
    quote: { lastClose: priceHistory.at(-1)?.close ?? 100, bid, ask, bidSize: 100, askSize: 100, orderBook: { bids: [], asks: [] } },
    priceHistory,
    lastRoundVolume: null,
    borrow: { availableShares: 1000, feeAnnualized: 0.03 },
    latestFundamentals: null,
    analystConsensus: null,
    analystRevisionHistory: [],
    events: [],
  };
}

function portfolio({ nlv, buyingPower = 0, positions = [] }) {
  return {
    cash: nlv,
    availableCash: nlv,
    nlv,
    buyingPower,
    marginUsed: 0,
    maintenanceRequirement: 0,
    grossExposure: 0,
    netExposure: 0,
    longExposure: 0,
    shortExposure: 0,
    leverage: 0,
    drawdown: 0,
    realizedPnl: 0,
    bankrupt: false,
    positions,
    openOrders: [],
  };
}

function observationFor(round, phase, securities, portfolioObservation) {
  return {
    round,
    totalRounds: 500,
    warmupRounds: 20,
    phase,
    indexSymbol: 'SYNTH_INDEX',
    securities,
    calendar: [],
    marketEvents: [],
    portfolio: portfolioObservation,
  };
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-cross-sectional-momentum-3',
  participantId: 'cross-sectional-momentum-stock-market-3',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-cross-sectional-momentum-3' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-3',
    gameVersion: '0.1.0',
    participantId: 'cross-sectional-momentum-stock-market-3',
    roster: ['cross-sectional-momentum-stock-market-3', 'opponent'],
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

async function ask(round, phase, securities, portfolioObservation) {
  lifecycle.sendObservation(round, { state: observationFor(round, phase, securities, portfolioObservation), awaitingAction: true });
  const result = await lifecycle.awaitAction(round, 10_000);
  if (!result.ok) {
    throw new Error(`round ${String(round)}: bot did not produce an action: ${JSON.stringify(result)}`);
  }
  return result.action;
}

// Four equities with 21 rounds of history (more than the 20-round lookback), trending strongly
// up (TECH_A), mildly up (TECH_B), flat (CONSUMER_A), and down (CONSUMER_B) — but all quoted at
// the same $100 ask/bid right now, so expected order sizes are easy to compute by hand.
const securities = [
  security('TECH_A', candlesTrending(80, 2, 21), { ask: 100, bid: 99.9 }),
  security('TECH_B', candlesTrending(90, 0.5, 21), { ask: 100, bid: 99.9 }),
  security('CONSUMER_A', candlesTrending(100, 0, 21), { ask: 100, bid: 99.9 }),
  security('CONSUMER_B', candlesTrending(120, -2, 21), { ask: 100, bid: 99.9 }),
];

assertEqual(
  await ask(5, 'WARMUP', securities, portfolio({ nlv: 100_000 })),
  { orders: [] },
  'round 5 (warmup): holds regardless of momentum',
);

// Round 30 is a rebalance round (30 % 10 === 0) and past warmup — long-only (buyingPower: 0)
// should buy the top 2 by trailing momentum: TECH_A then TECH_B. perLongDollars = 100,000 * 0.25 /
// 2 = 12,500; at $100/share that's 125 shares each.
assertEqual(
  await ask(30, 'COMPETITION', securities, portfolio({ nlv: 100_000 })),
  {
    orders: [
      { kind: 'MARKET', symbol: 'TECH_A', side: 'BUY', quantity: 125 },
      { kind: 'MARKET', symbol: 'TECH_B', side: 'BUY', quantity: 125 },
    ],
  },
  'round 30 (rebalance): buys the top-2-momentum equities, long-only',
);

assertEqual(
  await ask(31, 'COMPETITION', securities, portfolio({ nlv: 100_000, positions: [{ symbol: 'TECH_A', shares: 125 }, { symbol: 'TECH_B', shares: 125 }] })),
  { orders: [] },
  'round 31: holds between rebalances even with an existing position',
);

// With margin available, the same ranking should also short the bottom 2 (CONSUMER_B then
// CONSUMER_A): perShortDollars = 100,000 * 0.25 / 2 = 12,500 -> -125 shares each at $100.
assertEqual(
  await ask(40, 'COMPETITION', securities, portfolio({ nlv: 100_000, buyingPower: 200_000, positions: [{ symbol: 'TECH_A', shares: 125 }, { symbol: 'TECH_B', shares: 125 }] })),
  {
    orders: [
      { kind: 'MARKET', symbol: 'CONSUMER_B', side: 'SELL', quantity: 125 },
      { kind: 'MARKET', symbol: 'CONSUMER_A', side: 'SELL', quantity: 125 },
    ],
  },
  'round 40 (rebalance, margin available): also shorts the bottom-2-momentum equities',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
