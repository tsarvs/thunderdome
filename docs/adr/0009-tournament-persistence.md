# ADR-0009: Tournament Persistence

## Status

Accepted

## Context

Every prior `tournament run` was entirely ephemeral: results printed to stdout and vanished the
moment the process exited. The tournament-author-guide had always described the eventual shape as
three pieces — `tournament create` (a persisted record with a seed you can inspect or replay
later), `match inspect`, and `replay` — but none of it was built, and "no database" is a
deliberate, standing constraint (`docs/architecture.md` §10) that any design here has to respect.

Two questions needed answering before writing any code:

1. **Where does a record live, given "no database"?** The registry (ADR-0001) already
   establishes the precedent of plain files as the source of truth (`manifest.json`, scanned from
   disk, no index) — a tournament record can follow the same shape: one JSON file per tournament,
   no server process, no schema migrations.
2. **Does `create` need to be a separate step from `run`?** The original three-piece design
   implies creating a record and actually playing it are different moments — useful if, say, you
   wanted to schedule a tournament now and run it later. Nothing in this platform has that need
   yet: bots, games, and formats are all resolved synchronously at `run` time already. Splitting
   `create` out would mean designing a "record exists but hasn't been run yet" state with no
   current consumer.

## Decision

**One JSON file per tournament**, keyed by a random id (`crypto.randomUUID()`), written by a new
`@thunderdome/tournament-store` package — pure filesystem read/write plus zod validation on load
(so a hand-edited or corrupted file fails with a clear message instead of a crash deep in
`inspect`/`replay`), no engine/runtime/registry dependency. Default location is
`<rootDir>/.thunderdome/tournaments/<id>.json`, overridable via `--store-dir` (mainly so tests
don't write into the real repo tree); `.thunderdome/` is gitignored — it's local run state, not
source.

**`tournament create` was folded into `tournament run`.** `run` now always generates an id,
writes a `'running'` record before building any bot images (so a crash during image build or the
very first match still leaves something inspectable), appends each match's outcome as it
completes, and marks the record `'completed'` (with the format's own public standings) or
`'failed'` (with the error) at the end. This is a deliberate simplification from the
originally-sketched three-piece design, not a partial implementation of it — there is currently no
scenario where creating a record ahead of playing it is useful, and inventing one speculatively
would be exactly the kind of unrequested abstraction this project's own conventions warn against.
If a real need for a decoupled `create` ever shows up (e.g. scheduling), splitting it back out is
straightforward: the record shape doesn't change, only when the first write happens.

**A `TournamentRecord` stores**: the resolved game/format ids and versions, both configs, the
roster, the hex-encoded `tournamentSeed` (ADR-0004's one entropy boundary — not secret, safe to
persist), and one `PersistedMatch` per completed match (`matchId`, `participantIds`, `status`,
`standingOutcomes`, and the full per-round `events` log). `standings` holds the format's own
`getPublicStandings()` projection, not the internal `TStandings` — this is what a live run already
prints, so `inspect`/`replay` render it with the exact same formatting code instead of needing to
reconstruct or re-import format-internal state.

**`replay` is deterministic playback from the record, never a live re-run.** It reads the stored
`events`/`standingOutcomes` for each match and prints them in the same shape a live run would have
— no Docker, no bots, no registry. This is the "replaying a persisted match record is fully
deterministic" case ADR-0004 already called out, as distinct from re-running the same live bots
again (which ADR-0004 explicitly does _not_ guarantee reproduces identical timeouts/forfeits,
since those depend on real wall-clock behavior). A record is therefore inspectable and replayable
even after the bots that produced it are gone, changed, or misbehaving.

`tournament list` summarizes every record in the store dir (id, timestamps, status, game/format,
roster) without loading full match/event data for each one — `TournamentSummary` is a lighter
projection than `TournamentRecord`, for exactly this reason.

## Consequences

- No concurrent-write story is needed: one `tournament run` process owns one record file for its
  whole lifetime, and nothing else writes to it. If concurrent tournaments ever needed to append to
  a _shared_ record (they don't today — each `run` creates its own), this would need revisiting.
- Corrupt or missing records degrade gracefully: `loadTournamentRecord` returns a `Result`, never
  throws; `listTournamentRecords` collects per-file issues instead of letting one bad file hide
  every other tournament.
- A record is a plain, readable JSON file — a competitor or maintainer can open one directly
  without any tooling, consistent with the registry's own "metadata must never require executing
  code" stance (ADR-0001), even though a tournament record isn't itself competitor-authored.
- This does not add search, pagination, retention limits, or cleanup of old records — `.thunderdome/`
  grows unboundedly today. Acceptable for now (records are small — a few KB to a few hundred KB
  depending on round counts); revisit if it becomes a real problem.
