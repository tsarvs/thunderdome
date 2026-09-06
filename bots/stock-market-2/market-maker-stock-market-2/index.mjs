/**
 * Market Maker — Stock Market 2 — every round, quotes a fresh LIMIT buy a little below and a
 * LIMIT sell a little above the visible mid-price (spec §38's "places bids and asks around the
 * current market"), sized within whatever's currently affordable/held. Both quotes are DAY
 * orders, so there's never anything to explicitly cancel — an unfilled quote simply expires at
 * end of day and gets re-quoted fresh next round against that round's own mid-price.
 *
 * The sell side additionally opens/adds to a short (bounded by `portfolio.buyingPower`, which is
 * 0 whenever the game's `config.risk.allowShortSelling` is off) once this bot runs out of shares
 * to offer — a real market maker doesn't stop quoting an ask just because its own inventory ran
 * out. This bot never needs to read `config.risk` directly: `buyingPower` already communicates
 * whether shorting is available.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action — no randomness, so no PRNG/onInit needed at all.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const QUOTE_SIZE = 5;
const HALF_SPREAD_FRACTION = 0.005; // quote 0.5% inside either side of the mid-price

function decideAction(observation) {
  const { portfolio, market } = observation;
  const mid = market.bid !== null && market.ask !== null ? (market.bid + market.ask) / 2 : market.lastClose;
  const orders = [];

  const bidPrice = Math.max(0.01, Number((mid * (1 - HALF_SPREAD_FRACTION)).toFixed(2)));
  const maxAffordable = Math.floor((portfolio.availableCash * 0.99) / bidPrice);
  if (maxAffordable >= 1) {
    orders.push({
      kind: 'LIMIT',
      side: 'BUY',
      quantity: Math.min(QUOTE_SIZE, maxAffordable),
      limitPrice: bidPrice,
      timeInForce: 'DAY',
    });
  }

  const askPrice = Math.max(0.01, Number((mid * (1 + HALF_SPREAD_FRACTION)).toFixed(2)));
  const shortRoom = portfolio.buyingPower > 0 ? Math.floor(portfolio.buyingPower / askPrice) : 0;
  const maxSellable = portfolio.availableShares + shortRoom;
  if (maxSellable >= 1) {
    orders.push({
      kind: 'LIMIT',
      side: 'SELL',
      quantity: Math.min(QUOTE_SIZE, maxSellable),
      limitPrice: askPrice,
      timeInForce: 'DAY',
    });
  }

  return { orders };
}

runBot({ decideAction });
