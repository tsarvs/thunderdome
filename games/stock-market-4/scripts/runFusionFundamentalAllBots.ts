/**
 * Runs EVERY `fusion-fundamental-*` bot in the repo against each other in one historical
 * `stock-market-4` match, in-process against the real engine (real fees/margin/fills), with
 * shorting enabled. Generalizes `runFusionFundamentalMatchup.ts` (which only ever compared v0 vs
 * v1) to however many bots actually exist.
 *
 * Each bot's `createDecideAction` is constructed explicitly below (rather than through a generic
 * `{id, createDecideAction}[]` array) because each bot's `FusionFundamentalConfig` is its own
 * distinct nominal type (v1 added `strongSellThreshold`, v2 added `confidenceCalibration`, etc.)
 * — unifying them under one shared function-type array element doesn't type-check, even though at
 * runtime every call site only ever passes `undefined` for `config`. Adding a new bot means adding
 * one import, one id constant, one `decideActionByParticipant` entry, and one `participantIds`
 * entry — a few more lines than a single array push, but each one type-checks on its own terms.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/runFusionFundamentalAllBots.ts [startDate] [endDate]
 * Defaults to 2026-07-01 through 2026-08-31.
 */
import { createRng } from '@thunderdome/rng';
import { game as stockMarket4 } from '../src/index.js';
import type { StockMarket4Action, StockMarket4Observation } from '../src/types.js';
import { createDecideAction as createDecideActionV0 } from '../../../bots/stock-market-4/fusion-fundamental-v0/src/index.js';
import { createDecideAction as createDecideActionV1 } from '../../../bots/stock-market-4/fusion-fundamental-v1/src/index.js';
import { createDecideAction as createDecideActionV2 } from '../../../bots/stock-market-4/fusion-fundamental-v2/src/index.js';
import { createDecideAction as createDecideActionV3 } from '../../../bots/stock-market-4/fusion-fundamental-v3/src/index.js';
import { createDecideAction as createDecideActionV4 } from '../../../bots/stock-market-4/fusion-fundamental-v4/src/index.js';
import { createDecideAction as createDecideActionV5 } from '../../../bots/stock-market-4/fusion-fundamental-v5/src/index.js';
import { createDecideAction as createDecideActionV6 } from '../../../bots/stock-market-4/fusion-fundamental-v6/src/index.js';
import {
  DATASET_ID,
  DATASET_VERSION,
  DEFAULT_STORE_DIR,
} from '../../../packages/market-data/scripts/seedFusionFundamentalV0.js';
import { buildResearchTimeline, TICKERS } from './runFusionFundamentalV0.js';

const V0_ID = 'fusion-fundamental-v0';
const V1_ID = 'fusion-fundamental-v1';
const V2_ID = 'fusion-fundamental-v2';
const V3_ID = 'fusion-fundamental-v3';
const V4_ID = 'fusion-fundamental-v4';
const V5_ID = 'fusion-fundamental-v5';
const V6_ID = 'fusion-fundamental-v6';
const participantIds = [V0_ID, V1_ID, V2_ID, V3_ID, V4_ID, V5_ID, V6_ID];

const [, , startDateArg, endDateArg] = process.argv;
const startDate = startDateArg ?? '2026-07-01';
const endDate = endDateArg ?? '2026-08-31';

const configResult = stockMarket4.parseConfig({
  startDate,
  endDate,
  marketDataUniverse: TICKERS,
  marketDataset: { id: DATASET_ID, version: DATASET_VERSION, storeDir: DEFAULT_STORE_DIR },
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
  const quantity = decision.orders[0]?.quantity ?? 0;
  console.log(
    `  [${botId}] ${decision.date ?? '(no date)'} ${decision.security}: ${decision.action} ${String(quantity)} shares ` +
      `(signal=${decision.signalLevel}, confidence=${(decision.confidence * 100).toFixed(0)}%)`,
  );
}

const decideActionByParticipant: Record<string, (observation: StockMarket4Observation) => StockMarket4Action> = {
  [V0_ID]: createDecideActionV0(undefined, (decision) => { logDecision(V0_ID, decision); }),
  [V1_ID]: createDecideActionV1(undefined, (decision) => { logDecision(V1_ID, decision); }),
  [V2_ID]: createDecideActionV2(undefined, (decision) => { logDecision(V2_ID, decision); }),
  [V3_ID]: createDecideActionV3(undefined, (decision) => { logDecision(V3_ID, decision); }),
  [V4_ID]: createDecideActionV4(undefined, (decision) => { logDecision(V4_ID, decision); }),
  [V5_ID]: createDecideActionV5(undefined, (decision) => { logDecision(V5_ID, decision); }),
  [V6_ID]: createDecideActionV6(undefined, (decision) => { logDecision(V6_ID, decision); }),
};

const rng = createRng(Buffer.alloc(16)); // unused — stock-market-4 is fully deterministic
let state = stockMarket4.initialize({
  config: configResult.value,
  participantIds,
  rng,
});

console.log(`Running ${participantIds.join(' vs ')}, ${startDate} -> ${endDate}, real engine, shorting ENABLED.\n`);

// `getObservation` on the final, terminal state reports `date: null` — past the last trading day,
// with no mark price left to value positions at (`marketValueCents`/`unrealizedPnlCents` both go
// stale/zero there). So the last observation with a REAL date, captured from inside the loop, is
// what the final-portfolio summary needs — not a post-terminal re-query.
const lastObservationByParticipant = new Map<string, StockMarket4Observation>();

while (!stockMarket4.isTerminal(state)) {
  const actions = new Map<string, StockMarket4Action>();
  for (const participantId of participantIds) {
    const decideAction = decideActionByParticipant[participantId];
    if (decideAction === undefined) {
      throw new Error(`no decideAction registered for participant "${participantId}"`);
    }
    const observation = stockMarket4.getObservation(state, participantId);
    actions.set(participantId, decideAction(observation));
  }
  state = stockMarket4.resolve({ state, actions, rng }).nextState;
  for (const participantId of participantIds) {
    const postTradeObservation = stockMarket4.getObservation(state, participantId);
    if (postTradeObservation.date !== null) {
      lastObservationByParticipant.set(participantId, postTradeObservation);
    }
  }
}

const result = stockMarket4.getResult(state);

console.log('\n--- Result ---');
console.log(`Rounds played: ${String(result.totalRounds)}`);

for (const participantId of participantIds) {
  const metrics = result.performanceMetrics[participantId];
  console.log(`\n${participantId}:`);
  console.log(`  Final equity: $${((result.finalEquityCents[participantId] ?? 0) / 100).toFixed(2)}`);
  if (metrics) {
    console.log(`  Total return: ${(metrics.totalReturn * 100).toFixed(2)}%`);
    console.log(`  Max drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
    // console.log(`  Annualized volatility: ${(metrics.annualizedVolatility * 100).toFixed(2)}%`);
    console.log(`  Sharpe ratio: ${metrics.sharpeRatio === null ? 'n/a (no variance)' : metrics.sharpeRatio.toFixed(2)}`);
  }
}

if (result.benchmarkReturn !== null) {
  console.log(`\nELMT buy-and-hold return over the same window: ${(result.benchmarkReturn * 100).toFixed(2)}%`);
}

console.log('\n--- Final Portfolios ---');
for (const participantId of participantIds) {
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
