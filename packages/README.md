# Packages

The ringmaster's own hallowed machinery — inner-sanctum Yarn workspace packages, reviewed by the
council, that make up the platform itself. Every one is `private` and versioned independently but
built together; see the root [`README.md`](../README.md#forging-your-arms-local-development) for
the full build/lint/typecheck/test flow (`yarn build` builds them in dependency order, since Yarn
Classic's `workspaces run` doesn't guarantee topological order — see `scripts/build.sh`).

## Packages

| Package                                                             | Provides                                                                                                                                                                                                              | Depends on               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`protocol`](protocol/)                                             | The wire protocol: envelope types, JSON Schema, validators — the language engine and bots speak over stdio.                                                                                                           | —                        |
| [`rng`](rng/)                                                       | Seeded PRNG and deterministic seed derivation, so a match with a given `rngSeed` replays identically.                                                                                                                 | —                        |
| [`engine`](engine/)                                                 | The `GameDefinition` contract, the match runner, and the tournament orchestrator — the one true game engine every game and format is built against.                                                                   | `rng`                    |
| [`runtime`](runtime/)                                               | Docker bot execution: container lifecycle, resource limits, forfeit handling. Nothing runs a bot outside this.                                                                                                        | `engine`, `protocol`     |
| [`bot-sdk-js`](bot-sdk-js/)                                         | TypeScript SDK for bot authors: bot manifest schema, `runBot()` protocol client. Vendored into each bot's own tarball, not workspace-linked, since `bots/**` isn't a workspace member.                                | —                        |
| [`game-sdk`](game-sdk/)                                             | Helpers for game authors and the game manifest schema.                                                                                                                                                                | —                        |
| [`registry`](registry/)                                             | Filesystem scan and validation of bot and game manifests — how the CLI resolves a bot/game id to real code.                                                                                                           | `bot-sdk-js`, `game-sdk` |
| [`tournament-formats`](tournament-formats/)                         | Concrete `TournamentFormat` implementations: round robin and single elimination.                                                                                                                                      | `engine`                 |
| [`tournament-store`](tournament-store/)                             | Persisted `TournamentRecord` read/write — one JSON file per tournament, no database.                                                                                                                                  | `engine`                 |
| [`game-dev-toolkit/deck-of-cards`](game-dev-toolkit/deck-of-cards/) | Shared card/deck/trick primitives for card games — currently backs `games/card-game-hearts` and `games/poker-texas-hold-em`.                                                                                          | `rng`                    |
| [`research/core`](research/core/)                                   | Domain-neutral representation of structured research over time — entities, relationships, evidence, hypotheses, models, datasets, temporal state/snapshot reconstruction. Knows nothing about stocks, games, or bots. | —                        |
| [`research/fusion`](research/fusion/)                               | A small, representative fusion-research fixture proving `research/core`'s schema can carry a real domain — NOT the complete fusion research database.                                                                 | `research/core`          |
| [`research/quantum`](research/quantum/)                             | An intentional skeleton (three entities, one relationship/evidence/hypothesis) proving `research/core` is generic across a second domain — NOT a real quantum-research model.                                         | `research/core`          |

`game-dev-toolkit/*` and `research/*` are each their own workspace glob in the root `package.json`
(a family of related packages rather than a single one), separate from the flat `packages/*` glob
the rest of this directory uses.

[`bot-sdk-python`](bot-sdk-python/) also lives here but isn't a Yarn workspace package at all — no
`package.json`, nothing in the table above — since it's Python, not TypeScript: the Python analog
of `bot-sdk-js` for bot authors writing in Python, with its own README explaining the (simpler,
no-build) vendoring story.

Every package follows the same shape: `src/` for implementation, `test/` for unit tests,
`tsconfig.json`/`tsconfig.test.json`, `vitest.config.ts`, and a `dist/` produced by its own
`yarn build` (`tsc -p tsconfig.json`). None of these are ever imported by `bots/*` — see
`docs/adr/0001-monorepo-and-boundary.md` and `docs/adr/0007-repository-enforcement.md` for why
that boundary is mechanically enforced rather than just documented.

For the platform-contributor's map of how these fit together — and the ADRs behind each
irreversible decision — see [`docs/architecture.md`](../docs/architecture.md) and
[`docs/adr/`](../docs/adr/).
