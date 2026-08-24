# `thunderdome` CLI

The `@thunderdome/cli` package (`apps/cli`) is the platform's command-line entrypoint. It's a thin
presentation layer — no game/engine logic lives here (`docs/architecture.md` §2) — that currently
implements real commands for running matches and tournaments (`match run`, `tournament run`),
reading tournaments back after the fact (`tournament list`/`inspect`/`replay`), and playing a bot
yourself, turn by turn, from this terminal (`play`), plus stubs for the rest.

## Running it

From the repo root, during development (via `tsx`, no build step needed):

```bash
yarn thunderdome --help
```

Or, after `yarn build`, as the built binary directly:

```bash
node apps/cli/dist/index.js --help
```

Both forms take the same arguments throughout this doc. `--help`/`-h` prints usage and exits 0;
`--version`/`-v` prints the CLI's version and exits 0.

**Run it from the repo root** (or pass a directory that itself contains `games/` and `bots/`) —
both `match run` and `tournament run` resolve bots and games by scanning `games/` and `bots/`
under the current working directory; there's no other way to point them at a different location
today.

## Commands

| Command              | Status                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `match run`          | Real — runs one match between two or more bots. See below.                                       |
| `play`               | Real — a human, typing into this terminal, plays one interactive match against a bot. See below. |
| `tournament run`     | Real — runs a round-robin or single-elimination tournament among two or more bots. See below.    |
| `tournament list`    | Real — lists persisted tournament records. See below.                                            |
| `tournament inspect` | Real — prints one persisted tournament's details and final standings. See below.                 |
| `tournament replay`  | Real — replays a persisted tournament's matches purely from its record, no Docker. See below.    |
| `cleanup`            | Real — force-removes any leftover Thunderdome bot containers. See below.                         |
| `games`              | Stub — prints "not yet implemented"                                                              |
| `bots`               | Stub — prints "not yet implemented"                                                              |

## `match run`

```bash
yarn thunderdome match run <botId> <botId> [...moreBotIds] [--config '<json>']
```

Resolves every given bot id (and the game they all share) through the real bot/game registry
(`@thunderdome/registry`), builds each bot's Docker image on demand from its own manifest — no
manual `docker build` step first — then drives a real match through the generic engine
(`@thunderdome/engine`'s `runMatch()`) and runtime (`@thunderdome/runtime`'s
`DockerActionCollector` and `BotLifecycle`), printing each round's result and final rank-sorted
standings.

```bash
yarn thunderdome match run only-rock only-paper --config '{"totalRounds":3}'
```

```
Building 2 bot image(s)...

Match: only-rock vs only-paper (Rock Paper Scissors)

  round-result: { winner: 'only-paper', choiceA: 'rock', choiceB: 'paper' }
  round-result: { winner: 'only-paper', choiceA: 'rock', choiceB: 'paper' }
  round-result: { winner: 'only-paper', choiceA: 'rock', choiceB: 'paper' }

1. only-paper (win, score=3)
2. only-rock (loss, score=0)
```

(At the real default of 300 rounds, the per-round lines are replaced with a single
`(300 rounds played)` line instead — see [the note below](#a-note-on-ties-and-non-terminating-matches).)

- `--config` is whatever JSON the shared game's own `parseConfig` expects — for
  Rock-Paper-Scissors, `{"totalRounds": <positive int>}` (defaults to 300 hands if omitted; see
  `games/rock-paper-scissors/src/types.ts`'s `RpsConfigSchema`). Every configured hand is played
  regardless of who's ahead — the tally at the end decides the winner, or a genuine tie if it's
  exactly even. Defaults to `{}`, which is valid on its own for Rock-Paper-Scissors.
- Bot ids are whatever a bot's own `manifest.json` declares as `id` — see
  [`/bots/rock-paper-scissors/`](../../bots/rock-paper-scissors/) for what's available today, or
  [`docs/guides/rps-bot-author-guide.md`](../../docs/guides/rps-bot-author-guide.md) for writing
  your own.
- All bots in one `match run` must share the same `game` (checked against each bot's own
  manifest) — you'll get a clear error, not a confusing crash, if they don't.
- Exits 0 on a completed, forfeited, or timed-out match (see below), 1 on any resolution error
  (unknown bot/game id, mismatched games, invalid `--config`, or a bot failing to initialize).

### A note on ties and non-terminating matches

Rock-Paper-Scissors plays every configured `totalRounds` hand, full stop — it never tries to
detect "the outcome is already decided" and stop early, and it never keeps replaying indefinitely
either. That means a genuine tie is possible (e.g. a bot that always copies the opponent's last
move, against a bot that always plays the same throw, draws every hand after round one — with
300 real hands played, that's an honest 0-0 tie, not a cop-out) — `match run` reports this as a
real draw in the standings, not specially flagged.

Separately, `runMatch()` (`@thunderdome/engine`) also caps the _whole match_ at 120 seconds of
wall-clock time, regardless of the game or the reason it hasn't finished — pure defense-in-depth
(docs/adr/0003-docker-bot-isolation.md) against a different game's own termination logic having a
similar gap. Rock-Paper-Scissors is bounded by `totalRounds` by construction and shouldn't ever
actually hit this in normal play; if it does, `match run` reports `status: 'match-timeout'`
distinctly from both a forfeit and a real tie.

### A known Docker reliability issue (fixed)

Real Docker container startup used to occasionally race and a bot's `init` handshake would time
out (`INIT_TIMEOUT`) even though the bot and image were fine — root-caused and fixed by a
first-write retry in `@thunderdome/runtime`; see
[`scripts/README.md`](../../scripts/README.md#a-known-docker-reliability-issue-root-caused-and-fixed)
for the full explanation. If you still see this, it's a new issue, not the old one.

## `play`

```bash
yarn thunderdome play <botId> [--as <yourParticipantId>] [--game-config '<json>']
```

Resolves the one given bot id (and its game) through the registry exactly like `match run`, builds
its Docker image on demand, then drives a real match through the same `@thunderdome/engine`
`runMatch()` loop — except this time, one side of the match is you: every round, the game's own
prompt is printed right here in this terminal, and whatever you type becomes your action.

```bash
yarn thunderdome play only-rock --game-config '{"totalRounds":3}'
```

```
Building 1 bot image...

You (you) vs only-rock (Rock Paper Scissors). Type "quit" anytime to resign.

Round 1/3 — you: 0, only-rock: 0
rock, paper, or scissors? (r/p/s) paper
Round 2/3 — you: 1, only-rock: 0
Last round — you: paper, only-rock: rock (you won)
rock, paper, or scissors? (r/p/s) paper
...

1. you (win, score=3)
2. only-rock (loss, score=0)
```

- Requires the shared game to opt in via `GameDefinition.humanInterface` (an optional hook next to
  `onMissingAction` on the same interface, `packages/engine/src/types.ts`) — it owns rendering each
  round's prompt and parsing your reply into that game's own action shape, the same way every other
  piece of a game's rules lives in the game package, not the CLI. Rock-Paper-Scissors implements
  it (`games/rock-paper-scissors/src/game.ts`); a game that hasn't yet gets a clear error here
  rather than a garbled prompt.
- Type "quit" (or "resign") at any prompt to forfeit the match early instead of playing out every
  configured round — this is the same generic missing-action path a bot's crash or timeout takes,
  not a special case.
- An unparseable line (a typo, an empty line, anything the game's `humanInterface.parseInput`
  doesn't recognize) just reprompts — it never counts as a forfeit or an illegal move.
- `--as` names your own participant id (defaults to `you`); it can't collide with the bot's own id.
- Unlike a bot's per-turn deadline, nothing times out your own replies — you set the pace. The
  match as a whole is still capped (a generous 1 hour, not `match run`'s 120 seconds) as pure
  defense-in-depth against a genuinely abandoned session, matching
  [the note on ties and non-terminating matches](#a-note-on-ties-and-non-terminating-matches)
  above.
- Subject to the same
  [interrupt handling](#interrupting-a-running-match-run--play--tournament-run) as
  `match run`/`tournament run` — Ctrl+C tears down the bot's container before exiting.

## `tournament run`

```bash
yarn thunderdome tournament run <botId> <botId> [...moreBotIds] \
  [--tournament-config '<json>'] [--game-config '<json>']
```

Resolves bots and their shared game the same way `match run` does, builds each bot's image once
(not once per match), then drives a real tournament — round robin or single elimination,
`--tournament-config`'s own `format` field choosing which — through `@thunderdome/engine`'s
`runTournament()` and `@thunderdome/tournament-formats`. Every matchup (a round-robin pairing, or
a bracket slot) plays a best-of-N series of matches (`--tournament-config`'s `bestOf`, defaulting
to a single match), printing each match's result as it completes — along with the matchup's
running series score, once `bestOf` is above 1 — and final standings at the end.

```bash
yarn thunderdome tournament run only-rock only-paper only-scissors \
  --game-config '{"totalRounds":3}' --tournament-config '{"bestOf":3}'
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

- `--game-config` is the shared game's own config — the same content `match run`'s `--config`
  takes, just renamed here to distinguish it from `--tournament-config`.
- `--tournament-config` is the format's own config, and also where the format itself is chosen —
  `{ "format": "round-robin" | "single-elimination", "bestOf": <positive odd int> }`. Both fields
  are optional: `format` defaults to `"round-robin"`, and `bestOf` (best of how many matches each
  matchup plays) defaults to `1`. Any other `format` value is a clear error, not a crash. A
  matchup stops as soon as either bot reaches a majority of decisive match wins, or once `bestOf`
  matches have been played — whichever comes first. This is safe from the kind of hang
  `totalRounds` was built to prevent, since every individual match is itself already bounded by
  the game's own rules; a round-robin pairing that draws every single match still finishes after
  exactly `bestOf` matches, tied. A single-elimination matchup can't end tied, though — see below.
- Whenever `bestOf` is above 1, each match's result line is followed by a `series:` line showing
  that matchup's running score (`<bot> leads 2-0 (2/3 played)`), and once the matchup is decided,
  a `series decided:` recap instead. This is presentation only — purely derived in
  `apps/cli/src/commands/tournament.ts` from each match's own result, not new format state — so it
  never affects scoring, only what gets printed as a series plays out.
- For single elimination:

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

  With an odd number of participants, the roster's seeded shuffle leaves one bot a bye each round
  — it advances straight to the next round without playing, and `tournament run` calls this out
  as its own line right when it happens (`only-rock draws a bye in round 1` above), rather than
  leaving the bot's absence from that round's matches to speak for itself. This can recur every
  round for a large-enough roster (e.g. 5 participants draws a bye in both round 1 and round 2).
  A bracket matchup that can't produce a majority winner (every game in its series drew, or the
  wins split evenly) still has to advance someone, unlike a round-robin pairing — it's decided by
  the lower participant id, a deliberately simple, reproducible tiebreak rather than a "fair" one.
  Full detail on both: [`docs/guides/tournament-author-guide.md`](../../docs/guides/tournament-author-guide.md)
  §3.

- Every run is persisted as it goes — see `tournament list`/`inspect`/`replay` below and
  [`docs/adr/0009-tournament-persistence.md`](../../docs/adr/0009-tournament-persistence.md) for
  the design.
- Subject to the same [now-fixed Docker reliability issue](#a-known-docker-reliability-issue-fixed)
  and the same [notes on ties and non-terminating matches](#a-note-on-ties-and-non-terminating-matches)
  as `match run` — a genuinely tied or timed-out match is scored as a draw (round robin) or
  resolved by the tiebreak above (single elimination), and the tournament continues.

## `tournament list` / `inspect` / `replay`

```bash
yarn thunderdome tournament list [--store-dir <path>]
yarn thunderdome tournament inspect <tournamentId> [--store-dir <path>]
yarn thunderdome tournament replay <tournamentId> [--store-dir <path>]
```

Every `tournament run` writes a `TournamentRecord` to `.thunderdome/tournaments/` (gitignored
local run state — override the location with `--store-dir`) as it plays, not just at the end — a
tournament interrupted partway through still leaves every match played so far on disk. `list`
prints one line per record (id, timestamps, status, `gameId/formatId`, roster); `inspect` prints
one record's full metadata and final standings; `replay` prints every match's stored per-round
events and result, then the same final standings — entirely from the record, no Docker, no bots,
no registry lookup.

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

`replay` is deterministic playback of what already happened, not a live re-run of the same bots —
see [`docs/adr/0009-tournament-persistence.md`](../../docs/adr/0009-tournament-persistence.md)
for why that distinction matters (ADR-0004's reproducibility caveat). A `'running'` record with
fewer matches than expected, or a `'failed'` one with an `error` message, is exactly what a
tournament interrupted or crashed partway through leaves behind — `inspect`/`list` surface all
three statuses (`running` / `completed` / `failed`).

## Interrupting a running `match run` / `play` / `tournament run`

Closing the terminal, or an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` — the CLI catches both and
tears down whatever bot containers are currently running before exiting, rather than leaving them
behind (a second interrupt while that's in progress exits immediately instead of waiting). A
tournament interrupted this way leaves its persisted record in `status: 'running'` forever,
honestly reflecting that it never finished — the same as any other mid-run crash (see
[`docs/adr/0003-docker-bot-isolation.md`](../../docs/adr/0003-docker-bot-isolation.md)'s "Resource
cleanup" section for the full design, including the guarantees inside a single match run itself).

## `cleanup`

```bash
yarn thunderdome cleanup
```

The explicit backstop for whatever slips past the above — most notably a `SIGKILL` (or a host
crash) that never gives the CLI a chance to run any of its own cleanup code at all. Force-removes
every container carrying the `thunderdome.matchId` label, regardless of which process created it
or whether that process is still alive:

```
Found 1 leftover container(s):
  2bd79f34b06a  match=manual-orphan-test  participant=only-rock  state=exited
Removed.
```

Prints `No leftover Thunderdome containers found.` (and exits 0) when there's nothing to do.

## What's not built yet

Any tournament format beyond round robin and single elimination (Swiss, pool-then-elimination,
...). See [`docs/guides/tournament-author-guide.md`](../../docs/guides/tournament-author-guide.md)
for the design that still-aspirational piece is meant to fit.

`play` only works against a game that implements `GameDefinition.humanInterface` — today, that's
Rock-Paper-Scissors only. Connect Four hasn't implemented it yet (`play leftmost-connect-four`
gives a clear error, not a crash); doing so is just a matter of `games/connect-four` adding its
own `describeObservation`/`parseInput` pair, no CLI or engine change required.
