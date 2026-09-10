import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import { computeTradingDecision } from '../../src/decision.js';
import { emptyPortfolio, DAY_BEFORE_ACQUISITION, ACQUISITION_DAY, fusionStateAt } from '../support/fixtures.js';

/**
 * Spec §19's adversarial case, at full-pipeline scope (the unit-level version lives in
 * `test/research/interpretEvents.test.ts`): the real fixture has ELMT's acquired operation
 * manufacturing tungsten AND ARC requiring tungsten, but the ELMT/Schwabmünchen -> ARC supplier
 * and qualification relationships are both explicitly `UNKNOWN`. The acquisition must still be
 * allowed to raise base-business and fusion-OPTION value — but `fusionDerivedValue`, which is
 * driven entirely by the configured `supplierCapture` assumption, must be bit-for-bit unchanged,
 * because nothing in this delta touched that assumption.
 */
describe('anti-inference: capability increasing never inflates fusion-derived value (spec §5/§19)', () => {
  it('fusionDerivedValue is identical before and after the acquisition, even though fair value moves', () => {
    const elmt = DEFAULT_FUSION_FUNDAMENTAL_CONFIG.securities[0]!;
    const signalThresholds = DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal;
    const portfolioPolicy = DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio;

    const before = computeTradingDecision({
      date: '2026-09-07',
      security: elmt,
      signalThresholds,
      portfolioPolicy,
      previousResearchState: undefined,
      currentResearchState: fusionStateAt(DAY_BEFORE_ACQUISITION),
      currentPriceDollars: 20,
      previousPriceDollars: undefined,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });

    const after = computeTradingDecision({
      date: '2026-09-08',
      security: elmt,
      signalThresholds,
      portfolioPolicy,
      previousResearchState: fusionStateAt(DAY_BEFORE_ACQUISITION),
      currentResearchState: fusionStateAt(ACQUISITION_DAY),
      currentPriceDollars: 20,
      previousPriceDollars: 20,
      previousFairValuePerShare: before.valuationAfter,
      portfolio: emptyPortfolio(),
    });

    // The acquisition must move the fair value estimate (base-business + option value channels)...
    expect(after.valuationAfter).not.toBeCloseTo(before.valuationAfter, 6);
    expect(after.valuationBreakdown.baseBusinessValue.base).toBeGreaterThan(
      before.valuationBreakdown.baseBusinessValue.base,
    );

    // ...but the fusion-derived-value chain itself — driven only by `elmt.valuation.fusion`'s
    // supplierCapture assumption, which this delta never touches — must be bit-for-bit identical.
    expect(after.valuationBreakdown.fusionDerivedValue).toEqual(before.valuationBreakdown.fusionDerivedValue);
  });
});
