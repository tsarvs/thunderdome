import { describe, expect, it } from 'vitest';
import { buildEventSeries, type FilingRecord, type PriceBar } from '../src/data/events.js';
import denEvents from '../src/data/denn-events.json' with { type: 'json' };
import denFilings from '../src/data/denn-filings.json' with { type: 'json' };
import denPrices from '../src/data/denn-prices.json' with { type: 'json' };

const prices = denPrices as PriceBar[];
const filings = denFilings as FilingRecord[];
const events = denEvents as { date: string; type: string }[];

describe('buildEventSeries — golden-file check', () => {
  it('recomputing from the two raw real fixtures reproduces the committed denn-events.json exactly', () => {
    // This is what keeps the committed snapshot (what game.ts actually reads at runtime) from
    // ever silently drifting away from the classification logic above it — if events.ts changes
    // without regenerating denn-events.json, this fails loudly instead of quietly serving stale
    // labels.
    expect(buildEventSeries(prices, filings)).toEqual(events);
  });

  it('produces exactly one entry per real trading day, in the same order', () => {
    const computed = buildEventSeries(prices, filings);
    expect(computed.map((e) => e.date)).toEqual(prices.map((p) => p.date));
  });
});

describe('buildEventSeries — spot checks against known real dates', () => {
  it('classifies the real 2016-02-17 earnings filing as EARNINGS_BEAT/MISS, not NO_NEWS', () => {
    const computed = buildEventSeries(prices, filings);
    const entry = computed.find((e) => e.date === '2016-02-17');
    expect(entry?.type === 'EARNINGS_BEAT' || entry?.type === 'EARNINGS_MISS').toBe(true);
  });

  it(
    'attributes the real 2025-11-04 merger-announcement day to general news, not the routine ' +
      'earnings filing that coincidentally landed the same real date',
    () => {
      // Real DENN closed $4.11 on 2025-11-03 and $6.18 on 2025-11-04 — a real same-day +50% move
      // from the real merger announcement, not from the concurrent routine quarterly earnings
      // release also filed that day.
      const computed = buildEventSeries(prices, filings);
      const entry = computed.find((e) => e.date === '2025-11-04');
      expect(entry?.type).toBe('POSITIVE_NEWS');
    },
  );

  it('never invents POSITIVE_NEWS/NEGATIVE_NEWS/EARNINGS_* on a day with no real 8-K filing', () => {
    const filedDates = new Set(filings.map((f) => f.date));
    const computed = buildEventSeries(prices, filings);
    for (const entry of computed) {
      if (!filedDates.has(entry.date)) {
        expect(entry.type).toBe('NO_NEWS');
      }
    }
  });
});
