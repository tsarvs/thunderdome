import { describe, expect, it } from 'vitest';
import {
  findDuplicateAssessmentTimestamps,
  parseResearchHypothesis,
} from '../../src/hypothesis/hypothesis.js';
import type { HypothesisAssessment } from '../../src/hypothesis/assessment.js';

function assessment(
  timestamp: string,
  value: number,
  overrides: Partial<HypothesisAssessment> = {},
): HypothesisAssessment {
  return {
    timestamp,
    confidence: { value },
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    ...overrides,
  };
}

function baseHypothesis(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hypothesis-h032',
    name: 'H032',
    statement: 'Vacuum-vessel fabrication is a major commercial bottleneck.',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    assessments: [],
    ...overrides,
  };
}

describe('ResearchHypothesis construction', () => {
  it('accepts a minimal valid hypothesis with no assessments yet', () => {
    expect(parseResearchHypothesis(baseHypothesis()).ok).toBe(true);
  });

  it('accepts falsifiers', () => {
    const raw = baseHypothesis({
      falsifiers: [{ description: 'A second supplier qualifies within 3 years.' }],
    });
    expect(parseResearchHypothesis(raw)).toEqual({ ok: true, value: raw });
  });

  it('requires a non-empty name and statement, and a valid status', () => {
    expect(parseResearchHypothesis(baseHypothesis({ name: '' })).ok).toBe(false);
    expect(parseResearchHypothesis(baseHypothesis({ statement: '' })).ok).toBe(false);
    expect(parseResearchHypothesis(baseHypothesis({ status: 'not-a-status' })).ok).toBe(false);
  });

  it('rejects an assessment timestamped before the hypothesis was created', () => {
    const raw = baseHypothesis({
      createdAt: '2026-06-01T00:00:00Z',
      assessments: [assessment('2026-01-01T00:00:00Z', 0.4)],
    });
    expect(parseResearchHypothesis(raw).ok).toBe(false);
  });

  it('rejects two assessments sharing the same timestamp', () => {
    const raw = baseHypothesis({
      assessments: [
        assessment('2026-06-01T00:00:00Z', 0.4),
        assessment('2026-06-01T00:00:00Z', 0.5),
      ],
    });
    expect(parseResearchHypothesis(raw).ok).toBe(false);
  });
});

describe('hypothesis confidence history over time (spec §20/§44)', () => {
  const y2026 = assessment('2026-12-31T23:59:59Z', 0.94, {
    rationale: 'Only one qualified vessel supplier to date.',
  });
  const y2028 = assessment('2028-12-31T23:59:59Z', 0.81, {
    rationale: 'A competing fabricator began qualification trials.',
  });
  const y2029 = assessment('2029-12-31T23:59:59Z', 0.42, {
    rationale: 'A second supplier completed qualification.',
  });
  const h032History = [y2026, y2028, y2029];

  it('accepts a hypothesis whose confidence changes across multiple years', () => {
    const raw = baseHypothesis({ assessments: h032History });
    expect(parseResearchHypothesis(raw)).toEqual({ ok: true, value: raw });
  });

  it('keeps each historical assessment intact rather than collapsing to a single scalar', () => {
    const result = parseResearchHypothesis(baseHypothesis({ assessments: h032History }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.assessments).toHaveLength(3);
    expect(result.value.assessments.map((a) => a.confidence.value)).toEqual([0.94, 0.81, 0.42]);
  });

  it('accepts assessments given out of chronological order', () => {
    const shuffled = [y2029, y2026, y2028];
    expect(findDuplicateAssessmentTimestamps(shuffled)).toEqual([]);
  });
});
