# @thunderdome/market-data

A SQLite-backed, versioned market-data store, behind a generic `MarketDataProvider` abstraction.
This is a deliberate, narrowly-scoped exception to the repo's standing "no database" constraint
(`docs/architecture.md` §10) — see `docs/adr/0010-sqlite-market-data-store.md` for why.

## What this is for

`games/stock-market-4` (and, eventually, other games) needs market data — daily bars, corporate
actions, a trading-holiday calendar — that is:

- **point-in-time safe**: a query for date `D` must never return a row dated after `D`, no matter
  what rows exist in storage;
- **identifiable and versioned**: a competition should be reproducible against the exact dataset
  version it ran with, even after that dataset is later corrected;
- **shared** across historical, synthetic, and (eventually) forward/current-day match modes,
  without three separate storage implementations.

This package provides that as one `MarketDataProvider` interface, backed by one SQLite file per
dataset id (`node:sqlite`'s built-in `DatabaseSync` — no native/compiled dependency).

## What this is NOT

- Not a general-purpose application database. Nothing else in this repo should reach for this
  package, or for SQLite, for unrelated persistence — that would need its own ADR, the same way
  this package did.
- Not part of any game's bot-facing wire protocol. A game builds its own per-participant,
  split-adjusted observation from this provider (see `games/stock-market-4/src/game.ts`); a bot
  never receives a provider, a store handle, or a raw dataset.
- Not a live/forward data ingestion pipeline (yet) — that's a later roadmap phase. Phase 1 only
  covers historical/synthetic datasets seeded ahead of a match.

## Usage sketch

```ts
import {
  createMarketDataStore,
  publishDatasetVersion,
  openMarketDataStore,
  createSqliteMarketDataProvider,
} from '@thunderdome/market-data';

// Seeding (offline, once per dataset version):
const seedStore = createMarketDataStore('/path/to/my-dataset.sqlite');
publishDatasetVersion(
  seedStore,
  { id: 'my-dataset', version: '1' },
  {
    bars: { ACME: [{ date: '2026-01-02', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }] },
  },
);

// Reading (at match setup time):
const readResult = openMarketDataStore('/path/to/my-dataset.sqlite');
if (readResult.ok) {
  const providerResult = createSqliteMarketDataProvider(readResult.value, {
    id: 'my-dataset',
    version: '1',
  });
  if (providerResult.ok) {
    providerResult.value.barsAsOf('ACME', '2026-01-02', 250); // never returns a bar after this date
  }
}
```

See `scripts/seedFusionFixture.ts` for a fuller worked example, and
`test/fixtures/fusionProofDataset.ts` for the small synthetic dataset it seeds.
