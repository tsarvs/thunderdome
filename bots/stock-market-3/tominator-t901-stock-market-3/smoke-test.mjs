// Verifies tominator-t901-stock-market-3 against the real Docker runtime: holds during
// warmup; picks its momentum/value lookback windows by backtesting candidates against its own
// price history rather than assuming a "true" window, and sizes positions by conviction rather
// than splitting each leg equally; reacts to a decaying post-earnings surprise; learns its own
// macro sector-tilt in-match (via regression against realized returns around economic-release
// surprises, never a known table) even during warmup, then acts on it once momentum is flat/tied;
// and runs its fixed-payout arbitrage overlay on a pending ACQUISITION event exactly like
// tominator-t900-stock-market-3.
// Requires: docker build -t thunderdome-tominator-t901-stock-market-3 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tominator-t901-stock-market-3';

function candlesTrending(startClose, stepPerRound, count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = startClose + stepPerRound * i;
    candles.push({ date: `day-${String(i)}`, open: close, high: close, low: close, close, volume: 1000 });
  }
  return candles;
}

function candlesFlat(close, count) {
  return candlesTrending(close, 0, count);
}

function security(symbol, priceHistory, options = {}) {
  const {
    sector = 'TECHNOLOGY',
    ask = 100,
    bid = 99.9,
    borrow = { availableShares: 1000, feeAnnualized: 0.03 },
    events = [],
    analystRevisionHistory = [],
  } = options;
  return {
    symbol,
    kind: 'EQUITY',
    sector,
    active: true,
    sharesOutstanding: 100_000_000,
    quote: { lastClose: priceHistory.at(-1)?.close ?? 100, bid, ask, bidSize: 100, askSize: 100, orderBook: { bids: [], asks: [] } },
    priceHistory,
    lastRoundVolume: null,
    borrow,
    latestFundamentals: null,
    analystConsensus: null,
    analystRevisionHistory,
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

function observationFor(round, phase, securities, portfolioObservation, marketEvents = []) {
  return {
    round,
    totalRounds: 500,
    warmupRounds: 20,
    phase,
    indexSymbol: 'SYNTH_INDEX',
    securities,
    calendar: [],
    marketEvents,
    portfolio: portfolioObservation,
  };
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-tominator-t901-3',
  participantId: 'tominator-t901-stock-market-3',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-tominator-t901-3' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-3',
    gameVersion: '0.1.0',
    participantId: 'tominator-t901-stock-market-3',
    roster: ['tominator-t901-stock-market-3', 'opponent'],
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

async function ask(round, phase, securities, portfolioObservation, marketEvents) {
  lifecycle.sendObservation(round, { state: observationFor(round, phase, securities, portfolioObservation, marketEvents), awaitingAction: true });
  const result = await lifecycle.awaitAction(round, 10_000);
  if (!result.ok) {
    throw new Error(`round ${String(round)}: bot did not produce an action: ${JSON.stringify(result)}`);
  }
  return result.action;
}

assertEqual(
  await ask(5, 'WARMUP', [security('TECH_A', candlesTrending(80, 2, 21))], portfolio({ nlv: 100_000 })),
  { orders: [] },
  'round 5 (warmup): holds regardless of momentum',
);

// Four equities, 21 rounds of history each — strongly up (TECH_A), mildly up (TECH_B), flat
// (CONSUMER_A), strongly down (CONSUMER_B). With only 21 rounds of history, the momentum-window
// backtest only has enough pooled data to trust its 5-round candidate (44 samples; every longer
// candidate falls below MIN_IC_SAMPLES) — so this bot picks a 5-round window here, not the
// 10-round cold-start default, and (unlike T-900's equal split) that choice directly drives these
// conviction-weighted sizes: TECH_A 227, TECH_B 89, CONSUMER_A 33 (all long-only, buyingPower: 0).
const convictionEquities = [
  security('TECH_A', candlesTrending(80, 2, 21)),
  security('TECH_B', candlesTrending(90, 0.5, 21)),
  security('CONSUMER_A', candlesTrending(100, 0, 21)),
  security('CONSUMER_B', candlesTrending(120, -2, 21)),
];

assertEqual(
  await ask(30, 'COMPETITION', convictionEquities, portfolio({ nlv: 100_000 })),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'TECH_A', side: 'BUY', quantity: 227, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'TECH_B', side: 'BUY', quantity: 89, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'CONSUMER_A', side: 'BUY', quantity: 33, limitPrice: 100 },
    ],
  },
  'round 30: conviction-weighted sizing off an empirically-selected (5-round) momentum window (long-only)',
);

// Six same-sector equities (sector-demeaning a no-op here, isolating the conviction-weighting
// math) with clearly separated momentum: A/B/C up (strongest to mildest), D/E/F down (mildest to
// strongest). With 6 names' worth of pooled data, both the 5-round and 10-round momentum
// candidates clear MIN_IC_SAMPLES, but 5-round still wins on higher realized correlation (0.993
// vs. 0.986) — sized by conviction rather than split evenly: A 111, B 47, C 16 long; D 11, E 38,
// F 124 short.
const sixEquities = [
  security('A', candlesTrending(70, 3, 21)),
  security('B', candlesTrending(90, 1, 21)),
  security('C', candlesTrending(95, 0.2, 21)),
  security('D', candlesTrending(105, -0.2, 21)),
  security('E', candlesTrending(110, -1, 21)),
  security('F', candlesTrending(130, -3, 21)),
];

assertEqual(
  await ask(40, 'COMPETITION', sixEquities, portfolio({ nlv: 100_000, buyingPower: 200_000 })),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'A', side: 'BUY', quantity: 111, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'B', side: 'BUY', quantity: 47, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'C', side: 'BUY', quantity: 16, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'D', side: 'SELL', quantity: 11, limitPrice: 99.9 },
      { kind: 'LIMIT', symbol: 'E', side: 'SELL', quantity: 38, limitPrice: 99.9 },
      { kind: 'LIMIT', symbol: 'F', side: 'SELL', quantity: 124, limitPrice: 99.9 },
    ],
  },
  'round 40 (margin available): conviction-weighted long/short book off an empirically-selected momentum window',
);

// Three names with IDENTICAL flat price histories (momentum tied at exactly 0 for all three, so
// it contributes nothing) — WINNER beat its EPS consensus by 30%, LOSER missed by 30%, NEUTRAL
// reported nothing this quarter. The decaying earnings-surprise term alone ranks WINNER > NEUTRAL
// > LOSER and sizes them accordingly (long-only, buyingPower: 0): 187 / 116 / 45 shares.
const earningsEquities = [
  security('WINNER', candlesFlat(100, 21), {
    events: [
      {
        type: 'EARNINGS_REPORT',
        observedAtRound: 30,
        symbol: 'WINNER',
        periodLabel: 'Q1',
        reported: { eps: 1.3, revenue: 200, marginBps: 1000 },
        consensus: { eps: 1, revenue: 200, marginBps: 1000 },
      },
    ],
  }),
  security('NEUTRAL', candlesFlat(100, 21)),
  security('LOSER', candlesFlat(100, 21), {
    events: [
      {
        type: 'EARNINGS_REPORT',
        observedAtRound: 30,
        symbol: 'LOSER',
        periodLabel: 'Q1',
        reported: { eps: 0.7, revenue: 200, marginBps: 1000 },
        consensus: { eps: 1, revenue: 200, marginBps: 1000 },
      },
    ],
  }),
];

assertEqual(
  await ask(30, 'COMPETITION', earningsEquities, portfolio({ nlv: 100_000 })),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'WINNER', side: 'BUY', quantity: 187, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'NEUTRAL', side: 'BUY', quantity: 116, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'LOSER', side: 'BUY', quantity: 45, limitPrice: 100 },
    ],
  },
  'round 30: a decaying post-earnings surprise alone ranks and sizes tied-momentum names',
);

// The macro sector-tilt is *learned*, not known in advance — it starts at zero conviction and
// only kicks in once this bot has accumulated MIN_MACRO_SAMPLES real (surprise, realized-return)
// data points for a given (sector, indicator) pair. Simulate 4 WARMUP rounds where a fresh
// POLICY_RATE release fires and TECHNOLOGY/FINANCIAL move in a perfectly consistent (noiseless)
// -0.5x / +0.5x relationship to that round's surprise — proving warmup rounds feed the regression
// too (each of these returns {orders: []} regardless, since it's still WARMUP). A 2-round-history
// fixture is enough here: momentum needs >10 rounds so it's excluded on these calibration calls,
// which is fine since we don't assert on them beyond the guaranteed-empty warmup action.
function oneRoundReturnHistory(closeBefore, roundReturn) {
  return [
    { date: 'before', open: closeBefore, high: closeBefore, low: closeBefore, close: closeBefore, volume: 1000 },
    { date: 'after', open: closeBefore, high: closeBefore, low: closeBefore, close: closeBefore * Math.exp(roundReturn), volume: 1000 },
  ];
}
function policyRateEvent(round, reported) {
  return { type: 'ECONOMIC_RELEASE', observedAtRound: round, indicator: 'POLICY_RATE', periodLabel: 'Q1', reported, consensus: 5.0, previous: 4.9 };
}
const TECH_SLOPE = -0.5;
const FIN_SLOPE = 0.5;
const calibrationRounds = [
  { round: 10, reported: 5.1 }, // surprise = +0.02
  { round: 11, reported: 4.95 }, // surprise = -0.01
  { round: 12, reported: 5.15 }, // surprise = +0.03
  { round: 13, reported: 4.9 }, // surprise = -0.02
];
for (const { round, reported } of calibrationRounds) {
  const surprise = (reported - 5.0) / 5.0;
  const calibrationEquities = [
    security('TECH_CO', oneRoundReturnHistory(100, TECH_SLOPE * surprise), { sector: 'TECHNOLOGY' }),
    security('FIN_CO', oneRoundReturnHistory(100, FIN_SLOPE * surprise), { sector: 'FINANCIAL' }),
  ];
  assertEqual(
    await ask(round, 'WARMUP', calibrationEquities, portfolio({ nlv: 100_000 }), [policyRateEvent(round, reported)]),
    { orders: [] },
    `round ${String(round)} (warmup): still holds, but this round's surprise/return feeds the macro regression`,
  );
}

// Now, well past warmup, momentum is flat/tied for both names and the only live surprise is the
// round-13 print, decayed (age 7 of 15 rounds): -0.02 * (1 - 7/15) ≈ -0.010667. Multiplied by the
// slopes *this bot estimated for itself* from the 4 rounds above (-0.5 / +0.5, recovered exactly
// since that data was noiseless), TECH_CO tilts positive and FIN_CO negative -> TECH_CO
// outweights FIN_CO (268 vs. 81 shares), the mirror image of naively guessing the sign, which is
// exactly the point: this bot doesn't know the "real" sector sensitivities, only what it has
// itself observed.
const macroReadEquities = [
  security('TECH_CO', candlesFlat(100, 21), { sector: 'TECHNOLOGY' }),
  security('FIN_CO', candlesFlat(100, 21), { sector: 'FINANCIAL' }),
];

assertEqual(
  await ask(20, 'COMPETITION', macroReadEquities, portfolio({ nlv: 100_000 }), [policyRateEvent(13, 4.9)]),
  {
    orders: [
      { kind: 'LIMIT', symbol: 'TECH_CO', side: 'BUY', quantity: 268, limitPrice: 100 },
      { kind: 'LIMIT', symbol: 'FIN_CO', side: 'BUY', quantity: 81, limitPrice: 100 },
    ],
  },
  'round 20: a macro sector-tilt sized off this bot\'s own in-match regression, not a known table',
);

// A pending acquisition pays a FIXED $150/share 3 rounds out regardless of market price — the ask
// ($120) is well below that, so the arb overlay buys in up to its per-name cap: min(100,000*0.25,
// 100,000*0.5) / 120 = 25,000 / 120 = floor(208.33) = 208 shares.
const pendingAcquisition = [
  security('TARGET', candlesFlat(100, 21), {
    ask: 120,
    bid: 119.9,
    events: [{ type: 'ACQUISITION', observedAtRound: 37, symbol: 'TARGET', details: { type: 'ACQUISITION', effectiveRound: 40, cashPerShare: 150 } }],
  }),
];

assertEqual(
  await ask(37, 'COMPETITION', pendingAcquisition, portfolio({ nlv: 100_000 })),
  { orders: [{ kind: 'LIMIT', symbol: 'TARGET', side: 'BUY', quantity: 208, limitPrice: 120 }] },
  'round 37: buys into a pending acquisition trading below its disclosed cash payout',
);

// Now holding 100 shares and the market has bid the price ($160) above the guaranteed $150 payout
// -> take the better price now rather than waiting to be cashed out at $150.
const acquisitionAboveMarket = [
  security('TARGET', candlesFlat(100, 21), {
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

await lifecycle.finish({ result: { winnerId: 'tominator-t901-stock-market-3' }, reason: 'completed' });

console.log('\nAll checks passed.');
