import { describe, expect, it } from 'vitest';
import {
  adjustPositionForCorporateAction,
  applyCorporateActionToSecurity,
  maybeTriggerSplit,
} from '../src/market/corporateActions.js';
import type { CorporateActionDetails, Position, SecurityState } from '../src/types.js';

function security(overrides: Partial<SecurityState> = {}): SecurityState {
  return {
    symbol: 'TECH_A',
    kind: 'EQUITY',
    sector: 'TECHNOLOGY',
    active: true,
    factorLoadings: [],
    styleLoadings: { SIZE: 0, VALUE: 0, MOMENTUM: 0, QUALITY: 0, VOLATILITY: 0 },
    marketBeta: 1,
    fundamentals: { revenueCents: 100_000_000, revenueGrowth: 0.01, earningsCents: 10_000_000, marginBps: 1000, lifecycleStage: 'MATURE' },
    fundamentalValueCents: 40000,
    pendingActual: { epsCents: 100, revenueCents: 100_000_000, marginBps: 1000 },
    sharesOutstanding: 100_000_000,
    referencePriceCents: 40000,
    initialReferencePriceCents: 10000,
    priceHistory: [{ date: 'day-0', open: 400, high: 405, low: 395, close: 400, volume: 1000 }],
    lastRoundVolume: null,
    openOrders: [],
    pendingLiquidity: { bids: [], asks: [] },
    borrowFeeAnnualized: 0.03,
    borrowableShares: 1000,
    analystRevisions: [],
    events: [],
    ...overrides,
  };
}

describe('stock splits — spec §40 (a 2-for-1 split must not look like a 50% loss)', () => {
  it('triggers once price runs to 4x its (split-adjusted) starting price', () => {
    const cheap = security({ referencePriceCents: 20000, initialReferencePriceCents: 10000 });
    expect(maybeTriggerSplit(cheap, cheap.initialReferencePriceCents)).toBeNull();
    const runUp = security({ referencePriceCents: 40000, initialReferencePriceCents: 10000 });
    expect(maybeTriggerSplit(runUp, runUp.initialReferencePriceCents)).toEqual({ type: 'STOCK_SPLIT', fromShares: 1, toShares: 2 });
  });

  it('triggers a reverse split once price falls to 15% of its starting price', () => {
    const beaten = security({ referencePriceCents: 1400, initialReferencePriceCents: 10000 });
    expect(maybeTriggerSplit(beaten, beaten.initialReferencePriceCents)).toEqual({ type: 'REVERSE_SPLIT', fromShares: 5, toShares: 1 });
  });

  it('halves price and doubles shares outstanding, adjusting price history proportionally', () => {
    const before = security({ referencePriceCents: 40000, fundamentalValueCents: 40000, sharesOutstanding: 100_000_000 });
    const details: CorporateActionDetails = { type: 'STOCK_SPLIT', fromShares: 1, toShares: 2 };
    const after = applyCorporateActionToSecurity(before, details);
    expect(after.referencePriceCents).toBe(20000);
    expect(after.fundamentalValueCents).toBe(20000);
    expect(after.sharesOutstanding).toBe(200_000_000);
    expect(after.priceHistory[0]?.close).toBe(200);
    expect(after.openOrders).toEqual([]); // documented simplification: resting orders are cancelled
  });

  it("doubles a long position's shares and halves its cost basis — net position value is unchanged", () => {
    const position: Position = { shares: 100, averageEntryPriceCents: 30000, realizedPnlCents: 0 };
    const details: CorporateActionDetails = { type: 'STOCK_SPLIT', fromShares: 1, toShares: 2 };
    const { position: after, cashDeltaCents } = adjustPositionForCorporateAction(position, details);
    expect(after.shares).toBe(200);
    expect(after.averageEntryPriceCents).toBe(15000);
    expect(cashDeltaCents).toBe(0);
    // Cost basis (shares * averageEntryPrice) — the thing P&L is measured against — is preserved.
    expect(after.shares * after.averageEntryPriceCents).toBe(position.shares * position.averageEntryPriceCents);
  });

  it('reverse-splits a short position symmetrically (fewer shares owed, proportionally higher entry price)', () => {
    const position: Position = { shares: -500, averageEntryPriceCents: 2000, realizedPnlCents: 0 };
    const details: CorporateActionDetails = { type: 'REVERSE_SPLIT', fromShares: 5, toShares: 1 };
    const { position: after } = adjustPositionForCorporateAction(position, details);
    expect(after.shares).toBe(-100);
    expect(after.averageEntryPriceCents).toBe(10000);
  });
});

describe('cash dividends (spec §40)', () => {
  it('pays a long position and charges a short position the same per-share amount', () => {
    const details: CorporateActionDetails = { type: 'CASH_DIVIDEND', perShareCents: 25 };
    const long: Position = { shares: 200, averageEntryPriceCents: 10000, realizedPnlCents: 0 };
    const short: Position = { shares: -200, averageEntryPriceCents: 10000, realizedPnlCents: 0 };
    expect(adjustPositionForCorporateAction(long, details).cashDeltaCents).toBe(5000);
    expect(adjustPositionForCorporateAction(short, details).cashDeltaCents).toBe(-5000);
    expect(adjustPositionForCorporateAction(long, details).position).toEqual(long); // position itself is untouched
  });
});
