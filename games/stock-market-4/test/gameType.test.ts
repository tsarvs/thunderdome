import { createMarketDataStore, publishDatasetVersion } from '@thunderdome/market-data';
import { createRng } from '@thunderdome/rng';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stockMarket4 } from '../src/game.js';

/**
 * Proves `config.gameType` (roadmap Phase 2 — see docs/adr/0011-explicit-game-types.md) does
 * exactly what it's meant to and nothing more: `'HISTORICAL'`/`'SYNTHETIC'` are byte-identical to
 * this game's pre-existing behavior (full nominal calendar, regardless of how sparse a
 * `marketDataset` actually is), and `'FORWARD_SHADOW'` is the ONE case where the effective trading
 * calendar is trimmed to what the dataset actually has — using `MIN` across the traded universe's
 * per-ticker freshness, never a dataset-wide `MAX` (see `forwardShadowCutoffDateFor` in
 * `src/game.ts` for why `MAX` would be wrong).
 */

const rng = createRng(Buffer.alloc(16, 1));
const PARTICIPANT_IDS = ['alice', 'bob'];
const DATASET_ID = 'gametype-test-dataset';
const DATASET_VERSION = '1';

function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

// Nominal calendar for startDate 2026-01-05 / endDate 2026-01-12 (no holidays): six trading days
// — 01-05, 06, 07, 08, 09, 12 (01-10/11 is a weekend).
const FAST_BARS = [
  flatBar('2026-01-05', 10),
  flatBar('2026-01-06', 10.1),
  flatBar('2026-01-07', 10.2),
  flatBar('2026-01-08', 10.3),
  flatBar('2026-01-09', 10.4), // FAST is known through 01-09
];
const SLOW_BARS = [
  flatBar('2026-01-05', 20),
  flatBar('2026-01-06', 20.1),
  flatBar('2026-01-07', 20.2), // SLOW is known only through 01-07 — the binding constraint
];
const STALE_BAR = [flatBar('2026-01-02', 5)]; // known only through a date BEFORE startDate
const BENCH_BARS = [flatBar('2026-01-02', 1)]; // deliberately even more stale than STALE_BAR

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm4-gametype-'));
  const store = createMarketDataStore(join(dir, `${DATASET_ID}.sqlite`));
  const published = publishDatasetVersion(
    store,
    { id: DATASET_ID, version: DATASET_VERSION },
    {
      bars: { FAST: FAST_BARS, SLOW: SLOW_BARS, STALE: STALE_BAR, BENCH: BENCH_BARS },
    },
  );
  if (!published.ok) throw new Error(published.reason);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function marketDatasetConfigInput(overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05',
    endDate: '2026-01-12',
    marketDataUniverse: ['FAST', 'SLOW'],
    historicalContextDays: 10,
    marketDataset: { id: DATASET_ID, version: DATASET_VERSION, storeDir: dir },
    ...overrides,
  };
}

describe('gameType default', () => {
  it('defaults to HISTORICAL when omitted', () => {
    const result = stockMarket4.parseConfig(marketDatasetConfigInput());
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.gameType).toBe('HISTORICAL');
  });
});

describe('FORWARD_SHADOW config validation', () => {
  it('rejects inline historicalPrices — forward data cannot be fully authored up front', () => {
    const result = stockMarket4.parseConfig({
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      marketDataUniverse: ['FAST'],
      gameType: 'FORWARD_SHADOW',
      historicalPrices: { FAST: FAST_BARS },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('config.marketDataset');
  });

  it('accepts a marketDataset-backed config', () => {
    const result = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('FORWARD_SHADOW calendar trimming', () => {
  it("stops at the traded universe's earliest lagging ticker (MIN), not the latest (MAX)", () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });

    // SLOW is known only through 01-07 (3 trading days: 01-05, 06, 07) — FAST's extra 01-08/01-09
    // coverage must NOT extend the match, proving MIN, not MAX, governs the cutoff.
    const observation = stockMarket4.getObservation(state, 'alice');
    expect(observation.totalRounds).toBe(3);
    expect(observation.gameType).toBe('FORWARD_SHADOW');

    let current = state;
    const actions = new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
    let rounds = 0;
    while (!stockMarket4.isTerminal(current)) {
      current = stockMarket4.resolve({ state: current, actions, rng }).nextState;
      rounds++;
    }
    expect(rounds).toBe(3);

    const result = stockMarket4.getResult(current);
    expect(result.totalRounds).toBe(3);
    expect(result.gameType).toBe('FORWARD_SHADOW');
  });

  it('benchmarkTicker freshness never gates the cutoff', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ gameType: 'FORWARD_SHADOW', benchmarkTicker: 'BENCH' }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    const state = stockMarket4.initialize({
      config: configResult.value,
      participantIds: PARTICIPANT_IDS,
      rng,
    });
    // BENCH is stale back to 01-02, far before SLOW's own 01-07 cutoff — if benchmarkTicker were
    // (wrongly) included in the MIN, this match would have zero playable rounds instead of 3.
    expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(3);
  });

  it('throws at initialize() when there are zero playable trading days', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({
        gameType: 'FORWARD_SHADOW',
        marketDataUniverse: ['FAST', 'STALE'],
      }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    expect(() =>
      stockMarket4.initialize({ config: configResult.value, participantIds: PARTICIPANT_IDS, rng }),
    ).toThrow(/no playable trading days/);
  });
});

describe('HISTORICAL/SYNTHETIC are unaffected by dataset sparseness', () => {
  it.each(['HISTORICAL', 'SYNTHETIC'] as const)(
    '%s always plays the full nominal calendar, even against the same lagging dataset',
    (gameType) => {
      const configResult = stockMarket4.parseConfig(marketDatasetConfigInput({ gameType }));
      if (!configResult.ok) throw new Error(configResult.reason);
      const state = stockMarket4.initialize({
        config: configResult.value,
        participantIds: PARTICIPANT_IDS,
        rng,
      });
      // Full nominal calendar (6 days), NOT trimmed to SLOW's 01-07 cutoff — SLOW's missing bars
      // on 01-08/01-09/01-12 stay ordinary per-ticker data gaps, not a match-ending condition.
      expect(stockMarket4.getObservation(state, 'alice').totalRounds).toBe(6);
      expect(stockMarket4.getObservation(state, 'alice').gameType).toBe(gameType);
    },
  );
});
