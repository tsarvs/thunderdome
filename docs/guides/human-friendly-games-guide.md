# Making a Game Human-Friendly (and Other Ways to Develop It Further)

This guide is for taking a game that already works — its `GameDefinition` is implemented, bots can
play it, `match run` and `tournament run` both function — and making it *better*: pleasant for an
actual human to sit down and play, and easier to keep improving over time. If you haven't
implemented a `GameDefinition` yet, start with
[`game-authoring-guide.md`](game-authoring-guide.md) first; this guide assumes that part is done.

**Status check first.** Two of the three real games support human play today — Rock-Paper-Scissors
and Hearts both implement `GameDefinition.humanInterface`, so `yarn thunderdome play` works against
either. **Connect Four does not yet** — `yarn thunderdome play leftmost-connect-four` gives a
clear "this game doesn't support human play yet" error rather than a crash or a garbled prompt.
That gap is real, self-contained, and doesn't require touching the CLI or engine at all — §2 below
walks through closing it as a concrete, worked exercise, using Rock-Paper-Scissors and Hearts as
the two existing references.

## 1. Why bother making a game human-playable at all?

Two reasons, beyond letting people literally play for fun:

- **It's the best sanity check you have that your game actually behaves the way you designed it.**
  A bot only ever shows you a final tally; a human playing round-by-round sees every prompt and can
  immediately notice "wait, that's not what I expected to happen there." Playing your own game by
  hand is often how you'll first notice an observation is missing information a player obviously
  needs, or that a rule doesn't behave the way you thought you'd written it.
- **A confusing interface is a bug**, the same way a crash is. If a real person can't tell what
  they're allowed to type, or gets no confirmation their input was understood, that's a defect in
  the game worth fixing — this guide is about treating "is this actually pleasant to play" as a
  real, checkable property of a finished game, not a nice-to-have.

## 2. `humanInterface`: the whole mechanism

Everything `yarn thunderdome play` needs from a game is one optional field on `GameDefinition`
(`packages/engine/src/types.ts`):

```ts
humanInterface?: {
  describeObservation(observation: TObservation): string;
  parseInput(raw: string): TAction | undefined;
  describeAction?(action: TAction): string; // optional
};
```

That's it — three functions, all pure (no side effects, no I/O of their own), all operating on
types your game already defined for its `GameDefinition`. Nothing about the CLI, terminal
rendering, or input reading lives in your game code; you're just turning your existing
`TObservation` into a string, and turning a human's typed string back into your existing `TAction`.

### `describeObservation`: turning your observation into a prompt

Given the same `TObservation` a bot would receive, return the exact string to print to the
terminal. Rock-Paper-Scissors' version
(`games/rock-paper-scissors/src/game.ts`) is a good template for a simple, single-action-shape
game:

```ts
function describeObservation(observation: RpsObservation): string {
  const { round, totalRounds, yourWins, opponentWins, opponentId, history } = observation;
  const last = history.at(-1);
  const lastRoundLine =
    last === undefined
      ? ''
      : `Last round — you: ${describeChoice(last.you)}, ${opponentId}: ${describeChoice(last.opponent)} ` +
        `(${last.winner === 'you' ? 'you won' : last.winner === 'opponent' ? `${opponentId} won` : 'draw'})\n`;

  return (
    `\nRound ${String(round + 1)}/${String(totalRounds)} — you: ${String(yourWins)}, ${opponentId}: ${String(opponentWins)}\n` +
    lastRoundLine +
    'rock, paper, or scissors? (r/p/s) '
  );
}
```

Notice what this does that a bare dump of the observation object wouldn't:

- **Shows progress** (`Round 2/3`) and the running score, so a human always knows where they stand
  without having to track it themselves.
- **Recaps what just happened** ("Last round — you: paper, opponent: rock (you won)") before asking
  for the next move — a bot never needs this (it has `history` and doesn't get bored or forget),
  but a human benefits from being told, not just shown data.
- **Ends with the actual question and the accepted shorthand** (`(r/p/s)`) right at the prompt,
  not buried above it or left to a separate help command.

Hearts' version (`games/card-game-hearts/src/human.ts`) does more work because Hearts has two
phases and hidden information, but the shape is identical: given the observation, produce a string
that tells a human everything they need to decide — their hand, the current trick, the legend for
the card notation, and a concrete, currently-legal example of the exact command format expected:

```
Pass 3 cards left. Type: PASS <card> <card> <card>  (example: PASS 2C 5C TH)
```

That "example uses a card you can actually play right now" detail matters more than it looks —
a generic example risks being illegal in the current state, which teaches the wrong lesson right
when someone's learning the syntax.

### `parseInput`: turning a human's typing into your action type

```ts
function parseInput(raw: string): RpsAction | undefined {
  const choice = CHOICE_ALIASES[raw.trim().toLowerCase()];
  return choice === undefined ? undefined : { choice };
}
```

The contract is simple and important: **return `undefined` for anything you don't recognize —
never throw, and never guess.** Returning `undefined` tells the CLI "this didn't parse," which
reprompts the human with a friendly retry message; it's never treated as an illegal move or a
forfeit. This is what makes a typo forgiving instead of costly — accept a few reasonable synonyms
(`CHOICE_ALIASES` maps `r`, `rock`, `Rock`, etc. all to `'rock'`) rather than demanding exact,
case-sensitive input a human is unlikely to type correctly on the first try.

### `describeAction` (optional): confirming what was understood

```ts
humanInterface: { describeObservation, parseInput, describeAction },
```

Printed immediately after a valid input is accepted, before the next prompt — Hearts uses this for
`Passed: 9C QC 2D` and `Played: 4D`. This matters most when your notation is dense enough that a
typo could silently parse into a *different, still-valid* action rather than failing to parse at
all (e.g. typing `9D` instead of `9C` — both are legal card tokens, just not the one you meant).
Rock-Paper-Scissors skips `describeAction` entirely — its next prompt already restates your last
choice as part of the round recap, so a separate confirmation would be redundant. Omit it when your
next prompt already makes the outcome obvious; add it whenever a wrong-but-valid interpretation is
a real risk.

## 3. Worked exercise: adding `humanInterface` to Connect Four

Connect Four is fully observable, sequential, and single-action-shape (a column number, `0`
through `columns - 1`) — the simplest possible case for this, and genuinely unimplemented today.
Here's the exact path, following the pattern above:

1. **Read `games/connect-four/src/types.ts`** for `ConnectFourObservation` and
   `ConnectFourAction` — you already know these fully from writing (or reading) the game itself.
2. **Write `describeObservation`**: render the 7x6 board as text (a grid of `.`/`X`/`O` or similar,
   using `'you'`/`'opponent'` the same way the observation itself already relabels participants —
   see `game-authoring-guide.md` §4), plus whose turn it is and the column-number legend, ending in
   a prompt like `Drop in which column? (0-6)`.
3. **Write `parseInput`**: parse a bare integer, trim whitespace, return `undefined` for anything
   that isn't a valid integer in range — don't re-check whether the column is *currently* full
   here; that's `validateAction`'s job, and returning a well-formed-but-illegal action is fine
   (the CLI/engine already handles a rejected action the same way it handles a bot's illegal move).
4. **Wire it into `GameDefinition`**: add `humanInterface: { describeObservation, parseInput }` next
   to `resourceLimits` in `games/connect-four/src/game.ts` (see how Rock-Paper-Scissors and Hearts
   do the same, cited above).
5. **Add a unit test** (`testing-guide.md` §4) for `parseInput` — at minimum, one case that parses
   correctly, one that rejects out-of-range input, and one that rejects garbage input.
6. **Prove it for real**: `yarn thunderdome play leftmost-connect-four` and actually play a game
   against it. This is the step that catches whatever your unit tests didn't — an awkward prompt,
   a confusing board rendering, a legend you forgot to include.

No engine or CLI change is required anywhere in this list — that's the entire point of
`humanInterface` being an optional hook on `GameDefinition` rather than special CLI logic per game
(`apps/cli/README.md`'s "What's not built yet" section documents this exact gap and points back
here).

## 4. Other ways to develop and enhance a game

Making a game human-playable is one axis of "make this game better," not the only one. Some others,
roughly in order of how self-contained they are:

- **Add more reference bots.** A game with only one or two reference bots (`bots/<game-id>/`) is
  hard for a newcomer to learn from by comparison, and hides "what does a genuinely different
  strategy look like" questions your game design might not have considered. `yarn scaffold:bot
  <game-id> <bot-id>` (see `bots/README.md`) gets you a working starting point in seconds — start
  from `random-<game-id>` and `lowest-card-hearts`-style "obviously not optimal but a real
  baseline" strategies before attempting something sophisticated.
- **Add or tune `resourceLimits`.** If your game's bots need meaningfully more (or less) time per
  turn than the `5000`ms/`128`MB/`0.5`-CPU convention both real games currently use
  (`game-authoring-guide.md` §8), that's a legitimate, game-specific decision — a card game with a
  larger search space than Rock-Paper-Scissors' single-choice-per-round might reasonably need
  longer. Document *why* in a comment next to the value, the same way you'd document any other
  non-obvious constant.
- **Tune your config's defaults.** `parseConfig`'s defaults (`game-authoring-guide.md` §9) are
  often the single biggest lever on how a game *feels* without changing a single rule —
  Rock-Paper-Scissors' `totalRounds: 300` default exists specifically so a match has enough hands
  for an adaptive bot's strategy to actually show up in the result, rather than being decided by an
  early lucky streak. If playtesting (by hand, via `yarn thunderdome play`, or by watching several
  bot-vs-bot matches) reveals a default that makes games feel too short, too long, or too luck-
  dominated, that's real, actionable signal.
- **Wire your game into a tournament format that doesn't fit it yet.** Check
  `games/README.md`'s table for which formats a game currently lists as supported. A new format
  fitting your game (or your game needing a new kind of format, like Hearts needing
  `swiss-league` because a single 4-player hand is too noisy to rank bots on) is real, valuable
  work — see [`tournament-format-authoring-guide.md`](tournament-format-authoring-guide.md).
- **Widen your test suite's coverage of distinct outcomes**, not just distinct inputs — see
  [`testing-guide.md`](testing-guide.md) §6's framing of "what are the distinct cases" applied to
  your own `resolve()`.

None of this requires engine changes. That's a deliberate constraint on the whole platform, not a
limitation of this guide: `GameDefinition`'s ten members
(`game-authoring-guide.md` §1) are meant to be expressive enough that "make an existing game
better" and "add a brand new game" both stay entirely inside `games/<game-id>/`.

## See also

- [`game-authoring-guide.md`](game-authoring-guide.md) — implementing the `GameDefinition` these
  hooks attach to
- [`testing-guide.md`](testing-guide.md) — writing the unit tests that back up any change here
- [`apps/cli/README.md`](../../apps/cli/README.md#play) — exactly what `yarn thunderdome play`
  does with `humanInterface` once it's implemented
- `games/rock-paper-scissors/src/game.ts` and `games/card-game-hearts/src/human.ts` — the two real
  implementations this guide describes
