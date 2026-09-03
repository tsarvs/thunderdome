/**
 * Lowest Card Hearts — always plays the lowest-ranked legal card, ignoring the trick, hearts, or
 * scores entirely. Passes its 3 highest-ranked cards (the simplest possible way to unload
 * dangerous high cards without any actual risk analysis).
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough (written for RPS, but
 * the wire protocol itself is game-agnostic). This file only needs to answer one question:
 * decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk-js';

function byRankAscending(a, b) {
  return a.rank - b.rank;
}

function decideAction(observation) {
  if (observation.phase === 'passing') {
    const highestThree = [...observation.hand].sort(byRankAscending).slice(-3);
    return { type: 'pass', cards: highestThree };
  }
  const [lowest] = [...observation.legalPlays].sort(byRankAscending);
  return { type: 'play', card: lowest };
}

runBot({ decideAction });
