// Verifies tominator-t70 (stock-market-2) against the real Docker runtime, across a multi-round
// session (this bot's inference accumulates state — a Map per event type — across many
// decideAction calls within one process).
//
// Unlike bots/stock-market/tominator-t70's smoke test, there's no config.events weight table or
// config.marketImpactFactor for this bot to read at all — its magnitude prior is a fixed
// earnings-vs-news split, and its self-impact cap now comes from the observed top-of-book depth
// (market.bidSize/askSize) rather than a config formula — see src/index.ts. This test only needs
// to exercise every real event type (including repeats, to drive the confidence-gated
// magnitude-estimate path) with prices that move enough to cross this bot's worthwhile-deviation
// threshold at least a few times.
// Requires: docker build -t thunderdome-tominator-t70-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tominator-t70-2';

const EVENT_DESCRIPTIONS = {
  NO_NEWS: 'No regulatory disclosures today.',
  POSITIVE_NEWS: 'The company filed a material-event disclosure with regulators today.',
  NEGATIVE_NEWS: 'The company filed a material-event disclosure with regulators today.',
  EARNINGS_BEAT: 'The company filed a quarterly results disclosure with regulators today.',
  EARNINGS_MISS: 'The company filed a quarterly results disclosure with regulators today.',
};

function eventOf(type) {
  return { type, description: EVENT_DESCRIPTIONS[type] };
}

const PRICE_EVENT_SCRIPT = [
  { date: '2016-01-19', price: 9.11, event: 'NO_NEWS' },
  { date: '2016-01-20', price: 9.11, event: 'NO_NEWS' },
  { date: '2016-01-21', price: 9.11, event: 'POSITIVE_NEWS' },
  { date: '2016-01-22', price: 9.55, event: 'POSITIVE_NEWS' },
  { date: '2016-01-25', price: 9.95, event: 'NO_NEWS' },
  { date: '2016-01-26', price: 9.95, event: 'NEGATIVE_NEWS' },
  { date: '2016-01-27', price: 9.4, event: 'EARNINGS_BEAT' },
  { date: '2016-01-28', price: 9.75, event: 'EARNINGS_MISS' },
  { date: '2016-01-29', price: 9.3, event: 'POSITIVE_NEWS' },
];

const richPortfolio = { cash: 100_000, shares: 100, value: 101_000, availableCash: 100_000, availableShares: 100 };

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-tominator-t70-2',
  participantId: 'tominator-t70-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-tominator-t70-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.2.0',
    participantId: 'tominator-t70-2',
    roster: ['tominator-t70-2', 'opponent'],
    rngSeed: 'deadbeef',
    config: { transactionFee: 0.001 },
  },
  { initTimeoutMs: 10_000 },
);

const actions = [];
for (const [round, { date, price, event }] of PRICE_EVENT_SCRIPT.entries()) {
  const spread = price * 0.002;
  lifecycle.sendObservation(round, {
    state: {
      round,
      totalRounds: PRICE_EVENT_SCRIPT.length,
      symbol: 'DENN',
      mode: 'HISTORICAL',
      portfolio: richPortfolio,
      openOrders: [],
      market: {
        date,
        lastClose: price,
        bid: Number((price - spread).toFixed(4)),
        ask: Number((price + spread).toFixed(4)),
        bidSize: 400,
        askSize: 400,
        priceHistory: [],
        lastRoundVolume: null,
      },
      event: eventOf(event),
    },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(round, 10_000);
  if (!result.ok) {
    throw new Error(`round ${String(round)}: bot did not produce an action: ${JSON.stringify(result)}`);
  }
  actions.push(result.action);
}
await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

function assertWellFormed(action, round) {
  const label = `round ${String(round)}`;
  if (!Array.isArray(action.orders)) {
    throw new Error(`${label}: expected {orders: [...]}, got ${JSON.stringify(action)}`);
  }
  if (action.orders.length === 0) {
    console.log(`ok - ${label}: HOLD (no orders)`);
    return;
  }
  if (action.orders.length !== 1) {
    throw new Error(`${label}: expected at most one order, got ${JSON.stringify(action)}`);
  }
  const order = action.orders[0];
  if (order.kind !== 'MARKET' || (order.side !== 'BUY' && order.side !== 'SELL')) {
    throw new Error(`${label}: unrecognized order ${JSON.stringify(order)}`);
  }
  if (!Number.isInteger(order.quantity) || order.quantity < 1) {
    throw new Error(`${label}: ${order.side} has a non-positive-integer quantity: ${JSON.stringify(order)}`);
  }
  console.log(`ok - ${label}: ${order.side} ${String(order.quantity)}`);
}

actions.forEach(assertWellFormed);
if (actions[0].orders.length !== 0) {
  throw new Error(
    `round 0 must always HOLD (no observed price history yet to infer anything from), got ${JSON.stringify(actions[0])}`,
  );
}
console.log('ok - round 0 always HOLDs (nothing to infer yet)');

console.log('\nAll checks passed.');
