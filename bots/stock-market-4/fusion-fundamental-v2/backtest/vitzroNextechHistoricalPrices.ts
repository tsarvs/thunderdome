import type { DailyBar } from '../src/marketTypes.js';

/**
 * Vitzro Nextech (KOSDAQ:488900) REAL daily price history, pulled from stockanalysis.com on
 * 2026-09-09. Quoted natively in KRW — converted to USD below using a SINGLE current spot rate
 * (USD/KRW ~1386.155, the 30-day average pulled the same day — no single point-in-time quote was
 * available) applied across the whole window, not a genuine day-by-day historical FX series. See
 * `furukawaHistoricalPrices.ts`'s doc comment for why this simplification is acceptable here.
 * `RAW_KRW` is kept alongside the converted export so the conversion is auditable.
 */
const USD_PER_KRW = 1 / 1386.155;

interface RawBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RAW_KRW: RawBar[] = [
  { date: '2026-06-30', open: 9080, high: 9100, low: 8280, close: 8700, volume: 57_639 },
  { date: '2026-07-01', open: 8940, high: 9160, low: 8500, close: 8990, volume: 55_042 },
  { date: '2026-07-02', open: 9000, high: 9000, low: 8100, close: 8130, volume: 54_332 },
  { date: '2026-07-03', open: 8140, high: 8390, low: 7770, close: 8300, volume: 73_271 },
  { date: '2026-07-06', open: 8680, high: 8680, low: 7830, close: 8220, volume: 90_131 },
  { date: '2026-07-07', open: 8200, high: 8390, low: 7530, close: 7730, volume: 87_839 },
  { date: '2026-07-08', open: 7920, high: 7920, low: 6970, close: 7140, volume: 77_992 },
  { date: '2026-07-09', open: 7010, high: 7490, low: 6940, close: 7220, volume: 62_280 },
  { date: '2026-07-10', open: 7180, high: 8170, low: 7180, close: 8020, volume: 81_213 },
  { date: '2026-07-13', open: 8490, high: 8490, low: 7360, close: 7360, volume: 56_825 },
  { date: '2026-07-14', open: 7940, high: 7940, low: 6930, close: 7290, volume: 136_834 },
  { date: '2026-07-15', open: 7430, high: 8100, low: 7430, close: 8060, volume: 57_925 },
  { date: '2026-07-16', open: 7970, high: 8130, low: 7650, close: 7780, volume: 37_775 },
  { date: '2026-07-20', open: 7560, high: 7690, low: 7130, close: 7170, volume: 39_701 },
  { date: '2026-07-21', open: 6940, high: 7420, low: 6930, close: 7350, volume: 55_121 },
  { date: '2026-07-22', open: 8160, high: 8190, low: 7400, close: 7760, volume: 102_949 },
  { date: '2026-07-23', open: 8090, high: 8770, low: 7910, close: 8760, volume: 153_581 },
  { date: '2026-07-24', open: 8300, high: 8310, low: 7910, close: 7980, volume: 82_466 },
  { date: '2026-07-27', open: 7990, high: 8090, low: 7600, close: 7790, volume: 48_007 },
  { date: '2026-07-28', open: 7500, high: 7560, low: 6970, close: 7010, volume: 55_217 },
  { date: '2026-07-29', open: 7450, high: 7560, low: 6800, close: 7260, volume: 129_225 },
  { date: '2026-07-30', open: 6540, high: 7290, low: 6540, close: 6860, volume: 75_890 },
  { date: '2026-07-31', open: 6980, high: 7400, low: 6980, close: 7350, volume: 74_830 },
  { date: '2026-08-03', open: 7240, high: 7990, low: 7240, close: 7830, volume: 96_094 },
  { date: '2026-08-04', open: 7770, high: 8480, low: 7770, close: 8450, volume: 90_353 },
  { date: '2026-08-05', open: 8600, high: 8880, low: 8520, close: 8750, volume: 70_755 },
  { date: '2026-08-06', open: 8600, high: 8830, low: 8220, close: 8490, volume: 54_007 },
  { date: '2026-08-07', open: 9550, high: 9580, low: 8600, close: 8920, volume: 214_975 },
  { date: '2026-08-10', open: 10330, high: 11590, low: 10070, close: 11590, volume: 974_774 },
  { date: '2026-08-11', open: 12200, high: 12200, low: 11200, close: 11650, volume: 515_039 },
  { date: '2026-08-12', open: 11190, high: 11350, low: 10500, close: 11290, volume: 237_723 },
  { date: '2026-08-13', open: 12050, high: 12250, low: 11650, close: 11670, volume: 287_620 },
  { date: '2026-08-14', open: 11560, high: 11570, low: 10810, close: 11130, volume: 138_193 },
  { date: '2026-08-18', open: 10920, high: 10920, low: 10100, close: 10440, volume: 115_328 },
  { date: '2026-08-19', open: 9900, high: 10150, low: 9820, close: 9990, volume: 53_814 },
  { date: '2026-08-20', open: 10090, high: 10250, low: 9800, close: 10010, volume: 49_423 },
  { date: '2026-08-21', open: 9780, high: 9950, low: 9230, close: 9310, volume: 52_189 },
  { date: '2026-08-24', open: 9340, high: 9650, low: 9220, close: 9290, volume: 42_074 },
  { date: '2026-08-25', open: 9190, high: 9560, low: 8750, close: 9560, volume: 53_069 },
  { date: '2026-08-26', open: 9660, high: 9940, low: 9350, close: 9600, volume: 39_804 },
  { date: '2026-08-27', open: 9640, high: 9800, low: 9510, close: 9640, volume: 42_664 },
  { date: '2026-08-28', open: 9550, high: 9630, low: 9330, close: 9490, volume: 37_233 },
  { date: '2026-08-31', open: 9480, high: 9530, low: 8860, close: 9530, volume: 22_869 },
  { date: '2026-09-01', open: 9470, high: 9600, low: 9320, close: 9390, volume: 27_206 },
  { date: '2026-09-02', open: 9070, high: 9390, low: 9010, close: 9010, volume: 25_293 },
  { date: '2026-09-03', open: 9100, high: 9330, low: 8710, close: 9000, volume: 23_241 },
  { date: '2026-09-04', open: 9010, high: 9350, low: 9010, close: 9350, volume: 36_197 },
  { date: '2026-09-07', open: 9450, high: 9450, low: 9170, close: 9330, volume: 22_676 },
  { date: '2026-09-08', open: 9370, high: 9680, low: 9220, close: 9530, volume: 42_141 },
  { date: '2026-09-09', open: 9530, high: 10180, low: 9530, close: 10060, volume: 146_023 },
];

function toUsd(bar: RawBar): DailyBar {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    date: bar.date,
    open: round2(bar.open * USD_PER_KRW),
    high: round2(bar.high * USD_PER_KRW),
    low: round2(bar.low * USD_PER_KRW),
    close: round2(bar.close * USD_PER_KRW),
    volume: bar.volume,
  };
}

export const VITZRO_NEXTECH_REAL_HISTORICAL_PRICES: DailyBar[] = RAW_KRW.map(toUsd);
