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
every bot fights inside, the one true game engine, four blood-sworn arenas
(Rock-Paper-Scissors, Connect Four, the 4-seat trick-taking gauntlet of Hearts, and the no-limit
felt of Texas Hold'em), the registry
that remembers every name ever entered, a command to summon a single match between registered
champions (`yarn thunderdome match run`), a full tournament ringmaster — round robin's gauntlet,
single elimination's guillotine, and Swiss league's cumulative-score tables all now law
(`yarn thunderdome tournament run`) — and, for any mortal too proud to watch from the stands,
a way to step into the ring yourself and trade blows with a champion turn by turn
(`yarn thunderdome play`) — stand built, tested, and roaring. Consult
`docs/architecture.md` and `docs/adr/` for the sacred blueprints. Every tournament is etched into
an eternal black-box record the instant it happens, so any battle, however long past, may be
summoned back from the dead and watched again (`yarn thunderdome tournament
list`/`inspect`/`replay`, [`docs/adr/0009-tournament-persistence.md`](docs/adr/0009-tournament-persistence.md)).
Not yet written into law: any bracket beyond round robin, single elimination, and now Swiss
league's own cumulative-score tables — pool-then-elimination and other rites still wait in exile —
see [`docs/guides/tournament-author-guide.md`](docs/guides/tournament-author-guide.md), or
[`docs/guides/tournament-format-authoring-guide.md`](docs/guides/tournament-format-authoring-guide.md)
if you mean to be the one who ends the exile. And no
contender's cage, win or lose or crash in flames, is ever left standing after the final bell —
torn down on victory, on catastrophic failure, on a `Ctrl+C`/`SIGTERM` hurled at the CLI itself —
with `yarn thunderdome cleanup` standing eternal watch as the last word against any wreckage bold
enough to survive the purge (see
[`docs/adr/0003-docker-bot-isolation.md`](docs/adr/0003-docker-bot-isolation.md)'s "Resource
cleanup" section).

## The gates of entry — start here

**New to any of this — Node, Docker, "dev environment," or writing tests at all?** Read
[`docs/guides/getting-started.md`](docs/guides/getting-started.md) first. It explains what every
tool below is actually for, in plain language, before asking you to install anything — the setup
steps that follow assume none of that background yet.

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
packages/tournament-formats concrete TournamentFormat implementations (round robin, single elimination, Swiss league)
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

Requires Node.js 25.x, Yarn 1.22.22 (Classic), and Docker — see
[`docs/adr/0008-toolchain-simplification.md`](docs/adr/0008-toolchain-simplification.md) for the
full decree on the first two. There is no combat permitted outside the cage: Docker is what
actually runs every bot, and the real thing (`yarn thunderdome match run`, the runtime's own
integration tests) needs it running, not just installed.

### 1. Node.js 25.x

The exact version in use is pinned in [`.node-version`](.node-version) (`25`) and enforced by
`package.json`'s `"engines"` field (`>=25 <26`). Installing it through a version manager — rather
than your OS's package manager directly — is what keeps you from clobbering whatever Node version
some other project on your machine expects.

**[fnm](https://github.com/Schniz/fnm)** is the one recommendation here that behaves identically
on macOS, Linux, and Windows, and reads this repo's `.node-version` file natively (no `.nvmrc`
translation needed):

| Platform | Install fnm                                          |
| -------- | ---------------------------------------------------- |
| macOS    | `brew install fnm`                                   |
| Linux    | `curl -fsSL https://fnm.vercel.app/install \| bash`  |
| Windows  | `winget install Schniz.fnm` (or `scoop install fnm`) |

Then, from anywhere inside this repo, on any platform:

```bash
fnm use --install-if-missing   # reads .node-version, installs 25.x if you don't have it, and switches to it
node -v                        # sanity check — should print a v25.x.x
```

`fnm`'s install instructions end with a one-time shell hook (`eval "$(fnm env --use-on-cd)"` in
your `.bashrc`/`.zshrc`, or the PowerShell equivalent on Windows) that makes it auto-switch
versions when you `cd` into a directory with a `.node-version` file — worth doing once so you
don't have to remember to run `fnm use` by hand every time.

Already using a different version manager? Any of these work too, as long as you land on a real
Node 25.x — none of them read `.node-version` automatically the way `fnm` does, so you'll need to
name the version explicitly:

- **nvm** (macOS/Linux): `nvm install 25 && nvm use 25`
- **nvm-windows**: `nvm install 25.8.0 && nvm use 25.8.0` (needs an exact version, not a range)
- **Volta** (macOS/Linux/Windows): `volta install node@25`

### 2. Yarn 1.22.22 (Classic)

There's no version-manager pinning for Yarn here (a deliberate simplification —
`docs/adr/0008-toolchain-simplification.md`), so install this exact version globally with npm
(which you already have once Node is installed), on any platform:

```bash
npm install -g yarn@1.22.22
yarn -v   # should print exactly 1.22.22
```

### 3. Docker

Any bot's match — including this repo's own integration tests — runs inside a real Docker
container (`docs/adr/0003-docker-bot-isolation.md`), so this isn't optional.

| Platform | Install                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/), or `brew install --cask docker`                                                                                                                                                                                                          |
| Windows  | [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) (uses the WSL2 backend — Docker's installer walks you through enabling WSL2 if it isn't already)                                                                                                                                  |
| Linux    | [Docker Engine](https://docs.docker.com/engine/install/) via your distro's package manager, or the official convenience script: `curl -fsSL https://get.docker.com \| sh`. Afterwards, add yourself to the `docker` group (`sudo usermod -aG docker $USER`, then log out/in) so you don't need `sudo` for every command. |

Verify it's actually running (Docker Desktop needs to be launched, not just installed, on
macOS/Windows) before moving on:

```bash
docker ps
```

### 4. Clone and bootstrap

```bash
git clone <this-repo-url>
cd thunderdome
fnm use --install-if-missing   # or your version manager's equivalent — see step 1
npm install -g yarn@1.22.22    # if you don't already have this exact Yarn version
yarn install
yarn build
yarn lint
yarn typecheck
yarn test
yarn thunderdome --help
yarn thunderdome match run only-rock only-paper --config '{"totalRounds":3}'   # one real match
yarn thunderdome tournament run only-rock only-paper only-scissors --game-config '{"totalRounds":3}'   # a real round-robin tournament, see apps/cli/README.md
yarn thunderdome match run leftmost-connect-four random-connect-four   # the second game, Connect Four
yarn thunderdome match run random-hearts lowest-card-hearts point-dodger-hearts tominator-t101   # the third game, Hearts (exactly 4 seats)
yarn thunderdome match run random-poker calling-station-poker --config '{"startingStack":500,"totalHands":5,"matchFormat":"fixedHands"}'   # the fourth game, Texas Hold'em
yarn thunderdome play tominator-tx --game-config '{"totalRounds":10}'   # step into the ring yourself, see apps/cli/README.md
yarn thunderdome cleanup   # force-remove any leftover bot containers, if you ever need to
```

## Taking your place among legends

- **Bot authors**: `yarn scaffold:bot <game-id> <your-bot-id>` forges a working starting point in
  `bots/<game-id>/<your-bot-id>/` — nowhere else in all the realm — in seconds; see
  [`docs/guides/bot-author-guide.md`](docs/guides/bot-author-guide.md) for the full rite (protocol,
  manifest, Dockerfile, testing, submission), whichever arena you're entering.
- **Game authors**: `yarn scaffold:game <game-id>` consecrates a new, working-but-trivial arena
  under `games/<id>/` to build outward from; see
  [`docs/guides/game-authoring-guide.md`](docs/guides/game-authoring-guide.md) for the full rite,
  and [`docs/guides/human-friendly-games-guide.md`](docs/guides/human-friendly-games-guide.md) for
  making a finished arena pleasant for a mortal to actually step into
  (`yarn thunderdome play`) — none may open their gates without the maintainers' and stewards'
  seal.
- **Tournament format authors**: round robin, single elimination, and Swiss league don't exhaust
  every way a bracket can be shaped — see
  [`docs/guides/tournament-format-authoring-guide.md`](docs/guides/tournament-format-authoring-guide.md)
  for forging a new one (pool-then-elimination still waits for its champion).
- **Platform contributors**: read `docs/architecture.md` and the relevant ADR before you dare
  reforge the ringmaster's own crown — the engine, protocol, and game/tournament interfaces are
  deliberately, unyieldingly minimal, and every new ambition must be weighed against them before
  a single special case is permitted to exist.
