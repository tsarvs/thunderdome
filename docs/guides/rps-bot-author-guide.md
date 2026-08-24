# Rock-Paper-Scissors Bot Author Guide

This guide walks through writing a bot for Thunderdome's Rock-Paper-Scissors game: the wire
protocol your bot must speak, the manifest that describes it, the Docker image it ships in, and
how to test it before submitting it.

**Status check first:** the pieces this guide depends on — the protocol
(`docs/adr/0002-universal-bot-protocol.md`), the Docker runtime
(`docs/adr/0003-docker-bot-isolation.md`), and the Rock-Paper-Scissors game itself
(`games/rock-paper-scissors/`) — are all implemented and tested today. `@thunderdome/bot-sdk` also
exists today, providing both the manifest schema (§5 below uses it directly) and a
developer-facing protocol client (`runBot()`) that TypeScript/JavaScript bots can use instead of
implementing the wire protocol by hand — §4 below covers both paths. The bot registry and a
`match run` CLI command (Phase 6) are also real now — §7 covers running your bot against a real
second one. What's **not** built yet is a whole-tournament CLI (`TournamentFormat` and the
orchestrator are Phase 7 — see `docs/guides/tournament-author-guide.md`). Where this guide
describes something that doesn't exist yet, it says so explicitly rather than pretending
otherwise.

## 1. What a bot is

A bot is a single process, packaged as a Docker image, that:

- speaks a language-neutral JSON protocol over stdin/stdout (no SDK is required — any language
  that can read/write lines of text and parse/emit JSON can be a bot),
- gets a fresh container for every match — no state persists between matches, ever,
- never sees the other participant's source code, the platform's source, or the host filesystem,
- runs under the same resource limits (CPU, memory, timeouts) as every other bot.

None of this is specific to Rock-Paper-Scissors — see `docs/architecture.md` for the full
picture. This guide is the RPS-specific instance of it.

## 2. The Rock-Paper-Scissors contract

### Config

A tournament organizer configures a Rock-Paper-Scissors match with:

```ts
interface RpsConfig {
  totalRounds: number; // total hands played; defaults to 300. NOT "first to a majority" —
  // every configured hand is played, and the tally at the end decides the winner (or a genuine
  // tie, if the tally is exactly even).
  onMissingAction?: 'loseRound' | 'forfeitMatch'; // default: 'forfeitMatch'
}
```

You don't choose this — it's handed to you (opaque, for informational purposes only) in the
`init` message's `payload.config`. `onMissingAction` matters to know about: if it's
`'forfeitMatch'` (the default), failing to respond to a round forfeits the whole match; if it's
`'loseRound'`, you only lose that one round and the match continues. `totalRounds` matters if your
strategy wants to adapt over the course of a match — with a generous default of 300 hands, there's
real room to learn from `history` (see below) and try to get an edge, rather than the match being
decided by an early lucky streak.

### What you receive each round: the observation

```ts
interface RpsObservation {
  round: number;
  totalRounds: number;
  yourWins: number;
  opponentWins: number;
  opponentId: string;
  history: {
    round: number;
    you: 'rock' | 'paper' | 'scissors' | null;
    opponent: 'rock' | 'paper' | 'scissors' | null;
    winner: 'you' | 'opponent' | 'draw';
  }[];
}
```

`history` only ever contains **already-resolved** rounds — you never see the opponent's choice
for the round you're currently being asked to act in (that's the whole point: the game engine
never lets your action depend on information you shouldn't have). A `null` in `you`/`opponent`
means that participant's action was missing that round (a substituted forfeited round).

### What you send: the action

```ts
interface RpsAction {
  choice: 'rock' | 'paper' | 'scissors';
}
```

That's the entire action payload. Nothing else is expected or accepted.

## 3. The wire protocol, concretely

Every message is one JSON object followed by `\n` on stdout (yours) or stdin (the engine's) — see
`docs/adr/0002-universal-bot-protocol.md` for the full envelope spec. Here's the exact sequence
for a 3-hand match (`totalRounds: 3`, well below the real default of 300 — kept short here just
to fit on the page), from your bot's point of view:

**Engine → you**, once, at the start:

```json
{
  "protocolVersion": "1.0",
  "type": "init",
  "matchId": "match-001",
  "seq": 0,
  "sentAt": "2026-01-01T00:00:00.000Z",
  "payload": {
    "gameId": "rock-paper-scissors",
    "gameVersion": "1.0.0",
    "participantId": "your-bot-id",
    "roster": ["your-bot-id", "opponent-id"],
    "rngSeed": "a1b2c3d4...",
    "config": { "totalRounds": 3, "onMissingAction": "forfeitMatch" }
  }
}
```

**You → engine**, immediately after:

```json
{
  "protocolVersion": "1.0",
  "type": "ready",
  "matchId": "match-001",
  "seq": 0,
  "sentAt": "2026-01-01T00:00:00.050Z",
  "payload": { "protocolVersion": "1.0" }
}
```

**Engine → you**, every round (both participants get one of these every round — RPS is
simultaneous, not turn-based):

```json
{
  "protocolVersion": "1.0",
  "type": "observation",
  "matchId": "match-001",
  "roundId": 0,
  "seq": 1,
  "sentAt": "2026-01-01T00:00:00.100Z",
  "payload": {
    "state": {
      "round": 0,
      "totalRounds": 3,
      "yourWins": 0,
      "opponentWins": 0,
      "opponentId": "opponent-id",
      "history": []
    },
    "awaitingAction": true,
    "deadlineAt": "2026-01-01T00:00:05.100Z"
  }
}
```

**You → engine**, before `deadlineAt`:

```json
{
  "protocolVersion": "1.0",
  "type": "action",
  "matchId": "match-001",
  "roundId": 0,
  "seq": 1,
  "sentAt": "2026-01-01T00:00:00.400Z",
  "payload": { "action": { "choice": "rock" } }
}
```

This `observation` → `action` exchange repeats once per round — all `totalRounds` of them, win or
lose; RPS never ends early just because someone's already ahead — until the match ends. Finally:

**Engine → you**, once, at the end:

```json
{
  "protocolVersion": "1.0",
  "type": "match-end",
  "matchId": "match-001",
  "seq": 9,
  "sentAt": "2026-01-01T00:00:12.000Z",
  "payload": {
    "result": {
      "winnerId": "your-bot-id",
      "roundWins": { "your-bot-id": 2, "opponent-id": 1 },
      "totalRounds": 3
    },
    "reason": "completed"
  }
}
```

`winnerId` is `null`, not a bot id, if `roundWins` ends up exactly tied once all `totalRounds`
hands are played — a real, honest outcome of actual gameplay, not a cop-out.

Your process should exit promptly (exit code 0) once it receives `match-end`. If it doesn't, the
runtime will close your stdin, then escalate to `SIGTERM`, then `SIGKILL` — see
`docs/adr/0003-docker-bot-isolation.md`.

**Missing an `awaitingAction` observation entirely is fine** — it means you're being told about
the state of the match but aren't required to reply (this doesn't come up in a 2-player game like
RPS today, but the protocol supports it generally).

## 4. Writing your bot: a complete example

**If you're writing a TypeScript or JavaScript bot, use `@thunderdome/bot-sdk`'s `runBot()`** —
it's the exact protocol plumbing described below, already written, tested, and used by the real
bots in [`bots/rock-paper-scissors/only-rock/src/index.ts`](../../bots/rock-paper-scissors/only-rock/src/index.ts)
(and its siblings `only-paper`, `only-scissors`). With it, your entire bot is just:

```ts
import { runBot } from '@thunderdome/bot-sdk';

function decideAction(observation) {
  return { choice: 'rock' };
}

runBot({ decideAction });
```

Since `bots/**` isn't a Yarn workspace member, a real dependency on `@thunderdome/bot-sdk` means
vendoring a built tarball into your bot's own directory rather than a live workspace link — see
[`scripts/pack-bot-sdk.sh`](../../scripts/pack-bot-sdk.sh) and any of the three bots above for the
`vendor/`, `package.json`, and multi-stage `Dockerfile` pattern this requires.

The rest of this section walks through implementing the same protocol by hand, in plain JS with
zero dependencies — useful if you're writing a bot in a language other than TS/JS, or you just
want to understand what `runBot()` is doing under the hood. It splits cleanly into two pieces:
generic protocol plumbing (framing, the init/ready handshake, match-end shutdown) that has zero
knowledge of Rock-Paper-Scissors, and your actual strategy (one function: given this round's
observation, what's your action?). The working example — "Counter Bot," which plays whatever beats
the opponent's most recently revealed choice, or `rock` on the first round — is at
[`docs/guides/examples/counter-bot/`](examples/counter-bot/); see its own
[README](examples/counter-bot/README.md) for how to run it. The generic half:

```js
// harness.mjs — copy this file as-is for a bot for a different game; nothing here is
// Rock-Paper-Scissors-specific.
import { createInterface } from 'node:readline';

export function runBot({ decideAction }) {
  let seq = 0;
  function send(matchId, type, fields) {
    process.stdout.write(
      `${JSON.stringify({
        protocolVersion: '1.0',
        type,
        matchId,
        seq: seq++,
        sentAt: new Date().toISOString(),
        ...fields,
      })}\n`,
    );
  }

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    switch (message.type) {
      case 'init':
        send(message.matchId, 'ready', { payload: { protocolVersion: '1.0' } });
        break;
      case 'observation':
        if (!message.payload.awaitingAction) break;
        send(message.matchId, 'action', {
          roundId: message.roundId,
          payload: { action: decideAction(message.payload.state) },
        });
        break;
      case 'match-end':
        process.exit(0);
    }
  });
}
```

And the Rock-Paper-Scissors-specific half — the only file you'd actually need to write if you
copied the harness above as your starting point:

```js
// strategy.mjs
const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

export function decideAction(observation) {
  const lastRound = observation.history.at(-1);
  return { choice: lastRound ? BEATS[lastRound.opponent] : 'rock' };
}
```

A few things worth noticing:

- **No dependencies, no build step.** `node:readline` and `JSON` are all you need. Nothing stops
  you from writing this in TypeScript, Python, Go, or anything else that can read stdin
  line-by-line — the protocol doesn't care.
- **The harness never inspects your action's contents.** It hands `decideAction`'s return value
  straight into `payload.action` — that's what makes it reusable across games: only the strategy
  function needs to know what an RPS action (or a chess move, or anything else) looks like.
- **`seq` must strictly increase** on every message you send. The engine rejects duplicate or
  out-of-order `seq` values as a protocol violation.
- **`roundId` in your `action` must match the `roundId` of the observation you're replying to.**
  The engine correlates them explicitly; it doesn't assume you reply in order.
- **`stdout` is protocol-only.** If you want to log for your own debugging, write to `stderr` —
  anything on `stdout` that isn't a valid protocol message is a protocol violation and forfeits
  the match.
- This bot never uses its `rngSeed` (from the `init` payload) because its strategy is fully
  deterministic. If you want your bot's _own_ strategy to use reproducible randomness, seed your
  language's PRNG with it — see `docs/adr/0004-deterministic-randomness.md` for why you never
  need to match another language's PRNG bit-for-bit to get reproducibility.

## 5. The manifest

Every bot needs a `manifest.json` describing it (validated by `@thunderdome/bot-sdk`'s
`BotManifestSchema` — see `packages/bot-sdk/src/manifest.ts` for the authoritative schema):

```json
{
  "id": "counter-bot",
  "name": "Counter Bot",
  "version": "1.0.0",
  "game": "rock-paper-scissors",
  "author": { "name": "Your Name", "contact": "you@example.com" },
  "runtime": { "language": "node" },
  "interface": { "transport": "stdio" },
  "protocolVersion": "^1.0",
  "description": "Plays whatever beats the opponent's most recently revealed choice."
}
```

Notes:

- `id` must be kebab-case and must match the bot's directory name once it's submitted.
- `game` must match an existing game's id (`rock-paper-scissors`).
- `interface.transport` must be `"stdio"` — that's the only transport the protocol supports today.
- `resources` is optional and, if present, is a _request_, not an authority — the runtime clamps
  to platform-enforced hard caps regardless of what you ask for.

## 6. The Dockerfile

Your bot must be a fully self-contained Docker image — no bind mounts, no network access, and no
assumption that anything from the monorepo is available inside the container:

```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY harness.mjs strategy.mjs index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
```

You don't need to configure resource limits, a non-root user, or `--network none` yourself —
those are enforced by the runtime at container-create time regardless of what your image or
Dockerfile says (`docs/adr/0003-docker-bot-isolation.md`). Your job is just to make sure your bot
actually works under those constraints (small memory footprint, no network calls, no writes
outside `/tmp`).

## 7. Testing your bot locally

Two levels, from narrowest to broadest:

**In isolation, against a scripted opponent view.** You can exercise your bot's container
directly with the same runtime primitives the platform itself uses (`@thunderdome/runtime`'s
`DockerBotProcess` and `BotLifecycle`) — see
[`examples/counter-bot/README.md`](examples/counter-bot/README.md) for the exact steps.
`smoke-test.mjs` builds on those same primitives to drive a real container through an
`init`/`ready` handshake and two scripted rounds, and asserts the bot replies exactly as
expected — the same mechanics (timeouts, forfeit reasons, graceful shutdown) a real tournament
will use. It's a good template for testing your own bot: swap in your image tag and whatever
observation sequence exercises your strategy.

**Against a real second bot, end to end.** `yarn thunderdome match run <botId> <botId>` (Phase 6)
resolves both bot ids and their shared game through the real bot/game registry
(`@thunderdome/registry`), builds each bot's Docker image on demand from its own manifest — no
manual `docker build` step first — and drives a real match through the generic engine
(`@thunderdome/engine`'s `runMatch()`) and runtime, printing round results and final standings:

```bash
yarn thunderdome match run only-rock only-paper --config '{"totalRounds":300}'
```

`--config` is whatever JSON that game's `parseConfig` expects — for Rock-Paper-Scissors, that's
`totalRounds` (defaults to 300 if omitted) and `onMissingAction` (see §2 and
`games/rock-paper-scissors/src/types.ts`'s `RpsConfigSchema`). Any bot in
`bots/rock-paper-scissors/` is playable this way, by its manifest `id` — including your own, once
it's merged (see §8).

**Against yourself, by hand.** `yarn thunderdome play <botId>` puts you in the ring instead of a
second bot — the same registry resolution and real Docker match, but each round's prompt prints
right here in the terminal and whatever you type becomes your move:

```bash
yarn thunderdome play only-rock --game-config '{"totalRounds":10}'
```

Handy for eyeballing whether a bot's behavior actually matches what you intended, round by round,
rather than only ever reading it off a final tally. Type "quit" any time to stop early. See
[`apps/cli/README.md`](../../apps/cli/README.md#play) for the full details.

## 8. Submitting your bot

Open a PR that touches only `bots/rock-paper-scissors/<your-bot-id>/` — mechanically enforced by
`tools/boundary-check` (`docs/adr/0007-repository-enforcement.md`; bots are grouped under
`bots/<game-id>/`, so a Rock-Paper-Scissors bot's directory is `bots/rock-paper-scissors/<id>/`).
There's no separate registration step: the bot registry (Phase 6, `@thunderdome/registry`) is a
pure filesystem scan of `manifest.json` files, so the moment your PR merges, your bot is
discoverable and playable via `yarn thunderdome match run <your-bot-id> <opponent-id>` — no index
to update, nothing else to run.
