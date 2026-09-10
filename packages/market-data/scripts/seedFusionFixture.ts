/**
 * One-time local seed script: writes `.thunderdome/market-data/<id>.sqlite` from the package's
 * own synthetic proof dataset (see `test/fixtures/sampleDataset.ts` for why this isn't the real
 * fusion bot data yet). Run via `yarn workspace @thunderdome/market-data run seed:fusion-fixture`.
 *
 * Despite the script's filename (kept for continuity with the Phase 1 design notes), this seeds
 * the generic sample dataset, not fusion-specific data — rename once a real fusion dataset is
 * actually wired up.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarketDataStore } from '../src/store/db.js';
import { publishDatasetVersion } from '../src/store/ingest.js';
import {
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../test/fixtures/sampleDataset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const storeDir = resolve(repoRoot, '.thunderdome/market-data');
const dbPath = resolve(storeDir, `${SAMPLE_DATASET_ID}.sqlite`);

mkdirSync(storeDir, { recursive: true });
const store = createMarketDataStore(dbPath);
const result = publishDatasetVersion(
  store,
  { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION },
  SAMPLE_DATASET_INPUT,
);

if (!result.ok) {
  console.error(result.reason);
  process.exitCode = 1;
} else {
  console.log(
    `seeded ${dbPath} with dataset "${SAMPLE_DATASET_ID}" version "${SAMPLE_DATASET_VERSION}"`,
  );
}
