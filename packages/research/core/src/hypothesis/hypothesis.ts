import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import {
  compareResearchTimestamps,
  ResearchTimestampSchema,
  toEpochMillis,
} from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import {
  fromZodSafeParse,
  type ValidationIssue,
  type ValidationResult,
} from '../validation/issue.js';
import { HypothesisAssessmentSchema, type HypothesisAssessment } from './assessment.js';
import { ResearchCriterionSchema } from './criterion.js';

export const HypothesisStatusSchema = z.enum([
  'proposed',
  'active',
  'supported',
  'weakened',
  'falsified',
  'accepted',
  'rejected',
  'retired',
]);

export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

/**
 * Two assessments of the same hypothesis sharing a timestamp would make "what was the
 * confidence at that instant" ambiguous — flagged rather than silently resolved by array order.
 */
export function findDuplicateAssessmentTimestamps(
  assessments: readonly HypothesisAssessment[],
): ValidationIssue[] {
  const indicesByInstant = new Map<number, number[]>();
  assessments.forEach((assessment, index) => {
    const millis = toEpochMillis(assessment.timestamp);
    const indices = indicesByInstant.get(millis) ?? [];
    indices.push(index);
    indicesByInstant.set(millis, indices);
  });

  const issues: ValidationIssue[] = [];
  for (const indices of indicesByInstant.values()) {
    if (indices.length <= 1) continue;
    const [first] = indices;
    if (first === undefined) continue; // unreachable given the length check above
    issues.push({
      path: `assessments.${String(first)}`,
      code: 'ambiguous-assessment-timestamp',
      message: `assessments at indices ${indices.join(', ')} share the same timestamp — the confidence at that instant is ambiguous`,
    });
  }
  return issues;
}

const BaseResearchHypothesisSchema = z.object({
  id: ResearchIdSchema,
  name: z.string().min(1, 'hypothesis name must be a non-empty string'),
  statement: z.string().min(1, 'hypothesis statement must be a non-empty string'),
  status: HypothesisStatusSchema,
  // Visibility (state reconstruction): the hypothesis itself is gated by createdAt; each
  // assessment within it is separately gated by its own timestamp (see assessment.ts) — a
  // snapshot at T sees a hypothesis created at or before T with only the subset of its
  // assessments whose timestamp is also at or before T.
  createdAt: ResearchTimestampSchema,
  assessments: z.array(HypothesisAssessmentSchema),
  falsifiers: z.array(ResearchCriterionSchema).optional(),
  metadata: z.record(ResearchValueSchema).optional(),
});

export const ResearchHypothesisSchema = BaseResearchHypothesisSchema.strict().superRefine(
  (value, ctx) => {
    value.assessments.forEach((assessment, index) => {
      if (compareResearchTimestamps(assessment.timestamp, value.createdAt) < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assessments', index, 'timestamp'],
          message: `assessments.${String(index)}.timestamp (${assessment.timestamp}) precedes the hypothesis's createdAt (${value.createdAt})`,
        });
      }
    });

    for (const issue of findDuplicateAssessmentTimestamps(value.assessments)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  },
);

/**
 * An explicitly testable research belief, tracked over time via `assessments` rather than a
 * single mutable confidence value, with optional `falsifiers` describing what would weaken or
 * falsify it. research-core does not prescribe how falsifiers are evaluated (no rule engine).
 */
export type ResearchHypothesis = z.infer<typeof ResearchHypothesisSchema>;

export function parseResearchHypothesis(raw: unknown): ValidationResult<ResearchHypothesis> {
  return fromZodSafeParse(ResearchHypothesisSchema.safeParse(raw));
}
