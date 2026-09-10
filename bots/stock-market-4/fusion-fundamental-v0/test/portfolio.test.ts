import { describe, expect, it } from 'vitest';
import type { PortfolioPolicy } from '../src/config.js';
import { buildOrders, targetWeightForSignal } from '../src/portfolio.js';
import { emptyPortfolio, portfolioWithPosition } from './support/fixtures.js';

// rebalanceToleranceWeight: 0 here so every existing test below keeps testing exactly what it
// says it does (exact-target math, minOrderNotionalCents) rather than incidentally being skipped
// by the tolerance — that feature gets its own dedicated tests further down.
const policy: PortfolioPolicy = {
  strongBuyTargetWeight: 0.2,
  buyTargetWeight: 0.08,
  reduceTargetWeight: 0.02,
  maxPositionWeight: 0.25,
  minOrderNotionalCents: 5_000,
  rebalanceToleranceWeight: 0,
};

describe('targetWeightForSignal', () => {
  it('maps every level to the configured target, clamped to maxPositionWeight', () => {
    expect(targetWeightForSignal('STRONG_BUY', policy)).toBeCloseTo(0.2);
    expect(targetWeightForSignal('BUY', policy)).toBeCloseTo(0.08);
    expect(targetWeightForSignal('HOLD', policy)).toBeUndefined();
    expect(targetWeightForSignal('REDUCE', policy)).toBeCloseTo(0.02);
    expect(targetWeightForSignal('SELL', policy)).toBe(0);
  });

  it('clamps a target above maxPositionWeight', () => {
    const aggressive: PortfolioPolicy = { ...policy, strongBuyTargetWeight: 0.9 };
    expect(targetWeightForSignal('STRONG_BUY', aggressive)).toBeCloseTo(0.25);
  });
});

describe('buildOrders', () => {
  it('produces no orders when targetWeight is undefined (HOLD)', () => {
    const orders = buildOrders({
      ticker: 'ELMT',
      targetWeight: undefined,
      priceDollars: 20,
      portfolio: emptyPortfolio(),
      policy,
    });
    expect(orders).toEqual([]);
  });

  it('buys shares to move from no position toward a positive target weight', () => {
    const portfolio = emptyPortfolio(10_000_000); // $100,000
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.1, priceDollars: 20, portfolio, policy });
    // target = $10,000 -> 500 shares at $20
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });

  it('never buys more than buyingPowerCents allows', () => {
    const portfolio = {
      ...emptyPortfolio(10_000_000),
      buyingPowerCents: 1_000_000, // only $10,000 available
    };
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.5, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });

  it('sells shares to move toward a smaller positive target', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 1000, averageEntryPriceCents: 1500, priceCents: 2000 });
    // equity = 5,000,000 cash + 1000*2000 = 7,000,000; target 0.02 -> 140,000 cents -> 70 shares
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.02, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 930 }]);
  });

  it('never sells more shares than are actually held', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 10, averageEntryPriceCents: 1500, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 10 }]);
  });

  it('a SELL (target weight 0) with no position produces no orders', () => {
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio: emptyPortfolio(), policy });
    expect(orders).toEqual([]);
  });

  it('skips a trade below minOrderNotionalCents', () => {
    const portfolio = emptyPortfolio(1_000_000);
    // target 0.001 of $10,000 equity = $10 -> below $50 minimum
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.001, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([]);
  });
});

describe('buildOrders rebalance tolerance (spec follow-up)', () => {
  const tolerantPolicy: PortfolioPolicy = { ...policy, rebalanceToleranceWeight: 0.02 };

  it('skips a trade when the position is already within tolerance of the target, even though the target technically differs', () => {
    // shares=350 @ $20 -> $7,000 position; cash 5,000,000 cents -> equity 5,700,000 cents ->
    // current weight = 700,000 / 5,700,000 ≈ 0.1228; target 0.1 -> drift ≈ 0.0228... use a target
    // that lands drift comfortably under 0.02 instead:
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    // current weight = 700,000 / 5,700,000 ≈ 0.12281; target 0.11 -> drift ≈ 0.01281 < 0.02
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.11, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([]);
  });

  it('still trades once drift exceeds the tolerance', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    // current weight ≈ 0.12281; target 0.08 -> drift ≈ 0.04281 > 0.02
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.08, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).not.toEqual([]);
  });

  it('a full exit (target weight 0) still fires once the held position exceeds tolerance', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 350 }]);
  });

  it('a tiny existing position within tolerance of a zero target is left alone rather than force-closed', () => {
    // shares=5 @ $20 -> $100 position against 5,000,000 cents cash -> weight ≈ 0.0002, well
    // within a 0.02 tolerance of a target of 0.
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 5, averageEntryPriceCents: 2000, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([]);
  });
});
