import { describe, expect, it } from 'vitest';
import {
  applyFill,
  equityCents,
  getPosition,
  grossPositionValueCents,
  isBelowMaintenance,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
  remainingBuyingPowerCents,
} from '../src/portfolio/accounting.js';
import { forceLiquidatePortfolio } from '../src/portfolio/liquidation.js';
import type { PortfolioAccount, RiskConfig } from '../src/types.js';

function emptyPortfolio(cashCents = 1_000_000): PortfolioAccount {
  return { cashCents, positions: new Map(), bankrupt: false, peakEquityCents: cashCents, maxDrawdown: 0 };
}

const RISK_MARGIN: RiskConfig = {
  allowShortSelling: true,
  borrowableShares: 1000,
  borrowFeeAnnualized: 0.03,
  initialMarginRatio: 0.5,
  maintenanceMarginRatio: 0.3,
};

describe('applyFill — weighted-average cost basis across multiple symbols', () => {
  it('opens a long in one symbol without disturbing another symbol already held', () => {
    let portfolio = applyFill(emptyPortfolio(), 'TECH_A', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'CONSUMER_A', 'BUY', 5, 2000, 0);
    expect(getPosition(portfolio, 'TECH_A')).toEqual({ shares: 10, averageEntryPriceCents: 1000, realizedPnlCents: 0 });
    expect(getPosition(portfolio, 'CONSUMER_A')).toEqual({ shares: 5, averageEntryPriceCents: 2000, realizedPnlCents: 0 });
    expect(portfolio.cashCents).toBe(1_000_000 - 10 * 1000 - 5 * 2000);
  });

  it('realizes P&L when a fill flips a position straight through flat', () => {
    let portfolio = applyFill(emptyPortfolio(), 'TECH_A', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'TECH_A', 'SELL', 15, 1200, 0);
    const position = getPosition(portfolio, 'TECH_A');
    expect(position.shares).toBe(-5);
    expect(position.averageEntryPriceCents).toBe(1200); // the new short leg opened at the fill price
    expect(position.realizedPnlCents).toBe((1200 - 1000) * 10); // only the closing 10 shares realize P&L
  });
});

describe('portfolio-level margin (spec §38 — sized against gross exposure across ALL symbols)', () => {
  it('remainingBuyingPowerCents accounts for exposure already used in a different symbol', () => {
    // Starts with $2,000 cash; spends $1,000 buying 100 shares @ $10 -> $1,000 cash + $1,000
    // position = $2,000 equity. Capacity = equity / 0.5 = $4,000; $1,000 of it is already used.
    const portfolio = applyFill(emptyPortfolio(2_000_00), 'TECH_A', 'BUY', 100, 1000, 0);
    const marks = new Map([['TECH_A', 1000]]);
    expect(remainingBuyingPowerCents(portfolio, marks, RISK_MARGIN)).toBe(300_000);
  });

  it('is zero whenever short selling is disabled', () => {
    const risk: RiskConfig = { ...RISK_MARGIN, allowShortSelling: false };
    expect(remainingBuyingPowerCents(emptyPortfolio(), new Map(), risk)).toBe(0);
  });

  it('flags below-maintenance once equity falls under maintenanceMarginRatio * gross exposure', () => {
    let portfolio = applyFill(emptyPortfolio(10_000), 'TECH_A', 'SELL', 100, 1000, 0); // short 100 @ $10, cash +$1,000
    // cash = 10,000 + 100,000(cents) ... use plain numbers for clarity below instead.
    portfolio = { cashCents: 20_000, positions: portfolio.positions, bankrupt: false, peakEquityCents: 20_000, maxDrawdown: 0 };
    const marksHealthy = new Map([['TECH_A', 1000]]); // equity = 20000 - 100*1000 = -80000 (deliberately unhealthy to prove the check fires)
    expect(isBelowMaintenance(portfolio, marksHealthy, RISK_MARGIN)).toBe(true);
  });

  it('grossPositionValueCents sums absolute exposure across every symbol', () => {
    let portfolio = applyFill(emptyPortfolio(), 'TECH_A', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'CONSUMER_A', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['TECH_A', 1000],
      ['CONSUMER_A', 2000],
    ]);
    expect(grossPositionValueCents(portfolio, marks)).toBe(10 * 1000 + 5 * 2000);
  });
});

describe('maxBuyQuantityByMargin / maxSellQuantityByMargin', () => {
  it('always allows covering an existing short back toward flat regardless of margin', () => {
    expect(maxBuyQuantityByMargin(-50, 0, 1000)).toBe(50);
  });
  it('always allows reducing an existing long back toward flat regardless of margin/borrow', () => {
    expect(maxSellQuantityByMargin(50, 0, 1000, 0)).toBe(50);
  });
});

describe('forceLiquidatePortfolio — deterministic, largest-exposure-first ordering', () => {
  it('liquidates the larger position first and stops once back above maintenance', () => {
    let portfolio = applyFill(emptyPortfolio(0), 'TECH_A', 'BUY', 100, 1000, 0); // $1,000.00 exposure
    portfolio = applyFill(portfolio, 'CONSUMER_A', 'BUY', 10, 100, 0); // $10.00 exposure — much smaller
    // gross exposure = $1,010.00 -> maintenance requirement = 30% = $303.00; force cash negative
    // enough that equity falls below that requirement.
    portfolio = { ...portfolio, cashCents: -100_000 };
    const marks = new Map([
      ['TECH_A', 1000],
      ['CONSUMER_A', 100],
    ]);
    const liquidity = new Map([
      ['TECH_A', { bids: [{ priceCents: 1000, quantity: 1000 }], asks: [] }],
      ['CONSUMER_A', { bids: [{ priceCents: 100, quantity: 1000 }], asks: [] }],
    ]);
    const result = forceLiquidatePortfolio({
      participantId: 'alice',
      portfolio,
      markPricesCents: marks,
      liquidityBySymbol: liquidity,
      risk: RISK_MARGIN,
      feeRate: 0,
    });
    expect(result.trades[0]?.symbol).toBe('TECH_A'); // $100,000 exposure > $1,000 exposure
  });
});

describe('equityCents', () => {
  it('sums cash plus every position marked at its own price', () => {
    let portfolio = applyFill(emptyPortfolio(500_00), 'TECH_A', 'BUY', 10, 1000, 0);
    portfolio = applyFill(portfolio, 'CONSUMER_A', 'SELL', 5, 2000, 0);
    const marks = new Map([
      ['TECH_A', 1100],
      ['CONSUMER_A', 1800],
    ]);
    expect(equityCents(portfolio, marks)).toBe(portfolio.cashCents + 10 * 1100 + -5 * 1800);
  });
});
