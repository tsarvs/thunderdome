## What does this PR change?

<!-- One or two sentences. -->

## Scope

- [ ] This PR touches exactly one of: a single `bots/<game-id>/<bot-id>/` directory, `games/**`,
      or platform code (`apps/**`, `packages/**`, `tools/**`, root config) — not a mix, unless a
      maintainer has applied the `maintainer-override` label.
- [ ] If this PR adds or changes a `manifest.json`, its `id` matches the containing directory
      name, and (for bots) its `game` field matches the `bots/<game-id>/` it's grouped under.

## For bot submissions

- [ ] `docker build` succeeds against this bot's own directory.
- [ ] The bot has been run locally against at least one match.

## For game or platform changes

- [ ] Tests were added or updated.
- [ ] `docs/architecture.md` and/or the relevant ADR were updated if this changes a core
      abstraction.
