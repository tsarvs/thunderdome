# Guides

Practical, hands-on documentation for building on top of Thunderdome. For the _why_ behind the
architecture these guides use, see `docs/architecture.md` and `docs/adr/`.

| Guide                                                      | For                                         | Status                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`rps-bot-author-guide.md`](rps-bot-author-guide.md)       | Writing a Rock-Paper-Scissors bot           | Real and testable today — protocol, runtime, and the game itself are all implemented                                                  |
| [`tournament-author-guide.md`](tournament-author-guide.md) | Configuring and persisting a tournament     | Real for round robin, single elimination, and persistence; Swiss/pool-then-elimination not built                                      |
| [`game-authoring-guide.md`](game-authoring-guide.md)       | Implementing a new `GameDefinition`         | Real — describes the two real games (Rock-Paper-Scissors, Connect Four) and the interface both implement                              |
| [`protocol-reference.md`](protocol-reference.md)           | The wire protocol, precisely                | Real — every message type, with real examples from `packages/protocol/fixtures`                                                       |
| [`security-model.md`](security-model.md)                   | Isolation, timeouts, and cleanup guarantees | Real — summarizes ADR-0003 for bot authors and operators, plus resource-cleanup detail ADR-0003 itself doesn't spell out in one place |

Connect Four (`games/connect-four`) is the platform's second real game — sequential and fully
observable, unlike Rock-Paper-Scissors' simultaneous reveal. It doesn't have its own _bot_ author
guide yet (only [`rps-bot-author-guide.md`](rps-bot-author-guide.md) does) — its wire shapes
(`ConnectFourObservation`/`ConnectFourAction`) are documented directly in
`games/connect-four/src/types.ts` and in [`protocol-reference.md`](protocol-reference.md), and
`bots/connect-four/` has two working reference bots (`leftmost-connect-four`,
`random-connect-four`) to read for a concrete starting point. [`game-authoring-guide.md`](game-authoring-guide.md)
covers both games from the _implementer's_ side.

`examples/` holds complete, working example code referenced by the guides above:

- [`examples/counter-bot/`](examples/counter-bot/) — a full Rock-Paper-Scissors bot, with its own
  README.

See [`/bots`](../../bots/) for the reference bots, and run `yarn thunderdome match run <botId>
<botId>` to play two of them against each other through the real registry, engine, and runtime
end to end (`apps/cli/src/commands/match.ts`) — see
[`rps-bot-author-guide.md`](rps-bot-author-guide.md) for details (written for Rock-Paper-Scissors,
but the registry/CLI/protocol mechanics it walks through are the same for any game).
