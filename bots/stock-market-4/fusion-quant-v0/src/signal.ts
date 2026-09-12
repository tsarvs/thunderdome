import type { DailyBar } from './marketTypes.js';
import { ROLLING_BASE_VALUE_WINDOW_DAYS } from './valuation/rollingBaseValue.js';

/** Trailing daily-return volatility (population standard deviation of day-over-day returns over
 * the trailing window) — unchanged from `fusion-fundamental-v7`'s own `computeDailyVolatility`.
 * Reused by `alpha/momentum.ts`'s coverage math and `portfolio/inverseVolatility.ts`/
 * `riskParity.ts`'s sizing. Returns `undefined` when there are fewer than 2 bars of history. */
export function computeDailyVolatility(history: DailyBar[], windowDays: number = ROLLING_BASE_VALUE_WINDOW_DAYS): number | undefined {
  const closes = history.slice(-windowDays).map((bar) => bar.close);
  if (closes.length < 2) return undefined;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(closes[i]! / closes[i - 1]! - 1);
  }
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * The trailing simple return over `windowDays` real trading days — `currentPrice / (close
 * windowDays ago) - 1` — unchanged from `fusion-fundamental-v7`'s own `computeTrailingReturn`;
 * `alpha/momentum.ts` is this bot's only caller. Returns `undefined` when there aren't at least
 * `windowDays` bars of history yet.
 */
export function computeTrailingReturn(history: DailyBar[], currentPrice: number, windowDays: number): number | undefined {
  if (history.length < windowDays) return undefined;
  const referenceClose = history[history.length - windowDays]!.close;
  if (referenceClose <= 0) return undefined;
  return currentPrice / referenceClose - 1;
}
