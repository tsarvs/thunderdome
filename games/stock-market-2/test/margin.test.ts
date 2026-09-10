import { describe, expect, it } from 'vitest';
import { forceLiquidate } from '../src/portfolio/margin.js';
import type { LiquidityLevel, StockMarket2Portfolio } from '../src/types.js';

function longPortfolio(shares: number): StockMarket2Portfolio {
  return { cashCents: 100_000, shares, averageEntryPriceCents: 10000, realizedPnlCents: 0, bankrupt: false };
}

function shortPortfolio(shares: number): StockMarket2Portfolio {
  return { cashCents: 2_000_000, shares, averageEntryPriceCents: 10000, realizedPnlCents: 0, bankrupt: false };
}

describe('forceLiquidate', () => {
  it('fully flattens a long by selling into the remaining bid liquidity', () => {
    const liquidity: LiquidityLevel[] = [
      { priceCents: 9900, quantity: 5 },
      { priceCents: 9800, quantity: 20 },
    ];
    const result = forceLiquidate({ participantId: 'alice', portfolio: longPortfolio(10), liquidity, feeRate: 0 });
    expect(result.portfolio.shares).toBe(0);
    expect(result.trades).toEqual([
      { buyerParticipantId: null, sellerParticipantId: 'alice', priceCents: 9900, quantity: 5, forced: true },
      { buyerParticipantId: null, sellerParticipantId: 'alice', priceCents: 9800, quantity: 5, forced: true },
    ]);
    expect(result.remainingLiquidity).toEqual([
      { priceCents: 9900, quantity: 0 },
      { priceCents: 9800, quantity: 15 },
    ]);
  });

  it('fully covers a short by buying from the remaining ask liquidity', () => {
    const liquidity: LiquidityLevel[] = [{ priceCents: 10100, quantity: 100 }];
    const result = forceLiquidate({ participantId: 'alice', portfolio: shortPortfolio(-10), liquidity, feeRate: 0 });
    expect(result.portfolio.shares).toBe(0);
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10100, quantity: 10, forced: true },
    ]);
  });

  it('closes as much as possible when liquidity is insufficient, leaving a residual position', () => {
    const liquidity: LiquidityLevel[] = [{ priceCents: 9900, quantity: 3 }];
    const result = forceLiquidate({ participantId: 'alice', portfolio: longPortfolio(10), liquidity, feeRate: 0 });
    expect(result.portfolio.shares).toBe(7);
    expect(result.trades).toHaveLength(1);
  });

  it('applies the transaction fee to each forced fill, same as a normal trade', () => {
    const liquidity: LiquidityLevel[] = [{ priceCents: 10000, quantity: 10 }];
    const result = forceLiquidate({ participantId: 'alice', portfolio: longPortfolio(10), liquidity, feeRate: 0.01 });
    // 10 shares @ $100 = $1000 notional, 1% fee = $10 = 1000 cents.
    expect(result.portfolio.cashCents).toBe(100_000 + 10 * 10000 - 1000);
  });

  it('does nothing when liquidity is empty — position and portfolio pass through unchanged', () => {
    const result = forceLiquidate({ participantId: 'alice', portfolio: longPortfolio(10), liquidity: [], feeRate: 0 });
    expect(result.trades).toEqual([]);
    expect(result.portfolio).toEqual(longPortfolio(10));
  });
});
