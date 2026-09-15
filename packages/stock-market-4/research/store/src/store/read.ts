import {
  formatValidationIssues,
  validateResearchDataset,
  type ResearchDataset,
} from '@thunderdome/research-core';
import {
  ASSERTIONS,
  ASSUMPTIONS,
  ENTITIES,
  EVENTS,
  EVIDENCE,
  HYPOTHESES,
  MODELS,
  QUESTIONS,
  RELATIONSHIPS,
  SCENARIOS,
  selectCollection,
  VARIABLES,
} from './collections.js';
import type { ResearchStore } from './db.js';
import { err, ok, type Result } from '../result.js';

interface ResearchDatasetRow {
  dataset_id: string;
  domain: string;
  name: string;
  version: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

/**
 * Reconstructs a full `ResearchDataset` from `store` and re-validates it via
 * `validateResearchDataset` before returning — defense in depth against a hand-edited or
 * otherwise corrupted row, the same "never trust storage blindly" posture
 * `@thunderdome/market-data` and `@thunderdome/forward-match-store` both take.
 *
 * Unlike `@thunderdome/market-data`'s `barsAsOf` (scoped by an exact, pinned dataset version),
 * this always returns the CURRENT cumulative dataset for `datasetId` — see
 * `migrations/0001_init.ts`'s doc comment for why research data has no per-version pinning.
 */
export function getResearchDataset(
  store: ResearchStore,
  datasetId: string,
): Result<ResearchDataset> {
  const { db } = store;
  const row = db.prepare('SELECT * FROM research_datasets WHERE dataset_id = ?').get(datasetId) as
    ResearchDatasetRow | undefined;

  if (!row) {
    return err(`research dataset "${datasetId}" not found`);
  }

  const raw = {
    id: row.dataset_id,
    version: row.version,
    domain: row.domain,
    name: row.name,
    createdAt: row.created_at,
    metadata: row.metadata !== null ? (JSON.parse(row.metadata) as unknown) : undefined,
    entities: selectCollection(db, ENTITIES, datasetId),
    relationships: selectCollection(db, RELATIONSHIPS, datasetId),
    evidence: selectCollection(db, EVIDENCE, datasetId),
    assertions: selectCollection(db, ASSERTIONS, datasetId),
    hypotheses: selectCollection(db, HYPOTHESES, datasetId),
    assumptions: selectCollection(db, ASSUMPTIONS, datasetId),
    variables: selectCollection(db, VARIABLES, datasetId),
    models: selectCollection(db, MODELS, datasetId),
    scenarios: selectCollection(db, SCENARIOS, datasetId),
    events: selectCollection(db, EVENTS, datasetId),
    questions: selectCollection(db, QUESTIONS, datasetId),
  };

  const validated = validateResearchDataset(raw);
  if (!validated.ok) {
    return err(
      `research dataset "${datasetId}" is corrupt: ${formatValidationIssues(validated.issues)}`,
    );
  }
  return ok(validated.value);
}
