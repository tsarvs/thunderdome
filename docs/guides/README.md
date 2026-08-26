# Guides

Practical, hands-on documentation for building on top of Thunderdome. For the _why_ behind the
architecture these guides use, see `docs/architecture.md` and `docs/adr/`.

| Guide                                                      | For                                         | Status                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`rps-bot-author-guide.md`](rps-bot-author-guide.md)       | Writing a Rock-Paper-Scissors bot           | Real and testable today — protocol, runtime, and the game itself are all implemented                                                  |
| [`hearts-bot-author-guide.md`](hearts-bot-author-guide.md) | Writing a Hearts bot                        | Real and testable today — 3 reference bots exist; `match run` (4 bots) and `play` (human + 3 bots) both work end to end               |
| [`tournament-author-guide.md`](tournament-author-guide.md) | Configuring and persisting a tournament     | Real for round robin, single elimination, and persistence; Swiss/pool-then-elimination not built                                      |
| [`game-authoring-guide.md`](game-authoring-guide.md)       | Implementing a new `GameDefinition`         | Real — walks through Rock-Paper-Scissors and Connect Four in depth; Hearts is a third real, tested implementation of the same interface, described in [`hearts-bot-author-guide.md`](hearts-bot-author-guide.md) and `games/card-game-hearts/src/types.ts` instead |
| [`protocol-reference.md`](protocol-reference.md)           | The wire protocol, precisely                | Real — every message type, with real examples from `packages/protocol/fixtures`                                                       |
| [`security-model.md`](security-model.md)                   | Isolation, timeouts, and cleanup guarantees | Real — summarizes ADR-0003 for bot authors and operators, plus resource-cleanup detail ADR-0003 itself doesn't spell out in one place |

Connect Four (`games/connect-four`) is the platform's second real game — sequential and fully
observable, unlike Rock-Paper-Scissors' simultaneous reveal. It doesn't have its own _bot_ author
guide yet (only [`rps-bot-author-guide.md`](rps-bot-author-guide.md) does) — its wire shapes
(`ConnectFourObservation`/`ConnectFourAction`) are documented directly in
`games/connect-four/src/types.ts` and in [`protocol-reference.md`](protocol-reference.md), and
`bots/connect-four/` has two working reference bots (`leftmost-connect-four`,
`random-connect-four`) to read for a concrete starting point.

Hearts (`games/card-game-hearts`) is the platform's third real game and its first with hidden
information and more than 2 players — 4 seats, your own hand private, a simultaneous passing
phase before each hand's sequential trick play. It **does** have its own
[`hearts-bot-author-guide.md`](hearts-bot-author-guide.md), and `bots/card-game-hearts/` has
three working reference bots (`random-hearts`, `lowest-card-hearts`, `point-dodger-hearts`).
[`game-authoring-guide.md`](game-authoring-guide.md) still only walks through Rock-Paper-Scissors
and Connect Four from the _implementer's_ side — Hearts' own state machine, hidden-information
handling, and rules are documented in `games/card-game-hearts/src/types.ts` and
[`hearts-bot-author-guide.md`](hearts-bot-author-guide.md) instead.

`examples/` holds complete, working example code referenced by the guides above:

- [`examples/counter-bot/`](examples/counter-bot/) — a full Rock-Paper-Scissors bot, with its own
  README.

See [`/bots`](../../bots/) for the reference bots, and run `yarn thunderdome match run <botId>
<botId> [...moreBotIds]` to play several of them against each other through the real registry,
engine, and runtime end to end (`apps/cli/src/commands/match.ts`) — see
[`rps-bot-author-guide.md`](rps-bot-author-guide.md) or
[`hearts-bot-author-guide.md`](hearts-bot-author-guide.md) for details (the registry/CLI/protocol
mechanics both walk through are the same for any game — Hearts just needs exactly 4 bot ids where
Rock-Paper-Scissors needs 2). `yarn thunderdome play <botId> [...moreBotIds]` does the same
thing with you filling one seat instead of a bot — see
[`apps/cli/README.md`](../../apps/cli/README.md#play).
