import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import { computeTradingDecisions } from '../../src/decision.js';
import { fusionStateAt } from '../support/fixtures.js';

/**
 * Spec §43: KMT and AMSC are deliberate CONTROL cases — real, tungsten/superconductor-adjacent
 * companies the research dataset does NOT establish a fusion supplier relationship for (the
 * fixture's own `commodityTrap` assertion names Kennametal explicitly as a caution: general
 * tungsten exposure isn't the same as capturing fusion economics). This bot must be able to
 * explain why they're never treated as fusion plays, not just silently ignore them.
 */
describe('acceptance: KMT/AMSC control cases are explainable, never inflated by an uncaptured fusion narrative (spec §43)', () => {
  it('KMT and AMSC never receive a manufacturing_capability or supplier_capture effect against the real fixture', () => {
    const state = fusionStateAt('2026-09-11T00:00:00Z');
    const decisions = computeTradingDecisions({
      date: '2026-09-11',
      config: DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
      previousResearchState: undefined,
      currentResearchState: state,
      currentPricesByTicker: new Map([['KMT', 29.34], ['AMSC', 28.71]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: { cashCents: 10_000_000, equityCents: 10_000_000, positions: [], equityHistory: [], buyingPowerCents: 0, maintenanceRequirementCents: 0, belowMaintenance: false, riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 } },
    });

    const kmt = decisions.find((d) => d.security === 'KMT')!;
    const amsc = decisions.find((d) => d.security === 'AMSC')!;
    expect(kmt.modelEffects.some((line) => line.includes('capability') || line.includes('supplier'))).toBe(false);
    expect(amsc.modelEffects.some((line) => line.includes('capability') || line.includes('supplier'))).toBe(false);

    // fusionDerivedValue stays exactly zero (NO_FUSION_ASSUMPTIONS) — every dollar of fair value
    // for these two comes from base business value alone, never a fusion narrative.
    expect(kmt.valuationBreakdown.fusionDerivedValue.base).toBe(0);
    expect(amsc.valuationBreakdown.fusionDerivedValue.base).toBe(0);

    // No modeled fusion revenue chain -> nothing to reverse-engineer a market-implied capture from.
    expect(kmt.marketImplied).toBeUndefined();
    expect(amsc.marketImplied).toBeUndefined();
  });

  it("KMT's exposure map shows low/no supplier/qualification/contract-tier exposure — explainable as a control case, not silently absent data", () => {
    const state = fusionStateAt('2026-09-11T00:00:00Z');
    const decisions = computeTradingDecisions({
      date: '2026-09-11',
      config: DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
      previousResearchState: undefined,
      currentResearchState: state,
      currentPricesByTicker: new Map([['KMT', 29.34]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: { cashCents: 10_000_000, equityCents: 10_000_000, positions: [], equityHistory: [], buyingPowerCents: 0, maintenanceRequirementCents: 0, belowMaintenance: false, riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 } },
    });
    const kmt = decisions.find((d) => d.security === 'KMT')!;
    // Explicitly zero fusion-program supplier/qualification/contract relationships on record for
    // Kennametal — the exposure map reports this plainly (an empty array), rather than the bot
    // ever asserting or assuming one exists.
    expect(kmt.exposure.qualification).toEqual([]);
    expect(kmt.exposure.contract).toEqual([]);
  });
});
