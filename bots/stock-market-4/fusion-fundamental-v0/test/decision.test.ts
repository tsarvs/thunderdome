import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../src/config.js';
import { computeTradingDecision } from '../src/decision.js';
import type { ResearchState } from '../src/research/types.js';
import { computeFusionValue } from '../src/valuation/fusionValue.js';
import { emptyPortfolio } from './support/fixtures.js';

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
      previousPriceDollars: 20,
      previousFairValuePerShare: undefined,
      portfolio: emptyPortfolio(),
    });
    expect(decision.falsifiers).toContain('If X never happens, retire this hypothesis.');
    expect(decision.modelEffects.length).toBeGreaterThan(0);
  });
});
