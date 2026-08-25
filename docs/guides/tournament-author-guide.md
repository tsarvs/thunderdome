# Tournament Author Guide

This guide explains how a Thunderdome tournament fits together: the pieces you configure, how a
tournament format schedules matches, and how results roll up into final standings.

**Status check first — read this before the rest.** A full tournament is real and runnable
today, in either of two formats: `yarn thunderdome tournament run <botId> <botId> [...moreBotIds]`
resolves bots and a shared game through the registry (`@thunderdome/registry`), builds each bot's
image once, and drives every match through the real engine and runtime (`@thunderdome/engine`'s
`runTournament()` + `@thunderdome/runtime`'s `DockerActionCollector`) — see §2 for exact usage.
Every run is persisted as it goes (`@thunderdome/tournament-store`, `docs/adr/0009-tournament-persistence.md`):
`tournament list`/`inspect`/`replay` read a run back after the fact — §6 covers all three. What's
**not** built yet: any format beyond round robin and single elimination (Swiss,
pool-then-elimination, ...). This guide documents what's real, using Rock-Paper-Scissors (still
the running example throughout) — Connect Four is the platform's other real game
(`docs/guides/README.md`) and fits every piece below identically, just without its own worked
example here yet.

## 1. The five pieces of a tournament

A tournament is the combination of:

| Piece               | What it is                                                                | Status                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Game**            | Which game, which version, and that game's own config                     | Real — `rock-paper-scissors`, `{ totalRounds, onMissingAction }`                                                           |
| **Roster**          | Which bots (from the bot registry) are competing                          | Real — `@thunderdome/registry`'s `scanBots`/`scanGames`                                                                    |
| **Format**          | How matchups are generated and standings computed                         | Real for round robin and single elimination — `@thunderdome/tournament-formats`; Swiss and pool-then-elimination not built |
| **Seed**            | The one entropy boundary this tournament's reproducibility traces back to | Real — `@thunderdome/rng`                                                                                                  |
| **Resource limits** | Per-game CPU/memory/timeout ceilings                                      | Partially real — `GameDefinition.resourceLimits` exists; runtime enforcement is per-match, not tournament-level yet        |

None of these are new concepts invented for this guide — they're exactly
`docs/architecture.md`'s mental model: **Games + Tournaments + Bots → Matches → Match
Orchestrator → Universal Protocol → Docker Bots**. A tournament is the layer that decides _who
plays whom, and when_ (that's the format's whole job) and _who's eligible to play at all_ (the
roster) — it never touches game rules or protocol mechanics, both of which are already fully
implemented and don't change based on which tournament format is running.

## 2. Running a tournament today

```bash
yarn thunderdome tournament run only-rock only-paper only-scissors \
  --game-config '{"totalRounds":3}' \
  --tournament-config '{"bestOf":3}'
```

```
Building 3 bot image(s)...

Tournament db99a9f0-2e67-4151-8315-897eb37ce207: only-rock, only-paper, only-scissors (Rock Paper Scissors, round-robin)

Match round-robin-1-1: only-rock vs only-paper
  winner: only-paper
  series: only-paper leads 1-0 (1/3 played)
Match round-robin-2-1: only-paper vs only-scissors
  winner: only-scissors
  series: only-scissors leads 1-0 (1/3 played)
Match round-robin-3-1: only-rock vs only-scissors
  winner: only-rock
  series: only-rock leads 1-0 (1/3 played)
Match round-robin-1-2: only-rock vs only-paper
  winner: only-paper
  series decided: only-paper wins 2-0 over only-rock
Match round-robin-2-2: only-paper vs only-scissors
  winner: only-scissors
  series decided: only-scissors wins 2-0 over only-paper
Match round-robin-3-2: only-rock vs only-scissors
  winner: only-rock
  series decided: only-rock wins 2-0 over only-scissors

Final standings:
1. only-paper — 1W 1L 0D (1 pts)
2. only-rock — 1W 1L 0D (1 pts)
3. only-scissors — 1W 1L 0D (1 pts)
```

- Bot ids (positional args, 2 or more) are resolved through the bot registry — same as
  [`match run`](rps-bot-author-guide.md#7-testing-your-bot-locally); every bot must share one
  game.
- `--all-bots <gameId>` resolves the roster automatically to every bot the registry finds for that
  game (sorted, for a deterministic ordering) instead of typing every bot id — mutually exclusive
  with positional bot ids. It also fills in `bestOf: 7` when `--tournament-config` doesn't specify
  one — a "run everyone against everyone" tournament is exactly the case where one lucky match
  deciding a pairing is least desirable, so a best-of-7 series per pairing is a better default than
  round robin's own `bestOf: 1`. An explicit `bestOf` in `--tournament-config` always wins:
  ```bash
  yarn thunderdome tournament run --all-bots rock-paper-scissors --game-config '{"totalRounds":300}'
  ```
  runs every registered Rock-Paper-Scissors bot against every other, each pairing a best-of-7
  series of 300-hand matches.
- `--game-config` is that game's own config, validated by its `parseConfig` — for
  Rock-Paper-Scissors, `RpsConfigSchema` (`games/rock-paper-scissors/src/types.ts`).
- `--tournament-config` is the format's own config — for round robin, `{ bestOf }` (best of how many
  matches each pairing plays; must be odd; defaults to `1`), validated by
  `RoundRobinConfigSchema` (`packages/tournament-formats/src/round-robin.ts`). A pairing stops as
  soon as either bot reaches a majority of decisive match wins, or once `bestOf` matches have
  been played — whichever comes first. Deliberately distinct from Rock-Paper-Scissors' own
  `totalRounds`: `bestOf` counts whole _matches_ between the same two bots, `totalRounds` counts
  _hands_ within one match — conflating the two was exactly the confusion this naming avoids.
  Safe from hanging even if a pairing draws every match (every match is itself already bounded by
  the game's own rules) — it just finishes tied after exactly `bestOf` matches.
- Whenever `bestOf` is above 1, `tournament run` (`apps/cli/src/commands/tournament.ts`) prints
  each matchup's running series score after every match (`series: <bot> leads 1-0 (1/3 played)`),
  then a `series decided:` recap once that matchup's majority (or `bestOf` cap) is reached — so a
  multi-match series' progress is visible as it plays out, not just the final tally. This is CLI
  presentation logic only, derived from each match's own result and shared by both formats — no
  format itself has a notion of "printing," only of deciding when a matchup is done.
- `--tournament-config`'s `format` field is `"round-robin"` (the default) or
  `"single-elimination"`; any other value is a clear error, not a crash. Here's the same roster
  run as a bracket instead:

  ```bash
  yarn thunderdome tournament run only-rock only-paper only-scissors \
    --tournament-config '{"format":"single-elimination"}' --game-config '{"totalRounds":3}'
  ```

  ```
  Tournament 7c1e2b3a-...: only-rock, only-paper, only-scissors (Rock Paper Scissors, single-elimination)

  only-rock draws a bye in round 1
  Match single-elimination-r1-m1-g1: only-paper vs only-scissors
    winner: only-scissors
  Match single-elimination-r2-m1-g1: only-scissors vs only-rock
    winner: only-rock

  Final standings:
  1. only-rock — champion
  2. only-scissors — eliminated in round 2
  3. only-paper — eliminated in round 1
  ```

  With 3 participants, `only-rock` drew the bye that round 1's seeded shuffle left over — it
  skips straight to round 2 without playing (§3 covers byes and seeding in full), and `tournament
run` calls this out as its own line the moment it happens rather than leaving it to be inferred
  from a bot's absence from that round's matches. Unlike round robin, this shuffle genuinely
  decides the bracket itself (who gets the bye, who plays whom), not just presentation order. A
  matchup's `matchId` carries a `-g<N>` suffix per game within its own best-of-`bestOf` series (so
  repeated games in one series get distinct match seeds, not the identical one a bare
  round+matchup id would give every game in the series).

- The tournament's `tournamentSeed` (the _only_ place true randomness enters the whole system,
  `docs/adr/0004-deterministic-randomness.md`) is generated fresh each run
  (`generateTournamentSeed()` in `@thunderdome/rng`) — every match's own seed, and the format's
  own shuffle (round robin's pairing order; single elimination's bracket seeding), derive from it
  via `deriveSeed`. It's recorded, hex-encoded, in the persisted record (§6) — visible via
  `tournament inspect`, but not itself enough to _re-run_ the same tournament and get the same
  bracket/pairing order back, since each `run` still calls `generateTournamentSeed()` fresh.
  Re-running the same command produces a new seed and, for round robin specifically, the same set
  of matches (its schedule doesn't depend on the seed) but not necessarily the same pairing
  _order_; single elimination's bracket seeding does depend on the seed, so a re-run can produce a
  genuinely different bracket (different byes, different matchups) even with the same roster. What
  _is_ fully reproducible from the seed alone is `tournament replay` (§6) — but that reads the
  already-played matches back from the record, rather than feeding the seed into a fresh `run`.

## 3. How a format schedules matches

The `TournamentFormat` interface (`docs/adr/0006-tournament-format-abstraction.md`) is real today
— it lives in `@thunderdome/engine`'s `src/tournament.ts` alongside `GameDefinition`, not in
`@thunderdome/tournament-formats` itself (that package depends on engine for this interface and
for `StandingOutcome`/`Rng`; putting the interface there instead would make that a circular
dependency — a deviation from this repo's very first architecture pass, corrected once the actual
dependency direction became concrete). It uses an **incremental pull model**, not an upfront full
schedule — this is the detail that makes both round robin (schedule known immediately) and
bracket formats like single elimination (round 2 depends on round 1's winners) fit the same
contract:

```ts
interface TournamentFormat<TFormatConfig, TFormatState, TStandings> {
  id: string;
  version: string;
  parseConfig(raw: unknown): Result<TFormatConfig>;
  initialize(args: { roster: RosterEntry[]; config: TFormatConfig; rng: Rng }): {
    formatState: TFormatState;
    standings: TStandings;
    readyMatches: MatchDescriptor[]; // whatever's playable right now
  };
  recordResult(args: {
    formatState: TFormatState;
    standings: TStandings;
    match: MatchDescriptor;
    record: MatchRecord;
  }): { formatState: TFormatState; standings: TStandings; readyMatches: MatchDescriptor[] };
  isComplete(args: { formatState: TFormatState; standings: TStandings }): boolean;
  getPublicStandings(standings: TStandings): unknown;
}
```

**Round robin** is real (`packages/tournament-formats/src/round-robin.ts`, `roundRobinFormat`):
`initialize` computes every unique pairing up front from the roster and returns just the _first_
match of each (shuffled via the tournament's own seeded `rng`, for presentation order only) — for
a 3-bot roster, that's 3 matches — see §2's example (`only-rock`, `only-paper`, `only-scissors`).
With the default `bestOf: 1`, that first match immediately decides the pairing and `recordResult`
never unlocks anything more — the "unlock everything up front, never unlock more" degenerate case
the incremental pull model was designed to also cover trivially. With `bestOf` above 1, though,
round robin genuinely _does_ unlock more: `recordResult` re-runs the same pairing until either
bot reaches a majority of that pairing's match wins or `bestOf` matches have been played, whichever
comes first — a real demonstration of the incremental model, not just the degenerate case.

**Single elimination** is real too (`packages/tournament-formats/src/single-elimination.ts`,
`singleEliminationFormat`) — this is the genuine "round 2 depends on round 1" case the incremental
pull model was designed for, not just the degenerate one round robin covers: `initialize` seeds
the bracket (a Fisher-Yates shuffle of the roster via the tournament's own seeded `rng` — this
does affect the actual matchups, unlike round robin's presentation-only shuffle) and returns only
round 1's matchups; `recordResult` accumulates each matchup's own best-of-`bestOf` series (the
same shared logic round robin's pairings use, `packages/tournament-formats/src/series.ts`), and
once every matchup in a round has a winner, computes and unlocks round N+1's matchups from those
winners — see §2's example (`only-rock`, `only-paper`, `only-scissors`). Two details that don't
show up in the interface itself:

- **Byes.** A non-power-of-two roster can't pair everyone every round — the last participant left
  over in bracket order (after the round's real pairings are made) draws a bye and advances
  automatically, without a `readyMatches` entry at all. This can recur every round (5 participants:
  round 1 has 2 matchups + 1 bye → round 2 has 3 survivors → 1 matchup + 1 bye again → round 3's
  final). Since a bye is invisible to the `readyMatches`/`recordResult` machinery by construction
  — nothing runs, nothing to record — `initialize`/`recordResult` report it via the
  `TournamentFormatInitializeResult.notices` field instead (`packages/engine/src/tournament.ts`):
  a plain string like `"only-rock draws a bye in round 1"`. `runTournament()`'s `onNotice`
  callback (`RunTournamentArgs`, `packages/engine/src/tournament-runner.ts`) fires with each one,
  in order, interleaved with match execution exactly where it happened — `tournament run` passes
  a callback that just prints it (§2's examples show the result). `notices` is generic
  infrastructure, not single-elimination-specific: any format can report something that isn't a
  match through it; round robin currently never does, since every match it plays already gets
  its own printed line.
- **A matchup can't end tied.** Round robin can happily record a drawn pairing (`getPublicStandings`
  reports it as a real tie) since nothing downstream depends on it having a winner. A bracket
  matchup isn't so lucky: someone has to advance. If a matchup's own best-of-`bestOf` series
  itself ends tied (every game drew, or the decisive wins split evenly), `recordResult` breaks the
  tie by the lower `participantId` — a plain string comparison, deliberately simple and
  reproducible rather than "fair," chosen because `recordResult` never receives `rng` (only
  `initialize` does, per the interface above) so it can't flip a seeded coin instead.

The orchestrator loop that drives either format is identical either way — it never special-cases
which format is running; this is proven by `@thunderdome/engine`'s `runTournament()`
(`src/tournament-runner.ts`), which contains zero format-specific logic despite two real formats
now existing.

## 4. How results roll up into standings

A format never sees a game's actual result type (RPS's `RpsResult`, or whatever a future game
returns) — that would break format/game independence. Instead, every game translates its own
result into a generic shape:

```ts
interface StandingOutcome {
  participantId: string;
  rank: number; // 1 = best; ties share a rank
  score?: number;
  outcome?: 'win' | 'loss' | 'draw';
}
```

This already exists and is exercised today — `GameDefinition.getStandingOutcomes` in
`packages/engine/src/types.ts`, and Rock-Paper-Scissors's implementation of it in
`games/rock-paper-scissors/src/game.ts`. A format's `recordResult` consumes
`MatchRecord.standingOutcomes` (always this shape, regardless of game) to update its own
tournament-wide standings — for round robin, that's just accumulating wins/losses/draws per bot
into a table; `getPublicStandings` projects that into whatever a spectator or CLI should see
(e.g. sorted by wins, then by round differential).

## 5. What's done, and what's still missing

Done:

1. **Bot registry** — `@thunderdome/registry`'s `scanBots`/`scanGames`, so a roster can
   reference real bot ids instead of a made-up list.
2. **Runtime ↔ engine adapter** — `@thunderdome/runtime`'s `DockerActionCollector`, a
   real `ActionCollector` (`@thunderdome/engine`) backed by real `BotLifecycle` instances, so
   `runMatch()` can actually drive Docker containers instead of a test's scripted collector.
3. **A CLI command for a single match** — `yarn thunderdome match run <botId> <botId>`
   (`apps/cli/src/commands/match.ts`) — see [the bot guide's
   §7](rps-bot-author-guide.md#7-testing-your-bot-locally).
4. **Two `TournamentFormat` implementations** — round robin and single elimination, both in
   `packages/tournament-formats`, both concretely implementing the interface in §3.
5. **Tournament orchestrator** — `@thunderdome/engine`'s `runTournament()`
   (`src/tournament-runner.ts`), the generic pull-loop that calls a match executor for each
   `readyMatches` entry and feeds results back into the format. Game/runtime-agnostic by
   construction: it takes a plain `(match) => Promise<MatchRecord>` callback rather than knowing
   anything about Docker or the registry itself.
6. **A CLI command for a whole tournament** — `yarn thunderdome tournament run <botId>
<botId> [...]` (`apps/cli/src/commands/tournament.ts`), with `--tournament-config`'s `format`
   field choosing between the two implemented formats — see §2.
7. **Tournament persistence** — every `run` writes a `TournamentRecord`
   (`@thunderdome/tournament-store`) as it goes; `tournament list`/`inspect`/`replay` read it
   back. See §6.

Still missing:

- **Any format beyond round robin and single elimination** — Swiss, pool-then-elimination. §3's
  `TournamentFormat` interface fits both without engine changes (ADR-0006), but neither is built.

This guide will be updated again once that lands.

## 6. Tournament persistence: list, inspect, replay

Every `tournament run` writes a record to disk as it plays — `docs/adr/0009-tournament-persistence.md`
covers the design and why `tournament create` (as a separate step before `run`) was simplified
away. Nothing about §2's usage changes: the record is a side effect, not a new required flag.

```bash
yarn thunderdome tournament list
```

```
db99a9f0-2e67-4151-8315-897eb37ce207  2026-08-23T04:38:52.045Z  completed  rock-paper-scissors/round-robin  only-rock, only-paper, only-scissors
```

```bash
yarn thunderdome tournament inspect db99a9f0-2e67-4151-8315-897eb37ce207
```

```
Tournament db99a9f0-2e67-4151-8315-897eb37ce207
  status: completed
  created: 2026-08-23T04:38:52.045Z, completed: 2026-08-23T04:38:52.859Z
  game: rock-paper-scissors@1.0.0
  format: round-robin@2.0.0
  roster: only-rock, only-paper, only-scissors
  seed: 95500ca1b34ac6569fd4e05a61177823e2b8cd6c138181592a2d01cff4542f49
  matches played: 3

Final standings:
1. only-paper — 1W 1L 0D (1 pts)
2. only-rock — 1W 1L 0D (1 pts)
3. only-scissors — 1W 1L 0D (1 pts)
```

```bash
yarn thunderdome tournament replay db99a9f0-2e67-4151-8315-897eb37ce207
```

`replay` prints every match's stored per-round events and result, then the same final standings
— entirely from the record, no Docker, no bots, no registry lookup. This is the deterministic
kind of replay ADR-0004 describes ("replaying a persisted match record is fully deterministic"):
it's reading back what already happened, not re-running the same live bots and hoping for the
same outcome (which ADR-0004 explicitly does _not_ promise, since timeouts/forfeits depend on
real wall-clock behavior). A record stays inspectable and replayable even after the bots that
produced it are gone or have changed.

- `list`/`inspect`/`replay` all accept `--store-dir <path>` to point at a non-default store (the
  default is `.thunderdome/tournaments/` under the directory `tournament run` was invoked from —
  gitignored local run state, not something to commit).
- `list` shows every record's id, timestamps, status, `gameId/formatId`, and roster — enough to
  find the one you want without loading its full match/event history.
- `inspect` shows one record's full metadata and final standings, but not the per-match event
  detail `replay` shows.
- A record's `status` is `'running'` until the tournament finishes, `'completed'` once it has
  (with `standings` set), or `'failed'` (with an `error` message) if something threw partway
  through — `inspect`/`list` surface all three; a `'running'` record with fewer matches than
  expected is exactly what a crash mid-tournament leaves behind, which is the point: every match
  played so far is saved as it completes, not just at the end.

## See also

- `docs/architecture.md` §6 (Tournament abstraction) and §1 (mental model)
- `docs/adr/0009-tournament-persistence.md` — the persistence design and why `create` was folded
  into `run`
- `docs/adr/0006-tournament-format-abstraction.md` — the full design and its reasoning
- `docs/adr/0004-deterministic-randomness.md` — the seed/reproducibility model this guide's §2 depends on
- `docs/guides/rps-bot-author-guide.md` — what a roster entry (a bot) actually is today
