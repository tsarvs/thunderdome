# Guides

Practical, hands-on documentation for building on top of Thunderdome. For the _why_ behind the
architecture these guides use, see `docs/architecture.md` and `docs/adr/`.

**New here, or new to programming in general?** Start with
[`getting-started.md`](getting-started.md) — it explains what Node, Yarn, Docker, and a "dev
environment" actually are in plain language, then points you at
[`testing-guide.md`](testing-guide.md) for what a unit/integration test is and how to write one.
Every guide below assumes you already have a working dev environment and know what a test is;
neither is re-explained per-guide.

| Guide                                                                          | For                                         | Status                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`getting-started.md`](getting-started.md)                 | Total beginners: Node/Yarn/Docker/dev-env, plain language | Real — a translation layer over the root README's setup steps, not a substitute for them              |
| [`testing-guide.md`](testing-guide.md)                     | What unit/integration tests are, and writing your first one | Real — walks through this repo's actual test suites, no toy examples                                 |
| [`bot-author-guide.md`](bot-author-guide.md)               | Writing a bot for any game — one guide, game-agnostic throughout, with a dedicated section per game's own specifics | Real and testable today — protocol, runtime, and Rock-Paper-Scissors/Hearts (§9/§10) are all implemented |
| [`game-authoring-guide.md`](game-authoring-guide.md)       | Implementing a new `GameDefinition`         | Real — walks through Rock-Paper-Scissors and Connect Four in depth; Hearts is a third real, tested implementation of the same interface, described in [`bot-author-guide.md`](bot-author-guide.md) §10 and `games/card-game-hearts/src/types.ts` instead |
| [`human-friendly-games-guide.md`](human-friendly-games-guide.md) | Making a game pleasant to play by hand, and other ways to develop it further | Real — Rock-Paper-Scissors and Hearts both implement `humanInterface`; Connect Four doesn't yet, and is this guide's own worked exercise |
| [`tournament-author-guide.md`](tournament-author-guide.md) | Configuring and persisting a tournament     | Real for round robin, single elimination, Swiss league, and persistence                                                               |
| [`tournament-format-authoring-guide.md`](tournament-format-authoring-guide.md) | Building a brand new `TournamentFormat` | Real — three real formats (round robin, single elimination, Swiss league) as worked references; pool-then-elimination still not built |
| [`protocol-reference.md`](protocol-reference.md)           | The wire protocol, precisely                | Real — every message type, with real examples from `packages/protocol/fixtures`                                                       |
| [`security-model.md`](security-model.md)                   | Isolation, timeouts, and cleanup guarantees | Real — summarizes ADR-0003 for bot authors and operators, plus resource-cleanup detail ADR-0003 itself doesn't spell out in one place |

Connect Four (`games/connect-four`) is the platform's second real game — sequential and fully
observable, unlike Rock-Paper-Scissors' simultaneous reveal. It doesn't have its own dedicated
section in [`bot-author-guide.md`](bot-author-guide.md) yet (only Rock-Paper-Scissors and Hearts
do, §9/§10) — its wire shapes (`ConnectFourObservation`/`ConnectFourAction`) are documented
directly in `games/connect-four/src/types.ts` and in
[`protocol-reference.md`](protocol-reference.md), and `bots/connect-four/` has two working
reference bots (`leftmost-connect-four`, `random-connect-four`) to read for a concrete starting
point.

Hearts (`games/card-game-hearts`) is the platform's third real game and its first with hidden
information and more than 2 players — 4 seats, your own hand private, a simultaneous passing
phase before each hand's sequential trick play. It **does** have its own section in
[`bot-author-guide.md`](bot-author-guide.md) (§10), and `bots/card-game-hearts/` has five working
bots (`random-hearts`, `lowest-card-hearts`, `point-dodger-hearts`, `tominator-t1`,
`tominator-t101` — see `bots/README.md` for which are reference bots versus real competitors).
[`game-authoring-guide.md`](game-authoring-guide.md) still only walks through Rock-Paper-Scissors
and Connect Four from the _implementer's_ side — Hearts' own state machine, hidden-information
handling, and rules are documented in `games/card-game-hearts/src/types.ts` and
[`bot-author-guide.md`](bot-author-guide.md) §10 instead.

`examples/` holds complete, working example code referenced by the guides above:

- [`examples/counter-bot/`](examples/counter-bot/) — a full Rock-Paper-Scissors bot, with its own
  README.

See [`/bots`](../../bots/) for the reference bots, and run `yarn thunderdome match run <botId>
<botId> [...moreBotIds]` to play several of them against each other through the real registry,
engine, and runtime end to end (`apps/cli/src/commands/match.ts`) — see
[`bot-author-guide.md`](bot-author-guide.md) §7 for details (the registry/CLI/protocol mechanics
are the same for any game — Hearts just needs exactly 4 bot ids where Rock-Paper-Scissors needs
2). `yarn thunderdome play <botId> [...moreBotIds]` does the same thing with you filling one seat
instead of a bot — see [`apps/cli/README.md`](../../apps/cli/README.md#play).
