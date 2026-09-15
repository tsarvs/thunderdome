/**
 * Small, cheap grid-search of `fusion-fundamental-v3`'s `trendFilter.vetoThreshold` against the
 * real July-August 2026 window. Deliberately narrow (4 runs, one fixed windowDays) — v3's first
 * cut (windowDays=10, vetoThreshold=0.08) underperformed v2 slightly (Sharpe 1.56 vs 1.61), and
 * the working theory is that 8% over 10 days is closer to ordinary noise than a genuine "steep
 * decline" for this dataset's volatile small-caps (several have >5% daily vol), so the filter is
 * likely vetoing legitimate entries, not just falling knives.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/sweepFusionFundamentalV3TrendFilter.ts
 */
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../../bots/stock-market-4/fusion-fundamental-v3/src/config.js';
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v3/src/index.js';
import { runFusionMatch } from './runFusionFundamentalV0.js';

const VETO_THRESHOLD_CANDIDATES = [0.08, 0.12, 0.15, 0.2];

// v2's real result over the same window/config, for comparison.
const V2_BENCHMARK = { totalReturnPct: 24.63, maxDrawdownPct: 25.39, sharpeRatio: 1.61 };

function runOne(vetoThreshold: number) {
  const config = {
    ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
    trendFilter: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.trendFilter, vetoThreshold },
  };
  const decideAction = createDecideAction(config);
  const summary = runFusionMatch({ decideAction });
  return {
    vetoThreshold,
    totalReturnPct: (summary.totalReturn ?? 0) * 100,
    maxDrawdownPct: (summary.maxDrawdown ?? 0) * 100,
    sharpeRatio: summary.sharpeRatio ?? null,
  };
}

console.log(
  `v2 benchmark (same window): return ${V2_BENCHMARK.totalReturnPct.toFixed(2)}%, ` +
    `drawdown ${V2_BENCHMARK.maxDrawdownPct.toFixed(2)}%, Sharpe ${V2_BENCHMARK.sharpeRatio.toFixed(2)}\n`,
);

console.log('vetoThreshold  totalReturn  maxDrawdown  sharpe  beatsV2');
for (const vetoThreshold of VETO_THRESHOLD_CANDIDATES) {
  const row = runOne(vetoThreshold);
  const beatsV2 =
    row.sharpeRatio !== null && row.sharpeRatio > V2_BENCHMARK.sharpeRatio ? 'YES' : '';
  console.log(
    `${row.vetoThreshold.toFixed(2).padStart(13)}  ` +
      `${row.totalReturnPct.toFixed(2).padStart(10)}%  ` +
      `${row.maxDrawdownPct.toFixed(2).padStart(10)}%  ` +
      `${row.sharpeRatio === null ? '  n/a ' : row.sharpeRatio.toFixed(2).padStart(6)}  ` +
      beatsV2,
  );
}
