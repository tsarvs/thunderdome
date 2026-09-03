# Bots

Competitor-owned code, grouped by game: `bots/<game-id>/<bot-id>/`. Each bot directory is a fully
self-contained unit — any language, its own `Dockerfile`, never imported by the platform, never a
Yarn workspace member (see `docs/adr/0001-monorepo-and-boundary.md`). A submission touches
exactly one `bots/<game-id>/<bot-id>/` directory — mechanically enforced by
`tools/boundary-check`, which also checks that a bot's manifest's `game` field agrees with the
game it's grouped under.

New to Node, Docker, or dev environments in general? Read
[`docs/guides/getting-started.md`](../docs/guides/getting-started.md) first — it explains what
those things actually are before the guides below assume you already know.

To write your own bot, run `yarn scaffold:bot <game-id> <your-bot-id>` for a working starting
point (see the doc comment at the top of
[`scripts/scaffold-bot.mjs`](../scripts/scaffold-bot.mjs) for every flag), then follow
[`docs/guides/bot-author-guide.md`](../docs/guides/bot-author-guide.md) for the full contract,
manifest, Dockerfile, and testing steps — game-agnostic throughout, with a dedicated section for
each game's own specifics (Rock-Paper-Scissors, Hearts, Texas Hold'em).

Two different kinds of bot live under `bots/`, and the distinction matters: **reference bots**
exist to teach the wire protocol and SDK — deliberately simple, sometimes deliberately bad, so
their own code stays easy to read as a starting point. **Competitors** are real, submitted
strategies actually trying to win — read them for strategy ideas, not API plumbing.

## Reference bots

| Bot                                                                             | Game                | Language   | Strategy                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`rock-paper-scissors/random-rps`](rock-paper-scissors/random-rps/)             | Rock Paper Scissors | JavaScript | Uniformly random choice each round, using a PRNG seeded from the match's `rngSeed` — never `Math.random()`.  |
| [`rock-paper-scissors/copycat-rps`](rock-paper-scissors/copycat-rps/)           | Rock Paper Scissors | JavaScript | Plays whatever the opponent played last round; `rock` on round 1.                                            |
| [`rock-paper-scissors/only-rock`](rock-paper-scissors/only-rock/)               | Rock Paper Scissors | TypeScript | Always plays `rock`, no matter what.                                                                         |
| [`rock-paper-scissors/only-paper`](rock-paper-scissors/only-paper/)             | Rock Paper Scissors | TypeScript | Always plays `paper`, no matter what.                                                                        |
| [`rock-paper-scissors/only-scissors`](rock-paper-scissors/only-scissors/)       | Rock Paper Scissors | TypeScript | Always plays `scissors`, no matter what.                                                                     |
| [`connect-four/leftmost-connect-four`](connect-four/leftmost-connect-four/)     | Connect Four        | JavaScript | Always drops into the lowest-indexed column that still has room, ignoring the board entirely.                |
| [`connect-four/random-connect-four`](connect-four/random-connect-four/)        | Connect Four        | JavaScript | Picks a uniformly random legal column each turn, PRNG seeded from the match's `rngSeed`.                     |
| [`card-game-hearts/random-hearts`](card-game-hearts/random-hearts/)            | Hearts              | JavaScript | Uniformly random pass/play every turn, seeded from the match's `rngSeed`.                                    |
| [`card-game-hearts/lowest-card-hearts`](card-game-hearts/lowest-card-hearts/)  | Hearts              | JavaScript | Always plays/passes by raw rank, ignoring the trick, hearts, or scores entirely.                             |
| [`card-game-hearts/point-dodger-hearts`](card-game-hearts/point-dodger-hearts/) | Hearts              | JavaScript | Sheds dangerous cards when passing, leads safe non-point cards, ducks under the trick's current winner when it can, and dumps its most dangerous card when void in the led suit. |
| [`poker-texas-hold-em/random-poker`](poker-texas-hold-em/random-poker/)        | Texas Hold Em       | JavaScript | Uniformly random choice among whatever's currently legal (fold/check/call/raise/allIn), with a uniformly random raise amount, PRNG seeded from the match's `rngSeed`. |
| [`poker-texas-hold-em/calling-station-poker`](poker-texas-hold-em/calling-station-poker/) | Texas Hold Em | JavaScript | Never folds or raises: checks when possible, otherwise calls (capped at its own stack). No randomness at all. |
| [`poker-texas-hold-em/tight-poker`](poker-texas-hold-em/tight-poker/)          | Texas Hold Em       | TypeScript | Bets/raises only with a good hand (a standard tight preflop range, or a made pair-or-better postflop) and never bluffs; calls a bet only when it's no more than the big blind. |

## Competitors

Real strategies, entered to actually win — not written to demonstrate anything about the protocol.

| Bot                                                                           | Game                | Language   | Strategy                                                                                                      |
|-------------------------------------------------------------------------------| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`rock-paper-scissors/tominator-t800`](rock-paper-scissors/tominator-t800/)   | Rock Paper Scissors | TypeScript | Three fixed phases: early-game deck exploration, mid-game exploitation of what it learned, late-game coast-or-reevaluate. |
| [`rock-paper-scissors/tominator-t1000`](rock-paper-scissors/tominator-t1000/) | Rock Paper Scissors | TypeScript | A red-herring/research/exploit/reevaluate/defense state machine that adapts through the match instead of tominator-t800's fixed phases. |
| [`rock-paper-scissors/tominator-tx`](rock-paper-scissors/tominator-tx/)       | Rock Paper Scissors | TypeScript | Defaults to a self-correcting balancing deck; exploits an opponent pattern only past a strict z-score bar, retreating on any real recent lead. |
| [`card-game-hearts/tominator-t1`](card-game-hearts/tominator-t1/)             | Hearts              | TypeScript | Plays the highest card in hand that still loses to the trick's current highest card.                          |
| [`card-game-hearts/tominator-t101`](card-game-hearts/tominator-t101/)          | Hearts              | TypeScript | Tracks played cards and which suits opponents have shown out of to inform play; defaults to defensive point-avoidance but switches to an aggressive shoot-the-moon attempt once a hand-strength signal crosses a threshold while leading. |

Both tables are one roster as far as the platform is concerned — nothing about `match run`,
`tournament run`, or the registry distinguishes a "reference" bot from a "competitor" one; the
split above is purely for a reader trying to figure out which bots to imitate versus which to
actually try to beat.

Each bot is verified against the real Docker runtime by its own `smoke-test.mjs` — build the
image, then `node <bot>/smoke-test.mjs` from the repo root; any bot's own `smoke-test.mjs` is a
working template for the pattern (e.g.
[`rock-paper-scissors/only-rock/smoke-test.mjs`](rock-paper-scissors/only-rock/smoke-test.mjs)).

All eighteen depend on `@thunderdome/bot-sdk`'s `runBot()` for the NDJSON wire-protocol handling
(replying to `init`, reading `observation`, exiting on `match-end`) — each bot's own file is just a
`decideAction()` (and, for `random-rps`/`tominator-t800`/`tominator-t1000`/`tominator-tx`/
`random-connect-four`/`random-hearts`/`random-poker`,
an `onInit` hook to seed its PRNG from the match's `rngSeed`). Since `bots/**` isn't a Yarn
workspace member, that dependency is a vendored tarball rather than a live workspace link: each bot
has its own `package.json`, `package-lock.json`, and `vendor/thunderdome-bot-sdk.tgz`, produced by
[`scripts/pack-bot-sdk.sh`](../scripts/README.md#pack-bot-sdksh). The `only-*` bots, every
`tominator-*` bot, and `tight-poker` additionally show the shape of a TypeScript bot: their own
`tsconfig.json` and a multi-stage `Dockerfile` that compiles TS in a build stage and ships only the
resulting JS plus production `node_modules` — no build tooling ends up in the runtime image.
Every other bot listed above is plain JS with no build step at all — just an `index.mjs` (or
`index.js`) shipped directly into the image.

Want to watch them actually play each other? `yarn thunderdome match run <botId> <botId>
[...moreBotIds]` runs a real match between registry-resolved bots through the real engine and
runtime (building each bot's Docker image on demand) — 2 bot ids for Rock Paper Scissors or
Connect Four, exactly 4 for Hearts, 2-10 for Texas Hold'em. See
[`docs/guides/bot-author-guide.md`](../docs/guides/bot-author-guide.md) §9/§10/§11 for details.
To play against 3 Hearts bots yourself instead of watching, see `yarn thunderdome play` in
[`apps/cli/README.md`](../apps/cli/README.md#play).
