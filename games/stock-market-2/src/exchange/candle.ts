import { toDollars } from '../money.js';
import type { DailyCandle, Trade } from '../types.js';

/**
 * Derives the day's OHLCV candle from actual executed trades — never fabricated independently
 * (spec §20). If no trades executed at all this round, the documented fallback is open = high =
 * low = close = the day's reference price, volume = 0.
 */
export function buildDailyCandle(date: string, referencePriceCents: number, trades: readonly Trade[]): DailyCandle {
  if (trades.length === 0) {
    const referencePrice = toDollars(referencePriceCents);
    return { date, open: referencePrice, high: referencePrice, low: referencePrice, close: referencePrice, volume: 0 };
  }

  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const trade of trades) {
    high = Math.max(high, trade.priceCents);
    low = Math.min(low, trade.priceCents);
    volume += trade.quantity;
  }

  return {
    date,
    open: toDollars(trades[0]?.priceCents ?? referencePriceCents),
    high: toDollars(high),
    low: toDollars(low),
    close: toDollars(trades[trades.length - 1]?.priceCents ?? referencePriceCents),
    volume,
  };
}
