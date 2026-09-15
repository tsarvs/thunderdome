/**
 * Runs a HEAD-TO-HEAD historical `stock-market-4` match between `fusion-fundamental-v0` and
 * `fusion-fundamental-v1`, in-process against the real engine (real fees/margin/fills), with
 * shorting enabled — the two-bot counterpart to `runFusionFundamentalV0.ts`'s solo run.
 *
 * This exists because `yarn thunderdome match run <v0> <v1> --config '{...}'` CANNOT express the
 * research payload these bots actually need: `--config` JSON that omits `researchTimeline` gets
 * the schema default (`[]`), which means `observation.research` is `undefined` every round — and
 * both bots' `createDecideAction` (see each bot's `src/index.ts`) explicitly returns
 * `{ orders: [] }` (a hard, permanent HOLD) whenever `currentResearchState` is `undefined`. The
 * real research fixture data (`createResearchSnapshot(dataset, timestamp)` from
 * `@thunderdome/research-fusion`/`@thunderdome/research-core`) is a generated object graph, not
 * something reasonable to hand-type as inline CLI JSON, and there's no `--config-file` flag — so
 * this in-process script (reusing `runFusionFundamentalV0.ts`'s own `buildResearchTimeline`) is
 * the correct way to run these two bots against each other with real trades actually happening.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/runFusionFundamentalMatchup.ts [startDate] [endDate]
 * Defaults to 2026-07-01 through 2026-08-31 (matching the other two runners' own default window).
 */
import { createRng } from '@thunderdome/rng';
import { game as stockMarket4 } from '../src/index.js';
import type { StockMarket4Action, StockMarket4Observation } from '../src/types.js';
import { createDecideAction as createDecideActionV0 } from '../../../bots/stock-market-4/fusion-fundamental-v0/src/index.js';
import { createDecideAction as createDecideActionV1 } from '../../../bots/stock-market-4/fusion-fundamental-v1/src/index.js';
import {
  DATASET_ID,
  DATASET_VERSION,
  DEFAULT_DB_PATH,
} from '../../../packages/stock-market-4/market-data/scripts/seedFusionFundamentalV0.js';
import { buildResearchTimeline, TICKERS } from './runFusionFundamentalV0.js';

const V0_ID = 'fusion-fundamental-v0';
const V1_ID = 'fusion-fundamental-v1';

const [, , startDateArg, endDateArg] = process.argv;
const startDate = startDateArg ?? '2026-07-01';
const endDate = endDateArg ?? '2026-08-31';

const configResult = stockMarket4.parseConfig({
  startDate,
  endDate,
  marketDataUniverse: TICKERS,
  marketDataset: {
    id: DATASET_ID,
    version: DATASET_VERSION,
    dbPath: DEFAULT_DB_PATH,
  },
  researchTimeline: buildResearchTimeline(startDate, endDate),
  benchmarkTicker: 'ELMT',
  risk: { allowShortSelling: true },
});
if (!configResult.ok) {
  throw new Error(configResult.reason);
}

function logDecision(
  botId: string,
  decision: {
    date: string | null;
    security: string;
    action: string;
    signalLevel: string;
    confidence: number;
    orders: { side: string; quantity: number }[];
  },
): void {
  if (decision.action === 'HOLD') return;
  // A decision's `action` collapses to its first order's side (see decision.ts) — quantity comes
  // straight from that same order, so this is never a second, independently-computed number.
  const quantity = decision.orders[0]?.quantity ?? 0;
  console.log(
    `  [${botId}] ${decision.date ?? '(no date)'} ${decision.security}: ${decision.action} ${String(quantity)} shares ` +
      `(signal=${decision.signalLevel}, confidence=${(decision.confidence * 100).toFixed(0)}%)`,
  );
}

const decideActionByParticipant: Record<
  string,
  (observation: StockMarket4Observation) => StockMarket4Action
> = {
  [V0_ID]: createDecideActionV0(undefined, (decision) => logDecision(V0_ID, decision)),
  [V1_ID]: createDecideActionV1(undefined, (decision) => logDecision(V1_ID, decision)),
};

const rng = createRng(Buffer.alloc(16)); // unused — stock-market-4 is fully deterministic
let state = stockMarket4.initialize({
  config: configResult.value,
  participantIds: [V0_ID, V1_ID],
  rng,
});

console.log(
  `Running ${V0_ID} vs ${V1_ID}, ${startDate} -> ${endDate}, real engine, shorting ENABLED.\n`,
);

// `getObservation` on the final, terminal state reports `date: null` — past the last trading day,
// with no mark price left to value positions at (`marketValueCents`/`unrealizedPnlCents` both go
// stale/zero there — see `PortfolioObservation`'s own doc comment). So the LAST REAL observation
// from inside the loop, not a post-terminal re-query, is what the final-portfolio summary needs.
const lastObservationByParticipant = new Map<string, StockMarket4Observation>();

while (!stockMarket4.isTerminal(state)) {
  const actions = new Map<string, StockMarket4Action>();
  for (const participantId of [V0_ID, V1_ID]) {
    const observation = stockMarket4.getObservation(state, participantId);
    actions.set(participantId, decideActionByParticipant[participantId]!(observation));
  }
  state = stockMarket4.resolve({ state, actions, rng }).nextState;
  // Captured AFTER resolving each round's own trades, so (unlike a pre-resolve capture) this
  // includes that round's fills too — overwritten every iteration, so the last successful write
  // is whichever round turns out to be the last one priced at a real trading day.
  for (const participantId of [V0_ID, V1_ID]) {
    const postTradeObservation = stockMarket4.getObservation(state, participantId);
    if (postTradeObservation.date !== null) {
      lastObservationByParticipant.set(participantId, postTradeObservation);
    }
  }
}

const result = stockMarket4.getResult(state);

console.log('\n--- Result ---');
console.log(`Rounds played: ${String(result.totalRounds)}`);

for (const participantId of [V0_ID, V1_ID]) {
  const metrics = result.performanceMetrics[participantId];
  console.log(`\n${participantId}:`);
  console.log(
    `  Final equity: $${((result.finalEquityCents[participantId] ?? 0) / 100).toFixed(2)}`,
  );
  if (metrics) {
    console.log(`  Total return: ${(metrics.totalReturn * 100).toFixed(2)}%`);
    console.log(`  Max drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`  Annualized volatility: ${(metrics.annualizedVolatility * 100).toFixed(2)}%`);
    console.log(
      `  Sharpe ratio: ${metrics.sharpeRatio === null ? 'n/a (no variance)' : metrics.sharpeRatio.toFixed(2)}`,
    );
  }
}

if (result.benchmarkReturn !== null) {
  console.log(
    `\nELMT buy-and-hold return over the same window: ${(result.benchmarkReturn * 100).toFixed(2)}%`,
  );
}

console.log('\n--- Final Portfolios ---');
for (const participantId of [V0_ID, V1_ID]) {
  const lastObservation = lastObservationByParticipant.get(participantId);
  if (lastObservation === undefined) continue; // no trading day was ever priced (shouldn't happen)
  const { portfolio } = lastObservation;
  console.log(`\n${participantId} (as of ${lastObservation.date ?? '(unknown)'}):`);
  console.log(`  Cash: $${(portfolio.cashCents / 100).toFixed(2)}`);
  if (portfolio.positions.length === 0) {
    console.log('  No open positions.');
    continue;
  }
  for (const position of portfolio.positions) {
    const side = position.shares < 0 ? 'SHORT' : 'LONG';
    console.log(
      `  ${position.ticker}: ${side} ${String(Math.abs(position.shares))} shares, ` +
        `market value $${(position.marketValueCents / 100).toFixed(2)}, ` +
        `unrealized P&L $${(position.unrealizedPnlCents / 100).toFixed(2)}`,
    );
  }
}
