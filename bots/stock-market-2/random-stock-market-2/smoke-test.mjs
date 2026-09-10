// Verifies random-stock-market-2 against the real Docker runtime: every action it produces is
// well-formed given whatever's affordable/held, and running the exact same rngSeed twice produces
// the exact same sequence of actions (this bot's own strategy randomness must be reproducible,
// same as bots/connect-four/random-connect-four — see docs/adr/0004-deterministic-randomness.md).
// Requires: docker build -t thunderdome-random-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-stock-market-2';

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

async function playMatch(matchId, rngSeed) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'random-stock-market-2',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  await lifecycle.initialize(
    {
      gameId: 'stock-market-2',
      gameVersion: '0.3.0',
      participantId: 'random-stock-market-2',
      roster: ['random-stock-market-2', 'opponent'],
      rngSeed,
      config: {},
    },
    { initTimeoutMs: 10_000 },
  );

  const actions = [];
  for (const round of [0, 1, 2, 3, 4]) {
    const price = 100 + round;
    const richPortfolio = {
      cash: 100_000,
      shares: 20,
      value: 100_000 + 20 * price,
      availableCash: 100_000,
      availableShares: 20,
      buyingPower: 0,
      marginUsed: 0,
      maintenanceRequirement: 0,
      realizedPnl: 0,
      bankrupt: false,
    };
    lifecycle.sendObservation(round, {
      state: observationFor(round, richPortfolio, {
        date: `synthetic-day-${round}`,
        lastClose: price,
        bid: price - 0.1,
        ask: price + 0.1,
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
    actions.push(result.action);
  }
  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
  return actions;
}

function assertWellFormed(action, round) {
  const label = `round ${String(round)}`;
  if (!Array.isArray(action.orders) || action.orders.length > 1) {
    throw new Error(`${label}: expected {orders: [...]} with at most one order, got ${JSON.stringify(action)}`);
  }
  for (const order of action.orders) {
    if (order.kind === 'MARKET') {
      if (!Number.isInteger(order.quantity) || order.quantity < 1) {
        throw new Error(`${label}: MARKET order has a bad quantity: ${JSON.stringify(order)}`);
      }
    } else if (order.kind === 'LIMIT') {
      if (!Number.isInteger(order.quantity) || order.quantity < 1 || !(order.limitPrice > 0)) {
        throw new Error(`${label}: LIMIT order is malformed: ${JSON.stringify(order)}`);
      }
    } else {
      throw new Error(`${label}: unrecognized order kind: ${JSON.stringify(order)}`);
    }
  }
  console.log(`ok - ${label}: ${JSON.stringify(action)}`);
}

const first = await playMatch('smoke-random-2-a', 'deadbeef');
first.forEach(assertWellFormed);

const second = await playMatch('smoke-random-2-b', 'deadbeef');
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error(`same rngSeed produced different actions:\n${JSON.stringify(first)}\nvs\n${JSON.stringify(second)}`);
}
console.log('ok - identical rngSeed reproduces the identical action sequence');

console.log('\nAll checks passed.');
