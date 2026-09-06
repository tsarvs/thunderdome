import { readFileSync } from 'node:fs';
import type { Rng } from '@thunderdome/engine';
import type {
  DailyMarketConditions,
  MarketRegime,
  StockMarket2Config,
  StockMarket2Event,
  StockMarket2EventType,
} from '../types.js';
import type { MarketEnvironment } from './environment.js';
import { INITIAL_REGIME } from './regime.js';

// ---------------------------------------------------------------------------
// The bundled real dataset — 2,515 real DENN daily bars (2016-01-19 through 2026-01-16, the real
// date Denny's Corp was taken private and delisted from Nasdaq) and a precomputed real-event
// classification per day, both read once at module load. See ../data/README.md for exact
// provenance, ../data/events.ts for how the classification was derived, and test/events.test.ts's
// golden-file test for what keeps this snapshot honest against that logic.
// `package.json`'s build script copies src/data/*.json into dist/data/ alongside the compiled JS
// — plain `tsc` never does this on its own, so don't drop that copy step.
//
// This module is the ONLY place in the game that knows any of this is DENN-specific — everything
// downstream (the exchange, portfolio accounting, `game.ts`) only ever sees the generic
// `HistoricalDataProvider`/`MarketEnvironment` shape, so a future second historical dataset only
// needs a second provider here, never changes to the exchange or portfolio logic (spec §29).
// ---------------------------------------------------------------------------

interface RawPriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawEvent {
  date: string;
  type: StockMarket2EventType;
}

function readDataFile(fileName: string): unknown {
  return JSON.parse(readFileSync(new URL(`../data/${fileName}`, import.meta.url), 'utf8'));
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`historicalEnvironment: index ${String(index)} out of bounds (length ${String(items.length)})`);
  }
  return value;
}

const EVENT_DESCRIPTIONS: Record<StockMarket2EventType, string> = {
  NO_NEWS: 'No regulatory disclosures today.',
  POSITIVE_NEWS: 'The company filed a material-event disclosure with regulators today.',
  NEGATIVE_NEWS: 'The company filed a material-event disclosure with regulators today.',
  EARNINGS_BEAT: 'The company filed a quarterly results disclosure with regulators today.',
  EARNINGS_MISS: 'The company filed a quarterly results disclosure with regulators today.',
};

const TRAILING_VOLATILITY_WINDOW = 20;
const REGIME_TRAILING_WINDOW = 20;
/** A reasonable "normal" daily-volatility assumption for classification purposes only — real
 * trailing volatility is compared against this fixed baseline to decide HIGH_VOLATILITY/CRISIS/
 * LOW_VOLATILITY, rather than against a computed whole-dataset average (simpler, and avoids
 * scanning the entire dataset on every call). */
const REGIME_BASELINE_DAILY_VOLATILITY = 0.02;
const REGIME_CRISIS_VOL_RATIO = 2.5;
const REGIME_HIGH_VOL_RATIO = 1.5;
const REGIME_LOW_VOL_RATIO = 0.5;
const REGIME_TREND_THRESHOLD = 0.05;

/** Provider-agnostic surface the historical market environment consumes — a future second
 * dataset (spec §29) just needs a second implementation of this, loaded the same way. */
export interface HistoricalDataProvider {
  readonly totalDays: number;
  dateAt(index: number): string;
  closeCentsAt(index: number): number;
  volumeAt(index: number): number;
  /** (high - low) / close for that day — used only as a trailing volatility input, never for the
   * day currently being priced (that would leak today's not-yet-realized range). */
  highLowRangeFractionAt(index: number): number;
  eventAt(index: number): StockMarket2Event;
}

let cachedProvider: HistoricalDataProvider | undefined;

/** Loads the bundled real DENN dataset once per process. */
export function loadDennProvider(): HistoricalDataProvider {
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }

  const prices = readDataFile('denn-prices.json') as RawPriceBar[];
  const events = readDataFile('denn-events.json') as RawEvent[];
  const totalDays = prices.length;
  const closeCents = prices.map((bar) => Math.round(bar.close * 100));
  const highLowFraction = prices.map((bar) => (bar.high - bar.low) / bar.close);

  cachedProvider = {
    totalDays,
    dateAt: (index) => at(prices, index).date,
    closeCentsAt: (index) => at(closeCents, index),
    volumeAt: (index) => at(prices, index).volume,
    highLowRangeFractionAt: (index) => at(highLowFraction, index),
    eventAt: (index) => {
      const type = at(events, index).type;
      return { type, description: EVENT_DESCRIPTIONS[type] };
    },
  };
  return cachedProvider;
}

/** `config.historyStartIndex` given explicitly: use it as-is (already validated by
 * `StockMarket2ConfigSchema`'s refine against `rounds`). Omitted: draw uniformly at random from
 * every valid offset instead — same "pin or randomize" convention games/stock-market uses. */
export function resolveHistoryStartIndex(
  config: StockMarket2Config,
  provider: HistoricalDataProvider,
  rng: Rng,
): number {
  if (config.historyStartIndex !== undefined) {
    return config.historyStartIndex;
  }
  // Valid range leaves at least 2 real trading days spare past the match window — see the config
  // schema's superRefine for why.
  const maxHistoryStartIndex = provider.totalDays - 3 - config.rounds;
  return rng.nextInt(maxHistoryStartIndex + 1);
}

/**
 * Deterministic — no `rng` involved — a real regime label derived purely from trailing real
 * closes ending at `referenceIndex` (never `referenceIndex`'s own future). Unlike SYNTHETIC
 * mode's Markov transition, HISTORICAL mode's regime is a classification of real data, not a
 * stochastic process, matching this game's "don't fabricate randomness on top of a real company"
 * design (see games/stock-market-2/README.md). It only ever influences liquidity/spread sizing
 * (`game.ts`), never price directly — the real close already *is* the price signal.
 */
function classifyRegime(provider: HistoricalDataProvider, referenceIndex: number): MarketRegime {
  const windowStart = Math.max(1, referenceIndex - REGIME_TRAILING_WINDOW + 1);
  const returns: number[] = [];
  for (let i = windowStart; i <= referenceIndex; i++) {
    returns.push(Math.log(provider.closeCentsAt(i) / provider.closeCentsAt(i - 1)));
  }
  if (returns.length === 0) {
    return INITIAL_REGIME;
  }

  const cumulativeReturn = returns.reduce((sum, r) => sum + r, 0);
  const mean = cumulativeReturn / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const volatilityRatio = Math.sqrt(variance) / REGIME_BASELINE_DAILY_VOLATILITY;

  if (volatilityRatio > REGIME_CRISIS_VOL_RATIO) {
    return 'CRISIS';
  }
  if (volatilityRatio > REGIME_HIGH_VOL_RATIO) {
    return 'HIGH_VOLATILITY';
  }
  if (volatilityRatio < REGIME_LOW_VOL_RATIO) {
    return 'LOW_VOLATILITY';
  }
  if (cumulativeReturn > REGIME_TREND_THRESHOLD) {
    return 'BULL';
  }
  if (cumulativeReturn < -REGIME_TREND_THRESHOLD) {
    return 'BEAR';
  }
  return 'SIDEWAYS';
}

/**
 * HISTORICAL mode's hidden fundamental value for round `r` is always the *previous* real trading
 * day's real close (round 0 is the one exception: it uses its own pinned starting day's close,
 * since that's simply the match's configured starting point, not a lookahead — nothing is traded
 * before round 0 begins). This keeps the environment's walk decoupled from whatever the simulated
 * exchange actually closed at on prior rounds (spec §31), and guarantees a bot is never handed
 * today's real close before submitting orders (spec §32's "avoid lookahead bias") — even
 * indirectly, through how it shapes the reference price `market/referencePriceModel.ts` computes
 * from this value.
 *
 * Expected volume, the volatility hint, and the regime classification are likewise always drawn
 * from that same reference day (previous real day, or round 0's own pinned day) — real,
 * already-public numbers, never today's own not-yet-realized values. `eventImpactReturn` is
 * always 0 here — HISTORICAL mode's real event impact is already fully embedded in the real
 * close data itself; layering a *synthetic* impact on top would double-count it and would mean
 * fabricating a number about a real company (see games/stock-market-2/README.md).
 */
export function createHistoricalMarketEnvironment(
  provider: HistoricalDataProvider,
  historyStartIndex: number,
): MarketEnvironment {
  return {
    conditionsFor({ round }): DailyMarketConditions {
      const dayIndex = historyStartIndex + round;
      const referenceIndex = round === 0 ? dayIndex : dayIndex - 1;

      const windowStart = Math.max(0, referenceIndex - TRAILING_VOLATILITY_WINDOW + 1);
      let volatilitySum = 0;
      let volatilityCount = 0;
      for (let i = windowStart; i <= referenceIndex; i++) {
        volatilitySum += provider.highLowRangeFractionAt(i);
        volatilityCount += 1;
      }

      return {
        date: provider.dateAt(dayIndex),
        event: provider.eventAt(dayIndex),
        eventImpactReturn: 0,
        fundamentalValueCents: provider.closeCentsAt(referenceIndex),
        regime: classifyRegime(provider, referenceIndex),
        expectedDailyVolume: provider.volumeAt(referenceIndex),
        volatilityHint: volatilityCount > 0 ? volatilitySum / volatilityCount : 0.02,
      };
    },
  };
}
