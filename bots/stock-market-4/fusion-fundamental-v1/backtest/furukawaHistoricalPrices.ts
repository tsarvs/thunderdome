import type { DailyBar } from '../src/marketTypes.js';

/**
 * Furukawa Electric (TYO:5801) REAL daily price history, pulled from stockanalysis.com on
 * 2026-09-09. Quoted natively in JPY — converted to USD below using a SINGLE current spot rate
 * (USD/JPY 153.605, pulled the same day) applied across the whole window, not a genuine
 * day-by-day historical FX series. This is a labeled simplification (real FX moved during this
 * window; we're not modeling that) — same spirit as the backtest ledger's no-fees/no-margin
 * simplification. `RAW_JPY` is kept alongside the converted export so the conversion is auditable
 * against the real quoted prices.
 */
const USD_PER_JPY = 1 / 153.605;

interface RawBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RAW_JPY: RawBar[] = [
  { date: '2026-06-30', open: 4750.0, high: 4829.0, low: 4589.0, close: 4730.0, volume: 20_063_900 },
  { date: '2026-07-01', open: 4870.0, high: 4870.0, low: 4218.0, close: 4351.0, volume: 28_131_000 },
  { date: '2026-07-02', open: 4225.0, high: 4225.0, low: 3925.0, close: 3976.0, volume: 26_552_800 },
  { date: '2026-07-03', open: 3880.0, high: 4015.0, low: 3711.0, close: 4000.0, volume: 23_593_000 },
  { date: '2026-07-06', open: 3880.0, high: 3998.0, low: 3793.0, close: 3888.0, volume: 18_637_000 },
  { date: '2026-07-07', open: 3860.0, high: 3900.0, low: 3656.0, close: 3674.0, volume: 15_860_500 },
  { date: '2026-07-08', open: 3534.0, high: 3720.0, low: 3442.0, close: 3541.0, volume: 19_410_900 },
  { date: '2026-07-09', open: 3611.0, high: 3687.0, low: 3507.0, close: 3543.0, volume: 15_748_900 },
  { date: '2026-07-10', open: 3730.0, high: 3846.0, low: 3719.0, close: 3725.0, volume: 16_901_100 },
  { date: '2026-07-13', open: 3697.0, high: 3933.0, low: 3566.0, close: 3589.0, volume: 16_349_600 },
  { date: '2026-07-14', open: 3500.0, high: 3568.0, low: 3357.0, close: 3520.0, volume: 20_118_000 },
  { date: '2026-07-15', open: 3679.0, high: 3793.0, low: 3550.0, close: 3766.0, volume: 16_573_600 },
  { date: '2026-07-16', open: 3595.0, high: 3600.0, low: 3455.0, close: 3474.0, volume: 15_717_100 },
  { date: '2026-07-17', open: 3301.0, high: 3309.0, low: 3079.0, close: 3262.0, volume: 23_584_700 },
  { date: '2026-07-21', open: 3332.0, high: 3429.0, low: 3208.0, close: 3419.0, volume: 15_270_000 },
  { date: '2026-07-22', open: 3699.0, high: 3725.0, low: 3518.0, close: 3525.0, volume: 17_372_500 },
  { date: '2026-07-23', open: 3621.0, high: 3675.0, low: 3460.0, close: 3513.0, volume: 10_401_200 },
  { date: '2026-07-24', open: 3450.0, high: 3469.0, low: 3340.0, close: 3388.0, volume: 10_763_100 },
  { date: '2026-07-27', open: 3350.0, high: 3391.0, low: 3170.0, close: 3277.0, volume: 10_701_100 },
  { date: '2026-07-28', open: 3100.0, high: 3131.0, low: 2928.0, close: 3008.0, volume: 19_009_200 },
  { date: '2026-07-29', open: 3009.0, high: 3048.0, low: 2646.0, close: 2772.5, volume: 22_152_000 },
  { date: '2026-07-30', open: 2762.0, high: 2930.5, low: 2678.0, close: 2777.5, volume: 16_868_300 },
  { date: '2026-07-31', open: 3168.0, high: 3278.0, low: 3095.0, close: 3145.0, volume: 39_342_900 },
  { date: '2026-08-03', open: 2935.0, high: 3233.0, low: 2929.5, close: 3200.0, volume: 15_709_100 },
  { date: '2026-08-04', open: 3250.0, high: 3585.0, low: 3205.0, close: 3566.0, volume: 30_259_200 },
  { date: '2026-08-05', open: 3846.0, high: 3976.0, low: 3781.0, close: 3919.0, volume: 28_889_200 },
  { date: '2026-08-06', open: 3781.0, high: 4085.0, low: 3436.0, close: 3909.0, volume: 72_354_600 },
  { date: '2026-08-07', open: 3979.0, high: 4068.0, low: 3588.0, close: 3856.0, volume: 63_618_100 },
  { date: '2026-08-10', open: 3926.0, high: 4251.0, low: 3907.0, close: 3952.0, volume: 45_988_600 },
  { date: '2026-08-12', open: 3812.0, high: 4234.0, low: 3768.0, close: 4222.0, volume: 37_123_200 },
  { date: '2026-08-13', open: 4250.0, high: 4335.0, low: 4095.0, close: 4111.0, volume: 38_198_600 },
  { date: '2026-08-14', open: 4108.0, high: 4157.0, low: 3989.0, close: 4057.0, volume: 25_967_600 },
  { date: '2026-08-17', open: 4170.0, high: 4300.0, low: 4024.0, close: 4298.0, volume: 26_957_200 },
  { date: '2026-08-18', open: 4288.0, high: 4632.0, low: 4236.0, close: 4368.0, volume: 43_304_600 },
  { date: '2026-08-19', open: 4088.0, high: 4113.0, low: 3755.0, close: 3770.0, volume: 41_166_700 },
  { date: '2026-08-20', open: 3771.0, high: 3911.0, low: 3680.0, close: 3864.0, volume: 26_323_100 },
  { date: '2026-08-21', open: 3752.0, high: 3929.0, low: 3752.0, close: 3818.0, volume: 21_887_100 },
  { date: '2026-08-24', open: 3769.0, high: 3859.0, low: 3585.0, close: 3625.0, volume: 23_544_200 },
  { date: '2026-08-25', open: 3621.0, high: 4000.0, low: 3601.0, close: 4000.0, volume: 41_467_200 },
  { date: '2026-08-26', open: 3930.0, high: 3950.0, low: 3816.0, close: 3905.0, volume: 25_680_100 },
  { date: '2026-08-27', open: 4097.0, high: 4120.0, low: 3894.0, close: 4089.0, volume: 27_681_000 },
  { date: '2026-08-28', open: 4019.0, high: 4072.0, low: 3883.0, close: 3903.0, volume: 22_925_600 },
  { date: '2026-08-31', open: 3720.0, high: 4025.0, low: 3697.0, close: 4020.0, volume: 22_025_500 },
  { date: '2026-09-01', open: 3950.0, high: 3992.0, low: 3808.0, close: 3858.0, volume: 20_977_700 },
  { date: '2026-09-02', open: 3852.0, high: 3868.0, low: 3710.0, close: 3752.0, volume: 17_620_100 },
  { date: '2026-09-03', open: 3779.0, high: 3790.0, low: 3596.0, close: 3613.0, volume: 15_656_400 },
  { date: '2026-09-04', open: 3683.0, high: 3867.0, low: 3646.0, close: 3844.0, volume: 20_437_200 },
  { date: '2026-09-07', open: 4000.0, high: 4003.0, low: 3799.0, close: 3840.0, volume: 19_933_400 },
  { date: '2026-09-08', open: 3820.0, high: 3931.0, low: 3666.0, close: 3666.0, volume: 16_024_900 },
  { date: '2026-09-09', open: 3946.0, high: 4196.0, low: 3931.0, close: 4129.0, volume: 37_135_100 },
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

export const FURUKAWA_REAL_HISTORICAL_PRICES: DailyBar[] = RAW_JPY.map(toUsd);
