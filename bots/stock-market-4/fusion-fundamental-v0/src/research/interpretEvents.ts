import type { ResearchDelta } from './delta.js';
import type { Evidence, ResearchHypothesis, ResearchState } from './types.js';

/**
 * A single, inspectable strategy-relevant effect derived from a research change (spec §8).
 * `magnitude`/`confidence` are always sourced from something research actually recorded — a
 * relationship state's own `confidence`, or a hypothesis's own assessed confidence — never an
 * invented number. `direction: 'neutral'` with `magnitude: 0` is how this bot represents "we
 * explicitly checked, and this stays unchanged" — a real, reportable effect in its own right, not
 * the absence of one (see the anti-inference confirmation below).
 */
export interface ModelEffect {
  factor: string;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: number;
  confidence: number;
  rationale: string;
  /** The hypothesis this effect came from, if any — lets `../decision.ts` pull that hypothesis's
   * own `falsifiers` into the trading decision's explanation (spec §16) without re-parsing
   * `factor`'s string form. */
  sourceHypothesisId?: string;
}

/** Relationship types this interpreter recognizes as "our target company acquired something" —
 * domain-defined by research-fusion's own vocabulary (spec's fusion research dataset), not
 * enumerated by research-core itself. Extend this set to support a later acquisition/event; the
 * matching logic below never special-cases a specific company, date, or acquisition. */
const ACQUISITION_RELATIONSHIP_TYPES = new Set(['acquires']);

/** Relationship types this interpreter treats as "a specific fusion-program supplier
 * relationship" — the ones that must NEVER be silently upgraded just because a company's
 * manufacturing capability increased (spec §5/§19's core anti-inference requirement). */
const SUPPLIER_RELATIONSHIP_TYPE_PATTERN = /customer|qualification|supplies|supplier/i;

function indexEvidenceById(state: ResearchState): Map<string, Evidence> {
  return new Map(state.evidence.map((evidence) => [evidence.id, evidence]));
}

/**
 * A hypothesis "relates to" `entityId` if its most recent assessment cites supporting evidence
 * that itself names that entity — research-core's `ResearchHypothesis` has no direct entity link
 * of its own (only `ResearchQuestion` does), so evidence is the one real bridge between "a belief"
 * and "the thing that belief is about."
 */
function hypothesisRelatesToEntity(
  hypothesis: ResearchHypothesis,
  entityId: string,
  evidenceById: Map<string, Evidence>,
): boolean {
  const latest = hypothesis.assessments.at(-1);
  if (latest === undefined) return false;
  return latest.supportingEvidenceIds.some((id) => evidenceById.get(id)?.entityIds.includes(entityId));
}

/**
 * Transforms a `ResearchDelta` into explicit `ModelEffect`s for `targetEntityId` (spec §8) — the
 * whole point of keeping this a separate step from valuation: every economic assumption downstream
 * traces back to one of these, each with its own rationale, rather than research changes feeding
 * a black-box valuation update directly.
 *
 * Two families of effect, both driven entirely by what's actually in `currentState`:
 *
 * 1. **Acquisition-type relationship changes** where `targetEntityId` is the acquirer: a positive
 *    capability effect (magnitude/confidence from the relationship's own recorded `confidence`,
 *    defaulting to full confidence for an unqualified recorded fact) — immediately followed by an
 *    explicit NEUTRAL effect for every supplier/customer/qualification-type relationship already
 *    on record for the acquired entity, confirming each one stays exactly as recorded. This is
 *    what actually enforces "capability increasing must never imply a supplier relationship
 *    increasing" — not an absence of code, a present, inspectable effect saying so.
 * 2. **Hypothesis confidence changes** that relate to `targetEntityId` (via evidence, see above):
 *    one positive effect per changed hypothesis, magnitude and confidence both taken directly from
 *    the hypothesis's own latest assessed confidence — never re-derived or rescaled.
 */
export function interpretResearchDelta(
  delta: ResearchDelta,
  currentState: ResearchState,
  targetEntityId: string,
): ModelEffect[] {
  const effects: ModelEffect[] = [];
  const entitiesById = new Map(currentState.entities.map((entity) => [entity.id, entity]));
  const relationshipsById = new Map(currentState.relationships.map((r) => [r.id, r]));
  const evidenceLookup = indexEvidenceById(currentState);

  for (const change of delta.changedRelationships) {
    if (change.fromEntityId !== targetEntityId) continue;
    if (!ACQUISITION_RELATIONSHIP_TYPES.has(change.type)) continue;

    const acquirerName = entitiesById.get(change.fromEntityId)?.name ?? change.fromEntityId;
    const acquiredName = entitiesById.get(change.toEntityId)?.name ?? change.toEntityId;
    const relationshipConfidence =
      relationshipsById.get(change.relationshipId)?.states.at(-1)?.confidence?.value ?? 1;

    effects.push({
      factor: 'manufacturing_capability',
      direction: 'positive',
      magnitude: relationshipConfidence,
      confidence: relationshipConfidence,
      rationale: `${acquirerName} recorded a new "${change.type}" relationship (status "${change.currentStatus}") with ${acquiredName} — increases manufacturing breadth/capability.`,
    });

    // The anti-inference confirmation: every supplier/qualification/customer relationship
    // already on record FROM the acquired entity is reported here, unmodified, so "capability up"
    // never silently reads as "supplier relationship up" — see this function's own doc comment.
    for (const relationship of currentState.relationships) {
      if (relationship.fromEntityId !== change.toEntityId) continue;
      if (!SUPPLIER_RELATIONSHIP_TYPE_PATTERN.test(relationship.type)) continue;
      const latestState = relationship.states.at(-1);
      if (latestState === undefined) continue;

      const counterpartyName = entitiesById.get(relationship.toEntityId)?.name ?? relationship.toEntityId;
      effects.push({
        factor: `relationship:${relationship.type}:${relationship.toEntityId}`,
        direction: 'neutral',
        magnitude: 0,
        confidence: 1,
        rationale: `${acquiredName} -> ${counterpartyName} "${relationship.type}" stays "${latestState.status}" — capability alone never establishes a customer relationship, qualification, or contract.`,
      });
    }
  }

  for (const change of delta.changedHypotheses) {
    const hypothesis = currentState.hypotheses.find((h) => h.id === change.hypothesisId);
    if (hypothesis === undefined) continue;
    if (!hypothesisRelatesToEntity(hypothesis, targetEntityId, evidenceLookup)) continue;

    effects.push({
      factor: `hypothesis:${hypothesis.name}`,
      direction: 'positive',
      magnitude: change.currentConfidence,
      confidence: change.currentConfidence,
      rationale: change.rationale ?? hypothesis.statement,
      sourceHypothesisId: hypothesis.id,
    });
  }

  return effects;
}
