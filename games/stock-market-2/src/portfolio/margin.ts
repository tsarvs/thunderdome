import { roundHalfUp } from '../money.js';
import type { LiquidityLevel, StockMarket2Portfolio, Trade } from '../types.js';
import { applyFill } from './accounting.js';

/**
 * Forces a participant's entire position flat, executed through the same synthetic-liquidity
 * mechanism the normal exchange uses (spec §25 step 4) — never a bare accounting adjustment.
 * Walks whatever's left of that round's liquidity ladder on the side that can absorb this
 * participant's position (bids for a forced SELL closing a long, asks for a forced BUY covering a
 * short), same level-by-level walk as `exchange/matchingEngine.ts`'s normal liquidity matching.
 *
 * If the remaining ladder can't fully absorb the position, this closes as much as it can — the
 * caller re-checks equity afterward and marks bankruptcy if it's still negative (spec §25).
 */
export function forceLiquidate(args: {
  participantId: string;
  portfolio: StockMarket2Portfolio;
  liquidity: readonly LiquidityLevel[];
  feeRate: number;
}): { trades: Trade[]; portfolio: StockMarket2Portfolio; remainingLiquidity: LiquidityLevel[] } {
  const { participantId, feeRate } = args;
  const side = args.portfolio.shares > 0 ? 'SELL' : 'BUY';
  let remaining = Math.abs(args.portfolio.shares);
  const levels = args.liquidity.map((level) => ({ ...level }));
  const trades: Trade[] = [];
  let portfolio = args.portfolio;

  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }
    if (level.quantity <= 0) {
      continue;
    }
    const quantity = Math.min(remaining, level.quantity);
    const feeCents = roundHalfUp(quantity * level.priceCents * feeRate);
    portfolio = applyFill(portfolio, side, quantity, level.priceCents, feeCents);
    trades.push(
      side === 'SELL'
        ? { buyerParticipantId: null, sellerParticipantId: participantId, priceCents: level.priceCents, quantity, forced: true }
        : { buyerParticipantId: participantId, sellerParticipantId: null, priceCents: level.priceCents, quantity, forced: true },
    );
    level.quantity -= quantity;
    remaining -= quantity;
  }

  return { trades, portfolio, remainingLiquidity: levels };
}
