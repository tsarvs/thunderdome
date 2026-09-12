import type { DailyBar } from '../src/marketTypes.js';

/**
 * Sumitomo Electric Industries, Ltd. (TYO:5802) REAL daily price history, pulled from stockanalysis.com on
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
  { date: '2026-07-01', open: 3017.00, high: 3017.00, low: 2810.50, close: 2834.00, volume: 16_813_200 },
  { date: '2026-07-02', open: 2780.50, high: 2783.50, low: 2640.00, close: 2688.50, volume: 20_864_900 },
  { date: '2026-07-03', open: 2567.50, high: 2688.00, low: 2509.00, close: 2664.00, volume: 25_597_100 },
  { date: '2026-07-06', open: 2668.00, high: 2696.00, low: 2557.00, close: 2592.50, volume: 18_064_100 },
  { date: '2026-07-07', open: 2556.00, high: 2620.00, low: 2423.50, close: 2443.00, volume: 26_810_700 },
  { date: '2026-07-08', open: 2358.00, high: 2454.00, low: 2289.00, close: 2361.50, volume: 29_310_800 },
  { date: '2026-07-09', open: 2448.00, high: 2487.00, low: 2371.00, close: 2401.00, volume: 18_696_000 },
  { date: '2026-07-10', open: 2588.00, high: 2624.00, low: 2525.00, close: 2582.00, volume: 28_403_300 },
  { date: '2026-07-13', open: 2571.00, high: 2620.50, low: 2446.50, close: 2486.00, volume: 16_839_600 },
  { date: '2026-07-14', open: 2451.50, high: 2469.50, low: 2388.00, close: 2458.50, volume: 18_618_700 },
  { date: '2026-07-15', open: 2495.00, high: 2538.00, low: 2456.50, close: 2532.00, volume: 15_348_400 },
  { date: '2026-07-16', open: 2423.50, high: 2424.00, low: 2327.50, close: 2397.50, volume: 20_928_200 },
  { date: '2026-07-17', open: 2300.00, high: 2315.00, low: 2151.50, close: 2249.00, volume: 23_416_500 },
  { date: '2026-07-21', open: 2299.00, high: 2340.00, low: 2253.50, close: 2336.50, volume: 21_389_000 },
  { date: '2026-07-22', open: 2536.50, high: 2564.00, low: 2442.00, close: 2451.00, volume: 24_433_600 },
  { date: '2026-07-23', open: 2480.00, high: 2537.00, low: 2452.50, close: 2512.00, volume: 17_118_200 },
  { date: '2026-07-24', open: 2464.00, high: 2474.00, low: 2412.00, close: 2469.00, volume: 11_978_900 },
  { date: '2026-07-27', open: 2419.00, high: 2429.00, low: 2308.00, close: 2355.00, volume: 17_104_800 },
  { date: '2026-07-28', open: 2240.00, high: 2273.50, low: 2167.50, close: 2187.50, volume: 20_330_500 },
  { date: '2026-07-29', open: 2137.50, high: 2197.00, low: 2002.50, close: 2072.00, volume: 29_896_700 },
  { date: '2026-07-30', open: 2040.50, high: 2175.50, low: 2013.00, close: 2109.50, volume: 26_565_700 },
  { date: '2026-07-31', open: 2450.00, high: 2450.00, low: 2116.50, close: 2184.00, volume: 63_080_100 },
  { date: '2026-08-03', open: 2006.50, high: 2075.00, low: 1973.00, close: 2062.50, volume: 37_767_100 },
  { date: '2026-08-04', open: 2058.00, high: 2165.50, low: 2045.50, close: 2161.50, volume: 23_563_900 },
  { date: '2026-08-05', open: 2352.00, high: 2395.00, low: 2294.00, close: 2371.50, volume: 30_948_900 },
  { date: '2026-08-06', open: 2234.00, high: 2283.00, low: 2145.00, close: 2158.50, volume: 31_968_400 },
  { date: '2026-08-07', open: 2159.00, high: 2178.50, low: 2057.50, close: 2129.50, volume: 30_477_300 },
  { date: '2026-08-10', open: 2200.50, high: 2253.00, low: 2153.50, close: 2161.00, volume: 24_032_000 },
  { date: '2026-08-12', open: 2116.00, high: 2287.00, low: 2101.00, close: 2270.00, volume: 27_560_000 },
  { date: '2026-08-13', open: 2301.50, high: 2401.50, low: 2295.00, close: 2334.50, volume: 26_732_000 },
  { date: '2026-08-14', open: 2384.00, high: 2403.00, low: 2346.00, close: 2386.00, volume: 27_793_500 },
  { date: '2026-08-17', open: 2384.00, high: 2473.50, low: 2352.00, close: 2473.00, volume: 19_089_100 },
  { date: '2026-08-18', open: 2561.00, high: 2584.00, low: 2402.50, close: 2419.50, volume: 28_574_300 },
  { date: '2026-08-19', open: 2252.00, high: 2282.50, low: 2186.00, close: 2210.00, volume: 24_695_500 },
  { date: '2026-08-20', open: 2200.00, high: 2228.50, low: 2170.50, close: 2218.50, volume: 18_919_100 },
  { date: '2026-08-21', open: 2138.00, high: 2213.50, low: 2135.00, close: 2178.50, volume: 15_209_700 },
  { date: '2026-08-24', open: 2183.50, high: 2204.00, low: 2138.00, close: 2151.50, volume: 12_175_800 },
  { date: '2026-08-25', open: 2130.00, high: 2211.50, low: 2121.00, close: 2199.50, volume: 17_045_300 },
  { date: '2026-08-26', open: 2188.00, high: 2233.00, low: 2179.00, close: 2211.50, volume: 16_164_600 },
  { date: '2026-08-27', open: 2248.00, high: 2281.50, low: 2194.50, close: 2255.00, volume: 18_677_700 },
  { date: '2026-08-28', open: 2205.00, high: 2232.00, low: 2165.50, close: 2180.00, volume: 18_248_500 },
  { date: '2026-08-31', open: 2150.00, high: 2228.50, low: 2123.00, close: 2221.00, volume: 21_164_500 },
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

export const SUMITOMO_REAL_HISTORICAL_PRICES: DailyBar[] = RAW_JPY.map(toUsd);
