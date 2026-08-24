# ADR-0006: Tournament Format Abstraction

## Status

Accepted

## Context

Tournament formats (round robin, single/double elimination, Swiss, pool-then-elimination, custom)
must be pluggable without modifying the core engine or tournament orchestrator. An early strawman
proposed `generateSchedule(roster, config, rng): MatchPlan` — a single upfront call. This silently
assumes round robin's shape: that the full set of matches to play is knowable before any match has
been played. Single elimination breaks this — round 2's pairings depend on round 1's winners.

## Decision

### Incremental pull model

```ts
interface TournamentFormat<TFormatConfig, TFormatState, TStandings> {
  id: string;
  version: string;
  parseConfig(raw: unknown): Result<TFormatConfig>;
  initialize(args: { roster: RosterEntry[]; config: TFormatConfig; rng: Rng }): {
    formatState: TFormatState;
    standings: TStandings;
    readyMatches: MatchDescriptor[];
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

`initialize` returns whatever matches are immediately playable (`readyMatches`); `recordResult`,
called after every completed match, may unlock more. The orchestrator loop is uniform and never
changes when a new format is added:

```
{ formatState, standings, readyMatches: queue } = format.initialize({ roster, config, rng })
while queue.length > 0 && !format.isComplete({ formatState, standings }):
  match = queue.shift()
  record = runMatch(...)
  ({ formatState, standings, readyMatches: unlocked }) = format.recordResult({ formatState, standings, match, record })
  queue.push(...unlocked)
```

### Validated against both shapes

- **Round robin**: `initialize` computes every pairing up front and returns them all as
  `readyMatches`; `recordResult` updates a win/draw/loss table and always returns `[]` — the
  degenerate case of "unlock everything on day one, never unlock more."
- **Single elimination**: `initialize` seeds the bracket (byes handled inside `formatState`,
  never exposed to the game) and returns only round-1 pairings; `recordResult` records winners
  (from `record.standingOutcomes`, rank 1) into bracket slots, and once an entire round is
  recorded, computes and returns the next round's pairings.
- **Swiss / pool-then-elimination** (not implemented yet, but checked for fit): Swiss's
  `recordResult` withholds `readyMatches` until a full round is in, then computes next-round
  pairings from current standings — directly expressible. Pool-then-elimination can be one format
  with an internal `phase: 'pools' | 'bracket'`, or built by nesting one `TournamentFormat` inside
  another — the interface is uniform enough to compose. Neither requires touching the orchestrator.

> **Status update:** single elimination described above was design-time validation reasoning
> when this ADR was written; it's now a real implementation
> (`packages/tournament-formats/src/single-elimination.ts`, `singleEliminationFormat`), matching
> the shape above exactly — `initialize` returns only round 1, `recordResult` genuinely computes
> and unlocks round N+1 only once round N fully decides. Two details this ADR didn't anticipate,
> settled during implementation rather than revising the decision above: byes for a
> non-power-of-two roster are handled by auto-advancing the last participant in bracket order each
> round (not a special engine or protocol concept, just `formatState` bookkeeping, as this ADR's
> "byes handled inside `formatState`" line already implied); and a bracket matchup, unlike a
> round-robin pairing, cannot end tied (something must advance), so a matchup whose best-of-N
> series itself ends tied breaks the tie by the lower `participantId` — deliberately simple and
> reproducible rather than fair, since `recordResult` has no `rng` access to do better (only
> `initialize` does).

### Game/format decoupling

A format never sees a game's raw `TResult` — it consumes `MatchRecord.standingOutcomes`, which is
always `StandingOutcome[]` (`{participantId, rank, score?, outcome?}`), produced by
`GameDefinition.getStandingOutcomes(result)` (ADR-0005/architecture §5). This is what makes "any
format works with any game" actually true, not just aspirational: neither side needs to know the
other's internal types.

## Consequences

- Adding a new format is a new module implementing this interface plus a config schema — zero
  engine changes.
- The orchestrator's job is reduced to "pull ready matches, run them, feed results back, repeat
  until told it's done" — genuinely game- and format-agnostic.
- `id`/`version` on both `GameDefinition` and `TournamentFormat` are pinned into the persisted
  tournament record, so a reproducible record names exactly which implementation versions produced
  it.
