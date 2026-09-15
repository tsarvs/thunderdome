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
  VARIABLES,
  type CollectionConfig,
} from './collections.js';
import {
  bumpDatasetVersion,
  mergeResearchUpdate,
  type MergeSummary,
  type ResearchUpdate,
} from './merge.js';
import { err, ok, type Result } from '../result.js';

/**
 * Renders migration-file-ready, literal SQL — used both by the one-time seed generator (a full
 * dataset -> one big migration) and by update generation (a partial dataset -> an incremental
 * migration). No parameterized statements here deliberately: a `Migration.sql` string
 * (`@thunderdome/sqlite-migrations`) is executed verbatim via `db.exec`, not through a prepared
 * statement, so values must be inlined as SQL literals.
 */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlInt(value: number): string {
  return String(Math.trunc(value));
}

function insertRowSql<T extends { id: string }>(
  config: CollectionConfig<T>,
  datasetId: string,
  item: T,
  ordinal: number,
): string {
  const columns = ['dataset_id', 'id', 'ordinal', ...config.extraColumns, 'data'];
  const values = [
    sqlString(datasetId),
    sqlString(item.id),
    sqlInt(ordinal),
    ...config.extraValues(item).map(sqlString),
    sqlString(JSON.stringify(item)),
  ];
  return `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

function appendCollectionInserts<T extends { id: string }>(
  statements: string[],
  config: CollectionConfig<T>,
  datasetId: string,
  items: readonly T[],
  startOrdinal: number,
): void {
  items.forEach((item, index) => {
    statements.push(insertRowSql(config, datasetId, item, startOrdinal + index));
  });
}

function updateRelationshipDataSql(
  datasetId: string,
  relationship: ResearchDataset['relationships'][number],
): string {
  return (
    `UPDATE relationships SET data = ${sqlString(JSON.stringify(relationship))} ` +
    `WHERE dataset_id = ${sqlString(datasetId)} AND id = ${sqlString(relationship.id)};`
  );
}

/**
 * Renders the ONE migration that recreates a whole `ResearchDataset` from nothing — the seed
 * migration for a brand-new `dataset_id` (e.g. `research-store/0002_fusion_seed`). Refuses
 * (`Result`) rather than emitting invalid SQL if `dataset` itself fails validation.
 */
export function renderSeedSql(dataset: ResearchDataset): Result<string> {
  const validated = validateResearchDataset(dataset);
  if (!validated.ok) {
    return err(
      `refusing to seed an invalid research dataset: ${formatValidationIssues(validated.issues)}`,
    );
  }

  const statements: string[] = [
    'INSERT INTO research_datasets (dataset_id, domain, name, version, created_at, updated_at, metadata) ' +
      `VALUES (${sqlString(dataset.id)}, ${sqlString(dataset.domain)}, ${sqlString(dataset.name)}, ` +
      `${sqlString(dataset.version)}, ${sqlString(dataset.createdAt)}, ${sqlString(dataset.createdAt)}, ` +
      `${dataset.metadata !== undefined ? sqlString(JSON.stringify(dataset.metadata)) : 'NULL'});`,
  ];

  appendCollectionInserts(statements, ENTITIES, dataset.id, dataset.entities, 0);
  appendCollectionInserts(statements, RELATIONSHIPS, dataset.id, dataset.relationships, 0);
  appendCollectionInserts(statements, EVIDENCE, dataset.id, dataset.evidence, 0);
  appendCollectionInserts(statements, ASSERTIONS, dataset.id, dataset.assertions, 0);
  appendCollectionInserts(statements, HYPOTHESES, dataset.id, dataset.hypotheses, 0);
  appendCollectionInserts(statements, ASSUMPTIONS, dataset.id, dataset.assumptions, 0);
  appendCollectionInserts(statements, VARIABLES, dataset.id, dataset.variables, 0);
  appendCollectionInserts(statements, MODELS, dataset.id, dataset.models, 0);
  appendCollectionInserts(statements, SCENARIOS, dataset.id, dataset.scenarios, 0);
  appendCollectionInserts(statements, EVENTS, dataset.id, dataset.events, 0);
  appendCollectionInserts(statements, QUESTIONS, dataset.id, dataset.questions, 0);

  return ok(statements.join('\n'));
}

export interface RenderUpdateResult {
  sql: string;
  newVersion: string;
  summary: MergeSummary;
}

/**
 * Renders an INCREMENTAL migration — only the new rows a `ResearchUpdate` contributes, plus one
 * `UPDATE` per relationship gaining new states and one `UPDATE` bumping `research_datasets`'
 * version/updated_at label. This is the migration-time equivalent of what
 * `research/fusion/scripts/applyResearchUpdate.ts` used to do by rewriting the whole
 * `data/dataset.json` file.
 */
export function renderUpdateSql(
  current: ResearchDataset,
  update: ResearchUpdate,
  now: string,
): Result<RenderUpdateResult> {
  const mergeResult = mergeResearchUpdate(current, update);
  if (!mergeResult.ok) {
    return err(mergeResult.reason);
  }

  const newVersion = bumpDatasetVersion(current.version);
  const bumped: ResearchDataset = { ...mergeResult.dataset, version: newVersion };
  const validated = validateResearchDataset(bumped);
  if (!validated.ok) {
    return err(
      `merged dataset fails validation, no migration generated:\n${formatValidationIssues(validated.issues)}`,
    );
  }

  const statements: string[] = [];

  appendCollectionInserts(
    statements,
    ENTITIES,
    current.id,
    update.entities ?? [],
    current.entities.length,
  );
  appendCollectionInserts(
    statements,
    EVIDENCE,
    current.id,
    update.evidence ?? [],
    current.evidence.length,
  );
  appendCollectionInserts(
    statements,
    ASSERTIONS,
    current.id,
    update.assertions ?? [],
    current.assertions.length,
  );
  appendCollectionInserts(
    statements,
    HYPOTHESES,
    current.id,
    update.hypotheses ?? [],
    current.hypotheses.length,
  );
  appendCollectionInserts(
    statements,
    ASSUMPTIONS,
    current.id,
    update.assumptions ?? [],
    current.assumptions.length,
  );
  appendCollectionInserts(
    statements,
    VARIABLES,
    current.id,
    update.variables ?? [],
    current.variables.length,
  );
  appendCollectionInserts(
    statements,
    MODELS,
    current.id,
    update.models ?? [],
    current.models.length,
  );
  appendCollectionInserts(
    statements,
    SCENARIOS,
    current.id,
    update.scenarios ?? [],
    current.scenarios.length,
  );
  appendCollectionInserts(
    statements,
    EVENTS,
    current.id,
    update.events ?? [],
    current.events.length,
  );
  appendCollectionInserts(
    statements,
    QUESTIONS,
    current.id,
    update.questions ?? [],
    current.questions.length,
  );

  if (update.relationships !== undefined) {
    const existingIds = new Set(current.relationships.map((r) => r.id));
    const newRelationships = update.relationships.filter((r) => !existingIds.has(r.id));
    appendCollectionInserts(
      statements,
      RELATIONSHIPS,
      current.id,
      newRelationships,
      current.relationships.length,
    );

    for (const relationshipId of Object.keys(mergeResult.summary.appendedRelationshipStates)) {
      const mergedRelationship = bumped.relationships.find((r) => r.id === relationshipId);
      if (mergedRelationship === undefined) continue; // unreachable: this id was just merged above
      statements.push(updateRelationshipDataSql(current.id, mergedRelationship));
    }
  }

  statements.push(
    `UPDATE research_datasets SET version = ${sqlString(newVersion)}, updated_at = ${sqlString(now)} ` +
      `WHERE dataset_id = ${sqlString(current.id)};`,
  );

  return ok({ sql: statements.join('\n'), newVersion, summary: mergeResult.summary });
}
