/**
 * Calling Station Poker — never folds, never raises: checks when it can, otherwise calls (or, if
 * short-stacked, goes all-in rather than folding). No randomness, no hand-strength evaluation at
 * all — the simplest possible deterministic baseline, the poker equivalent of
 * bots/rock-paper-scissors/only-rock: something any real strategy should be able to beat, and a
 * fixed target to measure other poker bots against.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough.
 */
import { runBot } from '@thunderdome/bot-sdk';

function decideAction(observation) {
  // `call` already caps at your remaining stack (a short call is a legal all-in call in this
  // game's rules — see games/poker-texas-hold-em/src/game.ts), so check/call is genuinely all
  // this bot ever needs; there's no case where it must reach for `allIn` or `fold`.
  return observation.toCall === 0 ? { type: 'check' } : { type: 'call' };
}

runBot({ decideAction });
