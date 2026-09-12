/**
 * Third follow-up tuning pass on `fusion-fundamental-v6`. Stop-loss and vol-sizing's maxScaleFactor
 * are tapped out (see prior runs: stopLossPct sweep was completely FLAT from 0.4 to 1.0 — it isn't
 * even triggering at today's setting — and raising maxScaleFactor past 1.5 actively hurt). The one
 * v6-relevant knob never re-validated on ITS OWN behavior is `hysteresisBand` — it was tuned for
 * v3's exact character; v6's combined vol-sizing/correlation-sizing/stop-loss stack changes how
 * the underlying signal behaves, so the same value isn't guaranteed to still be optimal.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/optimizeFusionFundamentalV6.ts
 */
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../../bots/stock-market-4/fusion-fundamental-v6/src/config.js';
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v6/src/index.js';
import { runFusionMatch, type RunMatchSummary } from './runFusionFundamentalV0.js';

const V3_BENCHMARK = { totalReturnPct: 32.48, sharpeRatio: 1.88 };

function compositeScore(summary: RunMatchSummary): number {
  if (summary.sharpeRatio === null || summary.sharpeRatio === undefined) return -Infinity;
  const totalReturn = summary.totalReturn ?? 0;
  const maxDrawdown = summary.maxDrawdown ?? 0;
  const annualizedVolatility = summary.annualizedVolatility ?? 0;
  if (maxDrawdown <= 0.001 && annualizedVolatility <= 0.001) return -Infinity;
  return totalReturn - maxDrawdown - 0.1 * annualizedVolatility + summary.sharpeRatio;
}

function runWith(hysteresisBand: number) {
  const config = { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG, signal: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal, hysteresisBand } };
  const summary = runFusionMatch({ decideAction: createDecideAction(config) });
  return { hysteresisBand, summary, score: compositeScore(summary) };
}

console.log(`v3 benchmark (solo-harness scale, for relative comparison only): return ${V3_BENCHMARK.totalReturnPct}%, sharpe ${V3_BENCHMARK.sharpeRatio}`);
console.log('\nhysteresisBand   return    maxDD    annVol  sharpe   score');
for (const hysteresisBand of [0, 0.01, 0.02, 0.03, 0.05, 0.08]) {
  const { summary: s, score } = runWith(hysteresisBand);
  console.log(
    `${hysteresisBand.toFixed(2).padStart(14)}   ` +
      `${((s.totalReturn ?? 0) * 100).toFixed(1).padStart(6)}%  ` +
      `${((s.maxDrawdown ?? 0) * 100).toFixed(1).padStart(6)}%  ` +
      `${((s.annualizedVolatility ?? 0) * 100).toFixed(1).padStart(6)}%  ` +
      `${s.sharpeRatio === null || s.sharpeRatio === undefined ? '  n/a ' : s.sharpeRatio.toFixed(2).padStart(6)}  ` +
      `${score === -Infinity ? '  DISQ' : score.toFixed(2).padStart(6)}`,
  );
}
