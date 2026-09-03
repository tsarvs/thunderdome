export * from './types.js';
export * from './game.js';

// The registry-driven CLI (@thunderdome/registry + apps/cli) resolves a game manifest's
// `entryPackage` and dynamically imports it — it can't statically know each game's own export
// name (`pokerTexasHoldEm` here), so every game's entrypoint must also export its GameDefinition under
// this fixed name (games/rock-paper-scissors/src/index.ts established the convention).
export { pokerTexasHoldEm as game } from './game.js';
