// Verifies buy-and-hold-stock-market against the real Docker runtime: it spends 90% of its
// starting cash on shares in round 0, then holds no matter what happens afterward. Requires:
// docker build -t thunderdome-buy-and-hold-stock-market .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-buy-and-hold-stock-market';

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
    totalRounds: 100,
    portfolio,
    market,
    event: { type: 'NO_NEWS', description: 'No significant news today.' },
  };
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: 'smoke-buy-and-hold',
  participantId: 'buy-and-hold-stock-market',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: 'smoke-buy-and-hold' });

await lifecycle.initialize(
  {
    gameId: 'stock-market',
    gameVersion: '0.1.0',
    participantId: 'buy-and-hold-stock-market',
    roster: ['buy-and-hold-stock-market', 'opponent'],
    rngSeed: 'deadbeef',
    config: { rounds: 100 },
  },
  { initTimeoutMs: 10_000 },
);

// Round 0: $10,000 cash, $100/share — 90% of cash is $9,000, so 90 shares.
lifecycle.sendObservation(0, {
  state: observationFor(
    0,
    { cash: 10000, shares: 0, value: 10000 },
    { price: 100, priceHistory: [100], lastRoundVolume: null },
  ),
  awaitingAction: true,
});
const roundZero = await lifecycle.awaitAction(0, 10_000);
if (!roundZero.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(roundZero)}`);
}
assertEqual(roundZero.action, { action: 'BUY', quantity: 90 }, 'buys 90 shares in round 0 (90% of $10,000 at $100/share)');

// Round 1: whatever the portfolio/price looks like now, it must hold.
lifecycle.sendObservation(1, {
  state: observationFor(
    1,
    { cash: 991, shares: 90, value: 9991 },
    { price: 99.99, priceHistory: [100, 99.99], lastRoundVolume: { sharesBought: 90, sharesSold: 0, netDemand: 90 } },
  ),
  awaitingAction: true,
});
const roundOne = await lifecycle.awaitAction(1, 10_000);
if (!roundOne.ok) {
  throw new Error(`bot did not produce an action: ${JSON.stringify(roundOne)}`);
}
assertEqual(roundOne.action, { action: 'HOLD' }, 'holds in every round after round 0');

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });

console.log('\nAll checks passed.');
