import { describe, expect, it } from 'vitest';
import type { FusionFundamentalConfig, SecurityConfig } from '../../src/config.js';
import { computeTradingDecisions } from '../../src/decision.js';
import type { ResearchState } from '../../src/research/types.js';
import { emptyPortfolio } from '../support/fixtures.js';

/**
 * Spec §20/§42: two securities can appear independent while actually betting on the same
 * underlying commercialization pathway (the FREEM+GFUZ / HTS-trio concern). This constructs a
 * SYNTHETIC pair that unambiguously shares one architecture entity (both hold a direct
 * relationship to the same shared reactor program) — end-to-end through the real
 * `computeTradingDecisions` pipeline, not just the isolated `applyThesisGroupCaps` unit (see
 * `test/portfolio/optimizer.test.ts` for that) — proving the FULL bot actually applies the cap,
 * not just the standalone function.
 */
function constant(value: number) {
  return { bear: value, base: value, bull: value };
}

const SHARED_PROGRAM = 'entity-shared-program';

function makeSecurity(ticker: string, targetEntityId: string): SecurityConfig {
  return {
    ticker,
    targetEntityId,
    sharesOutstanding: 1,
    valuation: {
      baseBusinessValuePerShare: constant(1000), // deeply "undervalued" vs a $20 market -> STRONG_BUY
      fusionOptionValueBaselinePerShare: constant(0),
      fusion: {
        reactorDeployments: constant(0),
        tungstenContentTonnes: constant(0),
        tungstenPriceUsdPerTonne: constant(0),
        supplierCapture: constant(0),
        replacementDemand: constant(0),
        incrementalEbitMargin: constant(0),
        valuationMultiple: constant(0),
      },
      sensitivities: {
        manufacturingCapabilityToBaseValuePerShare: 0,
        manufacturingCapabilityToFusionOptionPerShare: 0,
        hypothesisConfidenceToFusionOptionPerShare: 0,
        supplierCaptureToFusionOptionPerShare: 0,
      },
    },
  };
}

function stateWithSharedProgram(): ResearchState {
  return {
    timestamp: 't1',
    entities: [
      { id: 'entity-a', type: 'company', name: 'Security A', recordedAt: 't0' },
      { id: 'entity-b', type: 'company', name: 'Security B', recordedAt: 't0' },
      { id: SHARED_PROGRAM, type: 'reactor', name: 'Shared Program', recordedAt: 't0' },
    ],
    relationships: [
      { id: 'r1', type: 'supplies', fromEntityId: 'entity-a', toEntityId: SHARED_PROGRAM, states: [{ status: 'qualified', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [] }] },
      { id: 'r2', type: 'supplies', fromEntityId: 'entity-b', toEntityId: SHARED_PROGRAM, states: [{ status: 'qualified', recordedAt: 't0', effectiveFrom: 't0', evidenceIds: [] }] },
    ],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

const BASE_CONFIG_FIELDS = {
  signal: { strongBuyThreshold: 0.15, buyThreshold: 0.05, reduceThreshold: -0.05, sellThreshold: -0.15, strongSellThreshold: -0.25, hysteresisBand: 0 },
  confidenceCalibration: { rollingWindowDays: 20, calmDailyVolatility: 0.01, chaoticDailyVolatility: 0.05, confidenceFloor: 0.3, rollingBlendWeight: 0.3 },
  trendFilter: { windowDays: 10, vetoThreshold: 0.08 },
  volatilitySizing: { referenceDailyVolatility: 0.02, minScaleFactor: 0.5, maxScaleFactor: 1.5 },
  stopLoss: { stopLossPct: 0.25 },
  correlationSizing: { windowDays: 20, concentrationPenalty: 0.5, minScaleFactor: 0.25 },
  portfolio: {
    strongBuyTargetWeight: 0.4,
    buyTargetWeight: 0.1,
    reduceTargetWeight: 0.02,
    shortTargetWeight: 0.25,
    minShortConfidence: 0.7,
    maxPositionWeight: 0.5,
    minOrderNotionalCents: 0,
    rebalanceToleranceWeight: 0,
    emergencyCashReservePct: 0,
    dryPowderTargetPct: 0,
    globalShortBudgetPct: 1,
  },
};

describe('acceptance: correlated exposure across securities is capped at the portfolio level (spec §20/§42)', () => {
  it('caps two securities sharing one architecture entity to the group max, even though each independently earns STRONG_BUY at the FULL per-security target', () => {
    const config: FusionFundamentalConfig = {
      ...BASE_CONFIG_FIELDS,
      securities: [makeSecurity('A', 'entity-a'), makeSecurity('B', 'entity-b')],
      thesisGroupCap: { minSharedExposureIds: 1, maxGroupWeight: 0.3 },
      advancedSignal: { supplierCaptureThresholdShift: 0.08, marketImpliedOptimismConfidencePenalty: 0.5, marketImpliedUpsideConfidenceBoost: 1.2 },
    };

    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: stateWithSharedProgram(),
      currentPricesByTicker: new Map([['A', 20], ['B', 20]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(10_000_000),
    });

    const a = decisions.find((d) => d.security === 'A')!;
    const b = decisions.find((d) => d.security === 'B')!;

    // Each independently earns STRONG_BUY (a 40% raw target) — proving the RAW signal is
    // untouched by this pass, only the FINAL action changes (spec §25).
    expect(a.signalLevel).toBe('STRONG_BUY');
    expect(b.signalLevel).toBe('STRONG_BUY');

    // But the portfolio-level pass caught the shared exposure and scaled BOTH down so their
    // combined weight respects the 0.3 group cap, instead of 0.4 + 0.4 = 0.8.
    expect(a.portfolioAdjustmentNote).toBeDefined();
    expect(b.portfolioAdjustmentNote).toBeDefined();
    const combined = Math.abs(a.targetWeight ?? 0) + Math.abs(b.targetWeight ?? 0);
    expect(combined).toBeCloseTo(0.3, 5);
  });

  it('never caps two securities with NO shared exposure, even if their combined weight is large', () => {
    const config: FusionFundamentalConfig = {
      ...BASE_CONFIG_FIELDS,
      securities: [makeSecurity('A', 'entity-a'), makeSecurity('B', 'entity-b')],
      thesisGroupCap: { minSharedExposureIds: 1, maxGroupWeight: 0.3 },
      advancedSignal: { supplierCaptureThresholdShift: 0.08, marketImpliedOptimismConfidencePenalty: 0.5, marketImpliedUpsideConfidenceBoost: 1.2 },
    };
    // No shared program this time — each entity is isolated.
    const isolatedState: ResearchState = {
      timestamp: 't1',
      entities: [
        { id: 'entity-a', type: 'company', name: 'Security A', recordedAt: 't0' },
        { id: 'entity-b', type: 'company', name: 'Security B', recordedAt: 't0' },
      ],
      relationships: [],
      evidence: [],
      assertions: [],
      hypotheses: [],
      events: [],
      questions: [],
    };

    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: isolatedState,
      currentPricesByTicker: new Map([['A', 20], ['B', 20]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(10_000_000),
    });

    const a = decisions.find((d) => d.security === 'A')!;
    const b = decisions.find((d) => d.security === 'B')!;
    expect(a.portfolioAdjustmentNote).toBeUndefined();
    expect(b.portfolioAdjustmentNote).toBeUndefined();
    expect(a.targetWeight).toBeCloseTo(0.4);
    expect(b.targetWeight).toBeCloseTo(0.4);
  });
});
