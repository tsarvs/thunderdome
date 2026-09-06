import { roundHalfUp } from '../money.js';

/** Trading days/rounds assumed per year when converting an annualized borrow fee into a per-round
 * rate — the standard real-world day-count convention for this kind of cost. */
const TRADING_DAYS_PER_YEAR = 252;

/** The cost of holding a short position for one more round, in cents — charged on the position's
 * current mark-to-market notional (spec §23), never on the original sale proceeds. */
export function dailyBorrowFeeCents(shortShares: number, markPriceCents: number, borrowFeeAnnualized: number): number {
  const dailyRate = borrowFeeAnnualized / TRADING_DAYS_PER_YEAR;
  return roundHalfUp(shortShares * markPriceCents * dailyRate);
}
