/**
 * One-off migration: dumps the CURRENT `createFusionFixtureDataset()` output to
 * `data/dataset.json`, byte-for-byte, so `fixture.ts` can load the dataset from a file instead of
 * building it inline in TypeScript. Zero judgment — a mechanical export of what's already there.
 * Kept in the repo afterward as documentation of how `data/dataset.json` was produced, not deleted
 * once run; re-running it would just overwrite the file with whatever `fixture.ts` builds at the
 * time, which is only useful before the migration (once `fixture.ts` itself loads from JSON, this
 * script's import would just read the file back and write it out again, a no-op).
 *
 * Usage: yarn workspace @thunderdome/research-fusion run migrate:fixture-to-json
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFusionFixtureDataset } from '../src/fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, '../data/dataset.json');

function main(): void {
  const dataset = createFusionFixtureDataset();
  writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${DATASET_PATH}`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
