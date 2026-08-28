# Testing Guide (for beginners)

This guide explains what an automated test actually is, the difference between a **unit test** and
an **integration test**, and walks through writing one of each — using real code from this repo,
not a toy example. If you already know what these terms mean, skip to
[§3](#3-this-repos-two-testing-tiers) for how this repo specifically organizes its tests.

## 1. What is an automated test, and why bother?

A test is a small program that runs another piece of your code and checks the result is what you
expect — automatically, without a human clicking through the app by hand. Instead of manually
running `yarn thunderdome match run only-rock only-paper` after every change and eyeballing the
output, a test does the equivalent, instantly, every time, and tells you clearly if something
broke — including breakage in a part of the code you weren't even thinking about when you made
your change. That's the real value: tests catch **regressions** (something that used to work,
silently stops working) far earlier and far more reliably than a human re-checking things by hand
ever could.

This repo uses [Vitest](https://vitest.dev/) to run its tests — `yarn test` runs every test in the
whole monorepo once; `yarn test:watch` re-runs affected tests automatically every time you save a
file, which is the faster loop to use while actively writing code.

## 2. Unit tests vs. integration tests

These two terms describe *how much* of the system a test exercises at once — think of it as a
dial, not a strict binary, but the two ends of that dial behave differently enough to be worth
naming separately.

**A unit test** calls one function (or one small, self-contained piece of code — a "unit") directly,
with made-up inputs, and checks its output — nothing else in the system is involved. It doesn't
start a server, doesn't touch a real file or database, doesn't run Docker. Because of that, unit
tests are extremely fast (thousands can run in well under a second) and, when one fails, the
failure almost always points precisely at the one function responsible — there's nothing else in
the picture that could have gone wrong instead.

For example, `rockPaperScissors.parseConfig({ totalRounds: 4 })` is a plain function call: give it
an input, get back a `Result`, check it's what you expected. No Docker, no network, no other part
of the codebase involved — a unit test.

**An integration test** checks that several pieces actually work correctly *together* — the thing
a unit test, by design, never proves. Two well-tested functions can each work perfectly in
isolation and still fail the moment they're wired together (a mismatched assumption about what one
hands the other, a real network call that behaves differently than a fake one did). Integration
tests are slower (they touch real infrastructure — here, that's Docker) and a failure gives you a
wider area to investigate — but they're the only kind of test that can catch a wiring mistake
between two otherwise-correct pieces.

Neither kind replaces the other. A healthy test suite has *many* fast unit tests covering every
function's own logic in detail, plus a *smaller* number of integration tests confirming the real
pieces genuinely fit together — this repo's own test suite is shaped exactly that way (§3).

## 3. This repo's two testing tiers

| Tier            | What it exercises                                                          | How fast   | Real example in this repo                                                                                     |
| --------------- | --------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit test       | One `GameDefinition` method, or one pure function, called directly          | Instant    | `games/rock-paper-scissors/test/game.test.ts` — calls `rockPaperScissors.parseConfig()`/`.resolve()`/etc. directly against hand-built state, with **zero** Docker involved |
| Integration test | A real bot's Docker container, driven through the real wire protocol       | Seconds    | `bots/rock-paper-scissors/*/smoke-test.mjs` and [`docs/guides/examples/counter-bot/smoke-test.mjs`](examples/counter-bot/smoke-test.mjs) — builds a real image, starts a real container via `@thunderdome/runtime`, and drives it through a scripted `init`/`observation`/`action` exchange |

Every package under `packages/` and `games/` has a `test/` directory of unit tests, run by
`yarn test` (Vitest) — these are what CI runs on every change and what you should be running
constantly (`yarn test:watch`) while developing. A bot's own `smoke-test.mjs` is the integration
tier: it needs Docker actually running (see [`getting-started.md`](getting-started.md) §5), which
is exactly why it isn't wired into the fast `yarn test` loop — it's run separately, by hand, as
described in `bot-author-guide.md` §7.

There's a third level above both, worth knowing about even though it isn't a "test" in the
automated-suite sense: actually running `yarn thunderdome match run <botId> <botId>` or `yarn
thunderdome play <botId>` yourself and watching it play. Fast unit tests and a slower integration
test each prove something real, but neither replaces actually watching your bot or game behave —
see the root README's setup checklist, which ends with exactly that.

## 4. Writing your first unit test, step by step

Say you're adding a new case to Rock-Paper-Scissors' config validation — this walks through the
actual shape any new unit test in this repo takes, using a real, already-tested function as the
target.

1. **Find the existing test file for the thing you're changing.** Every package's tests live next
   to its source, one directory over: `games/rock-paper-scissors/src/game.ts` is tested by
   `games/rock-paper-scissors/test/game.test.ts`. If you're adding a genuinely new file with no
   tests yet, create `test/<name>.test.ts` next to it, matching that pattern.

2. **Look at how an existing test in that file is structured** — they all follow the same shape:

   ```ts
   describe('rockPaperScissors.parseConfig', () => {
     it('accepts a valid totalRounds and defaults onMissingAction', () => {
       const result = rockPaperScissors.parseConfig({ totalRounds: 3 });
       expect(result.ok).toBe(true);
       if (result.ok) {
         expect(result.value).toEqual({ totalRounds: 3, onMissingAction: 'forfeitMatch' });
       }
     });
   });
   ```

   - `describe(...)` groups related tests under a label — usually the function being tested.
   - `it(...)` (an alias for `test(...)`) is one individual test case; its string argument should
     read as a sentence describing the exact behavior being checked ("rejects a non-positive
     totalRounds"), so a failure's own name tells you what broke without opening the file.
   - `expect(actual).toBe(expected)` / `.toEqual(expected)` is the actual check — `toBe` for
     primitives (numbers, strings, booleans), `toEqual` for objects/arrays (it compares contents,
     not identity). Vitest has [many more matchers](https://vitest.dev/api/expect.html)
     (`.toThrow()`, `.toContain()`, `.toHaveLength()`, ...) — grep this repo's own `test/`
     directories for examples before reaching for the docs.

3. **Write a new `it(...)` block for your case**, inside the relevant `describe`, following the
   same pattern — call the real function with the input you want to check, then assert on what it
   returns:

   ```ts
   it('rejects a totalRounds that is not an integer', () => {
     const result = rockPaperScissors.parseConfig({ totalRounds: 3.5 });
     expect(result.ok).toBe(false);
   });
   ```

4. **Run it.** `yarn test:watch` re-runs on save and prints pass/fail directly in your terminal —
   or scope it to just this file while you're iterating:

   ```bash
   yarn workspace @thunderdome/game-rock-paper-scissors test
   ```

5. **Watch it fail first, on purpose, before making it pass.** If `parseConfig` doesn't actually
   reject `3.5` yet, your new test should fail right now — confirming it actually exercises the
   behavior you think it does, rather than passing vacuously no matter what the code does. Only
   then go fix `parseConfig` (or whatever function you're testing) until the test passes for real.
   This order — red, then green — is the single most reliable way to know a test is actually
   testing something.

That's the entire loop this repo's whole unit-test suite is built from — every `test/*.test.ts`
file in `packages/` and `games/` is the same three ingredients (`describe`, `it`, `expect`)
repeated against different functions.  [`game-authoring-guide.md`](game-authoring-guide.md) §11
lists, concretely, everything a new game's own test suite should cover.

## 5. Writing (or extending) an integration test

Integration tests in this repo follow [`docs/guides/examples/counter-bot/smoke-test.mjs`](examples/counter-bot/README.md)'s
pattern: build the bot's Docker image, then drive it through a real container using
`@thunderdome/runtime`'s primitives (`DockerBotProcess`/`BotLifecycle`) with a scripted sequence of
observations, asserting the bot's replies match what you expect. Its own README spells out the
exact steps (build → sanity-check by hand → run the smoke test) and is the right template to copy
when your own bot needs one — you're not expected to write this kind of test from scratch.

You generally only need to write a new integration test when you're building something that
*talks to Docker directly* — a new bot, or a change to `@thunderdome/runtime` itself. A new game or
tournament format's correctness is proven by its unit tests (§4) plus actually running it for real
(`yarn thunderdome match run`/`tournament run`) — see
[`game-authoring-guide.md`](game-authoring-guide.md) §12.

## 6. What "good coverage" looks like here (rather than a number)

This repo doesn't chase a coverage percentage. Instead, for any new behavior, ask: **what are the
distinct cases, and does a test exist for each one?** For `GameDefinition.parseConfig`, that's
"valid input," "invalid input," and "input relying on a default." For `resolve()`, that's one test
per distinct outcome the game can reach (Connect Four's suite has one test per win direction, plus
a draw — `game-authoring-guide.md` §11). A single happy-path test proves the feature *can* work; it
takes the edge cases and error cases to prove it reliably *does*.
