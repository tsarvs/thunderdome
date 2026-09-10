import { roundHalfUp } from '../money.js';

const TRADING_DAYS_PER_YEAR = 252;

/** The cost of holding a short position in one symbol for one more round, charged on its current
 * mark-to-market notional (ported from games/stock-market-2). */
export function dailyBorrowFeeCents(shortShares: number, markPriceCents: number, borrowFeeAnnualized: number): number {
  const dailyRate = borrowFeeAnnualized / TRADING_DAYS_PER_YEAR;
  return roundHalfUp(shortShares * markPriceCents * dailyRate);
}

/**
 * Dynamic borrow conditions (spec §37): as a symbol gets more heavily shorted across all
 * participants relative to its float, borrowing it gets both scarcer (the per-participant
 * borrowable-share cap tightens) and more expensive (the annualized fee rises) — the same
 * qualitative effect a real "hard to borrow" security shows, without labeling it as such. A bot
 * only ever sees the resulting `feeAnnualized`/`availableShares` numbers, never `shortInterestRatio`
 * itself.
 */
export function computeDynamicBorrowConditions(args: {
  baseAnnualizedFee: number;
  baseBorrowableShares: number;
  totalShortInterestShares: number;
  sharesOutstanding: number;
}): { feeAnnualized: number; availableShares: number } {
  const { baseAnnualizedFee, baseBorrowableShares, totalShortInterestShares, sharesOutstanding } = args;
  const shortInterestRatio = sharesOutstanding > 0 ? Math.min(1, totalShortInterestShares / sharesOutstanding) : 0;
  return {
    feeAnnualized: baseAnnualizedFee * (1 + 3 * shortInterestRatio),
    availableShares: Math.max(1, Math.round(baseBorrowableShares * (1 - 0.5 * shortInterestRatio))),
  };
}
