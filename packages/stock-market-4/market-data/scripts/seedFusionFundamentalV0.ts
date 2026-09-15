/**
 * Renders a real, versioned `@thunderdome/market-data` dataset — from
 * `bots/stock-market-4/fusion-fundamental-v0`'s own real price history
 * (`backtest/*HistoricalPrices.ts` — each pulled from stockanalysis.com, see those files' own doc
 * comments for exact provenance/dates per ticker) — as a NEW, git-tracked migration file instead
 * of writing directly into a local sqlite file (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). This is a narrow, deliberate exception to
 * the usual package/bots boundary (`bots/**` is never a workspace dependency of platform code) —
 * it's a one-time data-seeding script reading a bot's own fixture files by relative path, not a
 * runtime package dependency; see `docs/adr/0010-sqlite-market-data-store.md` for why this
 * package exists at all, and `games/stock-market-4/scripts/runFusionFundamentalV0.ts` for what
 * actually reads this dataset back out.
 *
 * Captures the FULL real range every ticker has, once, under one pinned dataset version — a
 * specific match config (e.g. `startDate`/`endDate` for just July-August) then chooses its own
 * window out of this, the same way any other `stock-market-4` match config would. Re-run via:
 *
 *   yarn workspace @thunderdome/market-data run seed:fusion-fundamental-v0
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextMigrationNumber, renderMigrationFileSource } from '@thunderdome/sqlite-migrations';
import { renderPublishDatasetVersionSql } from '../src/store/sqlGen.js';

import { ELMT_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/elmtHistoricalPrices.js';
import { ALMONTY_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/almontyHistoricalPrices.js';
import { FURUKAWA_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/furukawaHistoricalPrices.js';
import { VITZRO_NEXTECH_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/vitzroNextechHistoricalPrices.js';
import { FREEMELT_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/freemeltHistoricalPrices.js';
import { OPTX_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/optxHistoricalPrices.js';
import { GFUZ_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/gfuzHistoricalPrices.js';
import { FUJIKURA_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/fujikuraHistoricalPrices.js';
import { SUMITOMO_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/sumitomoHistoricalPrices.js';
import { KMT_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/kmtHistoricalPrices.js';
import { AMSC_REAL_HISTORICAL_PRICES } from '../../../../bots/stock-market-4/fusion-fundamental-v0/backtest/amscHistoricalPrices.js';

export const DATASET_ID = 'fusion-fundamental-v0';
export const DATASET_VERSION = '3'; // bumped when FUJIKURA/SUMITOMO/KMT/AMSC were added — versions are immutable once published

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
/** The ONE shared Stock Market 4 database file (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`) — price/research/portfolio data all live
 * here now, not in a per-dataset-id file under a `market-data`-specific directory. */
export const DEFAULT_DB_PATH = resolve(repoRoot, '.thunderdome/stock-market-4/db.sqlite');

const MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

function generate(): void {
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

  const sql = renderPublishDatasetVersionSql(
    { id: DATASET_ID, version: DATASET_VERSION },
    {
      description:
        "fusion-fundamental-v0's real tracked-security prices (ELMT, Furukawa Electric, Vitzro " +
        'Nextech, Almonty Industries, Freemelt Holding AB, Syntec Optics, General Fusion, Fujikura, ' +
        'Sumitomo Electric, Kennametal, American Superconductor), pulled from stockanalysis.com — ' +
        'see bots/stock-market-4/fusion-fundamental-v0/backtest/*HistoricalPrices.ts for exact per-ticker provenance.',
      bars,
    },
    new Date().toISOString(),
  );

  const number = nextMigrationNumber(MIGRATIONS_DIR);
  const exportName = `migration${number}FusionFundamentalV0Seed`;
  const id = `market-data/${number}_fusion_fundamental_v0_seed`;
  const migrationPath = join(MIGRATIONS_DIR, `${number}_fusion_fundamental_v0_seed.ts`);

  const source = renderMigrationFileSource({
    exportName,
    id,
    sql,
    docComment:
      "/** `fusion-fundamental-v0`'s real tracked-security prices, pulled from stockanalysis.com\n" +
      ' * (see `bots/stock-market-4/fusion-fundamental-v0/backtest/*HistoricalPrices.ts` for exact\n' +
      ' * per-ticker provenance) — generated by `scripts/seedFusionFundamentalV0.ts`, not\n' +
      ' * hand-written. A correction is always a new migration, never an edit to this one. */',
  });

  writeFileSync(migrationPath, source, 'utf8');
  for (const [ticker, series] of Object.entries(bars)) {
    const first = series[0]?.date ?? '(none)';
    const last = series.at(-1)?.date ?? '(none)';
    console.log(`${ticker}: ${String(series.length)} bars, ${first} through ${last}`);
  }
  console.log(`\nWrote ${migrationPath}`);
  console.log(
    '\nOne manual step left — add these two lines to market-data/src/migrations/index.ts:',
  );
  console.log(`  import { ${exportName} } from './${number}_fusion_fundamental_v0_seed.js';`);
  console.log(`  // ...and add ${exportName} to the marketDataMigrations array.`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  generate();
}
