/**
 * Streamlined day-to-day price ingestion (roadmap Phase 3 follow-up): grows an ALREADY-published
 * dataset with new daily bars read from a JSON file, instead of hand-writing a bespoke
 * `seed*.ts`/literal-array script per update. Thin CLI wrapper over `appendBars`
 * (`../src/store/append.ts`) — see that file's own doc comment for the exact "only ever extends
 * the frontier forward, never backfills" semantics this inherits unchanged.
 *
 * Input file shape — one object, keyed by ticker, each a `DailyBar[]`:
 *   { "KMT": [{ "date": "2026-09-01", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1 }] }
 * (exactly the per-ticker "Daily prices" block `price-data-request-skill.md` asks for, reshaped
 * from its plain-text table into JSON — see that file for the sourcing discipline new bars must
 * satisfy before they end up here.)
 *
 * Usage:
 *   yarn workspace @thunderdome/market-data run append:bars -- \
 *     --dataset-id fusion-fundamental-v0 --dataset-version 3 --bars-file /path/to/bars.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appendBars } from '../src/store/append.js';
import { createMarketDataStore } from '../src/store/db.js';
import { DailyBarSchema } from '../src/schema/dailyBar.js';
import { DEFAULT_STORE_DIR } from './seedFusionFundamentalV0.js';

const BarsFileSchema = z.record(z.string(), z.array(DailyBarSchema));

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    args[name] = value;
    i++;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const datasetId = args['dataset-id'];
  const datasetVersion = args['dataset-version'];
  const barsFile = args['bars-file'];
  if (datasetId === undefined || datasetVersion === undefined || barsFile === undefined) {
    console.error(
      'Usage: append:bars -- --dataset-id <id> --dataset-version <version> --bars-file <path> [--store-dir <dir>]',
    );
    process.exitCode = 1;
    return;
  }
  const storeDir = args['store-dir'] ?? DEFAULT_STORE_DIR;

  const raw: unknown = JSON.parse(readFileSync(resolve(barsFile), 'utf8'));
  const parsed = BarsFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`"${barsFile}" is not a valid { TICKER: DailyBar[] } map: ${parsed.error.message}`);
    process.exitCode = 1;
    return;
  }

  // `appendBars` itself already refuses to grow a dataset (id, version) that was never published
  // (see its own doc comment) — this existence check is one level up, on the STORE FILE, so a
  // typo'd `--store-dir`/`--dataset-id` fails clearly instead of `createMarketDataStore` silently
  // creating a brand-new, empty sqlite file in its place.
  const dbPath = resolve(storeDir, `${datasetId}.sqlite`);
  if (!existsSync(dbPath)) {
    console.error(`market dataset store not found at "${dbPath}"`);
    process.exitCode = 1;
    return;
  }
  const store = createMarketDataStore(dbPath);

  const result = appendBars(store, { id: datasetId, version: datasetVersion }, { bars: parsed.data });
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }
  for (const [ticker, bars] of Object.entries(parsed.data)) {
    console.log(`${ticker}: appended ${String(bars.length)} bar(s), ${bars[0]?.date} through ${bars.at(-1)?.date}`);
  }
  console.log(`\nAppended to dataset "${datasetId}" version "${datasetVersion}" in ${storeDir}`);
}

main();
