import type { DailyBar } from '../src/marketTypes.js';

/**
 * ELMT's REAL daily price history, pulled from stockanalysis.com on 2026-09-09 (cross-checked
 * against stocktitan.net's independently-reported "+0.89% on the Sep 8 session," which matches
 * the 2026-09-04 -> 2026-09-08 close-to-close move below exactly).
 *
 * This is ELMT's ENTIRE public trading history, not a truncated window — the stock IPO'd on
 * 2026-06-30, so there is no earlier daily-bar data to have; `historicalContextDays` warmup
 * (stock-market-4's engine-level concept, only relevant if this series is later run through the
 * real `thunderdome match run` engine rather than this in-process backtest harness) cannot be
 * the usual 250 trading days here — there are only 48.
 *
 * 2026-09-05/06/07 are absent on purpose, not a data gap: 09-05/06 are a weekend and 09-07 is
 * Labor Day (a NASDAQ holiday), so the real tape genuinely jumps straight from Friday 09-04 to
 * Tuesday 09-08 — exactly the day the ELMT/Schwabmünchen acquisition became public.
 *
 * Deliberately STOPS at 2026-09-08 (the last fully-closed session as of when this was pulled).
 * 2026-09-09 was still an in-progress trading day at fetch time (partial volume, live price) and
 * is excluded rather than included as a fake "closed" bar — re-fetch to extend this series once
 * more real sessions have actually closed.
 */
export const ELMT_REAL_HISTORICAL_PRICES: DailyBar[] = [
  { date: '2026-06-30', open: 19.46, high: 20.12, low: 19.03, close: 19.74, volume: 478_961 },
  { date: '2026-07-01', open: 19.46, high: 20.91, low: 19.06, close: 19.25, volume: 516_922 },
  { date: '2026-07-02', open: 19.19, high: 19.43, low: 17.35, close: 17.43, volume: 817_795 },
  { date: '2026-07-06', open: 17.38, high: 18.27, low: 17.31, close: 17.46, volume: 466_866 },
  { date: '2026-07-07', open: 17.17, high: 17.38, low: 15.69, close: 16.03, volume: 877_684 },
  { date: '2026-07-08', open: 15.99, high: 17.00, low: 15.71, close: 15.95, volume: 1_039_679 },
  { date: '2026-07-09', open: 16.29, high: 16.75, low: 15.45, close: 15.82, volume: 432_775 },
  { date: '2026-07-10', open: 15.71, high: 16.11, low: 15.36, close: 15.84, volume: 212_891 },
  { date: '2026-07-13', open: 15.81, high: 15.85, low: 14.53, close: 14.67, volume: 307_854 },
  { date: '2026-07-14', open: 14.92, high: 15.30, low: 14.51, close: 14.61, volume: 176_917 },
  { date: '2026-07-15', open: 14.73, high: 15.10, low: 14.31, close: 14.99, volume: 216_872 },
  { date: '2026-07-16', open: 14.75, high: 14.93, low: 14.21, close: 14.46, volume: 286_422 },
  { date: '2026-07-17', open: 14.13, high: 14.92, low: 13.96, close: 14.41, volume: 299_960 },
  { date: '2026-07-20', open: 14.32, high: 15.05, low: 14.09, close: 14.39, volume: 301_922 },
  { date: '2026-07-21', open: 14.59, high: 16.02, low: 14.58, close: 15.66, volume: 404_691 },
  { date: '2026-07-22', open: 15.63, high: 16.23, low: 15.27, close: 15.27, volume: 308_289 },
  { date: '2026-07-23', open: 15.22, high: 15.76, low: 14.73, close: 14.91, volume: 308_567 },
  { date: '2026-07-24', open: 14.84, high: 14.93, low: 14.16, close: 14.25, volume: 225_508 },
  { date: '2026-07-27', open: 14.50, high: 14.98, low: 14.16, close: 14.71, volume: 255_929 },
  { date: '2026-07-28', open: 14.43, high: 14.69, low: 13.90, close: 14.49, volume: 421_708 },
  { date: '2026-07-29', open: 14.45, high: 14.69, low: 12.54, close: 12.74, volume: 716_758 },
  { date: '2026-07-30', open: 13.01, high: 13.70, low: 12.49, close: 13.62, volume: 659_190 },
  { date: '2026-07-31', open: 13.61, high: 13.99, low: 13.22, close: 13.91, volume: 235_551 },
  { date: '2026-08-03', open: 13.78, high: 14.47, low: 13.78, close: 14.36, volume: 210_509 },
  { date: '2026-08-04', open: 14.55, high: 16.00, low: 14.45, close: 15.80, volume: 248_201 },
  { date: '2026-08-05', open: 15.68, high: 16.32, low: 15.53, close: 15.81, volume: 189_043 },
  { date: '2026-08-06', open: 15.80, high: 16.76, low: 15.49, close: 16.31, volume: 155_327 },
  { date: '2026-08-07', open: 16.45, high: 17.03, low: 16.15, close: 16.86, volume: 160_673 },
  { date: '2026-08-10', open: 16.79, high: 17.21, low: 16.22, close: 16.48, volume: 223_706 },
  { date: '2026-08-11', open: 16.51, high: 16.81, low: 16.29, close: 16.51, volume: 130_549 },
  { date: '2026-08-12', open: 16.88, high: 17.42, low: 16.60, close: 16.93, volume: 282_823 },
  { date: '2026-08-13', open: 18.78, high: 19.00, low: 16.90, close: 17.15, volume: 574_894 },
  { date: '2026-08-14', open: 17.15, high: 18.85, low: 17.15, close: 18.82, volume: 432_942 },
  { date: '2026-08-17', open: 18.65, high: 19.80, low: 18.21, close: 19.10, volume: 347_429 },
  { date: '2026-08-18', open: 18.15, high: 18.84, low: 17.78, close: 17.98, volume: 216_438 },
  { date: '2026-08-19', open: 17.93, high: 18.41, low: 17.11, close: 17.19, volume: 147_693 },
  { date: '2026-08-20', open: 17.11, high: 17.21, low: 16.55, close: 16.67, volume: 181_158 },
  { date: '2026-08-21', open: 17.20, high: 20.64, low: 17.11, close: 19.89, volume: 1_739_403 },
  { date: '2026-08-24', open: 19.59, high: 19.59, low: 17.22, close: 17.66, volume: 580_072 },
  { date: '2026-08-25', open: 17.89, high: 18.45, low: 17.50, close: 17.75, volume: 204_349 },
  { date: '2026-08-26', open: 17.82, high: 18.68, low: 17.72, close: 17.96, volume: 195_118 },
  { date: '2026-08-27', open: 18.16, high: 18.43, low: 17.69, close: 18.07, volume: 251_678 },
  { date: '2026-08-28', open: 18.32, high: 18.33, low: 16.38, close: 16.64, volume: 342_613 },
  { date: '2026-08-31', open: 16.75, high: 16.89, low: 16.04, close: 16.41, volume: 286_689 },
  { date: '2026-09-01', open: 16.00, high: 16.44, low: 15.59, close: 15.76, volume: 216_231 },
  { date: '2026-09-02', open: 15.72, high: 16.11, low: 15.35, close: 15.86, volume: 222_519 },
  { date: '2026-09-03', open: 16.05, high: 16.53, low: 15.63, close: 16.37, volume: 261_796 },
  { date: '2026-09-04', open: 16.54, high: 17.26, low: 16.39, close: 16.78, volume: 213_762 },
  // 2026-09-05, 09-06, 09-07: weekend + Labor Day — no session.
  // The ELMT/Schwabmünchen acquisition became public this session (spec's acceptance case).
  { date: '2026-09-08', open: 16.95, high: 17.36, low: 16.65, close: 16.93, volume: 226_115 },
];

/** The last fully-closed session's close — a convenient anchor for backtest scripts (e.g. "what
 * would the model have said the day before the announcement"). */
export const LAST_PRE_ACQUISITION_CLOSE = ELMT_REAL_HISTORICAL_PRICES.at(-2)!; // 2026-09-04
export const ACQUISITION_DAY_BAR = ELMT_REAL_HISTORICAL_PRICES.at(-1)!; // 2026-09-08
