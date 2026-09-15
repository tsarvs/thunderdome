import type { Migration } from '@thunderdome/sqlite-migrations';
import { migration0001Init } from './0001_init.js';

/** Every migration this package's tables apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only. */
export const forwardMatchStoreMigrations: Migration[] = [migration0001Init];
