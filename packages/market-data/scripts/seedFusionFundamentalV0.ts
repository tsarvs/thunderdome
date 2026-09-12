/**
 * Seeds a real, versioned `@thunderdome/market-data` dataset from
 * `bots/stock-market-4/fusion-fundamental-v0`'s own real price history
 * (`backtest/*HistoricalPrices.ts` — each pulled from stockanalysis.com, see those files' own doc
 * comments for exact provenance/dates per ticker). This is a narrow, deliberate exception to the
 * usual package/bots boundary (`bots/**` is never a workspace dependency of platform code) — it's
 * a one-time data-seeding script reading a bot's own fixture files by relative path, not a runtime
 * package dependency; see `docs/adr/0010-sqlite-market-data-store.md` for why this package exists
 * at all, and `games/stock-market-4/scripts/runFusionFundamentalV0.ts` for what actually reads
 * this dataset back out.
 *
 * Seeds the FULL real range every ticker has, once, under one pinned dataset version — a specific
 * match config (e.g. `startDate`/`endDate` for just July-August) then chooses its own window out
 * of this, the same way any other `stock-market-4` match config would. Re-run via:
 *
 *   yarn workspace @thunderdome/market-data run seed:fusion-fundamental-v0
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarketDataStore } from '../src/store/db.js';
import { publishDatasetVersion } from '../src/store/ingest.js';

import { ELMT_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/elmtHistoricalPrices.js';
import { ALMONTY_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/almontyHistoricalPrices.js';
import { FURUKAWA_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/furukawaHistoricalPrices.js';
import { VITZRO_NEXTECH_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/vitzroNextechHistoricalPrices.js';
import { FREEMELT_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/freemeltHistoricalPrices.js';
import { OPTX_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/optxHistoricalPrices.js';
import { GFUZ_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/gfuzHistoricalPrices.js';
import { FUJIKURA_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/fujikuraHistoricalPrices.js';
import { SUMITOMO_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/sumitomoHistoricalPrices.js';
import { KMT_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/kmtHistoricalPrices.js';
import { AMSC_REAL_HISTORICAL_PRICES } from '../../../bots/stock-market-4/fusion-fundamental-v0/backtest/amscHistoricalPrices.js';

export const DATASET_ID = 'fusion-fundamental-v0';
export const DATASET_VERSION = '3'; // bumped when FUJIKURA/SUMITOMO/KMT/AMSC were added — versions are immutable once published

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
export const DEFAULT_STORE_DIR = resolve(repoRoot, '.thunderdome/market-data');

function seed(storeDir: string = DEFAULT_STORE_DIR): void {
  mkdirSync(storeDir, { recursive: true });
  const store = createMarketDataStore(resolve(storeDir, `${DATASET_ID}.sqlite`));

  const bars = {
    ELMT: ELMT_REAL_HISTORICAL_PRICES,
    FURUKAWA: FURUKAWA_REAL_HISTORICAL_PRICES,
    VITZRONEXTECH: VITZRO_NEXTECH_REAL_HISTORICAL_PRICES,
    ALM: ALMONTY_REAL_HISTORICAL_PRICES,
    FREEM: FREEMELT_REAL_HISTORICAL_PRICES,
    OPTX: OPTX_REAL_HISTORICAL_PRICES,
    GFUZ: GFUZ_REAL_HISTORICAL_PRICES,
    FUJIKURA: FUJIKURA_REAL_HISTORICAL_PRICES,
    SUMITOMO: SUMITOMO_REAL_HISTORICAL_PRICES,
    KMT: KMT_REAL_HISTORICAL_PRICES,
    AMSC: AMSC_REAL_HISTORICAL_PRICES,
  };

  const result = publishDatasetVersion(store, { id: DATASET_ID, version: DATASET_VERSION }, {
    description:
      "fusion-fundamental-v0's real tracked-security prices (ELMT, Furukawa Electric, Vitzro " +
      'Nextech, Almonty Industries, Freemelt Holding AB, Syntec Optics, General Fusion, Fujikura, ' +
      'Sumitomo Electric, Kennametal, American Superconductor), pulled from stockanalysis.com — ' +
      'see bots/stock-market-4/fusion-fundamental-v0/backtest/*HistoricalPrices.ts for exact per-ticker provenance.',
    bars,
  });

  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }
  for (const [ticker, series] of Object.entries(bars)) {
    const first = series[0]?.date ?? '(none)';
    const last = series.at(-1)?.date ?? '(none)';
    console.log(`${ticker}: ${String(series.length)} bars, ${first} through ${last}`);
  }
  console.log(`\nSeeded dataset "${DATASET_ID}" version "${DATASET_VERSION}" in ${storeDir}`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seed();
}
