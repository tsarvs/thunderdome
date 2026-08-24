import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
  resolve: {
    // Resolve workspace deps straight to source for tests, so `yarn test` doesn't require a
    // prior `yarn build` — CI still builds before running the compiled CLI (see ci.yml).
    alias: {
      '@thunderdome/bot-sdk': fileURLToPath(
        new URL('../../packages/bot-sdk/src/index.ts', import.meta.url),
      ),
      '@thunderdome/game-sdk': fileURLToPath(
        new URL('../../packages/game-sdk/src/index.ts', import.meta.url),
      ),
    },
  },
});
