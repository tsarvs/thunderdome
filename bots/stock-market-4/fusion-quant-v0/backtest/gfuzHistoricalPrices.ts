import type { DailyBar } from '@thunderdome/quant-sdk-js';

/**
 * General Fusion (NASDAQ:GFUZ) REAL daily price history, pulled from stockanalysis.com on
 * 2026-09-10. Already USD — no currency conversion needed. Begins 2026-07-13, its real IPO date
 * (SPAC merger with Spring Valley Acquisition Corp. III) — no pre-IPO data exists, unlike every
 * other tracked security's full-window coverage.
 */
export const GFUZ_REAL_HISTORICAL_PRICES: DailyBar[] = [
  { date: '2026-07-13', open: 12.80, high: 14.85, low: 9.12, close: 11.00, volume: 6_211_991 },
  { date: '2026-07-14', open: 12.58, high: 14.42, low: 12.42, close: 13.76, volume: 1_608_144 },
  { date: '2026-07-15', open: 13.50, high: 14.00, low: 11.00, close: 11.00, volume: 666_218 },
  { date: '2026-07-16', open: 10.84, high: 11.10, low: 8.60, close: 9.19, volume: 618_502 },
  { date: '2026-07-17', open: 9.98, high: 9.98, low: 8.30, close: 8.30, volume: 394_159 },
  { date: '2026-07-20', open: 9.10, high: 9.30, low: 8.17, close: 8.51, volume: 385_476 },
  { date: '2026-07-21', open: 8.70, high: 9.80, low: 8.65, close: 9.19, volume: 447_650 },
  { date: '2026-07-22', open: 9.52, high: 9.98, low: 8.22, close: 8.24, volume: 262_507 },
  { date: '2026-07-23', open: 8.26, high: 8.41, low: 6.51, close: 6.96, volume: 612_069 },
  { date: '2026-07-24', open: 6.91, high: 7.08, low: 6.56, close: 6.73, volume: 287_310 },
  { date: '2026-07-27', open: 6.80, high: 7.63, low: 6.08, close: 7.53, volume: 402_258 },
  { date: '2026-07-28', open: 7.60, high: 9.00, low: 7.41, close: 8.58, volume: 513_215 },
  { date: '2026-07-29', open: 9.21, high: 9.30, low: 7.95, close: 8.04, volume: 286_214 },
  { date: '2026-07-30', open: 8.70, high: 9.52, low: 8.61, close: 9.38, volume: 446_783 },
  { date: '2026-07-31', open: 9.90, high: 11.00, low: 9.52, close: 10.09, volume: 354_308 },
  { date: '2026-08-03', open: 9.93, high: 10.00, low: 8.52, close: 8.98, volume: 290_755 },
  { date: '2026-08-04', open: 9.09, high: 9.25, low: 8.08, close: 8.15, volume: 264_102 },
  { date: '2026-08-05', open: 8.31, high: 9.69, low: 8.31, close: 9.36, volume: 223_414 },
  { date: '2026-08-06', open: 9.00, high: 9.40, low: 8.75, close: 9.13, volume: 98_677 },
  { date: '2026-08-07', open: 9.48, high: 9.63, low: 9.02, close: 9.25, volume: 111_022 },
  { date: '2026-08-10', open: 9.60, high: 10.08, low: 8.52, close: 8.72, volume: 248_201 },
  { date: '2026-08-11', open: 8.73, high: 9.30, low: 8.73, close: 9.19, volume: 73_576 },
  { date: '2026-08-12', open: 9.16, high: 9.25, low: 8.17, close: 8.18, volume: 212_214 },
  { date: '2026-08-13', open: 8.36, high: 8.60, low: 8.12, close: 8.46, volume: 140_356 },
  { date: '2026-08-14', open: 8.50, high: 8.99, low: 8.05, close: 8.13, volume: 162_331 },
  { date: '2026-08-17', open: 8.18, high: 8.30, low: 7.59, close: 7.77, volume: 232_720 },
  { date: '2026-08-18', open: 7.83, high: 8.05, low: 7.45, close: 7.62, volume: 211_493 },
  { date: '2026-08-19', open: 7.75, high: 7.94, low: 7.02, close: 7.13, volume: 210_754 },
  { date: '2026-08-20', open: 7.08, high: 7.65, low: 6.75, close: 6.94, volume: 177_135 },
  { date: '2026-08-21', open: 7.00, high: 7.18, low: 6.75, close: 7.00, volume: 202_589 },
  { date: '2026-08-24', open: 7.01, high: 7.46, low: 6.90, close: 7.03, volume: 168_934 },
  { date: '2026-08-25', open: 7.03, high: 7.40, low: 6.95, close: 7.14, volume: 177_284 },
  { date: '2026-08-26', open: 7.38, high: 7.42, low: 6.92, close: 6.95, volume: 161_210 },
  { date: '2026-08-27', open: 7.09, high: 7.91, low: 7.00, close: 7.16, volume: 205_253 },
  { date: '2026-08-28', open: 7.15, high: 7.33, low: 6.90, close: 7.03, volume: 122_166 },
  { date: '2026-08-31', open: 7.17, high: 8.53, low: 7.17, close: 8.10, volume: 516_573 },
];
