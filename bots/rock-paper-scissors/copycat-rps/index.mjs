#!/usr/bin/env node
/**
 * Copycat RPS — plays whatever the opponent played in the previous round, or "rock" on the
 * first round when there's no history yet.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to answer one question: decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk';

/**
 * Decide this round's action.
 *
 * `observation` is this round's RpsObservation — see docs/guides/rps-bot-author-guide.md §2:
 *   { round, totalRounds, yourWins, opponentWins, opponentId, history }
 * `history` only ever contains ALREADY-RESOLVED rounds — never the current one, which is
 * exactly what keeps this a fair, simultaneous game.
 */
function decideAction(observation) {
  const lastRound = observation.history.at(-1);
  return { choice: lastRound ? lastRound.opponent : 'rock' };
}

runBot({ decideAction });
