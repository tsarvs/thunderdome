import { describe, expect, it } from 'vitest';
import { parseHypothesisAssessment } from '../../src/hypothesis/assessment.js';

function baseAssessment(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-12-31T23:59:59Z',
    confidence: { value: 0.94 },
    supportingEvidenceIds: ['evidence-1'],
    contradictingEvidenceIds: [],
    ...overrides,
  };
}

describe('HypothesisAssessment', () => {
  it('accepts a minimal valid assessment', () => {
    expect(parseHypothesisAssessment(baseAssessment()).ok).toBe(true);
  });

  it('accepts a rationale', () => {
    const raw = baseAssessment({ rationale: 'No competing supplier has qualified yet.' });
    expect(parseHypothesisAssessment(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires timestamp and confidence', () => {
    expect(parseHypothesisAssessment(baseAssessment({ timestamp: undefined })).ok).toBe(false);
    expect(parseHypothesisAssessment(baseAssessment({ confidence: undefined })).ok).toBe(false);
  });

  it('requires supportingEvidenceIds and contradictingEvidenceIds arrays, though they may be empty', () => {
    expect(parseHypothesisAssessment(baseAssessment({ supportingEvidenceIds: [] })).ok).toBe(true);
    expect(parseHypothesisAssessment(baseAssessment({ supportingEvidenceIds: undefined })).ok).toBe(
      false,
    );
  });

  it('rejects the same evidence id appearing in both supporting and contradicting', () => {
    const raw = baseAssessment({
      supportingEvidenceIds: ['evidence-1'],
      contradictingEvidenceIds: ['evidence-1'],
    });
    expect(parseHypothesisAssessment(raw).ok).toBe(false);
  });
});
