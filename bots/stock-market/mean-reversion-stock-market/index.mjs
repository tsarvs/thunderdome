/**
 * Mean Reversion Stock Market — buys once the price has drifted at least 3% below the average
 * of its own recent history (betting it reverts upward), sells once it's drifted at least 3%
 * above that average, holds in between. Trades a fixed quantity (capped at 10 shares, and by
 * whatever's actually affordable/owned) rather than sizing the trade to the size of the drift.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action — no randomness, so no PRNG/onInit needed at all.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const MAX_TRADE_QUANTITY = 10;
const DRIFT_THRESHOLD = 0.03;

function decideAction(observation) {
  const { portfolio, market } = observation;
  const history = market.priceHistory;
  const average = history.reduce((sum, price) => sum + price, 0) / history.length;

  if (market.price < average * (1 - DRIFT_THRESHOLD)) {
    const maxAffordable = Math.floor((portfolio.cash * 0.99) / market.price);
    const quantity = Math.min(maxAffordable, MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { action: 'BUY', quantity };
    }
  } else if (market.price > average * (1 + DRIFT_THRESHOLD)) {
    const quantity = Math.min(portfolio.shares, MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { action: 'SELL', quantity };
    }
  }
  return { action: 'HOLD' };
}

runBot({ decideAction });
