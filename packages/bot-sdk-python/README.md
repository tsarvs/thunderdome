# thunderdome_bot_sdk (Python)

The Python analog of [`@thunderdome/bot-sdk-js`](../bot-sdk-js) — a single-file, dependency-free client
for the [wire protocol](../../docs/guides/protocol-reference.md) every Thunderdome bot speaks. It
owns the NDJSON-over-stdio plumbing (replying to `init`, reading `observation`, exiting on
`match-end`) so a Python bot author only has to write one function: given this round's
observation, what's the action?

```python
from thunderdome_bot_sdk import run_bot

def decide_action(observation):
    return {"choice": "rock"}  # whatever your game's Action shape is

run_bot(decide_action)
```

Seeding your own PRNG from the match's `rngSeed` (if your strategy uses randomness) works the
same way as in JS — an `on_init` hook, called once with the full `init` payload:

```python
import random

rng = random.Random()

def on_init(init):
    rng.seed(init["rngSeed"])

run_bot(decide_action, on_init=on_init)
```

## Not a Yarn workspace member, not a pip package

This directory is the canonical _source_ of `thunderdome_bot_sdk.py`, tracked here so it's
tested and reviewed like any other platform code. It isn't installed as a package by anything —
`bots/**` isn't a Yarn workspace member and there's no private Python package registry to
`pip install` it from either (same reasoning as `@thunderdome/bot-sdk-js`'s vendored tarball;
docs/adr/0001-monorepo-and-boundary.md). A bot that wants it copies this one file directly into
its own directory and ships it in its Docker image alongside its own code — run
[`../../scripts/vendor-python-bot-sdk.sh`](../../scripts/vendor-python-bot-sdk.sh) after changing
this file to refresh every dependent bot's copy, or see
[`bots/connect-four/tactical-connect-four/`](../../bots/connect-four/tactical-connect-four/) for
the pattern end to end (Dockerfile included).

## Testing

Zero runtime dependencies, and the test suite doesn't need any either — just the standard
library:

```sh
python3 -m unittest discover -s packages/bot-sdk-python/test -v
```
