// Verifies tominator-t73-stock-market-2 against the real Docker runtime: same core signal
// behavior as tominator-t72-stock-market-2 (mean-reversion in SYNTHETIC only, real events in
// either mode, proactive de-risk), plus the one behavior that's actually different from T-72 -
// adding to an already-open, currently-underwater long on a *second* real event, which T-72's
// "never average down" guard blocks but T-73 deliberately allows for event-driven signals.
// Requires: docker build -t thunderdome-tominator-t73-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tominator-t73-stock-market-2';

function candle(date, close) {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

function eventOf(type) {
  const descriptions = {
    NO_NEWS: 'No news today.',
    EARNINGS_MISS: 'The company reported quarterly earnings below expectations today.',
    EARNINGS_BEAT: 'The company reported quarterly earnings above expectations today.',
  };
  return { type, description: descriptions[type] };
}

async function newMatch(matchId, config) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'tominator-t73-stock-market-2',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });
  await lifecycle.initialize(
    {
      gameId: 'stock-market-2',
      gameVersion: '0.3.0',
      participantId: 'tominator-t73-stock-market-2',
      roster: ['tominator-t73-stock-market-2', 'opponent'],
      rngSeed: 'deadbeef',
      config,
    },
    { initTimeoutMs: 10_000 },
  );
  return lifecycle;
}

function portfolio(overrides = {}) {
  return {
    cash: 100_000,
    shares: 0,
    value: 100_000,
    availableCash: 100_000,
    availableShares: 0,
    buyingPower: 0,
    marginUsed: 0,
    maintenanceRequirement: 0,
    realizedPnl: 0,
    bankrupt: false,
    ...overrides,
  };
}

function marketAt(round, lastClose, priceHistory) {
  return {
    date: `day-${round}`,
    lastClose,
    bid: Number((lastClose - 0.1).toFixed(2)),
    ask: Number((lastClose + 0.1).toFixed(2)),
    bidSize: 1000,
    askSize: 1000,
    orderBook: { bids: [], asks: [] },
    priceHistory,
    lastRoundVolume: null,
  };
}

async function ask(lifecycle, round, mode, port, market, event) {
  lifecycle.sendObservation(round, {
    state: { round, totalRounds: 50, symbol: 'SYNTH', mode, portfolio: port, openOrders: [], market, event },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(round, 10_000);
  if (!result.ok) {
    throw new Error(`round ${String(round)}: bot did not produce an action: ${JSON.stringify(result)}`);
  }
  return result.action;
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`failed: ${label}`);
  }
  console.log(`ok - ${label}`);
}

// A deviation clearly large enough to clear the cost gate in either mode.
const flatHighHistory = [candle('d0', 130), candle('d1', 130), candle('d2', 130), candle('d3', 130)];

// --- 1. SYNTHETIC mode: trades the mean-reversion deviation with no event. ---
{
  const lifecycle = await newMatch('smoke-t73-synthetic-mr', { transactionFee: 0.001, risk: { allowShortSelling: false, borrowFeeAnnualized: 0.03 } });
  await ask(lifecycle, 0, 'SYNTHETIC', portfolio(), marketAt(0, 130, []), eventOf('NO_NEWS'));
  const action = await ask(lifecycle, 1, 'SYNTHETIC', portfolio(), marketAt(1, 100, flatHighHistory), eventOf('NO_NEWS'));
  assert(action.orders.length === 1 && action.orders[0].side === 'BUY', 'SYNTHETIC mode fades a mean-reversion deviation');
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
}

// --- 2. HISTORICAL mode: holds through the identical deviation, since there's no event. ---
{
  const lifecycle = await newMatch('smoke-t73-historical-hold', { mode: 'HISTORICAL', transactionFee: 0.001, risk: { allowShortSelling: false, borrowFeeAnnualized: 0.03 } });
  await ask(lifecycle, 0, 'HISTORICAL', portfolio(), marketAt(0, 130, []), eventOf('NO_NEWS'));
  const action = await ask(lifecycle, 1, 'HISTORICAL', portfolio(), marketAt(1, 100, flatHighHistory), eventOf('NO_NEWS'));
  assert(action.orders.length === 0, 'HISTORICAL mode holds through the same deviation with no event');
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
}

// --- 3. HISTORICAL mode: still reacts to a genuine event, sized aggressively (T-73's whole point). ---
{
  const lifecycle = await newMatch('smoke-t73-historical-event', { mode: 'HISTORICAL', transactionFee: 0.001, risk: { allowShortSelling: true, borrowFeeAnnualized: 0.03, initialMarginRatio: 0.5, maintenanceMarginRatio: 0.3 } });
  const flatHistory = [candle('d0', 100), candle('d1', 100)];
  await ask(lifecycle, 0, 'HISTORICAL', portfolio({ buyingPower: 100_000 }), marketAt(0, 100, []), eventOf('NO_NEWS'));
  const action = await ask(
    lifecycle,
    1,
    'HISTORICAL',
    portfolio({ buyingPower: 100_000 }),
    marketAt(1, 100, flatHistory),
    eventOf('EARNINGS_MISS'),
  );
  assert(
    action.orders.length === 1 && action.orders[0].side === 'SELL' && action.orders[0].quantity > 0,
    'HISTORICAL mode opens a short on a real EARNINGS_MISS with margin enabled',
  );
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
}

// --- 4. Proactively de-risks a short too close to its maintenance requirement. ---
{
  const lifecycle = await newMatch('smoke-t73-derisk', {
    transactionFee: 0.001,
    risk: { allowShortSelling: true, borrowFeeAnnualized: 0.03, initialMarginRatio: 0.5, maintenanceMarginRatio: 0.3 },
  });
  const distressed = portfolio({
    shares: -500,
    value: 3_100,
    maintenanceRequirement: 3_000,
    buyingPower: 1_000,
  });
  const action = await ask(lifecycle, 0, 'SYNTHETIC', distressed, marketAt(0, 150, []), eventOf('NO_NEWS'));
  assert(
    action.orders.length === 1 && action.orders[0].kind === 'MARKET' && action.orders[0].side === 'BUY',
    'de-risks (covers part of the short at market) once equity is too close to the maintenance requirement',
  );
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
}

// --- 5. The T-73-specific behavior: adds to an already-open long on a *second* real event, even
// though it's currently underwater on paper - T-72's "never average down" guard would block this
// (it applies to every signal there), but T-73 only applies that guard to the mean-reversion
// signal, not to real events.
{
  const lifecycle = await newMatch('smoke-t73-add-to-underwater-event', {
    mode: 'HISTORICAL',
    transactionFee: 0.001,
    risk: { allowShortSelling: true, borrowFeeAnnualized: 0.03, initialMarginRatio: 0.5, maintenanceMarginRatio: 0.3 },
  });
  const history = [candle('d0', 100), candle('d1', 100), candle('d2', 95)];
  // Round 0: a real EARNINGS_BEAT opens a long.
  await ask(
    lifecycle,
    0,
    'HISTORICAL',
    portfolio({ buyingPower: 100_000 }),
    marketAt(0, 100, []),
    eventOf('EARNINGS_BEAT'),
  );
  // Round 1: the position is now underwater (equity fell) and a second EARNINGS_BEAT hits.
  const underwaterLong = portfolio({
    shares: 500,
    value: 94_000,
    availableShares: 500,
    buyingPower: 40_000,
  });
  const action = await ask(lifecycle, 1, 'HISTORICAL', underwaterLong, marketAt(1, 95, history), eventOf('EARNINGS_BEAT'));
  assert(
    action.orders.length === 1 && action.orders[0].side === 'BUY' && action.orders[0].quantity > 0,
    'adds to an underwater long on a second real event, unlike T-72\'s blanket averaging-down guard',
  );
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
}

console.log('\nAll checks passed.');
