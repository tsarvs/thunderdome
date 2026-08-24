# Counter Bot (example)

A complete, working Rock-Paper-Scissors bot for
[the bot author guide](../../rps-bot-author-guide.md). Plays whatever beats the opponent's most
recently revealed choice, or `rock` on the first round when there's no history yet.

## Files

| File             | What it is                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `harness.mjs`    | Generic NDJSON protocol plumbing — no Rock-Paper-Scissors knowledge at all. Reusable as-is for a bot for a different game. |
| `strategy.mjs`   | The one Rock-Paper-Scissors-specific function: `decideAction(observation) -> action`.                                      |
| `index.mjs`      | Three-line entrypoint wiring `harness.mjs` and `strategy.mjs` together.                                                    |
| `manifest.json`  | The bot manifest (`docs/guides/rps-bot-author-guide.md` §5).                                                               |
| `Dockerfile`     | Packages the three `.mjs` files into a self-contained image.                                                               |
| `smoke-test.mjs` | Drives a real container through a scripted exchange using `@thunderdome/runtime`, and asserts the bot replies correctly.   |

## Steps

1. **Build the image:**

   ```bash
   cd docs/guides/examples/counter-bot
   docker build -t thunderdome-counter-bot-example .
   ```

2. **Sanity-check it by hand** (optional) — feed it one `init` message directly and confirm it
   replies with `ready`:

   ```bash
   echo '{"protocolVersion":"1.0","type":"init","matchId":"m1","seq":0,"sentAt":"2026-01-01T00:00:00.000Z","payload":{"gameId":"rock-paper-scissors","gameVersion":"1.0.0","participantId":"p1","roster":["p1","p2"],"rngSeed":"abc","config":{}}}' \
     | docker run --rm -i thunderdome-counter-bot-example
   ```

3. **Run the smoke test** — from the repo root (it needs `@thunderdome/runtime`, resolved via the
   monorepo's `node_modules`):

   ```bash
   cd /path/to/thunderdome
   node docs/guides/examples/counter-bot/smoke-test.mjs
   ```

   Expected output:

   ```
   ok - bot completes init/ready handshake
   ok - round 0: plays rock with no history
   ok - round 1: counters opponent's last "paper" with "scissors"
   ok - shuts down cleanly on match-end
   ok - no fault recorded

   All checks passed.
   ```

4. **Adapt it for your own bot** — copy this directory, replace `strategy.mjs`'s `decideAction`
   with your own logic, update `manifest.json`'s `id`/`name`/`author`/`description`, and point
   `smoke-test.mjs`'s `IMAGE_TAG` at your image and its assertions at your strategy's actual
   choices.

## A note on flakiness

Docker's `attach` used to occasionally race container startup and the smoke test would time out
waiting for `ready` even though the bot and image were fine. This was root-caused (a dropped
first write into a freshly attached container's stdin) and fixed by a retry in
`@thunderdome/runtime` (`packages/runtime/src/first-write-retry.ts`) — see
[`scripts/README.md`](../../../../scripts/README.md#a-known-docker-reliability-issue-root-caused-and-fixed)
for the full story. If you still see this, it's worth investigating as a new issue rather than
assuming it's the old one.

## What this doesn't cover

This example only proves your bot speaks the protocol correctly in isolation, against a scripted
opponent view — not a real second bot. This directory is a doc illustration, not itself a
registry entry (it lives under `docs/guides/examples/`, not `bots/`) — see the real bots in
[`/bots/rock-paper-scissors/`](../../../../bots/rock-paper-scissors/) for that. Once your own bot
is submitted there (`docs/guides/rps-bot-author-guide.md` §8), `yarn thunderdome match run
<your-bot-id> <opponent-id>` resolves both through the real bot registry and drives an actual
match via `@thunderdome/engine` and `@thunderdome/runtime` (Phase 6) — or
`yarn thunderdome tournament run <your-bot-id> <opponent-id> [...]` for a real round-robin
tournament among more than two bots (Phase 7). See
[`docs/guides/tournament-author-guide.md`](../../tournament-author-guide.md) for what's still
missing beyond round robin (other formats, persistence).
