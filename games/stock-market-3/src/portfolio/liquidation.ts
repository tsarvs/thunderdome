import { roundHalfUp } from '../money.js';
import type { LiquiditySnapshot, PortfolioAccount, RiskConfig, Trade } from '../types.js';
import { applyFill, isBelowMaintenance } from './accounting.js';

function markPriceOf(markPricesCents: ReadonlyMap<string, number>, symbol: string): number {
  return markPricesCents.get(symbol) ?? 0;
}

/**
 * Forces a participant's positions flat, symbol by symbol, until equity is back at or above the
 * maintenance requirement (or there's nothing left to liquidate) — the portfolio-level
 * generalization of games/stock-market-2's single-symbol `forceLiquidate` (spec §38). Order is
 * deterministic (largest gross exposure first, by symbol name as a tiebreak) so replay/testing
 * never depends on `Map` iteration order. Each symbol liquidates through that SAME round's
 * remaining synthetic-liquidity ladder for that symbol (selling into its remaining bids, or
 * buying from its remaining asks to cover a short) — never a bare accounting adjustment (spec
 * §25).
 */
export function forceLiquidatePortfolio(args: {
  participantId: string;
  portfolio: PortfolioAccount;
  markPricesCents: ReadonlyMap<string, number>;
  liquidityBySymbol: ReadonlyMap<string, LiquiditySnapshot>;
  risk: RiskConfig;
  feeRate: number;
}): { trades: Trade[]; portfolio: PortfolioAccount; liquidityBySymbol: Map<string, LiquiditySnapshot> } {
  const { participantId, markPricesCents, risk, feeRate } = args;
  let portfolio = args.portfolio;
  const liquidityBySymbol = new Map(args.liquidityBySymbol);
  const trades: Trade[] = [];

  const symbolsByExposureDesc = [...portfolio.positions.entries()]
    .filter(([, position]) => position.shares !== 0)
    .sort(([symbolA, a], [symbolB, b]) => {
      const exposureA = Math.abs(a.shares) * markPriceOf(markPricesCents, symbolA);
      const exposureB = Math.abs(b.shares) * markPriceOf(markPricesCents, symbolB);
      return exposureB - exposureA || symbolA.localeCompare(symbolB);
    })
    .map(([symbol]) => symbol);

  for (const symbol of symbolsByExposureDesc) {
    if (!isBelowMaintenance(portfolio, markPricesCents, risk)) {
      break;
    }
    const position = portfolio.positions.get(symbol);
    if (position === undefined || position.shares === 0) {
      continue;
    }
    const side = position.shares > 0 ? 'SELL' : 'BUY';
    let remaining = Math.abs(position.shares);
    const snapshot = liquidityBySymbol.get(symbol) ?? { bids: [], asks: [] };
    const levels = (side === 'SELL' ? snapshot.bids : snapshot.asks).map((level) => ({ ...level }));

    for (const level of levels) {
      if (remaining <= 0 || level.quantity <= 0) {
        continue;
      }
      const quantity = Math.min(remaining, level.quantity);
      const feeCents = roundHalfUp(quantity * level.priceCents * feeRate);
      portfolio = applyFill(portfolio, symbol, side, quantity, level.priceCents, feeCents);
      trades.push(
        side === 'SELL'
          ? { symbol, buyerParticipantId: null, sellerParticipantId: participantId, priceCents: level.priceCents, quantity, forced: true }
          : { symbol, buyerParticipantId: participantId, sellerParticipantId: null, priceCents: level.priceCents, quantity, forced: true },
      );
      level.quantity -= quantity;
      remaining -= quantity;
    }
    liquidityBySymbol.set(symbol, side === 'SELL' ? { bids: levels, asks: snapshot.asks } : { bids: snapshot.bids, asks: levels });
  }

  return { trades, portfolio, liquidityBySymbol };
}
