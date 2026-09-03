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

| Game                                          | Package                                 | Players | Deterministic | Tournament formats                  | Rules                                                                                                                                    |
| --------------------------------------------- | --------------------------------------- | ------- | ------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`rock-paper-scissors`](rock-paper-scissors/) | `@thunderdome/game-rock-paper-scissors` | 2       | No            | `round-robin`                       | Best-of-N Rock Paper Scissors — the platform's first vertical-slice game, simultaneous reveal each round.                                |
| [`connect-four`](connect-four/)               | `@thunderdome/game-connect-four`        | 2       | Yes           | `round-robin`, `single-elimination` | Classic 7x6 Connect Four — the first sequential, no-hidden-information game.                                                             |
| [`card-game-hearts`](card-game-hearts/)       | `@thunderdome/game-card-game-hearts`    | 4       | No            | `swiss-league`                      | The classic 4-player trick-taking card game of Hearts — hidden information (each player's hand) and passing, unlike the other two games. |
| [`poker-texas-hold-em`](poker-texas-hold-em/) | `@thunderdome/game-poker-texas-hold-em` | 2-10    | No            | —                                   | No-limit Texas Hold'em — the first variable-size table, hidden hole cards, and side-pot betting across multiple streets per hand.        |

Each game directory is a standard workspace package shape: `src/` for the `GameDefinition`
implementation, `test/` for its unit tests, `manifest.json` for the metadata
`@thunderdome/registry` scans (id, entry package, participant counts, supported tournament
formats, maintainers), and a `dist/` produced by `yarn build`.

Every game depends on `@thunderdome/engine` for the `GameDefinition` contract it implements, plus
whatever else its rules need — `card-game-hearts` and `poker-texas-hold-em` also pull in
[`@thunderdome/card-kit`](../packages/game-dev-toolkit/card-kit/) for shared card/deck
primitives. See [`packages/README.md`](../packages/README.md) for what each of those packages
actually provides.

Want to see one running for real? `yarn thunderdome match run <botId> <botId> [...moreBotIds]`
picks the game from the bots' own manifests — see [`bots/README.md`](../bots/README.md) for the
full roster of reference bots to try it with.
