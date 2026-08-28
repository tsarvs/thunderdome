# Tournament Format Authoring Guide

This is a different guide from [`tournament-author-guide.md`](tournament-author-guide.md): that
one is for *configuring and running* a tournament in a format that already exists. This one is for
*building a brand new format* — the step-by-step path from "I want a Swiss-style or
pool-then-elimination bracket" to a real, tested, runnable `--tournament-config
'{"format":"my-new-format"}'`.

**Status check first.** Three real `TournamentFormat` implementations exist today, all in
`packages/tournament-formats/src/`: **round robin** (`round-robin.ts`, every pairing plays a
best-of-N series), **single elimination** (`single-elimination.ts`, a seeded bracket), and **Swiss
league** (`swiss-league.ts`, N-participant tables per round ranked by cumulative score — built for
Hearts, where a single 4-player hand is too noisy on its own to judge a bot fairly). All three are
wired into `yarn thunderdome tournament run`/`inspect`/`replay`. This guide uses all three as
worked references — by the time a fourth format exists, it should read as "here's the fourth
example" rather than "here's a hypothetical."

## 1. Read the interface first

Everything a format is responsible for is `docs/adr/0006-tournament-format-abstraction.md`'s
`TournamentFormat` interface, defined in `@thunderdome/engine`'s `src/tournament.ts` (not in
`@thunderdome/tournament-formats` itself — see
[`tournament-author-guide.md`](tournament-author-guide.md) §3 for why):

```ts
interface TournamentFormat<TFormatConfig, TFormatState, TStandings> {
  id: string;
  version: string;
  parseConfig(raw: unknown): Result<TFormatConfig>;
  initialize(args: { roster: RosterEntry[]; config: TFormatConfig; rng: Rng }): {
    formatState: TFormatState;
    standings: TStandings;
    readyMatches: MatchDescriptor[];
    notices?: string[];
  };
  recordResult(args: {
    formatState: TFormatState;
    standings: TStandings;
    match: MatchDescriptor;
    record: MatchRecord;
  }): { formatState: TFormatState; standings: TStandings; readyMatches: MatchDescriptor[]; notices?: string[] };
  isComplete(args: { formatState: TFormatState; standings: TStandings }): boolean;
  getPublicStandings(standings: TStandings): unknown;
}
```

Read [`tournament-author-guide.md`](tournament-author-guide.md) §3 before writing any code — it
walks through exactly how round robin and single elimination implement this **incremental pull
model** (unlock the matches that are ready to play now; unlock more once results come back), which
is the one genuinely non-obvious idea here. Your new format needs to fit the same shape: it's never
handed a full schedule up front, and it never runs a match itself — it only ever decides *which*
matches are ready and *how* results roll up into standings.

`TFormatConfig`/`TFormatState`/`TStandings` are entirely yours, exactly like a `GameDefinition`'s
type parameters (`game-authoring-guide.md` §1) — the engine only ever touches them through these
five methods.

## 2. Decide what your format actually needs to be different

Before writing anything, be concrete about what round robin, single elimination, and Swiss league
*don't* already do that your format needs. This determines almost everything else:

- **Do matches happen between exactly 2 participants, or N?** Round robin and single elimination
  are both hardcoded to 2-participant pairings; Swiss league plays N-participant tables (Hearts'
  4-player hands) — see `swiss-league.ts`'s own top comment for why that generalization was
  needed, and copy its `MatchDescriptor` construction if your format also needs tables larger than
  2.
- **Does round N depend on round N-1's results, or is the whole schedule knowable up front?**
  Round robin's `initialize` computes every pairing immediately (a schedule known in full from the
  roster alone); single elimination and Swiss league both only know their first round up front and
  compute the next round's matchups inside `recordResult` once enough results are in. If your
  format is schedule-driven from the start (a fixed number of predetermined rounds, e.g. a
  round-robin variant with `PC` matches per round rather than everyone-plays-everyone-once), you
  can front-load more into `initialize`; if pairings depend on standings-so-far (as Swiss league's
  do), you need `recordResult` to do real work.
- **How do standings get ranked, and by what?** Round robin ranks by win/loss/draw points; Swiss
  league ranks by cumulative `StandingOutcome.score` across every table played (since Hearts'
  scoring itself is what should decide standings, not a coarser win/loss reduction of it). Decide
  this before writing `TStandings` — it's the type your `getPublicStandings` shapes for display.
- **Can a "round" ever leave someone without a match (a bye), and how do you want that reported?**
  Single elimination and Swiss league both handle a non-evenly-divisible roster via the `notices`
  field (`TournamentFormatInitializeResult`/`recordResult`'s return type) rather than a synthetic
  match — `tournament-author-guide.md` §3 covers the mechanics; reuse the same pattern rather than
  inventing a new one.

If the answer to all of the above matches an existing format exactly, you don't need a new format
— you need a new *config option* on an existing one (e.g. `bestOf`).

## 3. Scaffold the file

There's no `yarn scaffold:tournament-format` script today (unlike `yarn scaffold:game`/`yarn
scaffold:bot`) — a new format is a single new file in an existing package, small enough that
copying the closest existing format and adapting it is the fastest real path:

```
packages/tournament-formats/src/
  my-new-format.ts       # your TournamentFormat implementation + config schema + exported types
```

- Start from whichever existing format is structurally closest to what you need (§2's answers tell
  you which): `round-robin.ts` for a 2-participant, schedule-known-up-front shape;
  `single-elimination.ts` for a 2-participant bracket that depends on prior rounds;
  `swiss-league.ts` for an N-participant, standings-driven shape.
- `series.ts` (in the same directory) has shared best-of-N series logic (`isSeriesDecided`,
  `shuffle`) used by more than one format already — reuse it rather than reimplementing a
  best-of-N decision if your format also plays a series per matchup.
- Add `export * from './my-new-format.js';` to `packages/tournament-formats/src/index.ts`, next to
  the three existing exports.
- Follow the same `parseConfig` zod pattern as `game-authoring-guide.md` §9 describes for
  `GameDefinition` — `RoundRobinConfigSchema`/`SwissLeagueConfigSchema` in the existing files are
  the concrete templates.

## 4. Wire it into the CLI

A format existing in `@thunderdome/tournament-formats` isn't enough on its own — `apps/cli/src/commands/tournament.ts`
has one explicit registry, `FORMATS`, keyed by format id:

```ts
const FORMATS: Record<string, FormatEntry> = {
  [roundRobinFormat.id]: { format: roundRobinFormat, printStandings: (standings) => { ... } },
  [singleEliminationFormat.id]: { format: singleEliminationFormat, printStandings: (standings) => { ... } },
  [swissLeagueFormat.id]: {
    format: swissLeagueFormat,
    printStandings: (standings) => { ... },
    defaultConfig: withSwissLeagueTableSizeDefault, // optional — see below
  },
};
```

Add your own entry the same way: your format object, and a `printStandings` function that renders
your `TStandings` (already projected through `getPublicStandings`) to the terminal — look at
`printSwissLeagueStandingsEntries` for a table-based format's rendering, or
`printRoundRobinStandingsEntries` for a simple win/loss table. `defaultConfig` is optional — only
needed if your format has a config field that should be derived from the resolved game rather than
requiring the caller to always state it explicitly (Swiss league's `tableSize` defaults from the
game's own `minParticipants` when unambiguous; most formats won't need this hook at all).

That single `FORMATS` map is also what makes `--tournament-config '{"format":"<your-id>"}'`
produce a clear, specific error for an unknown format rather than a crash — nothing else in the CLI
needs to change.

## 5. Test it

Follow the same unit-testing approach as a game (`testing-guide.md` §4) — call `initialize()` and
`recordResult()` directly against hand-built rosters and `MatchRecord`s, without any real Docker or
bots involved. `packages/tournament-formats/test/swiss-league.test.ts` is the template to copy for
an N-participant, standings-driven format; `round-robin.test.ts` for a simpler 2-participant one.
Cover, at minimum:

- `parseConfig` — valid input, invalid input, any defaulted fields.
- `initialize` — the shape of `readyMatches` for a roster your format can pair evenly, and
  separately for one it can't (does the bye/leftover case produce the `notices` you expect?).
- `recordResult` — feeding in a `MatchRecord` and checking both the standings update correctly and
  the right next matches unlock (this is the part that actually exercises the incremental-pull
  model, not just its degenerate "everything unlocked immediately" case).
- `isComplete` — that it's `false` mid-tournament and `true` once every match your format expects
  has actually been played.
- `getPublicStandings` — that the projection a spectator/CLI would see is correct for both a
  decisive and a tied intermediate state.

## 6. Prove it end to end

`game-authoring-guide.md` §12 holds a new game to a standard that applies here too — a format
isn't finished until it's run for real:

```bash
yarn build && yarn lint && yarn typecheck && yarn test
yarn thunderdome tournament run <botId> <botId> [...moreBotIds] \
  --tournament-config '{"format":"<your-format-id>", ...}'
```

If this works without any further change to `@thunderdome/engine`'s tournament orchestrator
(`runTournament()`, `src/tournament-runner.ts`) — which should contain zero format-specific logic,
by design — that's the real proof the abstraction held for your format too, the same way it held
for Swiss league joining round robin and single elimination without an engine change.

## 7. Update the docs your format is now part of

Once your format is real, it stops being "not yet built" everywhere that phrase currently appears
— check [`tournament-author-guide.md`](tournament-author-guide.md) (the table in §1, and §5's
"still missing" list), `games/README.md`'s per-game "Tournament formats" column for any game your
format now supports, and the root [`README.md`](../../README.md) if it mentions the current set of
formats by name. A format that works but is still documented as missing is a trap for the next
person who reads the docs before the code.

## See also

- `docs/adr/0006-tournament-format-abstraction.md` — the full reasoning behind the interface in §1
- [`tournament-author-guide.md`](tournament-author-guide.md) — how an existing format is
  configured and run, including the incremental pull model explained in more depth
- `docs/adr/0009-tournament-persistence.md` — how a format's `getPublicStandings` output ends up in
  a `TournamentRecord`, read back by `tournament inspect`/`replay`
- `packages/tournament-formats/src/round-robin.ts`, `single-elimination.ts`, `swiss-league.ts` —
  the three real implementations this guide describes
