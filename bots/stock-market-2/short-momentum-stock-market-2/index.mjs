/**
 * Short Momentum — Stock Market 2 — opens or adds to a short position at market after two
 * consecutive down realized closes (a sustained downward move, not just one bad day), and covers
 * the entire position at market the moment the price ticks back up. Never goes long — this bot
 * only ever expresses a bearish view (spec §38's "attempts to short during sustained downward
 * movement"); `bots/stock-market-2/momentum-stock-market-2` already covers plain long/flat
 * momentum.
 *
 * `portfolio.buyingPower` is 0 whenever the game's `config.risk.allowShortSelling` is off, so this
 * bot naturally never trades at all in a cash-only game — it never needs to read `config.risk`
 * directly to know shorting isn't available.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action — no randomness, so no PRNG/onInit needed at all.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const MAX_TRADE_QUANTITY = 10;

function decideAction(observation) {
  const { portfolio, market } = observation;
  const history = market.priceHistory;
  const last = market.lastClose;
  const previous = history.length >= 1 ? history[history.length - 1].close : last;
  const beforePrevious = history.length >= 2 ? history[history.length - 2].close : previous;

  const isShort = portfolio.shares < 0;

  if (isShort && last > previous) {
    // Any bounce covers the whole position — this bot never holds a short through a reversal.
    const quantity = Math.min(-portfolio.shares, MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] };
    }
    return { orders: [] };
  }

  const sustainedDownMove = last < previous && previous < beforePrevious;
  if (sustainedDownMove && portfolio.buyingPower > 0) {
    const price = market.bid ?? last;
    const quantity = Math.min(Math.floor(portfolio.buyingPower / price), MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] };
    }
  }
  return { orders: [] };
}

runBot({ decideAction });
