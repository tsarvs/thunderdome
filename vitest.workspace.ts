import { defineWorkspace } from 'vitest/config';

// Deliberately excludes bots/* — bot code is never built, imported, or tested by the platform.
export default defineWorkspace([
  'apps/*/',
  'packages/*/',
  // 'packages/*/' alone would also match 'packages/research/' itself (as an unnamed project
  // that recursively picks up every research/* package's tests, ignoring each one's own
  // vitest.config.ts) — excluded here so each research/* package below is the single project
  // that runs its own tests, matching how packages/*/ already behaves for every non-family
  // package directory.
  '!packages/research/',
  'packages/research/*/',
  'games/*/',
  'ci/tools/*/',
]);
