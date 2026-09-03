# Bot Author Guide

This guide walks through writing a bot for any of Thunderdome's games: the wire protocol your bot
must speak, the manifest that describes it, the Docker image it ships in, and how to test it
before submitting it. The process is identical no matter which game you're targeting — §1 through
§8 are the same for every game on the platform. The handful of things that genuinely differ by
game (the exact shape of what you receive and what you send back) live in their own section at the
end: [§9 Rock-Paper-Scissors specifics](#9-rock-paper-scissors-specifics),
[§10 Hearts specifics](#10-hearts-specifics), and
[§11 Texas Hold'em specifics](#11-texas-holdem-specifics). Building a bot for a game without its
own section here (Connect Four, or one you're authoring yourself)? That game's own `src/types.ts`
plus [`protocol-reference.md`](protocol-reference.md) document the same three things (config,
observation, action) a dedicated section would.

**Status check first:** the protocol (`docs/adr/0002-universal-bot-protocol.md`), the Docker
runtime (`docs/adr/0003-docker-bot-isolation.md`), and `@thunderdome/bot-sdk-js` (both the manifest
schema and the developer-facing `runBot()` protocol client) are all implemented and tested today,
and identical regardless of which game you're writing for. So is the bot registry and the
`match run`/`play`/`tournament run` CLI — see
[`tournament-author-guide.md`](tournament-author-guide.md) for round robin, single elimination,
and Swiss league. Four games have real, playable bots today: Rock-Paper-Scissors (2 players,
simultaneous, fully observable), Connect Four (2 players, sequential, fully observable — no
dedicated bot-author section yet, see above), Hearts (4 players, hidden information, two action
shapes), and Texas Hold'em (2-10 players, hidden information, no-limit betting). Where this guide
describes something that doesn't exist yet, it says so explicitly rather than pretending
otherwise.

**New to Node, Docker, or dev environments in general?**
[`getting-started.md`](getting-started.md) explains those from first principles before this guide
assumes you already have them working.

## Quickstart checklist

1. Run `yarn scaffold:bot <game-id> <your-bot-id>` for a working starting point (already using
   `@thunderdome/bot-sdk-js`'s `runBot()`, §4) rather than writing the protocol plumbing by hand.
   `scaffold:bot` only generates TS/JS bots today — a Python bot starts from `thunderdome_bot_sdk`
   (§4) instead, e.g. `bots/connect-four/tactical-connect-four/` as a working example to copy.
2. Replace the scaffolded `decideAction()` with your actual strategy — §2 explains what you always
   receive and return conceptually; §9/§10/§11 give the exact types for Rock-Paper-Scissors/
   Hearts/Texas Hold'em.
3. Fill in `manifest.json` (§5) and make sure your `Dockerfile` builds a self-contained image (§6).
4. Test it — first via a scripted smoke test against your own container (§7,
   [`testing-guide.md`](testing-guide.md) if "integration test" is a new term to you), then for
   real: `yarn thunderdome match run <your-bot-id> <opponent-id(s)>` (§9/§10/§11 give the exact
   number of opponents your game needs).
5. Open a PR touching only `bots/<game-id>/<your-bot-id>/` (§8).

The rest of this guide is the detailed reference for each of those steps.

## 1. What a bot is

A bot is a single process, packaged as a Docker image, that:

- speaks a language-neutral JSON protocol over stdin/stdout (no SDK is required — any language
  that can read/write lines of text and parse/emit JSON can be a bot),
- gets a fresh container for every match — no state persists between matches, ever,
- never sees the other participants' source code, the platform's source, or the host filesystem,
- runs under the same resource limits (CPU, memory, timeouts) as every other bot.

None of this is specific to any one game — see `docs/architecture.md` for the full picture. This
holds identically for Rock-Paper-Scissors, Connect Four, Hearts, or any future game.

## 2. The bot contract, in general

Every game hands your bot exactly three things, all funneled through the same message envelope
(§3):

- **Config** — handed to you once, in the `init` message's `payload.config`. Entirely defined by
  the game and opaque to your bot: you never choose it, you just read it (things like how many
  rounds to play, or what happens if you miss one). Whatever it contains, it never changes for the
  rest of the match.
- **Observation** — handed to you in an `observation` message whenever the game needs (or allows)
  you to act. Its shape is entirely up to the game — a flat round history
  (Rock-Paper-Scissors), or a private hand plus a partially-visible trick (Hearts) — but the
  envelope around it (`awaitingAction`, `deadlineAt`) is identical no matter the game.
- **Action** — what you send back in an `action` message, replying to an observation. Its shape
  must exactly match what that game's own `validateAction` expects; a malformed or game-illegal
  action is rejected the same way a missing one is.

None of this is boilerplate you need to reimplement per game — `@thunderdome/bot-sdk-js`'s
`runBot()` (§4) already handles the entire receive-observation/send-action loop for you. The only
genuinely game-specific work you'll ever do is writing a `decideAction()` function against that
one game's config/observation/action shapes — see §9 (Rock-Paper-Scissors) or §10 (Hearts) for
those, concretely.

## 3. The wire protocol: the envelope

Every message, in both directions, is one JSON object followed by `\n`, sharing this shape
(`docs/adr/0002-universal-bot-protocol.md` has the full spec;
[`protocol-reference.md`](protocol-reference.md) is the exhaustive, message-by-message version of
what follows):

```ts
interface Envelope<TPayload = unknown> {
  protocolVersion: string; // "1.0" today
  type:
    | 'init'
    | 'observation'
    | 'action'
    | 'match-end'
    | /* a few more, rarely needed — see protocol-reference.md */ string;
  matchId: string;
  roundId?: number; // present on round-scoped messages only
  seq: number; // per-direction monotonic counter, starting at 0
  sentAt: string; // ISO-8601, diagnostic only — never consulted for game logic
  payload: TPayload; // shape depends on `type`; game-specific fields live inside here
}
```

The lifecycle every match follows, regardless of game:

```
engine: init                          ──▶  bot
bot:    ready                         ──▶  engine
                (repeat once per round the game asks you to act in)
engine: observation (awaitingAction?) ──▶  bot
bot:    action                        ──▶  engine   (only when awaitingAction: true)
                (until the game ends)
engine: match-end                     ──▶  bot
```

A few rules apply no matter which game you're playing:

- **`seq` must strictly increase** on every message you send. The engine rejects a duplicate or
  out-of-order `seq` as a protocol violation.
- **`roundId` in your `action` must match the `roundId` of the observation you're replying to.**
  The engine correlates them explicitly; it doesn't assume you reply in the order observations
  arrived.
- **`stdout` is protocol-only.** If you want to log for your own debugging, write to `stderr` —
  anything on `stdout` that isn't a valid protocol message is a protocol violation and forfeits
  the match.
- **Missing an observation with `awaitingAction: false` is fine** — it means you're being told
  about the state of the match but aren't required to reply. (This doesn't come up in a
  simultaneous 2-player game like Rock-Paper-Scissors, but the protocol supports it generally —
  it's exactly what a sequential game's non-active participant experiences every round it isn't
  their turn.)
- **Exit promptly (exit code 0) once you receive `match-end`.** If you don't, the runtime closes
  your stdin, then escalates to `SIGTERM`, then `SIGKILL` (`docs/adr/0003-docker-bot-isolation.md`).

§9, §10, and §11 show the full, concrete message-by-message trace for a real Rock-Paper-Scissors
match, a real Hearts hand, and a real Texas Hold'em hand respectively — the shapes above, with
real numbers filled in.

## 4. Writing your bot: a complete example

**If you're writing a TypeScript or JavaScript bot, use `@thunderdome/bot-sdk-js`'s `runBot()`** —
it's the exact protocol plumbing this section walks through by hand, already written, tested, and
used by every real bot on the platform. With it, your entire bot is just:

```ts
import { runBot } from '@thunderdome/bot-sdk-js';

function decideAction(observation) {
  return { choice: 'rock' }; // whatever your game's Action shape is — see §9/§10/§11
}

runBot({ decideAction });
```

Since `bots/**` isn't a Yarn workspace member, a real dependency on `@thunderdome/bot-sdk-js` means
vendoring a built tarball into your bot's own directory rather than a live workspace link — see
[`scripts/pack-bot-sdk-js.sh`](../../scripts/pack-bot-sdk-js.sh), or any real bot under `bots/`, for the
`vendor/`, `package.json`, and Dockerfile pattern this requires (§6 shows the Dockerfile side).

**If you're writing a Python bot, use `thunderdome_bot_sdk`'s `run_bot()`** — the same protocol
plumbing, translated idiomatically rather than a hand-rolled reimplementation:

```python
from thunderdome_bot_sdk import run_bot

def decide_action(observation):
    return {"choice": "rock"}  # whatever your game's Action shape is — see §9/§10/§11

run_bot(decide_action)
```

`thunderdome_bot_sdk.py` lives at [`packages/bot-sdk-python`](../../packages/bot-sdk-python) —
read its own `README.md` for the full API (including the `on_init` hook for seeding your own PRNG
from `rngSeed`). Same vendoring story as `@thunderdome/bot-sdk-js`, but simpler: there's no build
step or package format, so vendoring is a straight file copy —
[`scripts/vendor-python-bot-sdk.sh`](../../scripts/vendor-python-bot-sdk.sh) does it, or see
`bots/connect-four/tactical-connect-four/` for the pattern end to end.

The rest of this section walks through implementing the same protocol by hand, in plain JS with
zero dependencies — useful if you're writing a bot in a language with no SDK of its own yet (i.e.
anything other than TS/JS or Python), or you just want to understand what `runBot()`/`run_bot()`
is doing under the hood. It splits cleanly into two pieces:
generic protocol plumbing (framing, the init/ready handshake, match-end shutdown) that has zero
knowledge of any particular game, and your actual strategy (one function: given this round's
observation, what's your action?). The worked example below plays whatever beats the opponent's
most recently revealed choice, or `rock` on the first round. The generic half:

```js
// harness.mjs — copy this file as-is for a bot for a different game; nothing here is
// specific to any one game.
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
copied the harness above as your starting point for that game:

```js
// strategy.mjs
const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

export function decideAction(observation) {
  const lastRound = observation.history.at(-1);
  return { choice: lastRound ? BEATS[lastRound.opponent] : 'rock' };
}
```

A few things worth noticing, all still true no matter which game you're targeting:

- **No dependencies, no build step.** `node:readline` and `JSON` are all you need. Nothing stops
  you from writing this in TypeScript, Python, Go, or anything else that can read stdin
  line-by-line — the protocol doesn't care.
- **The harness never inspects your action's contents.** It hands `decideAction`'s return value
  straight into `payload.action` — that's what makes it reusable across games: only the strategy
  function needs to know what one particular game's action (or a different game's action) looks
  like.
- This bot never uses its `rngSeed` (from the `init` payload) because its strategy is fully
  deterministic. If you want your bot's _own_ strategy to use reproducible randomness, seed your
  language's PRNG with it — see `docs/adr/0004-deterministic-randomness.md` for why you never
  need to match another language's PRNG bit-for-bit to get reproducibility.

## 5. The manifest

Every bot needs a `manifest.json` describing it (validated by `@thunderdome/bot-sdk-js`'s
`BotManifestSchema` — see `packages/bot-sdk-js/src/manifest.ts` for the authoritative schema):

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

Notes, true for any game:

- `id` must be kebab-case and must match the bot's directory name once it's submitted.
- `game` must match an existing game's id — today, one of `rock-paper-scissors`, `connect-four`,
  `card-game-hearts`, or `poker-texas-hold-em`.
- `interface.transport` must be `"stdio"` — that's the only transport the protocol supports today.
- `resources` is optional and, if present, is a _request_, not an authority — the runtime clamps
  to platform-enforced hard caps regardless of what you ask for.

`yarn scaffold:bot <game-id> <your-bot-id>` generates this (and the rest of the directory) for
you — see [`scripts/README.md`](../../scripts/README.md#scaffold-botmjs).

## 6. The Dockerfile

Your bot must be a fully self-contained Docker image — no bind mounts, no network access, and no
assumption that anything from the monorepo is available inside the container. You don't need to
configure resource limits, a non-root user, or `--network none` yourself — those are enforced by
the runtime at container-create time regardless of what your image or Dockerfile says
(`docs/adr/0003-docker-bot-isolation.md`). Your job is just to make sure your bot actually works
under those constraints (small memory footprint, no network calls, no writes outside `/tmp`).

Three real shapes exist on the platform today, depending on your bot:

**Zero-dependency, hand-rolled protocol (§4's worked example):**

```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY harness.mjs strategy.mjs index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
```

**Plain JavaScript using `@thunderdome/bot-sdk-js`'s `runBot()`** (most real reference bots use this
shape — e.g. `bots/card-game-hearts/lowest-card-hearts/Dockerfile`):

```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
```

**TypeScript, compiled in a build stage** (e.g. `bots/rock-paper-scissors/only-rock/Dockerfile`) —
a multi-stage build so the final image ships only the compiled JS plus production
`node_modules`, never `typescript`/`@types/node` or your own `src/`:

```dockerfile
FROM node:25-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY vendor ./vendor
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:25-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev

FROM node:25-alpine
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
```

`yarn scaffold:bot <game-id> <your-bot-id> --lang ts` generates the TypeScript form; the default
(no `--lang`, or `--lang js`) generates the plain-JS form. Either way, run
`./scripts/pack-bot-sdk-js.sh` afterward to populate `vendor/` and generate `package-lock.json`.

## 7. Testing your bot locally

Three levels, from narrowest to broadest — identical regardless of game, apart from how many
opponent bot ids a real match needs (§9/§10/§11 give the exact number and real bot ids to use).

**In isolation, against a scripted observation sequence.** Exercise your bot's container directly
with the same runtime primitives the platform itself uses (`@thunderdome/runtime`'s
`DockerBotProcess`/`BotLifecycle`) — see
[`bots/card-game-hearts/point-dodger-hearts/smoke-test.mjs`](../../bots/card-game-hearts/point-dodger-hearts/smoke-test.mjs)
for a worked example that scripts several distinct observations (leading, ducking, voiding,
forced-to-win) and asserts the exact action back, or
[`bots/poker-texas-hold-em/random-poker/smoke-test.mjs`](../../bots/poker-texas-hold-em/random-poker/smoke-test.mjs)
for one that also checks the bot's own randomness is deterministic given the same `rngSeed`. Good
template for your own bot regardless of game: swap in your image tag and whatever observation
sequence exercises your strategy's branches. [`testing-guide.md`](testing-guide.md) explains what
"integration test" means generally, if this is new to you.

**Against real opponents, end to end.** `yarn thunderdome match run <botId> <botId>
[...moreBotIds]` resolves every bot id and the game they share through the real bot/game registry
(`@thunderdome/registry`), builds each bot's Docker image on demand from its own manifest — no
manual `docker build` step first — and drives a real match through the generic engine
(`@thunderdome/engine`'s `runMatch()`) and runtime, printing round results and final standings.
How many bot ids you need depends entirely on the game (2 for Rock-Paper-Scissors or Connect Four,
exactly 4 for Hearts, 2-10 for Texas Hold'em) — §9/§10/§11 give concrete commands.

**Against yourself, by hand.** `yarn thunderdome play <botId> [...moreBotIds]` puts you in the
ring instead of one of the bots — same registry resolution and real Docker match, but each
round's prompt prints right here in the terminal and whatever you type becomes your move. Handy
for eyeballing whether a bot's behavior actually matches what you intended, round by round, rather
than only ever reading it off a final tally. Type `quit` any time to stop early. See
[`apps/cli/README.md`](../../apps/cli/README.md#play) for the full details.

## 8. Submitting your bot

Open a PR that touches only `bots/<game-id>/<your-bot-id>/` — mechanically enforced by
`ci/tools/boundary-check` (`docs/adr/0007-repository-enforcement.md`), which also checks that your
manifest's `game` field agrees with the game you're grouped under. There's no separate
registration step: the bot registry (`@thunderdome/registry`) is a pure filesystem scan of
`manifest.json` files, so the moment your PR merges, your bot is discoverable and playable via
`yarn thunderdome match run <your-bot-id> <opponent-id(s)>` — no index to update, nothing else to
run.

---

## 9. Rock-Paper-Scissors specifics

### The contract

**Config** — handed to you (opaque, informational) in the `init` message's `payload.config`:

```ts
interface RpsConfig {
  totalRounds: number; // total hands played; defaults to 300. NOT "first to a majority" —
  // every configured hand is played, and the tally at the end decides the winner (or a genuine
  // tie, if the tally is exactly even).
  onMissingAction?: 'loseRound' | 'forfeitMatch'; // default: 'forfeitMatch'
}
```

`onMissingAction` matters to know about: if it's `'forfeitMatch'` (the default), failing to
respond to a round forfeits the whole match; if it's `'loseRound'`, you only lose that one round
and the match continues. `totalRounds` matters if your strategy wants to adapt over the course of
a match — with a generous default of 300 hands, there's real room to learn from `history` (below)
and try to get an edge, rather than the match being decided by an early lucky streak.

**Observation** — what you receive each round:

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
for the round you're currently being asked to act in. A `null` in `you`/`opponent` means that
participant's action was missing that round (a substituted forfeited round).

**Action** — what you send:

```ts
interface RpsAction {
  choice: 'rock' | 'paper' | 'scissors';
}
```

That's the entire action payload. Nothing else is expected or accepted.

### The wire protocol, concretely

Here's the exact sequence for a 3-hand match (`totalRounds: 3`, well below the real default of
300 — kept short here just to fit on the page), from your bot's point of view — the concrete
version of §3's generic envelope:

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

### Reference bots

`bots/rock-paper-scissors/only-rock/src/index.ts` (and its siblings `only-paper`,
`only-scissors`) are the simplest real, `runBot()`-based bots to read; see
[`bots/README.md`](../../bots/README.md) for the full roster, from trivial reference bots through
`tominator-t800`/`tominator-t1000`/`tominator-tx`'s real adaptive strategies.

### Testing it for real

```bash
yarn thunderdome match run only-rock only-paper --config '{"totalRounds":300}'
```

`--config` is whatever JSON `parseConfig` expects — `totalRounds` (defaults to 300) and
`onMissingAction` (see above and `games/rock-paper-scissors/src/types.ts`'s `RpsConfigSchema`).
Any bot in `bots/rock-paper-scissors/` is playable this way, by its manifest `id` — including
your own, once it's merged.

```bash
yarn thunderdome play only-rock --game-config '{"totalRounds":10}'
```

puts you in the ring against `only-rock` instead — see [`apps/cli/README.md`](../../apps/cli/README.md#play)
for the full details.

## 10. Hearts specifics

### What makes Hearts different

Hearts is **4 players, hidden information, two action shapes**, not Rock-Paper-Scissors' 2-player,
fully-observable, single-action-shape game:

- You only ever see your own hand — other players' cards are hidden. You're told how many cards
  everyone holds (`handSizes`), never what they are.
- Every hand alternates between two phases: **passing** (all 4 players simultaneously pass 3
  cards) and **playing** (players take turns playing one card at a time, trick by trick). Your
  bot's `decideAction()` must handle both — check `observation.phase` and return the matching
  action shape.
- A match is many hands, not a fixed round count — it ends once someone's cumulative score
  crosses `config.pointLimit` (lowest score wins).

Everything else — the NDJSON wire framing, the init/ready handshake, `stdout` being
protocol-only, `seq` strictly increasing, using `@thunderdome/bot-sdk-js`'s `runBot()` — is identical
to every other game on the platform (§1-§8 above).

### The contract

**Config**:

```ts
interface HeartsConfig {
  pointLimit: number; // match ends once any player's cumulative score reaches this; default 100
}
```

Handed to you (opaque, informational) in `init`'s `payload.config`. Lower is better in Hearts —
`pointLimit` is the _ceiling_ a score has to cross to end the match, not a target to race toward.

**Cards, on the wire** — a plain object, never a compact string like `"QS"`:

```ts
interface Card {
  suit: 'clubs' | 'diamonds' | 'hearts' | 'spades';
  rank: number; // 2..10, then 11=J, 12=Q, 13=K, 14=A
}
```

(The compact `"QS"`/`"TH"` string form only exists in `thunderdome play`'s terminal text UI for a
_human_ typing commands. A bot's `Card` objects on the wire are never strings.)

**Observation** — what you receive:

```ts
interface HeartsObservation {
  you: string; // your own participant id
  participantIds: [string, string, string, string]; // fixed clockwise turn order
  phase: 'passing' | 'playing';
  handNumber: number; // 0-based
  passDirection: 'left' | 'right' | 'across' | 'hold'; // this hand's pass direction
  hand: Card[]; // YOUR full hand — nobody else's cards ever appear anywhere in this payload
  handSizes: Record<string, number>; // every participant's hand SIZE (incl. yours) — never contents
  heartsBroken: boolean;
  tricksCompleted: number; // 0..13 within the current hand
  isFirstTrick: boolean;
  currentTrick: { leaderId: string; plays: { participantId: string; card: Card }[] } | null; // null while passing
  handPoints: Record<string, number>; // penalty points taken so far THIS hand — resets every hand
  scores: Record<string, number>; // cumulative match scores so far — lower is better
  pointLimit: number;
  legalPlays?: Card[]; // present ONLY when phase === 'playing' and it's your turn
  youMustAct: boolean;
}
```

`legalPlays` is a convenience, not a requirement to use it — `validateAction`/`resolve` enforce
the real rules (follow suit if able; can't lead hearts until broken, unless your whole hand is
hearts; no hearts/Q♠ on the first trick unless forced; the 2♣ holder must open hand 1's first
trick) regardless of what your bot submits. But since it's handed to you already computed, a bot
that just picks from `legalPlays` never needs to reimplement any of those rules itself.

**Action** — a discriminated union; which one is valid depends entirely on `observation.phase`:

```ts
type HeartsAction =
  | { type: 'pass'; cards: [Card, Card, Card] } // only during phase === 'passing'
  | { type: 'play'; card: Card }; // only during phase === 'playing'
```

Submitting the wrong `type` for the current phase, a card you don't hold, or a card outside
`legalPlays` all get rejected the same way any illegal action does.

### The wire protocol: what's different

Here's what's specific to Hearts, on top of §3's generic envelope: one **passing** round, then one
**playing** round, from your bot's point of view (`roster` is your 4-participant table, in
clockwise turn order).

**Engine → you**, a passing round — every participant gets one of these simultaneously:

```json
{
  "type": "observation",
  "matchId": "match-001",
  "roundId": 0,
  "payload": {
    "state": {
      "you": "your-bot-id",
      "participantIds": ["your-bot-id", "p2", "p3", "p4"],
      "phase": "passing",
      "handNumber": 0,
      "passDirection": "left",
      "hand": [
        { "suit": "clubs", "rank": 2 },
        { "suit": "hearts", "rank": 5 },
        { "suit": "spades", "rank": 12 }
      ],
      "handSizes": { "your-bot-id": 13, "p2": 13, "p3": 13, "p4": 13 },
      "heartsBroken": false,
      "tricksCompleted": 0,
      "isFirstTrick": true,
      "currentTrick": null,
      "handPoints": { "your-bot-id": 0, "p2": 0, "p3": 0, "p4": 0 },
      "scores": { "your-bot-id": 0, "p2": 0, "p3": 0, "p4": 0 },
      "pointLimit": 100,
      "youMustAct": true
    },
    "awaitingAction": true,
    "deadlineAt": "2026-01-01T00:00:05.000Z"
  }
}
```

**You → engine**:

```json
{
  "type": "action",
  "matchId": "match-001",
  "roundId": 0,
  "payload": {
    "action": {
      "type": "pass",
      "cards": [
        { "suit": "clubs", "rank": 2 },
        { "suit": "hearts", "rank": 5 },
        { "suit": "spades", "rank": 12 }
      ]
    }
  }
}
```

**Engine → you**, later, a playing round — only whoever's turn it is gets an observation this
round (the other 3 don't hear anything until it's their turn):

```json
{
  "type": "observation",
  "matchId": "match-001",
  "roundId": 14,
  "payload": {
    "state": {
      "you": "your-bot-id",
      "participantIds": ["your-bot-id", "p2", "p3", "p4"],
      "phase": "playing",
      "handNumber": 0,
      "passDirection": "left",
      "hand": [
        { "suit": "clubs", "rank": 9 },
        { "suit": "diamonds", "rank": 4 }
      ],
      "handSizes": { "your-bot-id": 2, "p2": 3, "p3": 3, "p4": 3 },
      "heartsBroken": true,
      "tricksCompleted": 11,
      "isFirstTrick": false,
      "currentTrick": {
        "leaderId": "p2",
        "plays": [{ "participantId": "p2", "card": { "suit": "clubs", "rank": 3 } }]
      },
      "handPoints": { "your-bot-id": 1, "p2": 3, "p3": 0, "p4": 2 },
      "scores": { "your-bot-id": 4, "p2": 12, "p3": 6, "p4": 9 },
      "pointLimit": 100,
      "legalPlays": [{ "suit": "clubs", "rank": 9 }],
      "youMustAct": true
    },
    "awaitingAction": true,
    "deadlineAt": "2026-01-01T00:00:05.000Z"
  }
}
```

**You → engine**:

```json
{
  "type": "action",
  "matchId": "match-001",
  "roundId": 14,
  "payload": { "action": { "type": "play", "card": { "suit": "clubs", "rank": 9 } } }
}
```

This repeats for every passing round and every card played, across as many hands as it takes for
someone's `scores` to cross `pointLimit`, then ends with `match-end` exactly like every other
game. A missing/invalid/timed-out action doesn't forfeit the whole match here — Hearts substitutes
a legal (if unambitious) action on your behalf so one dropped response doesn't end a many-hand
match; see `games/card-game-hearts/src/game.ts`'s `onMissingAction` if you're curious exactly what
it plays.

### Writing your bot: handling both phases

The only Hearts-specific part of `decideAction()` is branching on `observation.phase`. The
simplest possible real bot (`bots/card-game-hearts/lowest-card-hearts/index.mjs`), in full:

```js
import { runBot } from '@thunderdome/bot-sdk-js';

function byRankAscending(a, b) {
  return a.rank - b.rank;
}

function decideAction(observation) {
  if (observation.phase === 'passing') {
    const highestThree = [...observation.hand].sort(byRankAscending).slice(-3);
    return { type: 'pass', cards: highestThree };
  }
  const [lowest] = [...observation.legalPlays].sort(byRankAscending);
  return { type: 'play', card: lowest };
}

runBot({ decideAction });
```

See [`bots/README.md`](../../bots/README.md) for the full roster of Hearts reference bots and
competitors, from `random-hearts`/`lowest-card-hearts` through `point-dodger-hearts`'s real
heuristic and the `tominator-*` line's more sophisticated strategies — good reading, in that
order, once you're past a trivial bot of your own.

### Testing it for real

Hearts needs **exactly 4** participants (not "2 or more" like Rock-Paper-Scissors), so you need 3
opponents to fill out a table:

```bash
yarn thunderdome match run my-hearts-bot random-hearts lowest-card-hearts point-dodger-hearts \
  --config '{"pointLimit":100}'
```

`yarn thunderdome play` takes one bot id per remaining seat — for Hearts, that's 3 — and you fill
the last one:

```bash
yarn thunderdome play random-hearts lowest-card-hearts point-dodger-hearts \
  --game-config '{"pointLimit":100}'
```

Every round it's your turn (whether to pass or to play), your prompt is printed right here in the
terminal — your own hand, the current trick, hearts-broken status, everyone's scores, a
card-notation legend, and a format example (using a real, currently-legal card) — and whatever you
type becomes your action:

```
Hearts — Hand 1 (passing) — passing direction: left
Your hand: 9C QC 2D 4D 9D TD QD KD TH KH 5S JS QS
Hearts broken: no
Scores — you: 0, random-hearts: 0, lowest-card-hearts: 0, point-dodger-hearts: 0 (lowest wins at 100)
Cards: rank+suit — 2-9, T=10, J, Q, K, A; C=clubs, D=diamonds, H=hearts, S=spades (e.g. QS = queen of spades, TH = ten of hearts).
Pass 3 cards left. Type: PASS <card> <card> <card>  (example: PASS 2C 5C TH)
> PASS 9C QC 2D
Passed: 9C QC 2D
```

Type `PASS <card> <card> <card>` (only during a passing round) or `PLAY <card>` (only during a
playing round), using the compact 2-character card form (`QS`, `TH` for ten — `10H` also
accepted). Right after you submit, the CLI echoes back exactly how it understood your input
(`Passed: 9C QC 2D`, or `Played: 4D`) — via the optional `humanInterface.describeAction` hook on
`GameDefinition` (`packages/engine/src/types.ts`) — so a valid-but-unintended parse never slips
past unnoticed; an unparseable line gets an explicit "Sorry, I didn't understand that — try
again." instead of silently repeating the prompt. Type `quit` (or `resign`) any time to forfeit
early instead of playing the whole match out. See
[`apps/cli/README.md`](../../apps/cli/README.md#play) for the full CLI reference, including
`--as` (your own participant id) and Ctrl+C behavior.

## 11. Texas Hold'em specifics

### What makes Texas Hold'em different

Texas Hold'em is **2-10 players, hidden information, no-limit betting**, the richest action
surface of any game on the platform so far:

- The roster size is variable, not fixed like every other game (RPS/Connect Four are always 2,
  Hearts is always 4) — your bot has to work correctly whether it's facing 1 opponent or 9.
- Like Hearts, you only ever see your own 2 hole cards — everyone else's are hidden until a
  showdown reveals them (and never at all if the hand ends by everyone-but-one folding).
- Unlike Hearts' two action shapes, there are **five**: `fold`, `check`, `call`, `raise` (with an
  `amount`), and `allIn`. Which ones are actually legal right now is state-dependent (you can't
  `check` into a bet, you can't `call` with nothing to call) — `observation.legalActions` tells you
  exactly which of the five apply this turn, advisory only (`validateAction` is the real
  authority, same as `legalPlays` in Hearts).
- A hand plays out over up to 4 **streets** (`preflop`, `flop`, `turn`, `river`) with a full round
  of betting on each — `observation.street` and `observation.board` (0, 3, 4, or 5 community
  cards) tell you where you are.
- A match is many hands, like Hearts, but ends one of two ways depending on
  `config.matchFormat`: `'elimination'` (hands repeat until only one participant still has chips —
  the default) or `'fixedHands'` (play exactly `config.totalHands` hands, then rank by final chip
  count). Either way, a hand can bust a participant down to 0 chips along the way; the match also
  ends early if that ever leaves fewer than 2 players with chips to deal another hand to.
- **A missing/invalid/timed-out action forfeits the whole match** — unlike Hearts, which
  substitutes a legal card on your behalf. Texas Hold'em has no sensible stand-in for "what would
  you have bet," the same reasoning Connect Four uses for having no sensible stand-in move.

Everything else — the NDJSON wire framing, the init/ready handshake, `stdout` being
protocol-only, `seq` strictly increasing, using `@thunderdome/bot-sdk-js`'s `runBot()` — is identical
to every other game on the platform (§1-§8 above).

### The contract

**Config**:

```ts
interface PokerTexasHoldEmConfig {
  matchFormat: 'elimination' | 'fixedHands'; // default: 'elimination'
  totalHands: number; // only consulted when matchFormat === 'fixedHands'; default 10
  startingStack: number; // chips every participant starts a match with; default 1000
  smallBlind: number; // default 10
  bigBlind: number; // must exceed smallBlind; default 20
}
```

Handed to you (opaque, informational) in `init`'s `payload.config`.

**Cards, on the wire** — the same plain object as Hearts, never a compact string like `"AS"`:

```ts
interface Card {
  suit: 'clubs' | 'diamonds' | 'hearts' | 'spades';
  rank: number; // 2..10, then 11=J, 12=Q, 13=K, 14=A
}
```

**Observation** — what you receive, every time it's your turn to act:

```ts
interface PokerTexasHoldEmObservation {
  you: string;
  handNumber: number; // 0-based
  street: 'preflop' | 'flop' | 'turn' | 'river';
  board: Card[]; // community cards revealed so far — 0, 3, 4, or 5 of them
  holeCards: [Card, Card]; // YOUR 2 hole cards — nobody else's ever appear here
  pot: number; // everyone's total chips committed this hand so far, across all streets
  yourStack: number; // chips NOT yet committed to this hand's pot
  yourCommittedThisStreet: number;
  toCall: number; // 0 means you can check
  minRaiseTo: number | null; // the minimum legal `raise` amount; null if you have no chips left to raise with
  maxRaiseTo: number; // your all-in amount — the max legal `raise` amount
  smallBlind: number;
  bigBlind: number;
  buttonParticipantId: string;
  opponents: {
    participantId: string;
    stack: number;
    committed: number; // this opponent's total committed this hand so far
    committedThisStreet: number;
    folded: boolean;
    allIn: boolean;
    isButton: boolean;
  }[]; // every other still-in-the-match participant, in seat order starting after you
  legalActions: ('fold' | 'check' | 'call' | 'raise' | 'allIn')[]; // advisory — see above
  lastHandSummary: {
    handNumber: number;
    winners: { participantId: string; amount: number }[];
    reason: 'fold' | 'showdown';
    showdown?: { participantId: string; holeCards: [Card, Card]; category: string }[]; // only present for reason === 'showdown'
    board: Card[];
  } | null; // null before the first hand's result exists
}
```

`lastHandSummary` exists for the same reason Hearts' `lastTrick` does — a stateless bot process
otherwise has no way to know what just happened before this turn's observation arrived.

**Action** — a discriminated union; `legalActions` tells you which are legal this turn:

```ts
type PokerTexasHoldEmAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number } // "raise TO", not "raise BY" — see below
  | { type: 'allIn' };
```

Two things worth knowing about `raise`: `amount` is the **total** you want
`yourCommittedThisStreet` to become after the raise, not how much more you're adding — so opening
the first bet of a street and reraising an existing bet use the exact same shape, just a bigger
`amount`. And `allIn` is a convenience over `raise` with `amount` set to your entire stack — it
saves you from having to know your own exact `yourStack`/`yourCommittedThisStreet` arithmetic just
to shove; use it instead of computing `maxRaiseTo` yourself.

### The wire protocol, concretely

Here's an **observation** partway through a hand — the flop, facing a bet — and the **action**
reply, from your bot's point of view (the concrete version of §3's generic envelope; `init`/`ready`
are identical in shape to every other game, just with `"gameId": "poker-texas-hold-em"`):

**Engine → you**:

```json
{
  "protocolVersion": "1.0",
  "type": "observation",
  "matchId": "match-001",
  "roundId": 6,
  "seq": 7,
  "sentAt": "2026-01-01T00:00:03.000Z",
  "payload": {
    "state": {
      "you": "your-bot-id",
      "handNumber": 0,
      "street": "flop",
      "board": [
        { "suit": "clubs", "rank": 9 },
        { "suit": "diamonds", "rank": 4 },
        { "suit": "hearts", "rank": 2 }
      ],
      "holeCards": [
        { "suit": "spades", "rank": 14 },
        { "suit": "spades", "rank": 13 }
      ],
      "pot": 140,
      "yourStack": 400,
      "yourCommittedThisStreet": 0,
      "toCall": 40,
      "minRaiseTo": 80,
      "maxRaiseTo": 440,
      "smallBlind": 10,
      "bigBlind": 20,
      "buttonParticipantId": "opponent-id",
      "opponents": [
        {
          "participantId": "opponent-id",
          "stack": 360,
          "committed": 40,
          "committedThisStreet": 40,
          "folded": false,
          "allIn": false,
          "isButton": true
        }
      ],
      "legalActions": ["fold", "call", "raise", "allIn"],
      "lastHandSummary": null
    },
    "awaitingAction": true,
    "deadlineAt": "2026-01-01T00:00:08.000Z"
  }
}
```

`check` isn't in `legalActions` here — there's a bet to call (`toCall: 40`), so it's `call` or
nothing. **You → engine**, calling it:

```json
{
  "protocolVersion": "1.0",
  "type": "action",
  "matchId": "match-001",
  "roundId": 6,
  "seq": 4,
  "sentAt": "2026-01-01T00:00:03.400Z",
  "payload": { "action": { "type": "call" } }
}
```

This repeats for every street of every hand — however many it takes for the match to end (see
`config.matchFormat` above) — then ends with `match-end` exactly like every other game:

```json
{
  "protocolVersion": "1.0",
  "type": "match-end",
  "matchId": "match-001",
  "seq": 41,
  "sentAt": "2026-01-01T00:02:12.000Z",
  "payload": {
    "result": {
      "participantIds": ["your-bot-id", "opponent-id"],
      "stacks": { "your-bot-id": 800, "opponent-id": 0 },
      "bustedOut": [["opponent-id"]],
      "handsPlayed": 7
    },
    "reason": "completed"
  }
}
```

`bustedOut` groups participants by which hand they busted in — here, `opponent-id` ran out of
chips during the 7th and final hand, ending the match (`elimination` format's default).

### Reference bots

`bots/poker-texas-hold-em/random-poker/index.mjs` picks uniformly at random among whatever
`legalActions` allows, with a uniformly random `raise` amount — the simplest real strategy to
read. `bots/poker-texas-hold-em/calling-station-poker/index.mjs` is even simpler: it never folds
or raises, just checks when it can and calls otherwise — a fixed, deterministic baseline to
measure other poker bots against. `bots/poker-texas-hold-em/tight-poker/` is a real TypeScript
example: it bets/raises only with a good hand (a standard tight preflop range in
`src/strategy.ts`'s `isPremiumHoleCards`, or a made pair-or-better postflop in `hasMadeHand`) and
never bluffs, folding a weak hand to anything pricier than the big blind. See
[`bots/README.md`](../../bots/README.md) for all three.

### Testing it for real

Texas Hold'em takes **2 to 10** participants, not a fixed count like Hearts' exactly-4 — any
number of bot ids in that range works:

```bash
yarn thunderdome match run random-poker calling-station-poker \
  --config '{"startingStack":500,"totalHands":5,"matchFormat":"fixedHands"}'
```

`--config` is whatever JSON `parseConfig` expects (see the `PokerTexasHoldEmConfig` shape above,
or `games/poker-texas-hold-em/src/types.ts`'s `PokerTexasHoldEmConfigSchema`). Any bot in
`bots/poker-texas-hold-em/` is playable this way, by its manifest `id` — including your own, once
it's merged.

```bash
yarn thunderdome play random-poker --game-config '{"startingStack":300,"smallBlind":10,"bigBlind":20,"totalHands":3,"matchFormat":"fixedHands"}'
```

puts you in the ring against `random-poker` instead. Every time it's your turn, your prompt is
printed right here in the terminal — the street and board, the pot, your hole cards, every
opponent's stack/status, and the exact legal actions with their min/max amounts:

```
----------

Texas Hold'em — Hand 1 (preflop)
Blinds: 10/20 — button: you
Board: (none)
Pot: 30

You [button]: stack 290, committed 10 this street, hole cards: 9D 5H
Opponents:
  random-poker: stack 280, committed 20 this hand (in)

To call: 10
Cards: rank+suit — 2-9, T=10, J, Q, K, A; C=clubs, D=diamonds, H=hearts, S=spades.
Type: FOLD | CALL (10) | RAISE <amount> (min 40, max 300) | ALLIN (300)
> call
You called.
```

Type `FOLD`, `CHECK`, `CALL`, `RAISE <amount>`, or `ALLIN` (case-insensitive; `F`/`X`/`C`/`R`/`A`
and a few other aliases work too — `games/poker-texas-hold-em/src/human.ts`'s `parseInput` has the
full list). Right after you submit, the CLI echoes back exactly how it understood your input
(`You called.`, `You raised to 80.`) via the same `humanInterface.describeAction` hook Hearts uses,
for the same reason: a well-formed-but-unintended amount is still a real, submittable action, not
a typo the CLI can catch for you. Type `quit` (or `resign`) any time to forfeit early instead of
playing the whole match out. See [`apps/cli/README.md`](../../apps/cli/README.md#play) for the
full CLI reference.
