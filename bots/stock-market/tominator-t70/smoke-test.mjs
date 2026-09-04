// Verifies tominator-t70 against the real Docker runtime, across a multi-round session (this
// bot's inference accumulates state — a Map per event type — across many decideAction calls
// within one process).
//
// This bot never reads `config.startingStockPrice` at all — its magnitude inference is driven
// purely by observed `market.price` and `event.type` — so its behavior must be identical whether
// or not `startingStockPrice` was given, as long as the observed prices are the same either way.
// This test runs the exact same multi-round price/event script through two bot processes, one
// with `startingStockPrice` omitted and one with it explicitly set to the first observed price,
// and asserts they produce byte-identical action sequences.
//
// It also exercises every event type at least once (including repeats of a couple of types, to
// drive the confidence-gated magnitude-estimate path this bot's inference depends on) and asserts
// every resulting action is well-formed — never NaN/undefined/fractional — which is what an
// accidentally-reintroduced NaN would otherwise silently degrade into "always HOLD" rather than a
// visible crash.
// Requires: docker build -t thunderdome-tominator-t70 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tominator-t70';

// `meanReversionFactor`/`transactionFee`/`marketImpactFactor` and each event type's `weight`
// (real inputs to this bot's magnitude-prior and market-impact-cap logic — see
// `redactConfigForBots` in games/stock-market/src/game.ts for why only `weight` survives per
// type) all need realistic values here for the bot to be exercised the way a real match would.
const EVENTS_CONFIG = {
  NO_NEWS: { weight: 60 },
  POSITIVE_NEWS: { weight: 8 },
  NEGATIVE_NEWS: { weight: 8 },
  ANALYST_UPGRADE: { weight: 6 },
  ANALYST_DOWNGRADE: { weight: 6 },
  PRODUCT_SUCCESS: { weight: 5 },
  PRODUCT_FAILURE: { weight: 5 },
  EARNINGS_BEAT: { weight: 1 },
  EARNINGS_MISS: { weight: 1 },
};

const EVENT_DESCRIPTIONS = {
  NO_NEWS: 'No significant news today.',
  POSITIVE_NEWS: 'General positive news about the company circulated today.',
  NEGATIVE_NEWS: 'General negative news about the company circulated today.',
  ANALYST_UPGRADE: 'An analyst upgraded their rating on the company.',
  ANALYST_DOWNGRADE: 'An analyst downgraded their rating on the company.',
  PRODUCT_SUCCESS: 'The company announced a successful new product.',
  PRODUCT_FAILURE: 'The company announced a failed product launch.',
  EARNINGS_BEAT: 'The company reported earnings significantly above expectations.',
  EARNINGS_MISS: 'The company reported earnings significantly below expectations.',
};

function eventOf(type) {
  return { type, description: EVENT_DESCRIPTIONS[type] };
}

// A varied multi-round script: repeats NO_NEWS and POSITIVE_NEWS (so the confidence-gated EMA
// path actually engages) alongside a one-off pass through every other event type, with prices
// that move enough to cross this bot's worthwhile-deviation threshold (fee 0.001 /
// meanReversionFactor 0.05 = 2%) at least a few times.
const PRICE_EVENT_SCRIPT = [
  { price: 100, event: 'NO_NEWS' },
  { price: 100, event: 'NO_NEWS' },
  { price: 100, event: 'POSITIVE_NEWS' },
  { price: 105, event: 'POSITIVE_NEWS' },
  { price: 110.25, event: 'NO_NEWS' },
  { price: 110.25, event: 'NEGATIVE_NEWS' },
  { price: 104, event: 'ANALYST_UPGRADE' },
  { price: 108, event: 'ANALYST_DOWNGRADE' },
  { price: 101, event: 'PRODUCT_SUCCESS' },
  { price: 106, event: 'PRODUCT_FAILURE' },
  { price: 98, event: 'EARNINGS_BEAT' },
  { price: 94, event: 'EARNINGS_MISS' },
];

const richPortfolio = { cash: 100_000, shares: 100, value: 110_000 };

async function playScript(matchId, gameConfig, script) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'tominator-t70',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market',
      gameVersion: '0.1.0',
      participantId: 'tominator-t70',
      roster: ['tominator-t70', 'opponent'],
      rngSeed: 'deadbeef',
      config: gameConfig,
    },
    { initTimeoutMs: 10_000 },
  );

  const actions = [];
  for (const [round, { price, event }] of script.entries()) {
    lifecycle.sendObservation(round, {
      state: {
        round,
        totalRounds: script.length,
        portfolio: richPortfolio,
        market: { price, priceHistory: [price], lastRoundVolume: null },
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
  return actions;
}

function assertWellFormed(action, round) {
  const label = `round ${String(round)}`;
  if (action.action === 'HOLD') {
    console.log(`ok - ${label}: HOLD`);
    return;
  }
  if (action.action !== 'BUY' && action.action !== 'SELL') {
    throw new Error(`${label}: unrecognized action ${JSON.stringify(action)}`);
  }
  if (!Number.isInteger(action.quantity) || action.quantity < 1) {
    throw new Error(`${label}: ${action.action} has a non-positive-integer quantity: ${JSON.stringify(action)}`);
  }
  console.log(`ok - ${label}: ${action.action} ${String(action.quantity)}`);
}

const baseConfig = {
  meanReversionFactor: 0.05,
  transactionFee: 0.001,
  marketImpactFactor: 0.0001,
  events: EVENTS_CONFIG,
};

const actionsWithoutStartingPrice = await playScript(
  'smoke-no-starting-price',
  baseConfig,
  PRICE_EVENT_SCRIPT,
);
actionsWithoutStartingPrice.forEach(assertWellFormed);
if (actionsWithoutStartingPrice[0].action !== 'HOLD') {
  throw new Error(
    `round 0 must always HOLD (no observed price history yet to infer anything from), got ${JSON.stringify(actionsWithoutStartingPrice[0])}`,
  );
}
console.log('ok - round 0 always HOLDs (nothing to infer yet), config.startingStockPrice omitted');

const actionsWithStartingPrice = await playScript('smoke-with-starting-price', {
  ...baseConfig,
  startingStockPrice: PRICE_EVENT_SCRIPT[0].price,
}, PRICE_EVENT_SCRIPT);

const withoutJson = JSON.stringify(actionsWithoutStartingPrice);
const withJson = JSON.stringify(actionsWithStartingPrice);
if (withoutJson !== withJson) {
  throw new Error(
    `expected identical action sequences whether startingStockPrice is given or omitted (same observed prices either way):\nomitted: ${withoutJson}\ngiven:   ${withJson}`,
  );
}
console.log('ok - identical action sequence whether startingStockPrice is given or omitted');

console.log('\nAll checks passed.');
