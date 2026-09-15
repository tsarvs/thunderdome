/**
 * Grid-searches `fusion-fundamental-v2`'s `confidenceCalibration.rollingBlendWeight` (how much of
 * `baseBusinessValuePerShare` comes from the rolling trailing-window calculation vs. the static
 * config anchor — see `valuation/rollingBaseValue.ts`'s `computeBlendedBaseValuePerShare`) and
 * `signal.hysteresisBand`, against the real July-August 2026 window, using the real engine end to
 * end — same methodology as `sweepFusionFundamentalV0Thresholds.ts`.
 *
 * Narrower than the first confidence-calibration sweep on purpose: that 108-combination sweep
 * already showed `rollingWindowDays`/`calmDailyVolatility`/`chaoticDailyVolatility`/
 * `minShortConfidence` barely move the result (all combinations landed within a few points of
 * each other, all badly behind v1) — the ROOT CAUSE was v2's original full replacement of the
 * static anchor with a rolling one (a mean-reversion strategy in disguise), not those knobs. This
 * sweep tests the actual fix (blending, not replacing) and keeps everything else fixed at v2's
 * defaults to stay cheap: 7 blend weights x 3 hysteresis bands = 21 real-engine runs.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/sweepFusionFundamentalV2Confidence.ts
 */
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../../bots/stock-market-4/fusion-fundamental-v2/src/config.js';
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v2/src/index.js';
import { runFusionMatch } from './runFusionFundamentalV0.js';

// Narrowed to the neighborhood the first pass found best (blendWeight 0-0.1, hysteresis 0.03) —
// see the first pass's results in session notes before broadening this again.
const BLEND_WEIGHT_CANDIDATES = [0, 0.02, 0.05, 0.08, 0.1, 0.15];
const HYSTERESIS_BAND_CANDIDATES = [0.02, 0.03, 0.04];

// v1's real result over the same window/config, for comparison.
const V1_BENCHMARK = { totalReturnPct: 25.29, maxDrawdownPct: 23.97, sharpeRatio: 1.64 };

interface SweepRow {
  rollingBlendWeight: number;
  hysteresisBand: number;
  tradeCount: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
}

let tradeCountForThisRun = 0;

function runOne(rollingBlendWeight: number, hysteresisBand: number): SweepRow {
  const config = {
    ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
    signal: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal, hysteresisBand },
    confidenceCalibration: {
      ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.confidenceCalibration,
      rollingBlendWeight,
    },
  };
  tradeCountForThisRun = 0;
  const decideAction = createDecideAction(config, (decision) => {
    if (decision.action !== 'HOLD') tradeCountForThisRun += 1;
  });
  const summary = runFusionMatch({ decideAction });
  return {
    rollingBlendWeight,
    hysteresisBand,
    tradeCount: tradeCountForThisRun,
    totalReturnPct: (summary.totalReturn ?? 0) * 100,
    maxDrawdownPct: (summary.maxDrawdown ?? 0) * 100,
    sharpeRatio: summary.sharpeRatio ?? null,
  };
}

function main(): void {
  const rows: SweepRow[] = [];
  for (const rollingBlendWeight of BLEND_WEIGHT_CANDIDATES) {
    for (const hysteresisBand of HYSTERESIS_BAND_CANDIDATES) {
      rows.push(runOne(rollingBlendWeight, hysteresisBand));
    }
  }

  rows.sort((a, b) => (b.sharpeRatio ?? -Infinity) - (a.sharpeRatio ?? -Infinity));

  console.log(
    `v1 benchmark (same window): return ${V1_BENCHMARK.totalReturnPct.toFixed(2)}%, ` +
      `drawdown ${V1_BENCHMARK.maxDrawdownPct.toFixed(2)}%, Sharpe ${V1_BENCHMARK.sharpeRatio.toFixed(2)}\n`,
  );

  console.log('blendWeight  hysteresis  trades  totalReturn  maxDrawdown  sharpe  beatsV1');
  for (const row of rows) {
    const beatsV1 =
      row.sharpeRatio !== null && row.sharpeRatio > V1_BENCHMARK.sharpeRatio ? 'YES' : '';
    console.log(
      `${row.rollingBlendWeight.toFixed(2).padStart(11)}  ` +
        `${row.hysteresisBand.toFixed(2).padStart(10)}  ` +
        `${String(row.tradeCount).padStart(6)}  ` +
        `${row.totalReturnPct.toFixed(2).padStart(10)}%  ` +
        `${row.maxDrawdownPct.toFixed(2).padStart(10)}%  ` +
        `${row.sharpeRatio === null ? '  n/a ' : row.sharpeRatio.toFixed(2).padStart(6)}  ` +
        beatsV1,
    );
  }
}

main();
