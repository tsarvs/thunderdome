import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../src/config.js';
import { computeTradingDecision } from '../src/decision.js';
import type { DailyBar } from '../src/marketTypes.js';
import type { ResearchState } from '../src/research/types.js';
import { computeFusionValue } from '../src/valuation/fusionValue.js';
import { emptyPortfolio } from './support/fixtures.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

const elmt = DEFAULT_FUSION_FUNDAMENTAL_CONFIG.securities[0]!;

/** The fair value per share `elmt`'s config implies with zero model effects — used below to
 * construct a market price with an exactly-zero valuation gap, so a HOLD is the correct,
 * non-arbitrary expectation rather than an assumption about the default config's numbers. */
function baselineFairValuePerShare(): number {
  const fusionValue = computeFusionValue(elmt.valuation.fusion);
  return (
    elmt.valuation.baseBusinessValuePerShare.base +
    fusionValue.fusionValue.base / elmt.sharesOutstanding +
    elmt.valuation.fusionOptionValueBaselinePerShare.base
  );
}

function emptyState(timestamp: string): ResearchState {
  return {
    timestamp,
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

describe('computeTradingDecision', () => {
  it('with no research change, holds and explains that nothing changed (spec §21)', () => {
    const state = emptyState('t1');
    const price = baselineFairValuePerShare();
    const decision = computeTradingDecision({
      date: '2026-09-01',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio,
      previousResearchState: state,
      currentResearchState: state,
      currentPriceDollars: price,
      priceHistory: [],
      confidenceCalibration: { rollingWindowDays: 20, calmDailyVolatility: 0.01, chaoticDailyVolatility: 0.05, confidenceFloor: 0.3, rollingBlendWeight: 0.3 },
      trendFilter: { windowDays: 10, vetoThreshold: 0.08 },
      volatilitySizing: { referenceDailyVolatility: 0.02, minScaleFactor: 0.5, maxScaleFactor: 1.5 },
      stopLoss: { stopLossPct: 0.25 },
      previousPriceDollars: price,
      previousFairValuePerShare: price,
      portfolio: emptyPortfolio(),
    });
    expect(decision.action).toBe('HOLD');
    expect(decision.orders).toEqual([]);
    expect(decision.researchChanges).toEqual([]);
    expect(decision.rationale).toContain('No research change');
  });

  it('always returns a decision record, even for a HOLD, with a fair value and rationale', () => {
    const state = emptyState('t1');
    const decision = computeTradingDecision({
      date: '2026-09-01',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio,
      previousResearchState: undefined,
      currentResearchState: state,
      currentPriceDollars: 20,
      priceHistory: [],
      confidenceCalibration: { rollingWindowDays: 20, calmDailyVolatility: 0.01, chaoticDailyVolatility: 0.05, confidenceFloor: 0.3, rollingBlendWeight: 0.3 },
      trendFilter: { windowDays: 10, vetoThreshold: 0.08 },
      volatilitySizing: { referenceDailyVolatility: 0.02, minScaleFactor: 0.5, maxScaleFactor: 1.5 },
      stopLoss: { stopLossPct: 0.25 },
      previousPriceDollars: undefined,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(typeof decision.valuationAfter).toBe('number');
    expect(decision.rationale.length).toBeGreaterThan(0);
    expect(decision.marketReaction).toBeNull();
  });

  it('includes hypothesis falsifiers in the decision record when a hypothesis-driven effect fires', () => {
    const previous = emptyState('t1');
    const current: ResearchState = {
      ...emptyState('t2'),
      evidence: [
        {
          id: 'ev1',
          observedAt: 't2',
          source: { name: 's' },
          description: 'evidence about ELMT',
          entityIds: [elmt.targetEntityId],
        },
      ],
      hypotheses: [
        {
          id: 'h1',
          name: 'Test hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            { timestamp: 't2', confidence: { value: 0.7 }, supportingEvidenceIds: ['ev1'], contradictingEvidenceIds: [] },
          ],
          falsifiers: [{ description: 'If X never happens, retire this hypothesis.' }],
        },
      ],
    };
    const decision = computeTradingDecision({
      date: '2026-09-08',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio,
      previousResearchState: previous,
      currentResearchState: current,
      currentPriceDollars: 20,
      priceHistory: [],
      confidenceCalibration: { rollingWindowDays: 20, calmDailyVolatility: 0.01, chaoticDailyVolatility: 0.05, confidenceFloor: 0.3, rollingBlendWeight: 0.3 },
      trendFilter: { windowDays: 10, vetoThreshold: 0.08 },
      volatilitySizing: { referenceDailyVolatility: 0.02, minScaleFactor: 0.5, maxScaleFactor: 1.5 },
      stopLoss: { stopLossPct: 0.25 },
      previousPriceDollars: 20,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(decision.falsifiers).toContain('If X never happens, retire this hypothesis.');
    expect(decision.modelEffects.length).toBeGreaterThan(0);
  });
});

describe('computeTradingDecision trend filter (v3)', () => {
  const state = emptyState('t1');
  // 10 declining closes (40 -> 22), then today continues the decline to $2 — a deep discount vs.
  // ELMT's real ~$17 fair value (STRONG_BUY territory) but also a steep, unmistakable decline.
  const decliningHistory = [40, 38, 36, 34, 32, 30, 28, 26, 24, 22].map((close, i) => bar(`d${String(i)}`, close));
  // 10 rising closes (5 -> 50), then today continues the rally to $100 — way above ELMT's real
  // fair value (STRONG_SELL territory) but also a steep, unmistakable rally.
  const risingHistory = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((close, i) => bar(`d${String(i)}`, close));

  it('vetoes a STRONG_BUY entry when the security is in a steep recent decline', () => {
    const decision = computeTradingDecision({
      date: '2026-09-08',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio,
      previousResearchState: state,
      currentResearchState: state,
      currentPriceDollars: 2,
      priceHistory: decliningHistory,
      confidenceCalibration: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.confidenceCalibration,
      trendFilter: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.trendFilter,
      volatilitySizing: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.volatilitySizing,
      stopLoss: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.stopLoss,
      previousPriceDollars: 3,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(decision.signalLevel).toBe('STRONG_BUY');
    expect(decision.targetWeight).toBeUndefined();
    expect(decision.action).toBe('HOLD');
    expect(decision.rationale).toContain('VETOED');
  });

  it('vetoes a STRONG_SELL short when the security is in a steep recent rally', () => {
    const decision = computeTradingDecision({
      date: '2026-09-08',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: { ...DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio, minShortConfidence: 0 }, // isolate the trend veto, not the confidence gate
      previousResearchState: state,
      currentResearchState: state,
      currentPriceDollars: 100,
      priceHistory: risingHistory,
      confidenceCalibration: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.confidenceCalibration,
      trendFilter: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.trendFilter,
      volatilitySizing: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.volatilitySizing,
      stopLoss: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.stopLoss,
      previousPriceDollars: 90,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(decision.signalLevel).toBe('STRONG_SELL');
    expect(decision.targetWeight).toBe(0);
    expect(decision.rationale).toContain('VETOED');
  });

  it('does NOT veto a STRONG_BUY when the recent trend is within the threshold', () => {
    // A mild, sub-8% trailing move — same deep-discount STRONG_BUY signal, but nothing for the
    // trend filter to object to.
    const mildHistory = Array.from({ length: 10 }, (_, i) => bar(`d${String(i)}`, 2 + i * 0.01)); // ~2.00 -> ~2.09
    const decision = computeTradingDecision({
      date: '2026-09-08',
      security: elmt,
      signalThresholds: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal,
      portfolioPolicy: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.portfolio,
      previousResearchState: state,
      currentResearchState: state,
      currentPriceDollars: 2.1,
      priceHistory: mildHistory,
      confidenceCalibration: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.confidenceCalibration,
      trendFilter: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.trendFilter,
      volatilitySizing: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.volatilitySizing,
      stopLoss: DEFAULT_FUSION_FUNDAMENTAL_CONFIG.stopLoss,
      previousPriceDollars: 2.09,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(decision.signalLevel).toBe('STRONG_BUY');
    expect(decision.targetWeight).toBeGreaterThan(0);
    expect(decision.rationale).not.toContain('VETOED');
  });
});
