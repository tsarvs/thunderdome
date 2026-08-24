# Scripts

Dev tooling that isn't a workspace package in its own right.

| Script            | What it does                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.sh`        | The root `yarn build`'s implementation — builds every workspace package in dependency order (see its own comments; Yarn Classic's `workspaces run` doesn't guarantee topological order). |
| `pack-bot-sdk.sh` | Builds `@thunderdome/bot-sdk` and vendors it into every bot that depends on it. See below.                                                                                               |

Running a real match between bots from `/bots` is now `yarn thunderdome match run <botId>
<botId>` (`apps/cli/src/commands/match.ts`) — the registry-backed, Phase 6 successor to what used
to be a hand-rolled `run-scrimmage.mjs` script here. See
[`docs/guides/rps-bot-author-guide.md`](../docs/guides/rps-bot-author-guide.md) for usage.

### A known Docker reliability issue (root-caused and fixed)

Across repeated real-Docker runs — `match run`, the individual bots' own `smoke-test.mjs` files,
and `packages/runtime`'s own integration test — Docker's `attach()` used to intermittently race
container startup: the very first write into a freshly attached container's stdin (always the
`init` message) was silently dropped by the daemon roughly 1-in-5 to 1-in-3 of the time, even
though the container and bot process were both healthy — confirmed by checking `docker logs`
(captured independently of our own attach stream) during a reproduced failure, and by observing
that a manually retried write always landed within milliseconds.

`@thunderdome/runtime`'s `FirstWriteRetryGuard` (`packages/runtime/src/first-write-retry.ts`) now
fixes this: it resends the very first line ever written to a bot's stdin, once, if no stdout data
has arrived within 500ms — comfortably above every observed healthy response time, so it never
fires against a merely-slow (not lost) response. `BotLifecycle` tolerates the one benign duplicate
`ready` this could cause (if the original write was actually just slow, not lost) without
forfeiting the match. Validated empirically: 60/60 real Docker trials succeeded after the fix,
against a baseline that reliably failed several times per 15–30 trials before it. If you still see
an `INIT_TIMEOUT` after this, that's a new signal worth investigating, not the old known issue.

## pack-bot-sdk.sh

`bots/**` is deliberately not a Yarn workspace member (`docs/adr/0001-monorepo-and-boundary.md`):
a bot's isolated `docker build bots/<game>/<bot>/` context has no shared `node_modules` to reach
into, and there's no private npm registry to `npm install` `@thunderdome/bot-sdk` from. So instead,
this script builds `@thunderdome/bot-sdk` and `npm pack`s it into a tarball, then copies that
tarball into `vendor/thunderdome-bot-sdk.tgz` inside every bot that depends on it (currently all
five: `only-rock`, `only-paper`, `only-scissors`, `copycat-rps`, `random-rps`) — each bot's
`package.json` points at it via a `"file:./vendor/thunderdome-bot-sdk.tgz"` dependency, giving
`npm ci` inside that bot's own build context a real, reproducible, committed artifact to install
from. This works the same whether the bot is TypeScript or plain JavaScript — `@thunderdome/bot-sdk`
ships compiled JS either way, so a JS bot just gains a `package.json`/`package-lock.json` and an
`npm ci --omit=dev` step in its (still single-stage) `Dockerfile`.

```bash
./scripts/pack-bot-sdk.sh
```

Run this after changing `packages/bot-sdk`, then commit every dependent bot's updated
`vendor/*.tgz` and `package-lock.json` alongside your source change — the script refreshes both
for you (see its own comments for why a plain `npm install` in place isn't enough).
