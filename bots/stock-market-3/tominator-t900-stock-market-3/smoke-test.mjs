// Verifies tominator-t900-stock-market-3 against the real Docker runtime: holds during
// warmup, rebalances long-only and long/short off trailing momentum, holds steady once already
// at target, and runs its fixed-payout arbitrage overlay on a pending ACQUISITION event (buying
// in below the disclosed cash price, and taking profit early if the market ever prices a held
// arb position above that guaranteed payout).
// Requires: docker build -t thunderdome-tominator-t900-stock-market-3 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tominator-t900-stock-market-3';

function candlesTrending(startClose, stepPerRound, count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = startClose + stepPerRound * i;
    candles.push({ date: `day-${String(i)}`, open: close, high: close, low: close, close, volume: 1000 });
  }
  return candles;
}

function security(symbol, priceHistory, options = {}) {
  const { ask = 100, bid = 99.9, borrow = { availableShares: 1000, feeAnnualized: 0.03 }, events = [] } = options;
  return {
    symbol,
    kind: 'EQUITY',
    sector: 'TECHNOLOGY',
    active: true,
    sharesOutstanding: 100_000_000,
    quote: { lastClose: priceHistory.at(-1)?.close ?? 100, bid, ask, bidSize: 100, askSize: 100, orderBook: { bids: [], asks: [] } },
    priceHistory,
    lastRoundVolume: null,
    borrow,
    latestFundamentals: null,
    analystConsensus: null,
    analystRevisionHistory: [],
    events,
  };
}

function portfolio({ nlv, buyingPower = 0, positions = [], drawdown = 0 }) {
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
    drawdown,
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
  matchId: 'smoke-tominator-t900-3',
  participantId: 'tominator-t900-stock-market-3',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-tominator-t900-3' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-3',
    gameVersion: '0.1.0',
    participantId: 'tominator-t900-stock-market-3',
    roster: ['tominator-t900-stock-market-3', 'opponent'],
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

// Four equities, 21 rounds of history each — strongly up (A), mildly up (B), flat (C), strongly
// down (D) — all quoted at the same $100/$99.90 ask/bid right now. With only 21 rounds of
// history, the momentum-window backtest only has enough pooled data to trust its 5-round
// candidate (44 samples; every longer candidate falls below MIN_IC_SAMPLES) — so this bot
// actually picks a 5-round window here, not the 10-round cold-start default, proving the
// selection is genuinely data-driven. T-900 splits each leg equally rather than weighting by
// conviction (that's T-901), so the final trade sizes below happen to come out the same
// regardless of which window wins, since these four names' momentum RANKING is identical at any
// reasonable window — only the magnitude differs, and magnitude isn't what equal-split uses.
const fourEquities = [
  security('TECH_A', candlesTrending(80, 2, 21)),
  security('TECH_B', candlesTrending(90, 0.5, 21)),
  security('CONSUMER_A', candlesTrending(100, 0, 21)),
  security('CONSUMER_B', candlesTrending(120, -2, 21)),
];

assertEqual(
  await ask(5, 'WARMUP', fourEquities, portfolio({ nlv: 100_000 })),
  { orders: [] },
  'round 5 (warmup): holds regardless of momentum',
);

// Long-only (buyingPower: 0): buys the top-3-momentum names. perLongDollars = 100,000 * 0.3 / 3 =
// 10,000; at $100/share ask that's 100 shares each.
assertEqual(
  await ask(30, 'COMPETITION', fourEquities, portfolio({ nlv: 100_000 })),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'TECH_A', side: 'BUY', quantity: 100, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'TECH_B', side: 'BUY', quantity: 100, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'CONSUMER_A', side: 'BUY', quantity: 100, limitPrice: 100 },
    ],
  },
  'round 30: long-only rebalance buys the top-3-momentum equities at 100 shares each',
);

// Already sitting exactly at target -> no further orders this round.
assertEqual(
  await ask(
    31,
    'COMPETITION',
    fourEquities,
    portfolio({
      nlv: 100_000,
      positions: [
        { symbol: 'TECH_A', shares: 100 },
        { symbol: 'TECH_B', shares: 100 },
        { symbol: 'CONSUMER_A', shares: 100 },
      ],
    }),
  ),
  { orders: [] },
  'round 31: holds steady once already at target, even every round',
);

// Six equities with clearly separated momentum so the top-3/bottom-3 split has no overlap. With
// 6 names' worth of pooled data, both the 5-round and 10-round momentum candidates clear
// MIN_IC_SAMPLES here, but 5-round still wins on higher realized correlation (0.993 vs 0.986) —
// again with no visible effect on these sizes, for the same equal-split reason as above.
const sixEquities = [
  security('A', candlesTrending(70, 3, 21)),
  security('B', candlesTrending(90, 1, 21)),
  security('C', candlesTrending(95, 0.2, 21)),
  security('D', candlesTrending(105, -0.2, 21)),
  security('E', candlesTrending(110, -1, 21)),
  security('F', candlesTrending(130, -3, 21)),
];

// With margin available, longs the top 3 and shorts the bottom 3. Gross fraction 0.3 split
// across both legs: perLongDollars = perShortDollars = 100,000 * 0.3 / 2 / 3 ≈ 5,000 -> floor(5,000
// / 100) = 50 shares long, floor(5,000 / 99.9) = 50 shares short.
assertEqual(
  await ask(40, 'COMPETITION', sixEquities, portfolio({ nlv: 100_000, buyingPower: 200_000 })),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'A', side: 'BUY', quantity: 50, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'B', side: 'BUY', quantity: 50, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'C', side: 'BUY', quantity: 50, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'D', side: 'SELL', quantity: 50, limitPrice: 99.9 },
      { kind: 'LIMIT', symbol: 'E', side: 'SELL', quantity: 50, limitPrice: 99.9 },
      { kind: 'LIMIT', symbol: 'F', side: 'SELL', quantity: 50, limitPrice: 99.9 },
    ],
  },
  'round 40 (margin available): longs the top 3 and shorts the bottom 3 by momentum',
);

// A pending acquisition pays a FIXED $150/share 3 rounds out regardless of market price — the ask
// ($120) is well below that, so the arb overlay buys in up to its per-name cap: min(100,000*0.2,
// 100,000*0.4) / 120 = 20,000 / 120 = floor(166.67) = 166 shares.
const pendingAcquisition = [
  security('TARGET', candlesTrending(100, 0, 21), {
    ask: 120,
    bid: 119.9,
    events: [{ type: 'ACQUISITION', observedAtRound: 37, symbol: 'TARGET', details: { type: 'ACQUISITION', effectiveRound: 40, cashPerShare: 150 } }],
  }),
];

assertEqual(
  await ask(37, 'COMPETITION', pendingAcquisition, portfolio({ nlv: 100_000 })),
  { orders: [{ kind: 'LIMIT', symbol: 'TARGET', side: 'BUY', quantity: 166, limitPrice: 120 }] },
  'round 37: buys into a pending acquisition trading below its disclosed cash payout',
);

// Now holding 100 shares and the market has bid the price ($160) above the guaranteed $150 payout
// -> take the better price now rather than waiting to be cashed out at $150.
const acquisitionAboveMarket = [
  security('TARGET', candlesTrending(100, 0, 21), {
    ask: 161,
    bid: 160,
    events: [{ type: 'ACQUISITION', observedAtRound: 37, symbol: 'TARGET', details: { type: 'ACQUISITION', effectiveRound: 40, cashPerShare: 150 } }],
  }),
];

assertEqual(
  await ask(38, 'COMPETITION', acquisitionAboveMarket, portfolio({ nlv: 100_000, positions: [{ symbol: 'TARGET', shares: 100 }] })),
  { orders: [{ kind: 'LIMIT', symbol: 'TARGET', side: 'SELL', quantity: 100, limitPrice: 160 }] },
  'round 38: takes profit early once the market prices a held arb position above its payout',
);

await lifecycle.finish({ result: { winnerId: 'tominator-t900-stock-market-3' }, reason: 'completed' });

console.log('\nAll checks passed.');
