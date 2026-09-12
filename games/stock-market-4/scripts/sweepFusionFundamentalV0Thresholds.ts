/**
 * Grid-searches `fusion-fundamental-v0`'s `signal.hysteresisBand` / `portfolio.
 * rebalanceToleranceWeight` against the real July-August 2026 window (`runFusionFundamentalV0.ts`'s
 * own default), using the real engine end to end (real fees, real fills) for every combination —
 * looking for a combination that reduces overtrading/fee drag without dulling the strategy's
 * actual judgment (see `games/stock-market-4/README.md`'s Quickstart for what this bot's signal
 * pipeline does). Not a general-purpose optimizer: an 6x5 grid over two knobs, printed as one
 * table, picked by eye against BOTH total return and Sharpe (never by total return alone — a
 * higher-return, much-higher-drawdown combination is not automatically "better").
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/sweepFusionFundamentalV0Thresholds.ts
 */
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../../bots/stock-market-4/fusion-fundamental-v0/src/config.js';
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v0/src/index.js';
import { runFusionMatch } from './runFusionFundamentalV0.js';

const HYSTERESIS_BAND_CANDIDATES = [0, 0.01, 0.02, 0.03, 0.05, 0.08];
const REBALANCE_TOLERANCE_CANDIDATES = [0, 0.01, 0.02, 0.03, 0.05];

interface SweepRow {
  hysteresisBand: number;
  rebalanceToleranceWeight: number;
  tradeCount: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
}

let tradeCountForThisRun = 0;

function runOne(hysteresisBand: number, rebalanceToleranceWeight: number): SweepRow {
  const config = {
    ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
    signal: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal, hysteresisBand },
    portfolio: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio, rebalanceToleranceWeight },
  };
  tradeCountForThisRun = 0;
  const decideAction = createDecideAction(config, (decision) => {
    if (decision.action !== 'HOLD') tradeCountForThisRun += 1;
  });
  const summary = runFusionMatch({ decideAction });
  return {
    hysteresisBand,
    rebalanceToleranceWeight,
    tradeCount: tradeCountForThisRun,
    totalReturnPct: (summary.totalReturn ?? 0) * 100,
    maxDrawdownPct: (summary.maxDrawdown ?? 0) * 100,
    sharpeRatio: summary.sharpeRatio ?? null,
  };
}

function main(): void {
  const rows: SweepRow[] = [];
  for (const hysteresisBand of HYSTERESIS_BAND_CANDIDATES) {
    for (const rebalanceToleranceWeight of REBALANCE_TOLERANCE_CANDIDATES) {
      rows.push(runOne(hysteresisBand, rebalanceToleranceWeight));
    }
  }

  rows.sort((a, b) => (b.sharpeRatio ?? -Infinity) - (a.sharpeRatio ?? -Infinity));

  console.log(
    'hysteresisBand  rebalanceTolerance  trades  totalReturn  maxDrawdown  sharpe',
  );
  for (const row of rows) {
    console.log(
      `${row.hysteresisBand.toFixed(2).padStart(14)}  ` +
        `${row.rebalanceToleranceWeight.toFixed(2).padStart(18)}  ` +
        `${String(row.tradeCount).padStart(6)}  ` +
        `${row.totalReturnPct.toFixed(2).padStart(10)}%  ` +
        `${row.maxDrawdownPct.toFixed(2).padStart(10)}%  ` +
        `${row.sharpeRatio === null ? '  n/a ' : row.sharpeRatio.toFixed(2).padStart(6)}`,
    );
  }

  console.log(`\nCurrent default: hysteresisBand=${String(DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal.hysteresisBand)}, ` +
    `rebalanceToleranceWeight=${String(DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio.rebalanceToleranceWeight)}`);
}

main();
