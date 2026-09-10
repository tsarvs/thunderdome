# Games

The sacred, unbreakable law of engagement for each arena — `games/<game-id>/`. Everything here is
inner-sanctum code: a Yarn workspace package, reviewed by the council, run in-process by
`@thunderdome/engine` (never sandboxed like a bot, since a game defines the rules bots play by).
To write a new one, generate a skeleton with `yarn scaffold:game <game-id>` and follow
[`docs/guides/game-authoring-guide.md`](../docs/guides/game-authoring-guide.md); once it's playing
correctly, [`docs/guides/human-friendly-games-guide.md`](../docs/guides/human-friendly-games-guide.md)
covers making it pleasant for a human to actually play (`yarn thunderdome play`) and other ways to
keep developing it further. New to Node/Docker/dev environments, or to unit/integration testing?
[`docs/guides/getting-started.md`](../docs/guides/getting-started.md) and
[`docs/guides/testing-guide.md`](../docs/guides/testing-guide.md) explain those from first
principles before either guide above assumes you already know them.

## Arenas

| Game                                          | Package                                 | Players | Deterministic | Tournament formats                  | Rules                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------- | ------- | ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`rock-paper-scissors`](rock-paper-scissors/) | `@thunderdome/game-rock-paper-scissors` | 2       | No            | `round-robin`                       | Best-of-N Rock Paper Scissors — the platform's first vertical-slice game, simultaneous reveal each round.                                                                                                                                                                                 |
| [`connect-four`](connect-four/)               | `@thunderdome/game-connect-four`        | 2       | Yes           | `round-robin`, `single-elimination` | Classic 7x6 Connect Four — the first sequential, no-hidden-information game.                                                                                                                                                                                                              |
| [`card-game-hearts`](card-game-hearts/)       | `@thunderdome/game-card-game-hearts`    | 4       | No            | `swiss-league`                      | The classic 4-player trick-taking card game of Hearts — hidden information (each player's hand) and passing, unlike the other two games.                                                                                                                                                  |
| [`poker-texas-hold-em`](poker-texas-hold-em/) | `@thunderdome/game-poker-texas-hold-em` | 2-10    | No            | —                                   | No-limit Texas Hold'em — the first variable-size table, hidden hole cards, and side-pot betting across multiple streets per hand.                                                                                                                                                         |
| [`stock-market`](stock-market/)               | `@thunderdome/game-stock-market`        | 2-10    | No            | `round-robin`                       | "Denny's Stock Sim" — a simulated single-stock market trading the one ticker left (DENN); every bot trades simultaneously each round, trying to end with the highest portfolio value. The first game with a hidden per-match variable (the fundamental value) that isn't a hand of cards. |
| [`stock-market-2`](stock-market-2/)           | `@thunderdome/game-stock-market-2`      | 1-10    | No            | `round-robin`                       | A daily-round exchange simulation with a real order book (bid/ask spread, market/limit orders, partial fills, synthetic liquidity, player-vs-player matching), a hidden fundamental value with regime-driven drift, and optional short selling with Reg-T-style margin, borrow costs, and forced liquidation. Runs a seeded synthetic ticker by default, or replays the real historical DENN daily record. The first game where solo play (1 bot vs. the market) is itself a complete match. |
| [`stock-market-3`](stock-market-3/)           | `@thunderdome/game-stock-market-3`      | 1-10    | No            | —                                    | A multi-symbol exchange simulation on the same order book/margin machinery as `stock-market-2`: a configurable universe of equities across 5 sectors plus a tradable synthetic index, all partially driven by a shared hidden macro economy, real quarterly fundamentals/earnings with analyst-consensus estimates, a public economic calendar, and corporate actions (splits, acquisitions, delistings). The first game with more than one tradable symbol at once. |
| [`stock-market-4`](stock-market-4/)           | `@thunderdome/game-stock-market-4`      | 1-10    | Yes           | —                                    | A portfolio-management simulation that *replays* an organizer-supplied daily price series (real historical data, or a synthetic one you generate yourself) instead of simulating a market — no order book, every fill is against the declared tape. Margin/short-selling/borrow/forced-liquidation, corporate actions, and portfolio accounting carry forward `stock-market-3`'s machinery; adds an opaque research-payload delivery boundary, a real trading calendar, and standard performance metrics (drawdown, Sharpe, benchmark comparison). The first game that's fully deterministic and the first with a research boundary. |

The "Rules" column above is a one-line summary — each game's own `README.md` (e.g.
[`rock-paper-scissors/README.md`](rock-paper-scissors/README.md)) is the full, human-readable
rulebook: how a round actually plays out, what each action does, and how the match is won,
written for a player or spectator rather than a bot author or implementer.

Each game directory is a standard workspace package shape: `README.md` for the rules (see above),
`src/` for the `GameDefinition` implementation, `test/` for its unit tests, `manifest.json` for the
metadata `@thunderdome/registry` scans (id, entry package, participant counts, supported
tournament formats, maintainers), and a `dist/` produced by `yarn build`.

Every game depends on `@thunderdome/engine` for the `GameDefinition` contract it implements, plus
whatever else its rules need — `card-game-hearts` and `poker-texas-hold-em` also pull in
[`@thunderdome/deck-of-cards`](../packages/game-dev-toolkit/deck-of-cards/) for shared card/deck
primitives. See [`packages/README.md`](../packages/README.md) for what each of those packages
actually provides.

Want to see one running for real? `yarn thunderdome match run <botId> <botId> [...moreBotIds]`
picks the game from the bots' own manifests — see [`bots/README.md`](../bots/README.md) for the
full roster of reference bots to try it with.
