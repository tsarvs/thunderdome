import type { DailyBar } from '../src/marketTypes.js';

/**
 * Freemelt Holding AB (STO:FREEM) REAL daily price history, pulled from stockanalysis.com on
 * 2026-09-09. Quoted natively in SEK — converted to USD below using a SINGLE current spot rate
 * (USD/SEK 9.5868, pulled the same day) applied across the whole window. See
 * `furukawaHistoricalPrices.ts`'s doc comment for why this simplification is acceptable here.
 * `RAW_SEK` is kept alongside the converted export so the conversion is auditable.
 *
 * The 2026-09-09 bar (+~30% on the day) is the real market reaction to the Freemelt/F4E JT-60SA
 * tungsten-component order announced that same day (see `../../../packages/research/fusion`'s
 * Sept 9, 2026 research update) — this is genuinely the acceptance-case pairing for this security,
 * the same role ELMT/Sept-8 plays for ELMT.
 */
const USD_PER_SEK = 1 / 9.5868;

interface RawBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RAW_SEK: RawBar[] = [
  { date: '2026-07-02', open: 2.06, high: 2.19, low: 1.98, close: 2.13, volume: 1_056_313 },
  { date: '2026-07-03', open: 2.13, high: 2.14, low: 1.99, close: 2.05, volume: 485_696 },
  { date: '2026-07-06', open: 2.0, high: 2.09, low: 1.94, close: 1.95, volume: 574_570 },
  { date: '2026-07-07', open: 1.94, high: 1.94, low: 1.75, close: 1.8, volume: 770_561 },
  { date: '2026-07-08', open: 1.8, high: 1.81, low: 1.7, close: 1.8, volume: 293_751 },
  { date: '2026-07-09', open: 1.8, high: 1.86, low: 1.72, close: 1.81, volume: 233_448 },
  { date: '2026-07-10', open: 1.82, high: 1.88, low: 1.67, close: 1.75, volume: 681_056 },
  { date: '2026-07-13', open: 1.7, high: 1.75, low: 1.64, close: 1.67, volume: 340_685 },
  { date: '2026-07-14', open: 1.65, high: 1.75, low: 1.62, close: 1.74, volume: 306_785 },
  { date: '2026-07-15', open: 1.8, high: 1.8, low: 1.67, close: 1.78, volume: 478_943 },
  { date: '2026-07-16', open: 1.66, high: 1.81, low: 1.62, close: 1.65, volume: 690_169 },
  { date: '2026-07-17', open: 1.64, high: 1.78, low: 1.52, close: 1.66, volume: 421_493 },
  { date: '2026-07-20', open: 1.66, high: 1.66, low: 1.6, close: 1.62, volume: 143_501 },
  { date: '2026-07-21', open: 1.6, high: 1.62, low: 1.5, close: 1.62, volume: 588_523 },
  { date: '2026-07-22', open: 1.6, high: 1.6, low: 1.49, close: 1.56, volume: 519_300 },
  { date: '2026-07-23', open: 1.56, high: 1.56, low: 1.45, close: 1.56, volume: 498_771 },
  { date: '2026-07-24', open: 1.51, high: 1.64, low: 1.51, close: 1.59, volume: 253_518 },
  { date: '2026-07-27', open: 1.56, high: 1.59, low: 1.51, close: 1.53, volume: 317_922 },
  { date: '2026-07-28', open: 1.53, high: 1.61, low: 1.49, close: 1.5, volume: 259_326 },
  { date: '2026-07-29', open: 1.49, high: 1.52, low: 1.45, close: 1.46, volume: 224_593 },
  { date: '2026-07-30', open: 1.45, high: 1.49, low: 1.45, close: 1.48, volume: 116_837 },
  { date: '2026-07-31', open: 1.48, high: 1.53, low: 1.41, close: 1.52, volume: 215_273 },
  { date: '2026-08-03', open: 1.52, high: 1.6, low: 1.5, close: 1.57, volume: 240_476 },
  { date: '2026-08-04', open: 1.57, high: 1.57, low: 1.52, close: 1.57, volume: 179_518 },
  { date: '2026-08-05', open: 1.55, high: 1.57, low: 1.48, close: 1.51, volume: 183_371 },
  { date: '2026-08-06', open: 1.51, high: 1.53, low: 1.46, close: 1.5, volume: 58_132 },
  { date: '2026-08-07', open: 1.5, high: 1.54, low: 1.45, close: 1.5, volume: 420_631 },
  { date: '2026-08-10', open: 1.48, high: 1.49, low: 1.43, close: 1.48, volume: 288_850 },
  { date: '2026-08-11', open: 1.21, high: 1.48, low: 1.1, close: 1.4, volume: 2_974_522 },
  { date: '2026-08-12', open: 1.4, high: 1.4, low: 1.31, close: 1.37, volume: 322_882 },
  { date: '2026-08-13', open: 1.37, high: 1.37, low: 1.25, close: 1.33, volume: 674_135 },
  { date: '2026-08-14', open: 1.33, high: 1.36, low: 1.26, close: 1.31, volume: 206_226 },
  { date: '2026-08-17', open: 1.3, high: 1.35, low: 1.29, close: 1.32, volume: 102_835 },
  { date: '2026-08-18', open: 1.34, high: 1.36, low: 1.3, close: 1.36, volume: 158_187 },
  { date: '2026-08-19', open: 1.35, high: 1.35, low: 1.29, close: 1.32, volume: 82_133 },
  { date: '2026-08-20', open: 1.32, high: 1.34, low: 1.28, close: 1.34, volume: 162_665 },
  { date: '2026-08-21', open: 1.34, high: 1.38, low: 1.27, close: 1.38, volume: 499_641 },
  { date: '2026-08-24', open: 1.38, high: 1.39, low: 1.35, close: 1.37, volume: 135_285 },
  { date: '2026-08-25', open: 1.37, high: 1.37, low: 1.3, close: 1.33, volume: 250_519 },
  { date: '2026-08-26', open: 1.33, high: 1.34, low: 1.27, close: 1.31, volume: 229_402 },
  { date: '2026-08-27', open: 1.31, high: 1.31, low: 1.24, close: 1.27, volume: 521_193 },
  { date: '2026-08-28', open: 1.27, high: 1.27, low: 1.22, close: 1.25, volume: 586_049 },
  { date: '2026-08-31', open: 1.22, high: 1.25, low: 1.15, close: 1.22, volume: 357_087 },
  { date: '2026-09-01', open: 1.22, high: 1.3, low: 1.21, close: 1.28, volume: 141_176 },
  { date: '2026-09-02', open: 1.25, high: 1.29, low: 1.16, close: 1.21, volume: 241_085 },
  { date: '2026-09-03', open: 1.21, high: 1.26, low: 1.18, close: 1.22, volume: 287_112 },
  { date: '2026-09-04', open: 1.25, high: 1.25, low: 1.22, close: 1.23, volume: 86_364 },
  { date: '2026-09-07', open: 1.24, high: 1.42, low: 1.24, close: 1.3, volume: 666_658 },
  { date: '2026-09-08', open: 1.28, high: 1.34, low: 1.23, close: 1.3, volume: 925_695 },
  { date: '2026-09-09', open: 1.58, high: 1.95, low: 1.58, close: 1.69, volume: 2_589_399 },
];

function toUsd(bar: RawBar): DailyBar {
  const round2 = (value: number) => Math.round(value * 10000) / 10000; // finer rounding — sub-$1 price
  return {
    date: bar.date,
    open: round2(bar.open * USD_PER_SEK),
    high: round2(bar.high * USD_PER_SEK),
    low: round2(bar.low * USD_PER_SEK),
    close: round2(bar.close * USD_PER_SEK),
    volume: bar.volume,
  };
}

export const FREEMELT_REAL_HISTORICAL_PRICES: DailyBar[] = RAW_SEK.map(toUsd);

/** Last USD close before the Sept 9 order announcement (Sept 8) — the acceptance-case anchor. */
export const FREEMELT_LAST_PRE_ORDER_CLOSE_USD =
  FREEMELT_REAL_HISTORICAL_PRICES[FREEMELT_REAL_HISTORICAL_PRICES.length - 2]!.close;
