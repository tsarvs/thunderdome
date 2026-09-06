/**
 * Mean Reversion — Stock Market 2 — buys at market once the last realized close has drifted at
 * least 3% below the average of its own recent realized closes (betting it reverts upward), sells
 * at market once it's drifted 3% above that average, holds in between. Trades a fixed quantity
 * (capped at 10 shares, and by whatever's actually affordable/held) rather than sizing the trade
 * to the size of the drift.
 *
 * Ported from bots/stock-market/mean-reversion-stock-market onto stock-market-2's rebuilt
 * exchange: that bot averaged `market.priceHistory` directly (a plain number per round); this
 * game's `priceHistory` is a list of realized daily OHLCV candles instead (spec §20), so this
 * version averages each candle's `.close`.
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
  const closes = market.priceHistory.map((candle) => candle.close);
  if (closes.length === 0) {
    return { orders: [] }; // nothing to average yet
  }
  const average = closes.reduce((sum, close) => sum + close, 0) / closes.length;
  const last = market.lastClose;

  if (last < average * (1 - DRIFT_THRESHOLD)) {
    const price = market.ask ?? last;
    const quantity = Math.min(Math.floor((portfolio.availableCash * 0.99) / price), MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] };
    }
  } else if (last > average * (1 + DRIFT_THRESHOLD)) {
    const quantity = Math.min(portfolio.availableShares, MAX_TRADE_QUANTITY);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] };
    }
  }
  return { orders: [] };
}

runBot({ decideAction });
