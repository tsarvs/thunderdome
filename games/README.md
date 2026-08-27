# Games

The sacred, unbreakable law of engagement for each arena — `games/<game-id>/`. Everything here is
inner-sanctum code: a Yarn workspace package, reviewed by the council, run in-process by
`@thunderdome/engine` (never sandboxed like a bot, since a game defines the rules bots play by).
To write a new one, start with
[`docs/guides/game-authoring-guide.md`](../docs/guides/game-authoring-guide.md) or generate a
skeleton with `yarn scaffold:game`.

## Arenas

| Game                                          | Package                                 | Players | Deterministic | Tournament formats                  | Rules                                                                                                                                    |
| --------------------------------------------- | --------------------------------------- | ------- | ------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`rock-paper-scissors`](rock-paper-scissors/) | `@thunderdome/game-rock-paper-scissors` | 2       | No            | `round-robin`                       | Best-of-N Rock Paper Scissors — the platform's first vertical-slice game, simultaneous reveal each round.                                |
| [`connect-four`](connect-four/)               | `@thunderdome/game-connect-four`        | 2       | Yes           | `round-robin`, `single-elimination` | Classic 7x6 Connect Four — the first sequential, no-hidden-information game.                                                             |
| [`card-game-hearts`](card-game-hearts/)       | `@thunderdome/game-card-game-hearts`    | 4       | No            | —                                   | The classic 4-player trick-taking card game of Hearts — hidden information (each player's hand) and passing, unlike the other two games. |

Each game directory is a standard workspace package shape: `src/` for the `GameDefinition`
implementation, `test/` for its unit tests, `manifest.json` for the metadata
`@thunderdome/registry` scans (id, entry package, participant counts, supported tournament
formats, maintainers), and a `dist/` produced by `yarn build`.

Every game depends on `@thunderdome/engine` for the `GameDefinition` contract it implements, plus
whatever else its rules need — `card-game-hearts` also pulls in
[`@thunderdome/card-kit`](../packages/game-dev-toolkit/card-kit/) for shared card/deck/trick
primitives. See [`packages/README.md`](../packages/README.md) for what each of those packages
actually provides.

Want to see one running for real? `yarn thunderdome match run <botId> <botId> [...moreBotIds]`
picks the game from the bots' own manifests — see [`bots/README.md`](../bots/README.md) for the
full roster of reference bots to try it with.
