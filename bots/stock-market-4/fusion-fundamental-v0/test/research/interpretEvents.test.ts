import { describe, expect, it } from 'vitest';
import { computeResearchDelta } from '../../src/research/delta.js';
import { interpretResearchDelta } from '../../src/research/interpretEvents.js';
import type { ResearchState } from '../../src/research/types.js';

const TARGET = 'entity-target';
const ACQUIRED = 'entity-acquired';
const ARC = 'entity-arc';

function baseState(timestamp: string): ResearchState {
  return {
    timestamp,
    entities: [
      { id: TARGET, type: 'company', name: 'Target Co', recordedAt: timestamp },
      { id: ACQUIRED, type: 'company', name: 'Acquired Co', recordedAt: timestamp },
      { id: ARC, type: 'reactor', name: 'ARC', recordedAt: timestamp },
    ],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

describe('interpretResearchDelta — acquisition handling', () => {
  it('produces a positive manufacturing_capability effect for a new acquires relationship', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-acquires',
          type: 'acquires',
          fromEntityId: TARGET,
          toEntityId: ACQUIRED,
          states: [
            {
              status: 'agreement_signed',
              recordedAt: 't2',
              effectiveFrom: 't2',
              evidenceIds: [],
              confidence: { value: 0.9 },
            },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET);

    const capability = effects.find((e) => e.factor === 'manufacturing_capability');
    expect(capability).toBeDefined();
    expect(capability?.direction).toBe('positive');
    expect(capability?.magnitude).toBeCloseTo(0.9);
    expect(capability?.confidence).toBeCloseTo(0.9);
  });

  it('NEVER upgrades an UNKNOWN supplier/qualification/customer relationship into a positive effect just because capability increased (spec §5/§19)', () => {
    const previous = baseState('t1');
    const current: ResearchState = {
      ...baseState('t2'),
      relationships: [
        {
          id: 'rel-acquires',
          type: 'acquires',
          fromEntityId: TARGET,
          toEntityId: ACQUIRED,
          states: [{ status: 'agreement_signed', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        // The acquired entity ALSO manufactures the exact material ARC requires, AND ARC requires
        // it — but the supplier/qualification relationship itself is explicitly UNKNOWN. This is
        // the adversarial case: capability + demand must never be conflated into "supplies."
        {
          id: 'rel-manufactures',
          type: 'manufactures',
          fromEntityId: ACQUIRED,
          toEntityId: 'entity-tungsten',
          states: [{ status: 'active', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        {
          id: 'rel-arc-requires',
          type: 'requires',
          fromEntityId: ARC,
          toEntityId: 'entity-tungsten',
          states: [{ status: 'active', recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] }],
        },
        {
          id: 'rel-potential-customer',
          type: 'potential_fusion_customer',
          fromEntityId: ACQUIRED,
          toEntityId: ARC,
          states: [
            { status: 'UNKNOWN', confidence: { value: 0 }, recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] },
          ],
        },
        {
          id: 'rel-qualification',
          type: 'fusion_qualification',
          fromEntityId: ACQUIRED,
          toEntityId: ARC,
          states: [
            { status: 'UNKNOWN', confidence: { value: 0 }, recordedAt: 't2', effectiveFrom: 't2', evidenceIds: [] },
          ],
        },
      ],
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET);

    const customerEffect = effects.find((e) => e.factor === `relationship:potential_fusion_customer:${ARC}`);
    const qualificationEffect = effects.find((e) => e.factor === `relationship:fusion_qualification:${ARC}`);

    expect(customerEffect?.direction).toBe('neutral');
    expect(customerEffect?.magnitude).toBe(0);
    expect(qualificationEffect?.direction).toBe('neutral');
    expect(qualificationEffect?.magnitude).toBe(0);

    // No effect anywhere claims the supplier relationship itself became positive.
    expect(effects.some((e) => e.factor.includes('potential_fusion_customer') && e.direction === 'positive')).toBe(
      false,
    );
    expect(effects.some((e) => e.factor.includes('fusion_qualification') && e.direction === 'positive')).toBe(false);
  });

  it('produces no effects when the delta is empty', () => {
    const state = baseState('t1');
    const delta = computeResearchDelta(state, state);
    const effects = interpretResearchDelta(delta, state, TARGET);
    expect(effects).toEqual([]);
  });

  it('produces a positive hypothesis effect only for hypotheses that relate to the target entity via evidence', () => {
    const previous: ResearchState = {
      ...baseState('t1'),
      evidence: [
        { id: 'ev1', observedAt: 't1', source: { name: 's' }, description: 'about target', entityIds: [TARGET] },
        { id: 'ev2', observedAt: 't1', source: { name: 's' }, description: 'about arc', entityIds: [ARC] },
      ],
      hypotheses: [
        {
          id: 'h-target',
          name: 'Target hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            { timestamp: 't0', confidence: { value: 0.2 }, supportingEvidenceIds: ['ev1'], contradictingEvidenceIds: [] },
          ],
        },
        {
          id: 'h-unrelated',
          name: 'Unrelated hypothesis',
          statement: 'stmt',
          status: 'active',
          createdAt: 't0',
          assessments: [
            { timestamp: 't0', confidence: { value: 0.2 }, supportingEvidenceIds: ['ev2'], contradictingEvidenceIds: [] },
          ],
        },
      ],
    };
    const current: ResearchState = {
      ...previous,
      timestamp: 't2',
      hypotheses: previous.hypotheses.map((h) => ({
        ...h,
        assessments: [
          ...h.assessments,
          { timestamp: 't2', confidence: { value: 0.7 }, supportingEvidenceIds: h.assessments[0]!.supportingEvidenceIds, contradictingEvidenceIds: [] },
        ],
      })),
    };
    const delta = computeResearchDelta(previous, current);
    const effects = interpretResearchDelta(delta, current, TARGET);

    expect(effects.some((e) => e.factor === 'hypothesis:Target hypothesis')).toBe(true);
    expect(effects.some((e) => e.factor === 'hypothesis:Unrelated hypothesis')).toBe(false);
  });
});
