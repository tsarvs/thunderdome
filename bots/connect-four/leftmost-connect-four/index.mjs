/**
 * Leftmost Connect Four — always drops into the lowest-indexed column that isn't full yet.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough (written for RPS, but
 * the wire protocol itself is game-agnostic). This file only needs to answer one question:
 * decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk';

/** Ignores the board entirely — always picks the first (lowest-indexed) legal column. */
function decideAction(observation) {
  return { column: observation.legalColumns[0] };
}

runBot({ decideAction });
