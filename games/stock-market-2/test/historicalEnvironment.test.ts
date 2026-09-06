import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import {
  createHistoricalMarketEnvironment,
  loadDennProvider,
  resolveHistoryStartIndex,
  type HistoricalDataProvider,
} from '../src/market/historicalEnvironment.js';
import { INITIAL_REGIME } from '../src/market/regime.js';
import { StockMarket2ConfigSchema } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

function conditionsFor(
  environment: ReturnType<typeof createHistoricalMarketEnvironment>,
  round: number,
  previousFundamentalValueCents = 0,
) {
  return environment.conditionsFor({ round, rng, previousFundamentalValueCents, previousRegime: INITIAL_REGIME });
}

function config(overrides: Record<string, unknown> = {}) {
  return StockMarket2ConfigSchema.parse({ mode: 'HISTORICAL', ...overrides });
}

describe('loadDennProvider', () => {
  it('loads the real bundled dataset', () => {
    const provider = loadDennProvider();
    expect(provider.totalDays).toBe(2515);
    expect(provider.dateAt(0)).toBe('2016-01-19');
    expect(provider.closeCentsAt(0)).toBe(911);
    expect(provider.dateAt(provider.totalDays - 1)).toBe('2026-01-16');
  });
});

describe('resolveHistoryStartIndex', () => {
  const provider = loadDennProvider();

  it('uses the pinned index as-is when given', () => {
    expect(resolveHistoryStartIndex(config({ historyStartIndex: 42, rounds: 10 }), provider, rng)).toBe(42);
  });

  it('draws deterministically from a seed when omitted', () => {
    const a = resolveHistoryStartIndex(config({ rounds: 10 }), provider, createRng(Buffer.alloc(16, 7)));
    const b = resolveHistoryStartIndex(config({ rounds: 10 }), provider, createRng(Buffer.alloc(16, 7)));
    expect(a).toBe(b);
  });

  it('always leaves enough real days for the configured round count', () => {
    const index = resolveHistoryStartIndex(config({ rounds: 500 }), provider, rng);
    expect(index + 500).toBeLessThanOrEqual(2513);
  });
});

describe('createHistoricalMarketEnvironment — no lookahead bias', () => {
  const provider = loadDennProvider();
  const historyStartIndex = 100;
  const environment = createHistoricalMarketEnvironment(provider, historyStartIndex);

  it("round 0's fundamental value is its own pinned starting day's real close (the configured starting point, not a leak)", () => {
    const conditions = conditionsFor(environment, 0);
    expect(conditions.fundamentalValueCents).toBe(provider.closeCentsAt(historyStartIndex));
    expect(conditions.date).toBe(provider.dateAt(historyStartIndex));
    expect(conditions.eventImpactReturn).toBe(0);
  });

  it("round r>=1's fundamental value is YESTERDAY's real close, never today's", () => {
    const conditions = conditionsFor(environment, 5);
    expect(conditions.fundamentalValueCents).toBe(provider.closeCentsAt(historyStartIndex + 4));
    expect(conditions.fundamentalValueCents).not.toBe(provider.closeCentsAt(historyStartIndex + 5));
    expect(conditions.date).toBe(provider.dateAt(historyStartIndex + 5));
  });

  it('ignores previousFundamentalValueCents/previousRegime entirely — the simulated exchange never rewrites the real path', () => {
    const a = conditionsFor(environment, 5, 1);
    const b = conditionsFor(environment, 5, 999_999);
    expect(a.fundamentalValueCents).toBe(b.fundamentalValueCents);
    expect(a.regime).toBe(b.regime);
  });

  it('maps each round to the next real trading day in sequence', () => {
    const dates = [0, 1, 2, 3].map((round) => conditionsFor(environment, round).date);
    expect(dates).toEqual([
      provider.dateAt(historyStartIndex),
      provider.dateAt(historyStartIndex + 1),
      provider.dateAt(historyStartIndex + 2),
      provider.dateAt(historyStartIndex + 3),
    ]);
  });

  it("reports today's real public event, which is not itself a leak of today's price move", () => {
    // 2016-02-17 (index 20) is a real EARNINGS_BEAT day (see src/data/README.md).
    const earningsEnv = createHistoricalMarketEnvironment(provider, 20);
    expect(conditionsFor(earningsEnv, 0).event.type).toBe('EARNINGS_BEAT');
  });

  it('expected volume and volatility hint are also drawn from the reference day, never the current day', () => {
    const conditions = conditionsFor(environment, 5);
    expect(conditions.expectedDailyVolume).toBe(provider.volumeAt(historyStartIndex + 4));
    expect(conditions.volatilityHint).toBeGreaterThan(0);
  });

  it('never fabricates a synthetic event impact on top of real data', () => {
    for (const round of [0, 1, 2, 3, 4, 5]) {
      expect(conditionsFor(environment, round).eventImpactReturn).toBe(0);
    }
  });
});

describe('createHistoricalMarketEnvironment — regime classification is deterministic, from real data only', () => {
  const provider = loadDennProvider();

  it('falls back to the initial regime with no trailing history to classify from', () => {
    const environment = createHistoricalMarketEnvironment(provider, 0);
    expect(conditionsFor(environment, 0).regime).toBe(INITIAL_REGIME);
  });

  it('is fully deterministic given the same real data (no rng involved)', () => {
    const environment = createHistoricalMarketEnvironment(provider, 500);
    const a = conditionsFor(environment, 10);
    const b = conditionsFor(environment, 10);
    expect(a.regime).toBe(b.regime);
  });

  it('classifies the real 2025-11-04 buyout-announcement jump window as elevated volatility', () => {
    // Index 2461 corresponds to shortly after the real +50% same-day jump (src/data/events.ts);
    // trailing realized volatility across that window is far above this classifier's baseline.
    const environment = createHistoricalMarketEnvironment(provider, 2465);
    const regime = conditionsFor(environment, 0).regime;
    expect(['HIGH_VOLATILITY', 'CRISIS']).toContain(regime);
  });
});

describe('createHistoricalMarketEnvironment — provider swappability', () => {
  it('works against any HistoricalDataProvider, not just the bundled DENN one (spec §29)', () => {
    const fakeProvider: HistoricalDataProvider = {
      totalDays: 3,
      dateAt: (i) => `2099-01-0${String(i + 1)}`,
      closeCentsAt: (i) => [5000, 5500, 4500][i] ?? 0,
      volumeAt: () => 42,
      highLowRangeFractionAt: () => 0.03,
      eventAt: () => ({ type: 'NO_NEWS', description: 'placeholder' }),
    };
    const environment = createHistoricalMarketEnvironment(fakeProvider, 0);
    expect(conditionsFor(environment, 0).fundamentalValueCents).toBe(5000);
    expect(conditionsFor(environment, 1).fundamentalValueCents).toBe(5000);
    expect(conditionsFor(environment, 2).fundamentalValueCents).toBe(5500);
  });
});
