# Bots

Competitor-owned code, grouped by game: `bots/<game-id>/<bot-id>/`. Each bot directory is a fully
self-contained unit — any language, its own `Dockerfile`, never imported by the platform, never a
Yarn workspace member (see `docs/adr/0001-monorepo-and-boundary.md`). A submission touches
exactly one `bots/<game-id>/<bot-id>/` directory — mechanically enforced by
`tools/boundary-check`, which also checks that a bot's manifest's `game` field agrees with the
game it's grouped under.

To write your own, start with [`docs/guides/rps-bot-author-guide.md`](../docs/guides/rps-bot-author-guide.md).

## Reference bots

| Bot                                                                       | Game                | Language   | Strategy                                                                                                    |
|---------------------------------------------------------------------------|---------------------|------------|-------------------------------------------------------------------------------------------------------------|
| [`rock-paper-scissors/random-rps`](rock-paper-scissors/random-rps/)       | Rock Paper Scissors | JavaScript | Uniformly random choice each round, using a PRNG seeded from the match's `rngSeed` — never `Math.random()`. |
| [`rock-paper-scissors/copycat-rps`](rock-paper-scissors/copycat-rps/)     | Rock Paper Scissors | JavaScript | Plays whatever the opponent played last round; `rock` on round 1.                                           |
| [`rock-paper-scissors/only-rock`](rock-paper-scissors/only-rock/)         | Rock Paper Scissors | TypeScript | Always plays `rock`, no matter what.                                                                        |
| [`rock-paper-scissors/only-paper`](rock-paper-scissors/only-paper/)       | Rock Paper Scissors | TypeScript | Always plays `paper`, no matter what.                                                                       |
| [`rock-paper-scissors/only-scissors`](rock-paper-scissors/only-scissors/) | Rock Paper Scissors | TypeScript | Always plays `scissors`, no matter what.                                                                    |
| [`rock-paper-scissors/t800`](rock-paper-scissors/t800/)                   | Rock Paper Scissors | TypeScript | Three fixed phases: early-game deck exploration, mid-game exploitation of what it learned, late-game coast-or-reevaluate. |
| [`rock-paper-scissors/t1000`](rock-paper-scissors/t1000/)                 | Rock Paper Scissors | TypeScript | A red-herring/research/exploit/reevaluate/defense state machine that adapts through the match instead of t800's fixed phases. |
| [`rock-paper-scissors/tx`](rock-paper-scissors/tx/)                       | Rock Paper Scissors | TypeScript | Defaults to a self-correcting balancing deck; exploits an opponent pattern only past a strict z-score bar, retreating on any real recent lead. |

Each is verified against the real Docker runtime by its own `smoke-test.mjs` — see
[`docs/guides/examples/counter-bot/README.md`](../docs/guides/examples/counter-bot/README.md) for
the pattern they follow (build the image, then `node <bot>/smoke-test.mjs` from the repo root).

All eight depend on `@thunderdome/bot-sdk`'s `runBot()` for the NDJSON wire-protocol handling
(replying to `init`, reading `observation`, exiting on `match-end`) — each bot's own file is just
a `decideAction()` (and, for `random-rps`/`t800`/`t1000`/`tx`, an `onInit` hook to seed its PRNG
from the match's `rngSeed`). Since `bots/**` isn't a Yarn workspace member, that dependency is a
vendored tarball rather than a live workspace link: each bot has its own `package.json`,
`package-lock.json`, and `vendor/thunderdome-bot-sdk.tgz`, produced by
[`scripts/pack-bot-sdk.sh`](../scripts/README.md#pack-bot-sdksh). The `only-*` bots, `t800`,
`t1000`, and `tx` additionally show the shape of a TypeScript bot: their own `tsconfig.json` and a
multi-stage
`Dockerfile` that compiles TS in a build stage and ships only the resulting JS plus production
`node_modules` — no build tooling ends up in the runtime image.

Want to watch them actually play each other? `yarn thunderdome match run <botId> <botId>` runs a
real match between two registry-resolved bots through the real engine and runtime (building each
bot's Docker image on demand) — see
[`docs/guides/rps-bot-author-guide.md`](../docs/guides/rps-bot-author-guide.md) for details.
