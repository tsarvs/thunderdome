# THE THUNDERDOME

_Storm clouds roll over the scrapyard coliseum. Ten thousand scavengers pound the barricades.
Somewhere above, the ringmaster raises a burning fist to the sky, and the arena falls silent
enough to hear a single gear turning. Two contenders roll to their marks. The crowd inhales as
one. Then — thunder._

This is not a repository. It is a **proving ground**, forged from shipping-container steel and
the static-charged wreckage of a civilization that decided the only fair way left to settle
anything was to build a machine and let it fight. Bots — written in whatever tongue their creator
still remembers, from whatever fires they were built beside — are dragged into the ring one match
at a time. Games lay down the sacred, unbreakable law of engagement. Tournaments crown champions
across brutal, unending campaigns of pluggable format. And presiding above it all, untouched by
bias toward any language or any game, sits the **Engine** — judge, executioner, and the only power
in the wasteland every contender obeys without question.

**The state of the empire, as chronicled this cycle:** the wire protocol, the Docker-forged cage
every bot fights inside, the one true game engine, two blood-sworn arenas
(Rock-Paper-Scissors and Connect Four), the registry that remembers every name ever entered, a
command to summon a single duel between two registered champions (`yarn thunderdome match run`),
a full tournament ringmaster — round robin's gauntlet and single elimination's guillotine both now
law (`yarn thunderdome tournament run`) — and, for any mortal too proud to watch from the stands,
a way to step into the ring yourself and trade blows with a champion turn by turn
(`yarn thunderdome play`) — stand built, tested, and roaring. Consult
`docs/architecture.md` and `docs/adr/` for the sacred blueprints. Every tournament is etched into
an eternal black-box record the instant it happens, so any battle, however long past, may be
summoned back from the dead and watched again (`yarn thunderdome tournament
list`/`inspect`/`replay`, [`docs/adr/0009-tournament-persistence.md`](docs/adr/0009-tournament-persistence.md)).
Not yet written into law: any bracket beyond round robin and single elimination — Swiss,
pool-then-elimination, and other rites still wait in exile — see
[`docs/guides/tournament-author-guide.md`](docs/guides/tournament-author-guide.md). And no
contender's cage, win or lose or crash in flames, is ever left standing after the final bell —
torn down on victory, on catastrophic failure, on a `Ctrl+C`/`SIGTERM` hurled at the CLI itself —
with `yarn thunderdome cleanup` standing eternal watch as the last word against any wreckage bold
enough to survive the purge (see
[`docs/adr/0003-docker-bot-isolation.md`](docs/adr/0003-docker-bot-isolation.md)'s "Resource
cleanup" section).

## The gates of entry — start here

- [`docs/architecture.md`](docs/architecture.md) — the founding scripture. Every subsystem, every
  law, the whole shape of the world laid bare.
- [`docs/adr/`](docs/adr/) — the councils of old, and why each irreversible decree was carved into
  stone rather than sand.
- [`docs/guides/`](docs/guides/) — the trials by which the initiated are made: bot authors, game
  authors, tournament authors, the protocol itself, and the oaths of security every combatant
  swears before entering the ring.

## The dominion, mapped

```
apps/cli                    CLI entrypoint (presentation only — no engine logic; see apps/cli/README.md)
packages/protocol           wire protocol: envelope types, JSON Schema, validators
packages/rng                seeded PRNG + deterministic seed derivation
packages/engine             GameDefinition contract, match runner, tournament orchestrator
packages/runtime            Docker bot execution, resource limits, forfeit handling
packages/bot-sdk            TypeScript SDK for bot authors; bot manifest schema; runBot() protocol client
packages/game-sdk           helpers for game authors; game manifest schema
packages/registry           filesystem scan + validation of bot/game manifests
packages/tournament-formats concrete TournamentFormat implementations (round robin, single elimination)
packages/tournament-store   persisted TournamentRecord read/write — one JSON file per tournament, no database
games/<game-id>             game rule implementations (reviewed, run in-process)
bots/<game-id>/<bot-id>     bot submissions, grouped by game (any language, Docker-only, untrusted)
tools/boundary-check        CI enforcement of the platform/competitor boundary
docs/                       architecture, ADRs, author guides
```

`packages/*`, `apps/*`, and `games/*` are the inner sanctum — the ringmaster's own hallowed
machinery, trusted and reviewed by the council before a single line is allowed to stand.
`bots/*` is the outer wastes: any challenger's creation, forged from whatever scrap they could
drag home, sealed off by unbreakable mechanical decree (see
`docs/adr/0007-repository-enforcement.md`) from ever laying a hand on anything beyond its own
plot of scorched earth.

## Forging your arms (local development)

Requires Node.js 25.x and Yarn 1.22.22 (Classic) — see
[`docs/adr/0008-toolchain-simplification.md`](docs/adr/0008-toolchain-simplification.md) for the
full decree — plus Docker, for there is no combat permitted outside the cage.

```bash
npm install -g yarn@1.22.22   # if you don't already have this exact Yarn version
yarn install
yarn build
yarn lint
yarn typecheck
yarn test
yarn thunderdome --help
yarn thunderdome match run only-rock only-paper --config '{"totalRounds":3}'   # one real match
yarn thunderdome tournament run only-rock only-paper only-scissors --game-config '{"totalRounds":3}'   # a real round-robin tournament, see apps/cli/README.md
yarn thunderdome match run leftmost-connect-four random-connect-four   # the second game, Connect Four
yarn thunderdome play tx --game-config '{"totalRounds":10}'   # step into the ring yourself, see apps/cli/README.md
yarn thunderdome cleanup   # force-remove any leftover bot containers, if you ever need to
```

## Taking your place among legends

- **Bot authors**: see [`docs/guides/rps-bot-author-guide.md`](docs/guides/rps-bot-author-guide.md)
  — march your creation into `bots/<game-id>/<your-bot-id>/` and nowhere else in all the realm.
- **Game authors**: new arenas are consecrated in `games/<id>/`, and none may open their gates
  without the maintainers' and stewards' seal.
- **Platform contributors**: read `docs/architecture.md` and the relevant ADR before you dare
  reforge the ringmaster's own crown — the engine, protocol, and game/tournament interfaces are
  deliberately, unyieldingly minimal, and every new ambition must be weighed against them before
  a single special case is permitted to exist.
