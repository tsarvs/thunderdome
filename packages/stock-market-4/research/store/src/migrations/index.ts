import type { Migration } from '@thunderdome/sqlite-migrations';
import { migration0001Init } from './0001_init.js';
import { migration0002FusionSeed } from './0002_fusion_seed.js';
import { migration0003QuantumSeed } from './0003_quantum_seed.js';

/** Every migration this package's SQLite files apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only. */
export const researchStoreMigrations: Migration[] = [
  migration0001Init,
  migration0002FusionSeed,
  migration0003QuantumSeed,
];
