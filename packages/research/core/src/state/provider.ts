import { isAtOrBefore, type ResearchTimestamp } from '../common/timestamps.js';
import type { ResearchDataset } from '../dataset/dataset.js';
import type { ResearchState } from './state.js';

/**
 * Reconstructs `ResearchState` from a `ResearchDataset` at an arbitrary point in time.
 *
 * THE key invariant (spec §31/§45): a state at time T may contain only information available
 * to the research system at or before T. Each collection is filtered independently, by the one
 * timestamp field that governs *when research came to know it* — never a real-world validity
 * window (`validFrom`/`effectiveFrom`/etc.), which describes when the underlying fact was true,
 * not when research learned it:
 *
 * | Collection    | Gated by                                    |
 * |---------------|----------------------------------------------|
 * | entities      | `recordedAt`                                  |
 * | relationships | at least one state's `recordedAt` (see below) |
 * | evidence      | `observedAt`                                  |
 * | assertions    | `createdAt`                                    |
 * | hypotheses    | `createdAt` (assessments separately, below)    |
 * | assumptions   | `recordedAt`                                   |
 * | variables     | `recordedAt`                                   |
 * | models        | `createdAt`                                    |
 * | scenarios     | `recordedAt`                                   |
 * | events        | `timestamp`                                    |
 * | questions     | `createdAt`                                    |
 *
 * Two collections filter *inside* an object, not just across the array:
 * - A relationship's `states` are trimmed to those with `recordedAt <= T`; a relationship with
 *   zero visible states is dropped entirely — unlike every other type, a `ResearchRelationship`
 *   has no epistemic timestamp of its own (spec §14 defines none), so "do we know anything
 *   about this relationship yet" is entirely a function of whether any of its states are known.
 * - A hypothesis's `assessments` are trimmed to those with `timestamp <= T`, but the hypothesis
 *   itself stays present (with possibly zero assessments) as long as its own `createdAt <= T` —
 *   unlike relationships, `ResearchHypothesis.createdAt` is its own independent epistemic
 *   timestamp, so a proposed-but-not-yet-assessed hypothesis is still knowable.
 *
 * Reference resolution is NOT re-validated here: this assumes (as `validateResearchDataset`
 * does not currently check) that a well-formed dataset never has an object cite another object
 * whose own epistemic timestamp is later than the citing object's — i.e. you can't cite
 * evidence you don't have yet. Filtering here does not re-prune dangling id references that
 * would result from violating that assumption; see README.md.
 */
export function computeResearchStateAt(
  dataset: ResearchDataset,
  timestamp: ResearchTimestamp,
): ResearchState {
  const visible = (recordedAt: ResearchTimestamp): boolean => isAtOrBefore(recordedAt, timestamp);

  const relationships = dataset.relationships
    .map((relationship) => ({
      ...relationship,
      states: relationship.states.filter((state) => visible(state.recordedAt)),
    }))
    .filter((relationship) => relationship.states.length > 0);

  const hypotheses = dataset.hypotheses
    .filter((hypothesis) => visible(hypothesis.createdAt))
    .map((hypothesis) => ({
      ...hypothesis,
      assessments: hypothesis.assessments.filter((assessment) => visible(assessment.timestamp)),
    }));

  return {
    timestamp,
    entities: dataset.entities.filter((entity) => visible(entity.recordedAt)),
    relationships,
    evidence: dataset.evidence.filter((evidence) => visible(evidence.observedAt)),
    assertions: dataset.assertions.filter((assertion) => visible(assertion.createdAt)),
    hypotheses,
    assumptions: dataset.assumptions.filter((assumption) => visible(assumption.recordedAt)),
    variables: dataset.variables.filter((variable) => visible(variable.recordedAt)),
    models: dataset.models.filter((model) => visible(model.createdAt)),
    scenarios: dataset.scenarios.filter((scenario) => visible(scenario.recordedAt)),
    events: dataset.events.filter((event) => visible(event.timestamp)),
    questions: dataset.questions.filter((question) => visible(question.createdAt)),
  };
}

export interface ResearchStateProvider {
  getStateAt(timestamp: ResearchTimestamp): ResearchState;
}

/** Binds a `ResearchDataset` to the `ResearchStateProvider` interface (spec §30). */
export function createResearchStateProvider(dataset: ResearchDataset): ResearchStateProvider {
  return {
    getStateAt: (timestamp) => computeResearchStateAt(dataset, timestamp),
  };
}
