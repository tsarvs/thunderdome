/**
 * Momentum — Stock Market 2 — buys at market when the last realized close just rose from the one
 * before it, sells at market when it just fell, holds when unchanged (or before there are at
 * least two realized candles to compare). Trades a fixed quantity (capped at 10 shares, and by
 * whatever's actually affordable/held) rather than sizing the trade to the size of the move.
 *
 * Ported from bots/stock-market/momentum-stock-market onto stock-market-2's rebuilt exchange:
 * that bot compared consecutive entries of `market.priceHistory` directly (a plain number per
 * round); this game's `priceHistory` is a list of realized daily OHLCV candles instead (spec
 * §20), so this version compares consecutive candles' `.close` instead.
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
  if (history.length < 2) {
    return { orders: [] }; // nothing to compare against yet
  }
  const last = history[history.length - 1].close;
  const previous = history[history.length - 2].close;

  if (last > previous) {
    const price = market.ask ?? market.lastClose;
    const quantity = Math.min(Math.floor((portfolio.availableCash * 0.99) / price), MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] };
    }
  } else if (last < previous) {
    const quantity = Math.min(portfolio.availableShares, MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] };
    }
  }
  return { orders: [] };
}

runBot({ decideAction });
