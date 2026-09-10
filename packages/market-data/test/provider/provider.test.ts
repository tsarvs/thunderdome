import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeMarketDataStore,
  createMarketDataStore,
  openMarketDataStore,
  type MarketDataStore,
} from '../../src/store/db.js';
import { publishDatasetVersion } from '../../src/store/ingest.js';
import { createSqliteMarketDataProvider } from '../../src/provider/provider.js';
import {
  SAMPLE_ACME_BARS,
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../fixtures/sampleDataset.js';

const IDENTITY = { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION };

let dir: string;
let dbPath: string;
let store: MarketDataStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'market-data-provider-test-'));
  dbPath = join(dir, 'dataset.sqlite');
  store = createMarketDataStore(dbPath);
  const result = publishDatasetVersion(store, IDENTITY, SAMPLE_DATASET_INPUT);
  if (!result.ok) throw new Error(result.reason);
});

afterEach(() => {
  closeMarketDataStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteMarketDataProvider', () => {
  it('builds a working provider for a published dataset version', () => {
    const result = createSqliteMarketDataProvider(store, IDENTITY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identity).toEqual(IDENTITY);
    expect(result.value.tickers()).toEqual(['ACME', 'GLOBEX']);
    expect(result.value.barsAsOf('ACME', '2026-01-12', 10)).toEqual(SAMPLE_ACME_BARS);
  });

  it('fails closed for an unpublished version, rather than behaving like an empty market', () => {
    const result = createSqliteMarketDataProvider(store, {
      id: SAMPLE_DATASET_ID,
      version: 'nope',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no published version');
  });

  it('fails closed for an unknown dataset id entirely', () => {
    const result = createSqliteMarketDataProvider(store, { id: 'unknown-dataset', version: '1' });
    expect(result.ok).toBe(false);
  });
});

describe('determinism', () => {
  it('two independently-opened providers over the same file return deep-equal results', () => {
    closeMarketDataStore(store);

    const openA = openMarketDataStore(dbPath);
    const openB = openMarketDataStore(dbPath);
    if (!openA.ok || !openB.ok) throw new Error('expected both opens to succeed');

    const providerA = createSqliteMarketDataProvider(openA.value, IDENTITY);
    const providerB = createSqliteMarketDataProvider(openB.value, IDENTITY);
    if (!providerA.ok || !providerB.ok) throw new Error('expected both providers to build');

    expect(providerA.value.barsAsOf('ACME', '2026-01-09', 250)).toEqual(
      providerB.value.barsAsOf('ACME', '2026-01-09', 250),
    );
    expect(providerA.value.corporateActionsAsOf(null, '2026-01-12')).toEqual(
      providerB.value.corporateActionsAsOf(null, '2026-01-12'),
    );

    closeMarketDataStore(openA.value);
    closeMarketDataStore(openB.value);
    // Reopen for the outer afterEach's closeMarketDataStore(store) call to stay a no-op-safe close.
    store = createMarketDataStore(dbPath);
  });

  it('repeated queries never mutate shared state — calling barsAsOf twice returns the same result', () => {
    const providerResult = createSqliteMarketDataProvider(store, IDENTITY);
    if (!providerResult.ok) throw new Error(providerResult.reason);
    const first = providerResult.value.barsAsOf('ACME', '2026-01-12', 250);
    const second = providerResult.value.barsAsOf('ACME', '2026-01-12', 250);
    expect(first).toEqual(second);
  });
});
