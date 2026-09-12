/**
 * Runs a `stock-market-4` bot's REAL `decideAction` against the REAL game engine (real fees, real
 * margin/portfolio accounting, real fills — via `stockMarket4.initialize`/`getObservation`/
 * `resolve`, not a simplified ledger) over a fixed, bounded historical window, reading real prices
 * from the dataset `packages/market-data/scripts/seedFusionFundamentalV0.ts` seeds. In-process (no
 * Docker, no CLI) — this is what `apps/cli`'s `match run` does under the hood, minus its own
 * two-participant minimum, which doesn't apply to a single bot evaluating its own strategy solo
 * (`stock-market-4` itself allows this; see that game's own README).
 *
 * `runFusionMatch` is the reusable half — shared by this file's own CLI entry point and
 * `sweepFusionFundamentalV0Thresholds.ts`'s parameter sweep, and reusable by any future bot
 * version's own runner (e.g. `fusion-fundamental-v1`) — it only needs a `decideAction` function,
 * not any particular bot's config shape.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/runFusionFundamentalV0.ts [startDate] [endDate]
 * Defaults to 2026-07-01 through 2026-08-31.
 */
import { createResearchSnapshot } from '@thunderdome/research-core';
import { createFusionFixtureDataset } from '@thunderdome/research-fusion';
import { createRng } from '@thunderdome/rng';
import { game as stockMarket4 } from '../src/index.js';
import type { StockMarket4Action, StockMarket4Observation } from '../src/types.js';
// Deep relative import into the bot's own source — the same cross-boundary pattern its own
// backtest/runBacktest.ts already uses (`import { createDecideAction } from '../src/index.js'`);
// see this script's own module doc comment for why running solo, in-process, needs this rather
// than going through the CLI/Docker.
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v0/src/index.js';
import {
  DATASET_ID,
  DATASET_VERSION,
  DEFAULT_STORE_DIR,
} from '../../../packages/market-data/scripts/seedFusionFundamentalV0.js';

export const PARTICIPANT_ID = 'fusion-fundamental-v0';
export const TICKERS = [
  'ELMT',
  'FURUKAWA',
  'VITZRONEXTECH',
  'ALM',
  'FREEM',
  'OPTX',
  'GFUZ',
  'FUJIKURA',
  'SUMITOMO',
  'KMT',
  'AMSC',
];

/** One research snapshot per calendar day in the window — matches `backtest/runBacktest.ts`'s own
 * "reconstructed fresh for each date, so no day ever sees research that wasn't yet knowable"
 * discipline, just driven by calendar dates here instead of by the price series' own dates. */
export function buildResearchTimeline(fromDate: string, toDate: string): { date: string; payload: unknown }[] {
  const dataset = createFusionFixtureDataset();
  const timeline: { date: string; payload: unknown }[] = [];
  let cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    timeline.push({ date, payload: createResearchSnapshot(dataset, `${date}T00:00:00Z`) });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return timeline;
}

export interface RunMatchSummary {
  totalRounds: number;
  finalEquityCents: number;
  totalReturn: number | undefined;
  maxDrawdown: number | undefined;
  annualizedVolatility: number | undefined;
  sharpeRatio: number | null | undefined;
  benchmarkReturn: number | null;
}

/**
 * Plays `decideAction` against the real engine for `[startDate, endDate]`, marketDataUniverse
 * `TICKERS`, reading the real seeded dataset. Deliberately game-/decideAction-agnostic beyond
 * that: doesn't know or care whether `decideAction` came from `fusion-fundamental-v0`, a v1 with
 * shorting logic, or a config override — a caller builds whatever `decideAction` it wants (see
 * `sweepFusionFundamentalV0Thresholds.ts` for a config-sweep example) and this just runs it.
 */
export function runFusionMatch(params: {
  decideAction: (observation: StockMarket4Observation) => StockMarket4Action;
  startDate?: string;
  endDate?: string;
  benchmarkTicker?: string;
  /** Passed straight through to `parseConfig`'s `risk` field (default: cash-only, no shorting —
   * `RiskConfigSchema`'s own default). A caller demonstrating a shorting-capable bot (e.g.
   * `fusion-fundamental-v1`) needs `{ allowShortSelling: true }` here — without it, the engine
   * itself caps every SELL at shares actually held, same as a v0 bot, regardless of what the
   * bot's own orders ask for. */
  risk?: { allowShortSelling?: boolean };
}): RunMatchSummary {
  const startDate = params.startDate ?? '2026-07-01';
  const endDate = params.endDate ?? '2026-08-31';

  const configResult = stockMarket4.parseConfig({
    startDate,
    endDate,
    marketDataUniverse: TICKERS,
    marketDataset: { id: DATASET_ID, version: DATASET_VERSION, storeDir: DEFAULT_STORE_DIR },
    researchTimeline: buildResearchTimeline(startDate, endDate),
    benchmarkTicker: params.benchmarkTicker ?? 'ELMT',
    ...(params.risk ? { risk: params.risk } : {}),
  });
  if (!configResult.ok) {
    throw new Error(configResult.reason);
  }

  const rng = createRng(Buffer.alloc(16)); // unused — stock-market-4 is fully deterministic
  let state = stockMarket4.initialize({
    config: configResult.value,
    participantIds: [PARTICIPANT_ID],
    rng,
  });

  while (!stockMarket4.isTerminal(state)) {
    const observation = stockMarket4.getObservation(state, PARTICIPANT_ID);
    const action = params.decideAction(observation);
    state = stockMarket4.resolve({
      state,
      actions: new Map([[PARTICIPANT_ID, action]]),
      rng,
    }).nextState;
  }

  const result = stockMarket4.getResult(state);
  const metrics = result.performanceMetrics[PARTICIPANT_ID];
  return {
    totalRounds: result.totalRounds,
    finalEquityCents: result.finalEquityCents[PARTICIPANT_ID] ?? 0,
    totalReturn: metrics?.totalReturn,
    maxDrawdown: metrics?.maxDrawdown,
    annualizedVolatility: metrics?.annualizedVolatility,
    sharpeRatio: metrics?.sharpeRatio,
    benchmarkReturn: result.benchmarkReturn,
  };
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const [, , startDateArg, endDateArg] = process.argv;
  const startDate = startDateArg ?? '2026-07-01';
  const endDate = endDateArg ?? '2026-08-31';

  const decideAction = createDecideAction(undefined, (decision) => {
    if (decision.action !== 'HOLD') {
      console.log(
        `  ${decision.date ?? '(no date)'} ${decision.security}: ${decision.action} ` +
          `(signal=${decision.signalLevel}, fairValue=$${decision.valuationAfter.toFixed(2)})`,
      );
    }
  });

  console.log(`Running fusion-fundamental-v0 solo, ${startDate} -> ${endDate}, real engine, real fees/margin.\n`);
  const summary = runFusionMatch({ decideAction, startDate, endDate });

  console.log('\n--- Result ---');
  console.log(`Rounds played: ${String(summary.totalRounds)}`);
  console.log(`Final equity: $${(summary.finalEquityCents / 100).toFixed(2)}`);
  if (summary.totalReturn !== undefined) {
    console.log(`Total return: ${(summary.totalReturn * 100).toFixed(2)}%`);
    console.log(`Max drawdown: ${((summary.maxDrawdown ?? 0) * 100).toFixed(2)}%`);
    console.log(`Annualized volatility: ${((summary.annualizedVolatility ?? 0) * 100).toFixed(2)}%`);
    console.log(
      `Sharpe ratio: ${summary.sharpeRatio === null || summary.sharpeRatio === undefined ? 'n/a (no variance)' : summary.sharpeRatio.toFixed(2)}`,
    );
  }
  if (summary.benchmarkReturn !== null) {
    console.log(`ELMT buy-and-hold return over the same window: ${(summary.benchmarkReturn * 100).toFixed(2)}%`);
  }
}
