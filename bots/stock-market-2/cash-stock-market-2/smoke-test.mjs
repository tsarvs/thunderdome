// Verifies cash-stock-market-2 against the real Docker runtime: it never submits an order, no
// matter what the observation looks like. Requires: docker build -t thunderdome-cash-stock-market-2 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-cash-stock-market-2';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
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
  matchId: 'smoke-cash-2',
  participantId: 'cash-stock-market-2',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-cash-2' });

await lifecycle.initialize(
  {
    gameId: 'stock-market-2',
    gameVersion: '0.3.0',
    participantId: 'cash-stock-market-2',
    roster: ['cash-stock-market-2', 'opponent'],
    rngSeed: 'deadbeef',
    config: {},
  },
  { initTimeoutMs: 10_000 },
);

const richPortfolio = {
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
};

for (const round of [0, 1, 2]) {
  lifecycle.sendObservation(round, {
    state: observationFor(round, richPortfolio, {
      date: `synthetic-day-${round}`,
      lastClose: 100 + round,
      bid: 99.9 + round,
      ask: 100.1 + round,
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
  assertEqual(result.action, { orders: [] }, `round ${String(round)}: holds`);
}

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
