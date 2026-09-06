import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import {
  createHistoricalMarketEnvironment,
  loadDennProvider,
  resolveHistoryStartIndex,
  type HistoricalDataProvider,
} from '../src/market/historicalEnvironment.js';
import { StockMarket2ConfigSchema } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

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

  it("round 0's reference price is its own pinned starting day's real close (the configured starting point, not a leak)", () => {
    const conditions = environment.conditionsFor({ round: 0, rng, lastRealizedCloseCents: 0 });
    expect(conditions.referencePriceCents).toBe(provider.closeCentsAt(historyStartIndex));
    expect(conditions.date).toBe(provider.dateAt(historyStartIndex));
  });

  it("round r>=1's reference price is YESTERDAY's real close, never today's", () => {
    const conditions = environment.conditionsFor({ round: 5, rng, lastRealizedCloseCents: 0 });
    expect(conditions.referencePriceCents).toBe(provider.closeCentsAt(historyStartIndex + 4));
    expect(conditions.referencePriceCents).not.toBe(provider.closeCentsAt(historyStartIndex + 5));
    expect(conditions.date).toBe(provider.dateAt(historyStartIndex + 5));
  });

  it('ignores lastRealizedCloseCents entirely — the simulated exchange never rewrites the real path', () => {
    const a = environment.conditionsFor({ round: 5, rng, lastRealizedCloseCents: 1 });
    const b = environment.conditionsFor({ round: 5, rng, lastRealizedCloseCents: 999_999 });
    expect(a.referencePriceCents).toBe(b.referencePriceCents);
  });

  it('maps each round to the next real trading day in sequence', () => {
    const dates = [0, 1, 2, 3].map((round) => environment.conditionsFor({ round, rng, lastRealizedCloseCents: 0 }).date);
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
    expect(earningsEnv.conditionsFor({ round: 0, rng, lastRealizedCloseCents: 0 }).event.type).toBe('EARNINGS_BEAT');
  });

  it('expected volume and volatility hint are also drawn from the reference day, never the current day', () => {
    const conditions = environment.conditionsFor({ round: 5, rng, lastRealizedCloseCents: 0 });
    expect(conditions.expectedDailyVolume).toBe(provider.volumeAt(historyStartIndex + 4));
    expect(conditions.volatilityHint).toBeGreaterThan(0);
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
    expect(environment.conditionsFor({ round: 0, rng, lastRealizedCloseCents: 0 }).referencePriceCents).toBe(5000);
    expect(environment.conditionsFor({ round: 1, rng, lastRealizedCloseCents: 0 }).referencePriceCents).toBe(5000);
    expect(environment.conditionsFor({ round: 2, rng, lastRealizedCloseCents: 0 }).referencePriceCents).toBe(5500);
  });
});
