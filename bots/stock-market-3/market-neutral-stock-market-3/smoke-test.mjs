// Verifies market-neutral-stock-market-3 against the real Docker runtime: holds during warmup,
// between rebalances, and before there's enough history to estimate beta; once there is, it buys
// the top-momentum picks and shorts the index to hedge their beta-weighted exposure.
// Requires: docker build -t thunderdome-market-neutral-stock-market-3 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-market-neutral-stock-market-3';

/** Builds a candle series from a per-round log-return generator, so an equity's returns can be
 * constructed as an EXACT multiple (`beta`) of the index's own returns — making the OLS beta this
 * bot estimates an exact, hand-checkable number rather than something only approximately right. */
function candlesFromReturns(startClose, returns) {
  const candles = [{ date: 'day-0', open: startClose, high: startClose, low: startClose, close: startClose, volume: 1000 }];
  let close = startClose;
  returns.forEach((r, i) => {
    close = close * Math.exp(r);
    candles.push({ date: `day-${String(i + 1)}`, open: close, high: close, low: close, close, volume: 1000 });
  });
  return candles;
}

// 64 rounds, alternating +1%/-0.6% so the index has genuine variance (a constant return every
// round would make beta mathematically undefined) and a net-positive trend over any 20-round
// window (10 up legs bigger than 10 down legs) — every downstream equity return below is an exact
// multiple of this same series, so momentum ranking and beta both come out exactly as designed.
const INDEX_RETURNS = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.006));
function scaledReturns(beta) {
  return INDEX_RETURNS.map((r) => r * beta);
}

function security(symbol, priceHistory, beta = null) {
  return {
    symbol,
    kind: 'EQUITY',
    sector: 'TECHNOLOGY',
    active: true,
    sharesOutstanding: 100_000_000,
    quote: { lastClose: priceHistory.at(-1)?.close ?? 100, bid: 99.9, ask: 100, bidSize: 100, askSize: 100, orderBook: { bids: [], asks: [] } },
    priceHistory,
    lastRoundVolume: null,
    borrow: { availableShares: 1000, feeAnnualized: 0.03 },
    latestFundamentals: null,
    analystConsensus: null,
    analystRevisionHistory: [],
    events: [],
    _beta: beta, // test-only annotation, not part of the real observation shape
  };
}

function indexSecurity(priceHistory) {
  return {
    symbol: 'SYNTH_INDEX',
    kind: 'INDEX',
    sector: null,
    active: true,
    sharesOutstanding: 1_000_000,
    quote: { lastClose: priceHistory.at(-1)?.close ?? 100, bid: 100, ask: 100, bidSize: 100, askSize: 100, orderBook: { bids: [], asks: [] } },
    priceHistory,
    lastRoundVolume: null,
    borrow: { availableShares: 0, feeAnnualized: 0 },
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
  matchId: 'smoke-market-neutral-3',
  participantId: 'market-neutral-stock-market-3',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-market-neutral-3' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-3',
    gameVersion: '0.1.0',
    participantId: 'market-neutral-stock-market-3',
    roster: ['market-neutral-stock-market-3', 'opponent'],
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

// Betas: TECH_A=2 (highest momentum, since its returns are the biggest exact multiple of the
// index's own trend), CONSUMER_A=1, TECH_B=0.5, CONSUMER_B=-1 (moves opposite the index, so it
// has the WORST trailing momentum and should never be picked at all).
const fullHistorySecurities = [
  security('TECH_A', candlesFromReturns(80, scaledReturns(2)), 2),
  security('CONSUMER_A', candlesFromReturns(100, scaledReturns(1)), 1),
  security('TECH_B', candlesFromReturns(90, scaledReturns(0.5)), 0.5),
  security('CONSUMER_B', candlesFromReturns(120, scaledReturns(-1)), -1),
  indexSecurity(candlesFromReturns(100, INDEX_RETURNS)),
];

assertEqual(
  await ask(5, 'WARMUP', fullHistorySecurities, portfolio({ nlv: 90_000 })),
  { orders: [] },
  'round 5 (warmup): holds regardless of history',
);

assertEqual(
  await ask(21, 'COMPETITION', fullHistorySecurities, portfolio({ nlv: 90_000 })),
  { orders: [] },
  'round 21: holds between rebalances (21 is not a multiple of 10)',
);

// Only 25 rounds of history — enough for the 20-round momentum lookback, but not the 60-round
// beta lookback, so every candidate is filtered out and the bot should trade nothing at all.
const shortHistorySecurities = [
  security('TECH_A', candlesFromReturns(80, scaledReturns(2).slice(0, 25))),
  security('CONSUMER_A', candlesFromReturns(100, scaledReturns(1).slice(0, 25))),
  security('TECH_B', candlesFromReturns(90, scaledReturns(0.5).slice(0, 25))),
  security('CONSUMER_B', candlesFromReturns(120, scaledReturns(-1).slice(0, 25))),
  indexSecurity(candlesFromReturns(100, INDEX_RETURNS.slice(0, 25))),
];
assertEqual(
  await ask(20, 'COMPETITION', shortHistorySecurities, portfolio({ nlv: 90_000, buyingPower: 200_000 })),
  { orders: [] },
  'round 20: not enough history yet to estimate beta -> no picks, no trades',
);

// Full history, margin available, rebalance round: picks TECH_A/CONSUMER_A/TECH_B (top-3
// momentum; CONSUMER_B is excluded), sized to $7,500 each (90,000 * 0.25 / 3) at $100/share = 75
// shares, then hedges the beta-weighted book (75 * 100 * (2 + 1 + 0.5) = $26,250) by shorting
// the index at $100/share -> 262 shares.
assertEqual(
  await ask(60, 'COMPETITION', fullHistorySecurities, portfolio({ nlv: 90_000, buyingPower: 300_000 })),
  {
    orders: [
      { kind: 'MARKET', symbol: 'TECH_A', side: 'BUY', quantity: 75 },
      { kind: 'MARKET', symbol: 'CONSUMER_A', side: 'BUY', quantity: 75 },
      { kind: 'MARKET', symbol: 'TECH_B', side: 'BUY', quantity: 75 },
      { kind: 'MARKET', symbol: 'SYNTH_INDEX', side: 'SELL', quantity: 262 },
    ],
  },
  'round 60 (rebalance, margin available): buys top-3-momentum picks and hedges via an index short',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
