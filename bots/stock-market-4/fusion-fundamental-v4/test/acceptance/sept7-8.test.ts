import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import type { TradingDecision } from '../../src/decision.js';
import { createDecideAction } from '../../src/index.js';
import { computeResearchDelta } from '../../src/research/delta.js';
import { interpretResearchDelta } from '../../src/research/interpretEvents.js';
import {
  ACQUISITION_ANNOUNCED_EVENT_ID,
  ARC_ENTITY_ID,
  buildObservation,
  DAY_BEFORE_ACQUISITION,
  ACQUISITION_DAY,
  emptyPortfolio,
  fusionSnapshotAt,
  fusionStateAt,
} from '../support/fixtures.js';

/**
 * The single most important test in this suite (spec §18): a real stock-market-4-shaped bot run
 * across the Sept 7 -> Sept 8, 2026 boundary, using the REAL `@thunderdome/research-fusion`
 * fixture (not a hand-rolled fake), proving the bot's entire causal chain works end to end
 * exactly on the day research actually makes the ELMT/Schwabmünchen acquisition knowable.
 */
describe('ELMT Schwabmünchen acquisition — Sept 7 / Sept 8 boundary (spec §18)', () => {
  it('is blind to the acquisition on Sept 7, and reacts to it on Sept 8', () => {
    const decisions: TradingDecision[] = [];
    const decideAction = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG, (decision) => decisions.push(decision));

    const portfolio = emptyPortfolio();
    const sept7Observation = buildObservation({
      round: 1,
      date: '2026-09-07',
      ticker: 'ELMT',
      priceDollars: 20,
      portfolio,
      researchSnapshot: fusionSnapshotAt(DAY_BEFORE_ACQUISITION),
    });
    decideAction(sept7Observation);
    const decisionSept7 = decisions[0]!;

    // Sept 7: the acquisition must not be referenced anywhere in the explanation.
    expect(decisionSept7.researchChanges.some((line) => line.includes(ACQUISITION_ANNOUNCED_EVENT_ID))).toBe(false);
    expect(decisionSept7.modelEffects.some((line) => line.toLowerCase().includes('acquir'))).toBe(false);
    expect(decisionSept7.rationale.toLowerCase()).not.toContain('schwabmünchen');

    const sept8Observation = buildObservation({
      round: 2,
      date: '2026-09-08',
      ticker: 'ELMT',
      priceDollars: 20.5,
      portfolio,
      researchSnapshot: fusionSnapshotAt(ACQUISITION_DAY),
    });
    decideAction(sept8Observation);
    const decisionSept8 = decisions[1]!;

    // Sept 8: the new acquisition event must actually be detected and interpreted.
    expect(decisionSept8.researchChanges.some((line) => line.includes(ACQUISITION_ANNOUNCED_EVENT_ID))).toBe(true);
    expect(decisionSept8.modelEffects.some((line) => line.toLowerCase().includes('acquir'))).toBe(true);
    expect(decisionSept8.valuationAfter).toBeGreaterThan(decisionSept7.valuationAfter);

    // Structural check (spec §5/§19): capability went up, but no ARC supplier/qualification
    // relationship was invented as a side effect.
    const delta = computeResearchDelta(fusionStateAt(DAY_BEFORE_ACQUISITION), fusionStateAt(ACQUISITION_DAY));
    const effects = interpretResearchDelta(
      delta,
      fusionStateAt(ACQUISITION_DAY),
      DEFAULT_FUSION_FUNDAMENTAL_CONFIG.securities[0]!.targetEntityId,
    );
    const arcCustomerEffect = effects.find((e) => e.factor === `relationship:potential_fusion_customer:${ARC_ENTITY_ID}`);
    const arcQualificationEffect = effects.find((e) => e.factor === `relationship:fusion_qualification:${ARC_ENTITY_ID}`);
    expect(arcCustomerEffect?.direction).toBe('neutral');
    expect(arcQualificationEffect?.direction).toBe('neutral');
    expect(effects.some((e) => e.factor === 'manufacturing_capability' && e.direction === 'positive')).toBe(true);
  });
});
