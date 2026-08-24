# The Thunderdome — Architecture Overview

Status: Phase 1 design. This document describes the target architecture. Implementation lands
incrementally (see `docs/adr/` for the reasoning behind each major decision, and the repo root
`README.md` for what's actually built so far).

## 1. Mental model

```
                         THUNDERDOME
                              |
       +----------------------+----------------------+
       |                      |                      |
     Games                Tournaments              Bots
       |                      |                      |
       |                Tournament Format           |
       |                      |                      |
       +----------------------+----------------------+
                              |
                           Matches
                              |
                       Match Orchestrator
                              |
                     Universal Protocol
                              |
                  +-----------+-----------+
                  |                       |
              Docker Bot              Docker Bot
                  |                       |
              TypeScript                 Java
              JavaScript                Future...
```

Responsibility boundaries:

| Concern               | Question it answers                            |
| --------------------- | ---------------------------------------------- |
| **Game**              | "What happens?"                                |
| **Bot**               | "What should I do?"                            |
| **Tournament Format** | "Who plays whom, and when?"                    |
| **Engine**            | "Make all of this happen safely."              |
| **Protocol**          | "How do independent processes communicate?"    |
| **Runtime**           | "How do we safely execute untrusted bots?"     |
| **Registry**          | "What games and bots exist?"                   |
| **Roster**            | "Which bots are competing in this tournament?" |
| **Seed**              | "How can we reproduce what happened?"          |

The engine orchestrates. It never contains a game-specific conditional, never constructs a bot's
observation itself, and never knows what language a bot is written in.

## 2. Package structure

```
apps/
  cli/                        thin presentation layer — no engine logic lives here

packages/
  protocol/                   wire protocol: envelope/message Zod schemas, codec, NDJSON framing, fixtures
  rng/                        seeded PRNG + HMAC-based seed derivation (the one entropy boundary)
  engine/                     GameDefinition contract, match-runner loop, tournament orchestrator
  runtime/                    Docker container lifecycle, resource limits, forfeit taxonomy
  bot-sdk/                    TS developer SDK for bot authors (runBot() protocol client); bot manifest schema
  game-sdk/                   GameDefinition helper types/test utilities; game manifest schema
  registry/                   filesystem scan + validation of bot/game manifests
  tournament-formats/         concrete TournamentFormat implementations (round robin, single
                               elimination) — the TournamentFormat contract itself lives in
                               engine/, alongside GameDefinition, since the orchestrator (also in
                               engine/) needs it and this package depends on engine for
                               StandingOutcome/Rng
  tournament-store/           persisted TournamentRecord read/write — one JSON file per
                               tournament, no database (see ADR-0009); no dependency on
                               runtime/registry/apps, so it's independently testable

games/
  <game-id>/                  real Yarn workspace members — rules implementations (RPS, Chess, …)

bots/
  <game-id>/<bot-id>/         NOT Yarn workspace members — fully competitor-owned, any language,
                              grouped by the one game each bot plays

tools/
  boundary-check/             CI diff-classifier + manifest validator

docs/
  adr/                        architectural decision records
  guides/                     bot/game/tournament author guides, protocol docs, security model
```

Dependency direction is strictly one-way: `apps/*` depends on `packages/engine` (and friends);
`packages/engine` never depends on `apps/*`. This is what lets a future HTTP API + React UI sit
behind the same engine without any engine rearchitecting — see §8.

### Why `games/*` and `bots/*` are treated differently

Both are "content contributed from outside the core platform team," but they sit at genuinely
different trust levels:

- **Games** are always TypeScript, always imported and executed **in-process** by the engine, and
  are merged only through maintainer + game-steward review. They are real Yarn workspace members:
  they get project-reference typechecking against `game-sdk`, hoisted/deduped dependencies, and a
  single reviewable root lockfile.
- **Bots** are the platform's actual adversarial-code boundary: any language, always executed in a
  fresh, isolated Docker container, never imported into the platform process. They are
  **deliberately not** Yarn workspace members. See ADR-0001 for the full reasoning — in short,
  workspace membership would let a bot silently depend on phantom-hoisted root packages that
  vanish the moment its isolated `docker build bots/<game-id>/<bot-id>/` context runs (no root `node_modules` in
  scope there), and it would turn the root lockfile into a permanent multi-competitor merge
  hotspot. The registry only ever reads a bot's `manifest.json` and hands its directory to the
  runtime for `docker build`/`docker run` — the platform's import graph structurally cannot reach
  `bots/**`.

## 3. Universal bot protocol (summary — full detail in ADR-0002)

Transport: **NDJSON over each bot container's stdin/stdout** (one JSON message + `\n`). Rejected
gRPC (per-language codegen burden for a "any language, easy to add" platform), HTTP-over-socket
(server lifecycle overhead a hobbyist bot shouldn't need), raw length-prefixed framing (easy to
get wrong per-language, not `docker logs`-debuggable), and full JSON-RPC 2.0 (solves a more
general problem than our fixed, engine-driven lifecycle needs). `stdout` is protocol-only;
`stderr` is the bot's free-form debug log, captured but never parsed as protocol.

Envelope:

```ts
interface Envelope<TPayload = unknown> {
  protocolVersion: string; // "MAJOR.MINOR"
  type: MessageType;
  matchId: string;
  roundId?: number;
  seq: number; // per-direction monotonic counter — duplicate/out-of-order detection
  sentAt: string; // ISO-8601, diagnostic only — never consulted for game logic
  payload: TPayload;
}
```

Message catalogue — every noun is generic (match, participant, round, observation, action,
result, error); none are game-specific:

| Direction    | Type          | Purpose                                                                                     |
| ------------ | ------------- | ------------------------------------------------------------------------------------------- |
| engine → bot | `init`        | match/config/roster/derived `rngSeed`, once                                                 |
| engine → bot | `observation` | per-round view of state; `awaitingAction` + `deadlineAt` say whether/when a response is due |
| engine → bot | `result`      | round-scoped or match-scoped outcome reveal                                                 |
| engine → bot | `error`       | this bot's last message was rejected; container is being terminated                         |
| engine → bot | `match-end`   | terminal message, tells the bot to shut down                                                |
| bot → engine | `ready`       | ack of `init`, declares supported `protocolVersion`                                         |
| bot → engine | `action`      | reply to an awaited `observation`                                                           |
| bot → engine | `resign`      | voluntary clean forfeit                                                                     |
| bot → engine | `error`       | bot's own SDK self-reporting an internal fault                                              |

`action-request` was deliberately folded into `observation` (via `awaitingAction`) rather than
kept separate — one message concept naturally covers both sequential games (only the active
participant's observation awaits a response) and simultaneous games (everyone's does).

Schema validation: the TypeScript implementation is **Zod-first**
(`packages/protocol/src/messages.ts`) — a hand-written discriminated union, one Zod object per
message type. A shared golden fixture corpus (`packages/protocol/fixtures/v1/{valid,invalid}/`)
of concrete valid/invalid messages is what the TS conformance suite (`test/fixtures.test.ts`)
runs against today, and is exactly what a future non-TS SDK's test suite will run against too.
`packages/protocol/schema/v1/` is reserved for a generated JSON Schema artifact once a
second-language SDK actually needs one (see the Phase 3 implementation note in ADR-0002) —
generated from the Zod schemas at that point, not hand-maintained in parallel.

Protocol-shape validation (`PROTOCOL_VIOLATION`) and game-legality validation (`ILLEGAL_ACTION`)
are explicitly two different passes with two different forfeit reasons.

## 4. Deterministic randomness (summary — full detail in ADR-0004)

Bots do **not** share a bit-identical cross-language RNG with the engine or each other — that
would require every bot language to reimplement one PRNG algorithm byte-for-byte, forever, for no
real benefit. Instead:

1. Any randomness that affects **shared game outcomes** is owned solely by the engine/game and
   never exposed as an RNG handle to bots — only its _result_ reaches a bot, as ordinary
   observation data (e.g. `"diceRoll": 4`).
2. A bot's own **internal strategy randomness** is the bot's private business. The engine hands
   each bot a derived seed once (`init.payload.rngSeed`); each language's bot-SDK seeds its own
   local PRNG with it. Determinism only requires "same code + same seed ⇒ same output within one
   process" — no cross-language agreement needed.

Single entropy boundary: `tournamentSeed` (32 random bytes, generated once at tournament
creation, persisted immutably). `deriveSeed(purpose, ...parts) = HMAC-SHA256(key=tournamentSeed,
msg=[purpose, ...parts])`. `matchSeed = deriveSeed("match", matchId)` (engine-internal, recomputed
on replay, never persisted or sent). `participantSeed = deriveSeed("bot", matchId,
participantId)` (sent only to that one participant). Arrival order of live bot responses must
never influence outcomes — only seeded RNG or fixed `participantId` order may break ties.

**Reproducibility caveat, stated plainly**: replaying a _persisted match record_ is fully
deterministic. Re-running the same bots live again is not guaranteed to reproduce identical
timeouts/forfeits, since those depend on real wall-clock bot behavior, not the seed alone.

## 5. Game abstraction (summary — full detail in ADR-0005)

**Status: implemented**, by two real games — Rock-Paper-Scissors (`games/rock-paper-scissors`,
simultaneous, no sequencing) and Connect Four (`games/connect-four`, sequential, single-mover-
per-turn — the shape originally sketched using Chess as the hypothetical example below, before
Chess itself was built). Both implement `GameDefinition` exactly as drafted here; no engine
change was needed to add the second one.

```ts
type Rng = {
  nextFloat(): number;
  nextInt(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
};
type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

interface PendingAction {
  participantId: string;
  required: boolean;
  actionSchema?: unknown;
  deadlineMs?: number;
}

interface RoundOutcome<TState> {
  nextState: TState;
  events: RoundEvent[];
}
interface RoundEvent {
  type: string;
  participantIds?: string[];
  data?: unknown;
}
type MissingActionDecision<TAction> =
  { policy: 'substitute'; action: TAction } | { policy: 'forfeit-match' };
interface StandingOutcome {
  participantId: string;
  rank: number;
  score?: number;
  outcome?: 'win' | 'loss' | 'draw';
}

interface GameDefinition<TConfig, TState, TObservation, TAction, TResult> {
  id: string;
  version: string;
  parseConfig(raw: unknown): Result<TConfig>;
  initialize(args: { config: TConfig; participantIds: string[]; rng: Rng }): TState;
  getObservation(state: TState, participantId: string): TObservation;
  getPendingActions(state: TState): PendingAction[];
  validateAction(state: TState, participantId: string, rawAction: unknown): Result<TAction>;
  resolve(args: { state: TState; actions: Map<string, TAction>; rng: Rng }): RoundOutcome<TState>;
  onMissingAction?(args: {
    state: TState;
    participantId: string;
    reason: 'timeout' | 'invalid' | 'disconnected';
  }): MissingActionDecision<TAction>;
  isTerminal(state: TState): boolean;
  getResult(state: TState): TResult;
  getStandingOutcomes(result: TResult): StandingOutcome[];
  resourceLimits: unknown;
}
```

`getPendingActions` returns whatever set of participants must act _this round_, each flagged
`required` or not — one entry for Connect Four's single mover (Chess, if built, would look the
same), all entries for RPS's simultaneous choice, a mix for a game with reactive/interrupt
abilities. This is what lets a single generic engine loop serve sequential, simultaneous, and
N-player games without ever special-casing "one" vs. "all."

`getStandingOutcomes` is the seam that lets a `TournamentFormat` consume any game's result without
ever knowing that game's `TResult` shape — the actual mechanism that makes game/format
pluggability mutually independent rather than aspirational.

**Observation is not game state.** `getObservation(state, participantId)` is the _sole_ authority
for what a participant may see. The engine forwards whatever it returns verbatim — it never
inspects, redacts, or infers observations from `TState` itself. See ADR-0005.

**Partial-forfeit policy**: if a required participant fails to submit a valid action before its
deadline, the engine's default is to forfeit the whole match — generic match-administration code,
not a game-specific branch. A game may opt into leniency via the single `onMissingAction` hook
(e.g. RPS choosing, via its own config, to auto-lose just that round instead of ending the match).
This hook is the only game-facing extension point in the entire timeout/forfeit path.

## 6. Tournament abstraction (summary — full detail in ADR-0006)

**Status: implemented (Phase 7: round robin; Phase 9: single elimination)**. `TournamentFormat`
and the types below live in `packages/engine/src/tournament.ts` (not `packages/tournament-formats`
— see §2's note on why); the orchestrator (`runTournament()`) lives alongside it in
`tournament-runner.ts`. `packages/tournament-formats` holds both concrete implementations,
`roundRobinFormat` and `singleEliminationFormat`, plus a small shared `series.ts` (the
best-of-N majority-or-cap decision every format's matchups use — identical logic whether the
matchup is a round-robin pairing or a bracket slot, so it's factored out rather than duplicated).
The actual `MatchDescriptor`/`MatchRecord` shapes ended up leaner than this section's original
draft — `MatchRecord` carries only what a format's `recordResult` actually consumes
(`standingOutcomes`), per this section's own "a format never sees a game's raw result" principle:

```ts
interface MatchDescriptor {
  matchId: string;
  participantIds: string[];
  round?: number; // advisory only, for progress reporting
}
interface MatchRecord {
  matchId: string;
  standingOutcomes: StandingOutcome[];
}

interface TournamentFormatInitializeResult<TFormatState, TStandings> {
  formatState: TFormatState;
  standings: TStandings;
  readyMatches: MatchDescriptor[];
  notices?: string[]; // e.g. a bye — something worth reporting that isn't a match
}

interface TournamentFormat<TFormatConfig, TFormatState, TStandings> {
  id: string;
  version: string;
  parseConfig(raw: unknown): Result<TFormatConfig>;
  initialize(args: {
    roster: RosterEntry[];
    config: TFormatConfig;
    rng: Rng;
  }): TournamentFormatInitializeResult<TFormatState, TStandings>;
  recordResult(args: {
    formatState: TFormatState;
    standings: TStandings;
    match: MatchDescriptor;
    record: MatchRecord;
  }): TournamentFormatInitializeResult<TFormatState, TStandings>;
  isComplete(args: { formatState: TFormatState; standings: TStandings }): boolean;
  getPublicStandings(standings: TStandings): unknown;
}
```

Formats use an **incremental pull model**, not a one-shot `generateSchedule()`: `initialize`
returns whatever matches are immediately playable, and `recordResult` may unlock more. With its
default config, round robin is the degenerate case (unlock everything on day one) — but its real
implementation also supports a best-of-N series per pairing, which genuinely does unlock more
matches via `recordResult` as each pairing's series continues. Single elimination is the other
validated shape, and now a real implementation too
(`packages/tournament-formats/src/single-elimination.ts`): `initialize` returns only round 1's
matchups, and `recordResult` computes and unlocks round N+1's matchups only once round N is fully
recorded, from the actual winners — proving the abstraction doesn't secretly assume round robin's
"whole schedule known up front" shape, not just by design reasoning but by a second concrete
format actually shipping. A non-power-of-two roster gets one bye per round (the last participant
in bracket order auto-advances without playing) — reported via `notices` above, since a bye is
otherwise invisible to the `readyMatches`/`recordResult` machinery (nothing runs, nothing to
record); `runTournament()`'s `onNotice` callback fires with each one in order, interleaved with
match execution, and `tournament run` just prints it. A bracket matchup, unlike a round-robin
pairing, must produce someone to advance even if its own best-of-N series ends tied, so it breaks
that tie deterministically (lower `participantId`) rather than recording a draw. Swiss and
pool-then-elimination fit the same contract without engine changes.

**Persistence (ADR-0009, Phase 11)**: every `tournament run` now writes a `TournamentRecord`
(`@thunderdome/tournament-store`) as it plays — one JSON file per tournament, no database,
consistent with §10's standing "no database" constraint. `tournament list`/`inspect`/`replay`
read it back; `replay` is deterministic playback of the stored per-match events, never a live
re-run of the same bots (see ADR-0004's reproducibility caveat above). This sits entirely in the
CLI/tournament-store layer — `TournamentFormat` and `runTournament()` themselves have no notion
of persistence at all.

## 7. Docker runtime & security model (summary — full detail in ADR-0003)

One container per participant per match. No bind mounts, ever — bot images are fully
self-contained at build time, which is what actually satisfies "no filesystem access to the repo
or other bots" (there is no shared filesystem to restrict access to).

Baseline hardening: `--network none`, `--memory` + matching `--memory-swap` (swap fully
disabled), `--cpus`, `--pids-limit`, `--read-only` root + small `noexec,nosuid` tmpfs scratch,
non-root `--user`, `--cap-drop=ALL`, `--security-opt no-new-privileges`, default seccomp,
`--ulimit nofile`. Controlled programmatically via `dockerode`, not CLI shelling.

Resource limits are fairness/containment, not the timeout mechanism — timeouts are enforced by
the orchestrator independently (a per-turn deadline timer, plus a whole-match wall-clock safety
net), since a throttled-but-not-killed bot could otherwise run "forever" within its CPU share.

Lifecycle: `SPAWNING → AWAITING_READY → RUNNING (per round: AWAITING_ACTION*) → MATCH_END_SENT →
GRACE_PERIOD → TERMINATED`. Failure at any state is scoped to that one participant's container —
siblings and the engine process are never affected. This is the concrete mechanism behind "one
bot's failure must never crash the tournament engine."

Failure taxonomy → forfeit reason (exhaustive):

`BOT_CRASHED`, `TURN_TIMEOUT`, `MATCH_TIMEOUT`, `PROTOCOL_VIOLATION`, `ILLEGAL_ACTION`,
`RESOURCE_LIMIT_EXCEEDED`, `ENGINE_ERROR` (never charged to a bot; voids/pauses the match instead),
`RESIGNED`.

**Flagged, not silently glossed over**: hardened plain Docker + seccomp is a fairness/accident
boundary, not a defense against a determined container-escape attempt from arbitrary community
code. Evaluating gVisor/Firecracker as a stronger sandbox is a documented near-term follow-up.

## 8. Registries, manifests, and repository enforcement (summary — full detail in ADR-0001, ADR-0007)

Both the Game Registry and Bot Registry are a **pure filesystem scan** — `games/*/manifest.json`
and `bots/*/manifest.json`, validated against a Zod schema, no hand-maintained central index file
(that would recreate exactly the merge-conflict coupling the platform is trying to avoid for
contributors). Game code is dynamically imported lazily, only when a command needs it. Bot code is
**never** imported by the platform process — only its manifest and directory path are read.

Repository enforcement uses two complementary mechanisms, not one:

- **CODEOWNERS**: requires maintainer review on everything (including bot PRs — running arbitrary
  community code is inherently risky even with a clean manifest) plus game-steward review on
  `games/**`.
- **CI boundary-check** (`tools/boundary-check`, a required status check): mechanically enforces
  that a PR touching `bots/**` doesn't also touch platform/game paths (unless a maintainer applies
  a `maintainer-override` label — gated by GitHub's own collaborator permissions, so a fork
  contributor can't self-apply it) and stays within exactly one `bots/<game-id>/<bot-id>/` directory, plus
  manifest schema/identity validation. CODEOWNERS alone can't express "what paths may this one PR
  touch together," which is exactly the gap the CI check closes.

## 9. Future web platform

The engine has zero dependency on the CLI or any presentation concern, by construction (one-way
package dependency direction, §2). The target eventual shape:

```
React Web UI → Thunderdome API → Thunderdome Engine → {Game Registry, Bot Registry, Tournament Engine, Match Runner}
```

None of this is built yet — no database, no HTTP API app, no React app. Nothing is scaffolded
"just in case"; the layering already makes adding `apps/server` and `apps/web` later possible
without touching the engine.

## 10. What's deliberately out of scope right now

No database. No auth system. No HTTP API. No React app. No multi-language CI build matrix (the
Java bot, once it exists, is proven by `docker build`/`docker run` + a protocol handshake, not a
Gradle CI job). No Yarn zero-installs/PnP. No Dependabot/Renovate. No release/publish pipeline. No
telemetry/observability stack. No tournament formats beyond round robin and single elimination yet
(Swiss, pool-then-elimination). No games beyond Rock-Paper-Scissors and Connect Four yet (Chess
remains a candidate architectural-validation exercise, though Connect Four already covers the
sequential/no-hidden-information case it was meant to validate).

## See also

- `docs/adr/0001-monorepo-and-boundary.md`
- `docs/adr/0002-universal-bot-protocol.md`
- `docs/adr/0003-docker-bot-isolation.md`
- `docs/adr/0004-deterministic-randomness.md`
- `docs/adr/0005-observation-vs-game-state.md`
- `docs/adr/0006-tournament-format-abstraction.md`
- `docs/adr/0007-repository-enforcement.md`
- `docs/adr/0008-toolchain-simplification.md`
- `docs/adr/0009-tournament-persistence.md`
