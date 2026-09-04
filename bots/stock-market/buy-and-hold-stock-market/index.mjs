/**
 * Buy And Hold Stock Market — spends 90% of its starting cash on shares in round 0 (a 10% cash
 * buffer is comfortably more than the transaction fee needs), then holds for every remaining
 * round no matter what the price or news does.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action — no randomness, so no PRNG/onInit needed at all.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

function decideAction(observation) {
  if (observation.round === 0) {
    const maxAffordable = Math.floor(
      (observation.portfolio.cash * 0.9) / observation.market.price,
    );
    if (maxAffordable >= 1) {
      return { action: 'BUY', quantity: maxAffordable };
    }
  }
  return { action: 'HOLD' };
}

runBot({ decideAction });
