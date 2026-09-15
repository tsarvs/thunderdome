import type { Migration } from '@thunderdome/sqlite-migrations';
import { migration0001Init } from './0001_init.js';
import { migration0003FusionFundamentalV0Seed } from './0003_fusion_fundamental_v0_seed.js';

/**
 * Every migration this package's SQLite files apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only.
 *
 * No `0002_*` here deliberately: an earlier attempt to bake `test/fixtures/sampleDataset.ts` (the
 * package's own unit-test fixture) into a migration collided with that same fixture being
 * separately published in every isolated test store (`createMarketDataStore` already applies
 * every migration here, including to a brand-new temp file a test then ALSO calls
 * `publishDatasetVersion` on with the same identity). Only genuinely curated, real content
 * belongs in this list — see `scripts/seedFusionFixture.ts`'s own doc comment for why that
 * script stays a direct-write dev convenience instead.
 */
export const marketDataMigrations: Migration[] = [
  migration0001Init,
  migration0003FusionFundamentalV0Seed,
];
