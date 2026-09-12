import type { DailyBar } from '../src/marketTypes.js';

/**
 * Fujikura Ltd. (TYO:5803) REAL daily price history, pulled from stockanalysis.com on
 * 2026-09-11. Quoted natively in JPY — converted to USD below using a SINGLE current spot rate
 * (USD/JPY 153.58, pulled 2026-09-11 via Reuters) applied across the whole window, not a genuine
 * day-by-day historical FX series. This is a labeled simplification (real FX moved during this
 * window; we're not modeling that) — same spirit as the backtest ledger's no-fees/no-margin
 * simplification. `RAW_JPY` is kept alongside the converted export so the conversion is auditable
 * against the real quoted prices.
 */
const USD_PER_JPY = 1 / 153.58;

interface RawBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RAW_JPY: RawBar[] = [
  { date: '2026-07-01', open: 6350.00, high: 6431.00, low: 5802.00, close: 5826.00, volume: 39_659_300 },
  { date: '2026-07-02', open: 5500.00, high: 5555.00, low: 5361.00, close: 5368.00, volume: 34_213_100 },
  { date: '2026-07-03', open: 5100.00, high: 5379.00, low: 5006.00, close: 5358.00, volume: 42_677_500 },
  { date: '2026-07-06', open: 5299.00, high: 5452.00, low: 5221.00, close: 5354.00, volume: 32_123_000 },
  { date: '2026-07-07', open: 5254.00, high: 5370.00, low: 5050.00, close: 5072.00, volume: 35_968_500 },
  { date: '2026-07-08', open: 4910.00, high: 5106.00, low: 4816.00, close: 4824.00, volume: 40_311_200 },
  { date: '2026-07-09', open: 4961.00, high: 5209.00, low: 4904.00, close: 4938.00, volume: 45_092_500 },
  { date: '2026-07-10', open: 5125.00, high: 5437.00, low: 5095.00, close: 5150.00, volume: 42_643_000 },
  { date: '2026-07-13', open: 5134.00, high: 5380.00, low: 4915.00, close: 5007.00, volume: 40_749_200 },
  { date: '2026-07-14', open: 4800.00, high: 4820.00, low: 4564.00, close: 4800.00, volume: 44_664_300 },
  { date: '2026-07-15', open: 4948.00, high: 5149.00, low: 4834.00, close: 5145.00, volume: 32_782_500 },
  { date: '2026-07-16', open: 5000.00, high: 5004.00, low: 4738.00, close: 4761.00, volume: 36_029_500 },
  { date: '2026-07-17', open: 4561.00, high: 4611.00, low: 4280.00, close: 4472.00, volume: 47_075_400 },
  { date: '2026-07-21', open: 4542.00, high: 4707.00, low: 4472.00, close: 4672.00, volume: 29_986_600 },
  { date: '2026-07-22', open: 4954.00, high: 5026.00, low: 4741.00, close: 4751.00, volume: 38_205_300 },
  { date: '2026-07-23', open: 4888.00, high: 4935.00, low: 4652.00, close: 4727.00, volume: 31_624_200 },
  { date: '2026-07-24', open: 4659.00, high: 4740.00, low: 4511.00, close: 4593.00, volume: 28_103_100 },
  { date: '2026-07-27', open: 4532.00, high: 4565.00, low: 4233.00, close: 4325.00, volume: 41_066_100 },
  { date: '2026-07-28', open: 4199.00, high: 4216.00, low: 4013.00, close: 4073.00, volume: 39_640_100 },
  { date: '2026-07-29', open: 4003.00, high: 4129.00, low: 3665.00, close: 3760.00, volume: 53_924_500 },
  { date: '2026-07-30', open: 3750.00, high: 3927.00, low: 3690.00, close: 3720.00, volume: 48_318_100 },
  { date: '2026-07-31', open: 4210.00, high: 4339.00, low: 4130.00, close: 4172.00, volume: 73_627_300 },
  { date: '2026-08-03', open: 4079.00, high: 4325.00, low: 4008.00, close: 4290.00, volume: 38_401_200 },
  { date: '2026-08-04', open: 4324.00, high: 4657.00, low: 4268.00, close: 4628.00, volume: 54_429_600 },
  { date: '2026-08-05', open: 4830.00, high: 5110.00, low: 4799.00, close: 5073.00, volume: 48_207_800 },
  { date: '2026-08-06', open: 4833.00, high: 4917.00, low: 4566.00, close: 4596.00, volume: 57_561_600 },
  { date: '2026-08-07', open: 4650.00, high: 5280.00, low: 4380.00, close: 5185.00, volume: 128_679_300 },
  { date: '2026-08-10', open: 5210.00, high: 5730.00, low: 5122.00, close: 5580.00, volume: 118_555_300 },
  { date: '2026-08-12', open: 5386.00, high: 5800.00, low: 5306.00, close: 5800.00, volume: 72_558_500 },
  { date: '2026-08-13', open: 5895.00, high: 5990.00, low: 5725.00, close: 5760.00, volume: 69_216_100 },
  { date: '2026-08-14', open: 5780.00, high: 5868.00, low: 5632.00, close: 5665.00, volume: 55_238_000 },
  { date: '2026-08-17', open: 5750.00, high: 6078.00, low: 5720.00, close: 6078.00, volume: 66_184_600 },
  { date: '2026-08-18', open: 6100.00, high: 6433.00, low: 5872.00, close: 5902.00, volume: 75_702_500 },
  { date: '2026-08-19', open: 5502.00, high: 5627.00, low: 5292.00, close: 5328.00, volume: 71_416_300 },
  { date: '2026-08-20', open: 5347.00, high: 5478.00, low: 5201.00, close: 5341.00, volume: 54_776_700 },
  { date: '2026-08-21', open: 5200.00, high: 5422.00, low: 5144.00, close: 5280.00, volume: 62_417_600 },
  { date: '2026-08-24', open: 5276.00, high: 5325.00, low: 4973.00, close: 5016.00, volume: 52_002_000 },
  { date: '2026-08-25', open: 4995.00, high: 5357.00, low: 4968.00, close: 5292.00, volume: 70_850_700 },
  { date: '2026-08-26', open: 5210.00, high: 5353.00, low: 5110.00, close: 5305.00, volume: 54_363_100 },
  { date: '2026-08-27', open: 5470.00, high: 5558.00, low: 5310.00, close: 5500.00, volume: 54_885_600 },
  { date: '2026-08-28', open: 5401.00, high: 5485.00, low: 5301.00, close: 5340.00, volume: 39_786_600 },
  { date: '2026-08-31', open: 5240.00, high: 5525.00, low: 5123.00, close: 5504.00, volume: 47_992_900 },
];

function toUsd(bar: RawBar): DailyBar {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    date: bar.date,
    open: round2(bar.open * USD_PER_JPY),
    high: round2(bar.high * USD_PER_JPY),
    low: round2(bar.low * USD_PER_JPY),
    close: round2(bar.close * USD_PER_JPY),
    volume: bar.volume,
  };
}

export const FUJIKURA_REAL_HISTORICAL_PRICES: DailyBar[] = RAW_JPY.map(toUsd);
