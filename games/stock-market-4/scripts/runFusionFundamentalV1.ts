/**
 * Runs `fusion-fundamental-v1` (the shorting-capable, sweep-tuned successor to v0) solo against
 * the real engine, with `config.risk.allowShortSelling: true` — the one thing `runFusionMatch`
 * defaults OFF, since a plain cash-only match (v0's own demo) caps every SELL at shares actually
 * held regardless of what a bot's orders ask for. This is the demonstration that v1's shorting
 * logic (see `bots/stock-market-4/fusion-fundamental-v1/src/portfolio.ts`) actually executes
 * against the real engine, not just in its own unit tests.
 *
 * Usage: npx tsx --tsconfig tsconfig.test.json scripts/runFusionFundamentalV1.ts [startDate] [endDate]
 * Defaults to 2026-07-01 through 2026-08-31 (same window `runFusionFundamentalV0.ts` uses, so the
 * two are directly comparable).
 */
import { createDecideAction } from '../../../bots/stock-market-4/fusion-fundamental-v1/src/index.js';
import { runFusionMatch } from './runFusionFundamentalV0.js';

const [, , startDateArg, endDateArg] = process.argv;
const startDate = startDateArg ?? '2026-07-01';
const endDate = endDateArg ?? '2026-08-31';

let shortsOpened = 0;

const decideAction = createDecideAction(undefined, (decision) => {
  if (decision.action !== 'HOLD') {
    console.log(
      `  ${decision.date ?? '(no date)'} ${decision.security}: ${decision.action} ` +
        `(signal=${decision.signalLevel}, confidence=${(decision.confidence * 100).toFixed(0)}%, ` +
        `fairValue=$${decision.valuationAfter.toFixed(2)}, target=${((decision.targetWeight ?? 0) * 100).toFixed(1)}%)`,
    );
  }
  if (decision.signalLevel === 'STRONG_SELL' && (decision.targetWeight ?? 0) < 0) {
    shortsOpened += 1;
  }
});

console.log(`Running fusion-fundamental-v1 solo, ${startDate} -> ${endDate}, real engine, shorting ENABLED.\n`);
const summary = runFusionMatch({ decideAction, startDate, endDate, risk: { allowShortSelling: true } });

console.log('\n--- Result ---');
console.log(`Rounds played: ${String(summary.totalRounds)}`);
console.log(`Final equity: $${(summary.finalEquityCents / 100).toFixed(2)}`);
console.log(`High-confidence STRONG_SELL decisions that called for a short: ${String(shortsOpened)}`);
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
