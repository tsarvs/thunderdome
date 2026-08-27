# Hearts Bot Author Guide

This guide walks through writing a bot for Thunderdome's Hearts game: the wire protocol your bot
must speak, the manifest that describes it, the Docker image it ships in, and how to test it
before submitting it — including actually playing against it yourself.

**Status check first:** the protocol (`docs/adr/0002-universal-bot-protocol.md`), the Docker
runtime (`docs/adr/0003-docker-bot-isolation.md`), and Hearts itself (`games/card-game-hearts/`)
are all implemented and tested today. `@thunderdome/bot-sdk`'s `runBot()` works exactly the same
for Hearts as it does for Rock-Paper-Scissors — see
[`rps-bot-author-guide.md`](rps-bot-author-guide.md) §1/§3 for the generic protocol-framing detail
this guide doesn't repeat (init/ready handshake, `seq`, `stdout`-is-protocol-only, etc.). Three
real reference bots exist today (`bots/card-game-hearts/random-hearts`,
`lowest-card-hearts`, `point-dodger-hearts`), and `yarn thunderdome play` supports a human
filling one seat against however many bots fill the rest — for Hearts, that's 3. Where this guide
describes something that doesn't exist yet, it says so explicitly.

## 1. What makes Hearts different from Rock-Paper-Scissors

Hearts is **4 players, hidden information, two action shapes**, not RPS's 2-player,
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
protocol-only, `seq` strictly increasing, using `@thunderdome/bot-sdk`'s `runBot()` — is identical
to Rock-Paper-Scissors and every other game on the platform (`docs/architecture.md`).

## 2. The Hearts contract

### Config

```ts
interface HeartsConfig {
  pointLimit: number; // match ends once any player's cumulative score reaches this; default 100
}
```

Handed to you (opaque, informational) in `init`'s `payload.config`. Lower is better in Hearts —
`pointLimit` is the *ceiling* a score has to cross to end the match, not a target to race toward.

### Cards, on the wire

A card is a plain object, never a compact string like `"QS"`:

```ts
interface Card {
  suit: 'clubs' | 'diamonds' | 'hearts' | 'spades';
  rank: number; // 2..10, then 11=J, 12=Q, 13=K, 14=A
}
```

(The compact `"QS"`/`"TH"` string form only exists in `thunderdome play`'s terminal text UI for a
*human* typing commands — see §7. A bot's `Card` objects on the wire are never strings.)

### What you receive: the observation

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

### What you send: the action

A discriminated union — which one is valid depends entirely on `observation.phase`:

```ts
type HeartsAction =
  | { type: 'pass'; cards: [Card, Card, Card] } // only during phase === 'passing'
  | { type: 'play'; card: Card }; // only during phase === 'playing'
```

Submitting the wrong `type` for the current phase, a card you don't hold, or a card outside
`legalPlays` all get rejected the same way any illegal action does (§3 below).

## 3. The wire protocol, concretely

Every message is one JSON object followed by `\n` — see
`docs/adr/0002-universal-bot-protocol.md` for the full envelope spec, and
[`rps-bot-author-guide.md`](rps-bot-author-guide.md) §3 for the generic init/ready handshake this
section doesn't repeat. Here's what's specific to Hearts: one **passing** round, then one
**playing** round, from your bot's point of view (`roster` is your 4-participant table, in
clockwise turn order):

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
      "hand": [{ "suit": "clubs", "rank": 9 }, { "suit": "diamonds", "rank": 4 }],
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
game (see [`rps-bot-author-guide.md`](rps-bot-author-guide.md) §3). A missing/invalid/timed-out
action doesn't forfeit the whole match here — Hearts substitutes a legal (if unambitious) action
on your behalf so one dropped response doesn't end a many-hand match; see
`games/card-game-hearts/src/game.ts`'s `onMissingAction` if you're curious exactly what it plays.

## 4. Writing your bot

Use `@thunderdome/bot-sdk`'s `runBot()` exactly as in
[`rps-bot-author-guide.md`](rps-bot-author-guide.md) §4 — the only Hearts-specific part is
`decideAction()` branching on `observation.phase`. The simplest possible real bot
(`bots/card-game-hearts/lowest-card-hearts/index.mjs`), in full:

```js
import { runBot } from '@thunderdome/bot-sdk';

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

Three real, working reference bots exist to read for increasingly sophisticated starting points:

| Bot | Strategy |
| --- | --- |
| [`random-hearts`](../../bots/card-game-hearts/random-hearts/) | Uniformly random pass/play every turn, seeded from `rngSeed` (never `Math.random()` — `docs/adr/0004-deterministic-randomness.md`). |
| [`lowest-card-hearts`](../../bots/card-game-hearts/lowest-card-hearts/) | Always plays/passes by raw rank, ignoring the trick, hearts, or scores entirely. Shown in full above. |
| [`point-dodger-hearts`](../../bots/card-game-hearts/point-dodger-hearts/) | An actual heuristic: sheds dangerous cards when passing, leads safe non-point cards, ducks under the trick's current winner when it can, dumps its most dangerous card when void in the led suit, and takes an unavoidable trick as cheaply as possible. |

`point-dodger-hearts` is worth reading end to end once you're past a trivial bot — it's a good
template for "real strategy, still short enough to read in one sitting."

## 5. The manifest

Same shape as any bot (`packages/bot-sdk/src/manifest.ts`), just `"game": "card-game-hearts"`:

```json
{
  "id": "my-hearts-bot",
  "name": "My Hearts Bot",
  "version": "1.0.0",
  "game": "card-game-hearts",
  "author": { "name": "Your Name", "contact": "you@example.com" },
  "runtime": { "language": "node" },
  "interface": { "transport": "stdio" },
  "protocolVersion": "^1.0",
  "description": "Describe your strategy here."
}
```

`scripts/scaffold-bot.mjs card-game-hearts my-hearts-bot` generates this (and the rest of the
directory below) for you — see [`scripts/README.md`](../../scripts/README.md#scaffold-botmjs).

## 6. The Dockerfile

Identical requirement to any bot — fully self-contained, no bind mounts, no network access:

```dockerfile
FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
```

(This is the JS-bot form all three reference bots use; a TypeScript bot's multi-stage Dockerfile
looks like [`rps-bot-author-guide.md`](rps-bot-author-guide.md) §6's — `scaffold-bot.mjs --lang
ts` generates that variant.) `@thunderdome/bot-sdk` is a vendored tarball, not a live workspace
dependency, exactly as in [`rps-bot-author-guide.md`](rps-bot-author-guide.md) §4 — run
`./scripts/pack-bot-sdk.sh` after scaffolding to populate `vendor/` and generate
`package-lock.json`.

## 7. Testing your bot locally

Three levels, from narrowest to broadest:

**In isolation, against a scripted observation.** Same primitives as any bot
(`@thunderdome/runtime`'s `DockerBotProcess`/`BotLifecycle`) — see
[`bots/card-game-hearts/point-dodger-hearts/smoke-test.mjs`](../../bots/card-game-hearts/point-dodger-hearts/smoke-test.mjs)
for a Hearts-specific worked example that scripts both a passing-phase and several distinct
playing-phase observations (leading, ducking, voiding, forced-to-win) and asserts the exact
action back. Good template for your own bot: swap in your image tag and whatever observations
exercise your strategy's branches.

**Against 3 other bots, end to end.** `yarn thunderdome match run <botId> <botId> <botId>
<botId>` — Hearts needs **exactly 4** participants (not "2 or more" like Rock-Paper-Scissors),
so you need 3 opponents. All three reference bots above make a full 4-bot table together with
your own:

```bash
yarn thunderdome match run my-hearts-bot random-hearts lowest-card-hearts point-dodger-hearts \
  --config '{"pointLimit":100}'
```

**Against 3 bots yourself, by hand.** `yarn thunderdome play` takes one bot id per remaining
seat — for Hearts, that's 3 — and you fill the last one:

```bash
yarn thunderdome play random-hearts lowest-card-hearts point-dodger-hearts \
  --game-config '{"pointLimit":100}'
```

Every round it's your turn (whether to pass or to play), your prompt is printed right here in the
terminal — your own hand, the current trick, hearts-broken status, everyone's scores, a
card-notation legend, and a format example (using a real, currently-legal card) — and whatever
you type becomes your action:

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

## 8. Submitting your bot

Same as any bot: open a PR touching only `bots/card-game-hearts/<your-bot-id>/` —
mechanically enforced by `tools/boundary-check` (`docs/adr/0007-repository-enforcement.md`). No
separate registration step: the moment your PR merges, `@thunderdome/registry`'s filesystem scan
picks it up and it's playable via `yarn thunderdome match run <your-bot-id> <3 more Hearts bot
ids>` or `yarn thunderdome play <3 Hearts bot ids>` — no index to update, nothing else to run.
