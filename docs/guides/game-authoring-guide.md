# Game Authoring Guide

This guide is for implementing a new game — a new `GameDefinition` — for the platform. It's a
different job from the other two guides: a **bot author**
([`bot-author-guide.md`](bot-author-guide.md)) plays an existing game; a **tournament
author** ([`tournament-author-guide.md`](tournament-author-guide.md)) configures matchups between
bots; a **game author** defines the rules those bots and tournaments run on top of.

**Status check first.** Four real games exist today; this guide deep-dives two of them —
Rock-Paper-Scissors (`games/rock-paper-scissors`, simultaneous, no hidden information) and Connect
Four (`games/connect-four`, sequential single-mover turns, also no hidden information) — since
together they cover the two basic turn-taking shapes (§2) with nothing hidden to complicate the
walkthrough. Both implement exactly the interface this guide describes; neither needed an engine
change to exist. A hidden-information game (each participant sees something different, ADR-0005)
is exercised by the other two instead: Hearts (`games/card-game-hearts`, 4 fixed seats) and Texas
Hold'em (`games/poker-texas-hold-em`, 2-10 seats, real no-limit betting with side pots) — both real
`GameDefinition`s too, just documented in [`bot-author-guide.md`](bot-author-guide.md) §10/§11 and
their own `src/types.ts` instead of here (see [`README.md`](README.md) for the full roster).

**New to Node/Docker/dev environments, or to this codebase generally?**
[`getting-started.md`](getting-started.md) explains the tooling this guide assumes you already
have working; [`testing-guide.md`](testing-guide.md) explains what a unit test is, if §11's
testing content below is your first time writing one.

## Quickstart checklist

The rest of this guide is a deep, section-by-section reference — worth reading in full once, but
not something to hold in your head all at once while building. This checklist is the same journey
condensed to its actual steps, each one linking to the section that explains it:

1. Run `yarn scaffold:game <your-game-id>` — a real, working (if trivial) `GameDefinition` skeleton
   lands in `games/<your-game-id>/`, already wired into the registry and build (§10). You're
   editing an existing, passing implementation from here, not starting from a blank file.
2. Decide your game's shape: does everyone act every round (simultaneous, like Rock-Paper-Scissors)
   or does exactly one participant act at a time (sequential, like Connect Four)? This is
   `getPendingActions`, and it's the first real design decision to make (§2).
3. Flesh out `TConfig`/`TState`/`TObservation`/`TAction`/`TResult` and the four methods that build
   and mutate them: `initialize` (§3), `getObservation` (§4), `validateAction`/`resolve` (§5).
4. Decide whether your game needs `onMissingAction` at all — most games are fine relying on the
   engine's default forfeit-the-match behavior (§6).
5. Implement `isTerminal`/`getResult`/`getStandingOutcomes`, and be able to say concretely why
   `isTerminal` is guaranteed to eventually become `true` (§7).
6. Set `resourceLimits` (§8) and `parseConfig` with sensible defaults (§9).
7. Write unit tests covering every distinct case your game can reach (§11,
   [`testing-guide.md`](testing-guide.md) if you're new to this).
8. Write at least one real reference bot for it (`bots/<your-game-id>/<bot-id>/`,
   `yarn scaffold:bot <your-game-id> <bot-id>`), then run it for real — `yarn thunderdome match run`
   and `tournament run` — to prove the abstraction actually holds end to end (§12).
9. Once it plays correctly, consider implementing `humanInterface` so a person can actually sit
   down and play it (`yarn thunderdome play`) — see
   [`human-friendly-games-guide.md`](human-friendly-games-guide.md) for that, plus other ways to
   keep developing a game once its rules are solid.

## 1. The `GameDefinition` interface

Everything a game is responsible for lives in one object, `packages/engine/src/types.ts`:

```ts
interface GameDefinition<TConfig, TState, TObservation, TAction, TResult> {
  id: string;
  version: string;

  parseConfig(raw: unknown): Result<TConfig>;
  initialize(args: { config: TConfig; participantIds: string[]; rng: Rng }): TState;
  getObservation(state: TState, participantId: string): TObservation;
  getPendingActions(state: TState): PendingAction[];
  validateAction(state: TState, participantId: string, rawAction: unknown): Result<TAction>;
  resolve(args: {
    state: TState;
    actions: ReadonlyMap<string, TAction>;
    rng: Rng;
  }): RoundOutcome<TState>;
  onMissingAction?(args: {
    state: TState;
    participantId: string;
    reason: MissingActionReason;
  }): MissingActionDecision<TAction>;
  isTerminal(state: TState): boolean;
  getResult(state: TState): TResult;
  getStandingOutcomes(result: TResult): StandingOutcome[];
  resourceLimits: unknown;
}
```

Everything the engine does with a game funnels through these ten members — there is no other
extension point, and no game-specific conditional anywhere in `@thunderdome/engine` or
`@thunderdome/runtime`. If you find yourself wanting the engine to special-case your game, that's
a sign the design needs another look, not a sign the engine needs a new `if`.

`TConfig`/`TState`/`TObservation`/`TAction`/`TResult` are entirely yours — the engine only ever
touches them through these ten methods, never by inspecting their shape directly.

## 2. Two real shapes: simultaneous vs. sequential

The single biggest design fork in a new game is **who acts each round**, answered by
`getPendingActions(state): PendingAction[]`:

```ts
interface PendingAction {
  participantId: string;
  required: boolean;
  actionSchema?: unknown; // advisory only; passed through to the wire protocol verbatim
  deadlineMs?: number; // overrides the caller's default deadline for this one entry
}
```

- **Rock-Paper-Scissors** (`games/rock-paper-scissors/src/game.ts`) is simultaneous: every round,
  `getPendingActions` returns **every** participant, each `required: true`. The engine requests
  all of them concurrently — arrival order must never affect the outcome (ADR-0004) — and
  `resolve()` reads everyone's action out of the `actions` map at once.
- **Connect Four** (`games/connect-four/src/game.ts`) is sequential: every round,
  `getPendingActions` returns **one** entry — `state.participantIds[state.currentPlayerIndex]`
  — so only the current mover ever gets an `observation`/`action` round-trip that round. The
  engine's collection loop doesn't know or care that this is "sequential" as a special case; it's
  just a pending-actions list of length one instead of length two. A hypothetical hidden-info
  card game with per-participant differing turn structure, or a game with an optional
  reactive/interrupt ability, would use the same field (`required: false` for the optional actor)
  — the mechanism generalizes past a strict "everyone" vs. "exactly one" binary.

This is what lets one generic engine loop
(`packages/engine/src/match-runner.ts`) serve every shape without ever branching on which game is
running.

## 3. `initialize`, and where randomness is allowed to come from

```ts
initialize(args: { config: TConfig; participantIds: string[]; rng: Rng }): TState;
```

Build your initial `TState` here. `rng` (`@thunderdome/rng`'s `Rng` — `nextFloat()`,
`nextInt(maxExclusive)`, `pick(items)`) is the **only** place a game may introduce real
randomness, and only for outcomes that affect the shared game state itself (never for a bot's own
strategy — that's the bot's job, seeded separately via `rngSeed` in `init`, ADR-0004).

Connect Four uses this for a fair coin flip deciding who moves first:

```ts
currentPlayerIndex: rng.nextInt(2) === 0 ? 0 : 1,
```

Without it, whichever participant a tournament format happens to list first would always move
first — a real, repeated advantage across every match of a best-of-N series against the same
opponent. Rock-Paper-Scissors, by contrast, never touches `rng` at all in `initialize` or
`resolve()` — nothing about RPS's own rules needs a coin flip, and a game with nothing to
randomize should just not call `rng`, rather than inventing a use for it.

Both games throw a plain `Error` from `initialize` if `participantIds` doesn't match what the
game supports (exactly 2, today, for both) — this is deliberately a **thrown error**, not a
`Result`, since it represents a caller-side contract violation (the tournament/registry layer
handing you an invalid roster), not a normal "config didn't validate" outcome.

## 4. `getObservation`: the sole authority for what a participant sees

```ts
getObservation(state: TState, participantId: string): TObservation;
```

**Observation is not game state** (ADR-0005) — this method is the _only_ thing the engine ever
calls to decide what a participant is told. The engine never reads, diffs, or redacts `TState`
itself; whatever this returns is forwarded to the wire protocol verbatim. Both real games happen
to be fully observable (nothing is hidden from either participant), so `getObservation` here is
really a _relabeling_ function, not a _redaction_ one — but the seam is identical either way, and
that's the point: a hidden-information game plugs into exactly the same method, just doing more
work inside it (assembling a private hand, others' hand sizes only, shared public state), with
zero engine changes.

Both games use the same relabeling convention: replace raw participant ids with `'you'`/
`'opponent'` (RPS's round history; Connect Four's board cells) rather than exposing the other
participant's actual id inside the payload a bot decides from. This is a project convention, not
an engine requirement — nothing stops a game from sending raw ids if there's no reason to hide
them. `opponentId` itself is still included as a plain field in both, since knowing who you're
playing isn't sensitive; it's _which cell/history-entry belongs to whom_ that gets relabeled.

For a **sequential** game, only the current mover gets an observation at all in a given round —
so by the time a bot receives one, "you got a message" already means "act now"; neither real game
bothers adding an explicit `isYourTurn` field, since it would always be `true` when present.

## 5. `validateAction` and `resolve`

```ts
validateAction(state: TState, participantId: string, rawAction: unknown): Result<TAction>;
resolve(args: { state: TState; actions: ReadonlyMap<string, TAction>; rng: Rng }): RoundOutcome<TState>;
```

`validateAction` is only ever called for participants `getPendingActions` actually asked for —
never for someone whose turn it isn't. Use a zod schema (both games do:
`RpsActionSchema`/`ConnectFourActionSchema`) for structural shape, then whatever game-specific
legality checks apply (Connect Four additionally checks the column is in range and not already
full). Return `err(...)` for anything invalid — this becomes a generic `ILLEGAL_ACTION` forfeit if
the participant was required to act, or is silently ignored if they were merely optional.

`resolve()` receives already-validated actions and must return:

```ts
interface RoundOutcome<TState> {
  nextState: TState;
  events: RoundEvent[]; // { type: string; participantIds?: string[]; data?: unknown }
}
```

`events` is opaque, game-defined structured data for replay/spectator logging
(`tournament replay` prints these verbatim — see `docs/adr/0009-tournament-persistence.md`) —
the engine never inspects `TState` to infer "what happened," it only ever forwards what `resolve`
itself reports. Both games emit exactly one event per round (`'round-result'` for RPS, `'move'`
for Connect Four) with whatever data a spectator would want to see; nothing requires exactly one,
a game with multiple simultaneous sub-effects per round could emit several.

`resolve()` also receives `rng` — for the same "engine-owned outcome randomness, delivered as
ordinary data" reason `initialize` does. Neither real game needs it here today (both are pure
functions of the submitted actions), but a game with resolution-time chance (a die roll
affecting combat) would call it here, never expose the roll itself as a live handle to a bot.

## 6. `onMissingAction`: the one optional, game-facing extension point

```ts
onMissingAction?(args: { state: TState; participantId: string; reason: MissingActionReason }): MissingActionDecision<TAction>;
```

If a **required** participant's action doesn't arrive (`reason`: `'timeout'` | `'invalid'` |
`'disconnected'`), the engine's default — with no `onMissingAction` at all — is to forfeit the
whole match. This hook is the single place a game may opt into leniency instead, by returning
`{ policy: 'substitute', action }` (an action `resolve()` already knows how to interpret) rather
than `{ policy: 'forfeit-match' }`.

Rock-Paper-Scissors uses it to offer a configurable choice (`RpsConfig.onMissingAction`):
`'loseRound'` substitutes a sentinel `{ forfeitedRound: true }` action that `resolve()` treats as
an automatic loss for just that round, instead of ending the whole match over one missed hand.
**Connect Four deliberately omits this hook entirely** — there's no sensible "substitute move" to
auto-play on a missing participant's behalf in a positional game, so it just takes the engine's
default. A second real game omitting the hook is itself useful proof that it's genuinely optional,
not something every game is expected to wire up.

## 7. `isTerminal`, `getResult`, and `getStandingOutcomes`

```ts
isTerminal(state: TState): boolean;
getResult(state: TState): TResult;
getStandingOutcomes(result: TResult): StandingOutcome[];
```

`isTerminal` is checked before every round; once it's `true`, the match-runner loop stops calling
`getPendingActions`/`resolve` and calls `getResult` once. **Both real games are bounded by
construction** — RPS plays exactly `config.totalRounds` hands, full stop; Connect Four ends the
moment a line completes or the board fills — deliberately, so a match can never run forever
waiting for a game-specific "is it actually over" condition that never arrives (this is exactly
what RPS's own predecessor design — "first to a majority of round wins" — got wrong: two
particular strategies could draw every round forever with neither side ever reaching a majority;
see `docs/adr/0003-docker-bot-isolation.md`'s match-timeout note for the reproduced case). A new
game should be able to point at its own state and say concretely why `isTerminal` is guaranteed to
become true — "the board is finite and every move fills a cell" (Connect Four), "we've played the
configured number of hands" (RPS) — not rely on the engine's whole-match wall-clock safety net to
paper over a design that doesn't actually bound itself.

`getStandingOutcomes` is the seam that makes tournament formats game-agnostic — a format
(`docs/adr/0006-tournament-format-abstraction.md`) never sees your actual `TResult` type, only:

```ts
interface StandingOutcome {
  participantId: string;
  rank: number; // 1 = best; ties share a rank
  score?: number;
  outcome?: 'win' | 'loss' | 'draw';
}
```

A draw is `rank: 1` for every tied participant (both games do this identically for a genuine tie);
a decisive result is `rank: 1`/`outcome: 'win'` for the winner and `rank: 2`/`outcome: 'loss'` for
the loser. `score` is optional and game-flavored — RPS reports hands won, Connect Four omits it
entirely (there's no meaningful per-participant score in a positional game beyond win/loss/draw).

## 8. `resourceLimits`

Opaque to the engine (`unknown`) — the runtime interprets it. Both real games use the same
literal shape as a project convention, not an enforced one:

```ts
resourceLimits: { cpus: 0.5, memoryMb: 128, turnTimeoutMs: 5000 }
```

See [`security-model.md`](security-model.md) for what the runtime actually does with limits like
these, and why they're fairness/containment rather than the timeout mechanism itself.

## 9. Config: the `parseConfig` pattern

```ts
parseConfig(raw: unknown): Result<TConfig>;
```

Both games follow the same zod pattern:

```ts
export const YourConfigSchema = z.object({ /* ...fields with .default(...) as needed... */ });
export type YourConfig = z.infer<typeof YourConfigSchema>;

// in the GameDefinition:
parseConfig(raw) {
  const result = YourConfigSchema.safeParse(raw);
  return result.success ? ok(result.data) : err(result.error.issues.map((i) => i.message).join('; '));
},
```

`ok`/`err`/`Result` come from `@thunderdome/engine`. Use `.refine()` for cross-field validation —
Connect Four's schema rejects a `winLength` that no board dimension could ever reach:

```ts
.refine((config) => config.winLength <= Math.max(config.columns, config.rows), {
  message: 'winLength must be <= max(columns, rows), or no line could ever reach it',
  path: ['winLength'],
})
```

## 10. Package scaffolding, the manifest, and the registry convention

A new game is a real Yarn workspace member under `games/<game-id>/`, structured identically to
the two existing ones:

```
games/<game-id>/
  manifest.json       # id, name, version, entryPackage, protocolVersion, min/maxParticipants, maintainers
  package.json         # name: "@thunderdome/game-<game-id>", deps: @thunderdome/engine + zod
  tsconfig.json        # extends ../../tsconfig.base.json
  tsconfig.test.json   # extends tsconfig.json, includes src+test, noEmit
  vitest.config.ts     # { test: { environment: 'node' } }
  src/
    types.ts           # config/state/observation/action/result types + zod schemas
    game.ts             # the GameDefinition object itself
    index.ts             # re-exports + `export { yourGame as game } from './game.js'`
  test/
    game.test.ts
```

The `export { yourGame as game }` line in `index.ts` is not optional naming convention — it's load-
bearing. The registry-driven CLI (`@thunderdome/registry` + `apps/cli`) resolves a game by
dynamically `import()`ing `manifest.json`'s `entryPackage` and reading its `game` named export; it
has no way to know your `GameDefinition` variable's own name in advance
(`games/rock-paper-scissors/src/index.ts` and `games/connect-four/src/index.ts` both document this
at the export site). `manifest.json` follows `GameManifestSchema`
(`packages/game-sdk/src/manifest.ts`) — `id` must be kebab-case and match the directory name,
`version` semver, `protocolVersion` a semver range.

Two more places need to know your new package exists, both by name:

- `scripts/build.sh`'s `INDEPENDENT_PACKAGES` array — Yarn Classic's `workspaces run` doesn't
  guarantee topological order, so games are built explicitly after their dependencies.
- Nothing else. `@thunderdome/registry` discovers your game by scanning `games/*/manifest.json`
  at runtime — there is no hand-maintained central list to update
  (`docs/adr/0001-monorepo-and-boundary.md`).

Then run `yarn install` once, so the workspace links your new package's dependencies.

## 11. Testing patterns

Both real games' test suites drive `resolve()`/`getObservation()`/etc. directly against
hand-constructed state, rather than only testing through a full match — much faster, and lets you
set up "one move from winning" scenarios without choreographing every prior round:

```ts
function initialState(overrides?) {
  return yourGame.initialize({ config: config(overrides), participantIds: ['alice', 'bob'], rng });
}

// Connect Four's convention for "skip initialize(), build state directly":
function stateWithBoard(board, currentPlayerIndex, overrides?) {
  return { participantIds: ['alice', 'bob'], config: config(overrides), board, currentPlayerIndex, ...};
}
```

Cover, at minimum: `parseConfig` (defaults, valid/invalid input), `initialize` (shape, any
rng-driven choice), `getObservation` (relabeling, and per-participant differences if any exist),
`getPendingActions`, `validateAction` (accept/reject cases), `resolve` (every distinct outcome
your game can reach — Connect Four's suite has one test per win direction plus a draw), and
`getResult`/`getStandingOutcomes` for both a decisive and a drawn result.

## 12. Proving it end to end

A game with no bot that can actually play it isn't finished. Write at least one reference bot
under `bots/<game-id>/<bot-id>/` (see
[`bot-author-guide.md`](bot-author-guide.md) for that side of the contract — the wire
protocol and `@thunderdome/bot-sdk-js`'s `runBot()` helper are entirely game-agnostic, so this is the
same for any game), then run the real thing:

```bash
yarn build && yarn lint && yarn typecheck && yarn test
yarn thunderdome match run <your-bot-id> <another-bot-id>
yarn thunderdome tournament run <your-bot-id> <another-bot-id> --tournament-config '{"format":"single-elimination"}'
```

Both real games were verified exactly this way — including live against real Docker, both
tournament formats, and (for Connect Four) two independent reference bots — before being
considered done. If `match run`/`tournament run` work without any change to `@thunderdome/engine`,
`@thunderdome/runtime`, `@thunderdome/registry`, or `@thunderdome/tournament-formats`, that's the
actual proof the abstraction held — not just that your game's own tests pass in isolation.

## See also

- `docs/architecture.md` §5 (Game abstraction) and §1 (mental model)
- `docs/adr/0005-observation-vs-game-state.md` — the full reasoning behind `getObservation`
- `docs/adr/0004-deterministic-randomness.md` — why `rng` is engine-owned and bot randomness is seeded separately
- [`protocol-reference.md`](protocol-reference.md) — the exact wire shape `getObservation`/`validateAction` payloads travel as
- [`security-model.md`](security-model.md) — what `resourceLimits` actually constrains
- `games/rock-paper-scissors/src/` and `games/connect-four/src/` — the two real implementations this guide describes
