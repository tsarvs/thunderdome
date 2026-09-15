import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { err, ok, type Result } from '../result.js';

// `node:sqlite` is loaded via `createRequire` rather than a static `import`, deliberately: Vite's
// (and therefore Vitest's) module resolver does not yet recognize this recently-stabilized Node
// builtin as external during its dev-time transform, and tries to load it as if it were a real
// file named "sqlite" — see this package's README for the full explanation. `createRequire` is a
// plain runtime `require()` call, invisible to Vite's static import analysis, and works
// identically under `tsc`'s compiled ESM output at real runtime (Node's own `createRequire` is
// unaffected by any of this — it's purely a build/test-tooling workaround).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Wraps a `node:sqlite` `DatabaseSync` handle for one dataset's file (one file per dataset id —
 * see `docs/adr/0010-sqlite-market-data-store.md`). Kept as an opaque type deliberately: nothing
 * outside this package's own `store/`/`provider/` modules should touch the raw handle, so a
 * consumer (a game) only ever sees the higher-level `MarketDataProvider` in `provider/provider.ts`.
 *
 * `node:sqlite`'s `DatabaseSync` is fully synchronous, matching every `GameDefinition` method
 * (`initialize`/`resolve`/`getObservation`/...) already being synchronous — no async wrapper layer
 * needed anywhere this store is used. Chosen over `better-sqlite3` specifically to avoid adding
 * this repo's first native/compiled dependency; see ADR-0010 for the full reasoning.
 */
export interface MarketDataStore {
  readonly db: DatabaseSyncType;
  readonly path: string;
}

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS dataset_versions (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  description     TEXT,
  PRIMARY KEY (dataset_id, dataset_version)
);

CREATE TABLE IF NOT EXISTS daily_bars (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,
  open  REAL NOT NULL,
  high  REAL NOT NULL,
  low   REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, ticker, date),
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
CREATE INDEX IF NOT EXISTS idx_daily_bars_asof ON daily_bars (dataset_id, dataset_version, ticker, date);

CREATE TABLE IF NOT EXISTS corporate_actions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id          TEXT NOT NULL,
  dataset_version     TEXT NOT NULL,
  ticker              TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN
                        ('CASH_DIVIDEND','STOCK_SPLIT','REVERSE_SPLIT','BUYBACK','ACQUISITION','DELISTING')),
  date                TEXT NOT NULL,
  announced_date      TEXT,
  per_share           REAL,
  from_shares         INTEGER,
  to_shares           INTEGER,
  shares_repurchased  INTEGER,
  cash_per_share      REAL,
  reason              TEXT,
  FOREIGN KEY (dataset_id, dataset_version) REFERENCES dataset_versions (dataset_id, dataset_version)
);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_asof
  ON corporate_actions (dataset_id, dataset_version, ticker, date);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_announced
  ON corporate_actions (dataset_id, dataset_version, ticker, announced_date);

CREATE TABLE IF NOT EXISTS trading_holidays (
  dataset_id      TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  date            TEXT NOT NULL,
  PRIMARY KEY (dataset_id, dataset_version, date)
);
`;

/** Creates (or opens, if it already exists) a dataset's SQLite file and ensures its schema exists
 * — the write/ingest-time entry point (see `store/ingest.ts`). Safe to call repeatedly: every
 * `CREATE TABLE`/`CREATE INDEX` is `IF NOT EXISTS`. */
export function createMarketDataStore(dbPath: string): MarketDataStore {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_DDL);
  return { db, path: dbPath };
}

/** Opens an EXISTING dataset file for reading — the path a `MarketDataProvider` is built from
 * (see `provider/provider.ts`). Fails closed (a `Result`, never a thrown exception) when the file
 * doesn't exist, matching `@thunderdome/tournament-store`'s "missing/corrupt record" convention:
 * a match that references a dataset that was never seeded should get a clear, catchable error,
 * not a fresh empty database silently created in its place. */
export function openMarketDataStore(dbPath: string): Result<MarketDataStore> {
  if (!existsSync(dbPath)) {
    return err(`market dataset store not found at "${dbPath}"`);
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA foreign_keys = ON;');
    return ok({ db, path: dbPath });
  } catch (error) {
    return err(`failed to open market dataset store at "${dbPath}": ${String(error)}`);
  }
}

/** Explicit close — see this package's README for the one known Phase 1 limitation: nothing in
 * `@thunderdome/engine`'s `GameDefinition` offers a match-teardown hook to call this from
 * automatically yet, so a long-lived process (e.g. a tournament running many matches) currently
 * relies on process exit / GC rather than a guaranteed close per match. Exposed here so a CLI or
 * test that owns a store's whole lifecycle explicitly can still close it. */
export function closeMarketDataStore(store: MarketDataStore): void {
  store.db.close();
}
