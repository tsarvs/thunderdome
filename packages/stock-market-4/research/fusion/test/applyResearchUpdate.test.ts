import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createResearchStore,
  renderSeedSql,
  type ResearchStore,
} from '@thunderdome/research-store';
import type { ResearchDataset } from '@thunderdome/research-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFusionFixtureDataset } from '../src/fixture.js';
import {
  applyResearchUpdateToMigration,
  type ApplyResearchUpdateOptions,
} from '../scripts/applyResearchUpdate.js';

/** A minimal, hand-built valid `ResearchDataset` — deliberately NOT the real fixture, so these
 * tests stay fast and their expectations are easy to read against a small, known baseline.
 * `mergeResearchUpdate`/`bumpDatasetVersion`'s own detailed unit tests now live in
 * `@thunderdome/research-store`'s test suite (`test/store/merge.test.ts`) — that's where the pure
 * logic actually lives now; this file only tests this package's own migration-file-generating
 * wrapper around it. */
function minimalDataset(): ResearchDataset {
  return {
    id: 'dataset-test',
    name: 'Test dataset',
    version: '1.0',
    domain: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-a', type: 'company', name: 'A Corp', recordedAt: '2026-01-01T00:00:00Z' },
      { id: 'entity-b', type: 'company', name: 'B Corp', recordedAt: '2026-01-01T00:00:00Z' },
    ],
    relationships: [
      {
        id: 'rel-a-b',
        type: 'supplies',
        fromEntityId: 'entity-a',
        toEntityId: 'entity-b',
        states: [
          {
            status: 'qualification track',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
    ],
    evidence: [],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };
}

let tempDir: string;
let migrationsDir: string;
let store: ResearchStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'apply-research-update-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  store = createResearchStore(':memory:'); // also seeds the real fusion/quantum data — harmless
  const seedSql = renderSeedSql(minimalDataset());
  if (!seedSql.ok) throw new Error(seedSql.reason);
  store.db.exec(seedSql.value);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function apply(updateFilePath: string, overrides: Partial<ApplyResearchUpdateOptions> = {}) {
  return applyResearchUpdateToMigration(updateFilePath, {
    store,
    datasetId: 'dataset-test',
    migrationsDir,
    now: '2026-03-01T00:00:00Z',
    ...overrides,
  });
}

describe('applyResearchUpdateToMigration', () => {
  it('generates a new, auto-numbered migration file for a valid update', () => {
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        entities: [
          { id: 'entity-c', type: 'company', name: 'C Corp', recordedAt: '2026-02-01T00:00:00Z' },
        ],
      }),
      'utf8',
    );

    const result = apply(updateFilePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationId).toBe('research-store/0001_fusion_update');
    expect(result.newVersion).toBe('1.0+update.1');
    expect(result.summary.addedCounts).toEqual({ entities: 1 });

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('id: "research-store/0001_fusion_update"');
    expect(written).toContain('entity-c');
    expect(written).toContain('C Corp');
  });

  it('numbers a second migration one past an existing one in the same directory', () => {
    writeFileSync(join(migrationsDir, '0001_init.ts'), '// placeholder', 'utf8');
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        entities: [
          { id: 'entity-c', type: 'company', name: 'C Corp', recordedAt: '2026-02-01T00:00:00Z' },
        ],
      }),
      'utf8',
    );

    const result = apply(updateFilePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationId).toBe('research-store/0002_fusion_update');
  });

  it('refuses and writes no file when the update file is not valid JSON', () => {
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(updateFilePath, 'not json{{{', 'utf8');

    const result = apply(updateFilePath);
    expect(result.ok).toBe(false);
    expect(readdirSync(migrationsDir)).toEqual([]);
  });

  it('refuses and writes no file when an update reuses an existing entity id', () => {
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        entities: [
          { id: 'entity-a', type: 'company', name: 'Renamed', recordedAt: '2026-02-01T00:00:00Z' },
        ],
      }),
      'utf8',
    );

    const result = apply(updateFilePath);
    expect(result.ok).toBe(false);
  });

  it('refuses and writes no file when a relationship references an unknown entity id', () => {
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        relationships: [
          {
            id: 'rel-a-ghost',
            type: 'supplies',
            fromEntityId: 'entity-a',
            toEntityId: 'entity-does-not-exist',
            states: [
              {
                status: 'qualification track',
                recordedAt: '2026-02-01T00:00:00Z',
                effectiveFrom: '2026-02-01T00:00:00Z',
                evidenceIds: [],
              },
            ],
          },
        ],
      }),
      'utf8',
    );

    const result = apply(updateFilePath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('entity-does-not-exist');
  });

  it('appends a new state to an existing relationship without adding a duplicate', () => {
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        relationships: [
          {
            id: 'rel-a-b',
            type: 'supplies',
            fromEntityId: 'entity-a',
            toEntityId: 'entity-b',
            states: [
              {
                status: 'production contract',
                recordedAt: '2026-03-01T00:00:00Z',
                effectiveFrom: '2026-03-01T00:00:00Z',
                evidenceIds: [],
              },
            ],
          },
        ],
      }),
      'utf8',
    );

    const result = apply(updateFilePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.appendedRelationshipStates).toEqual({ 'rel-a-b': 1 });

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('UPDATE relationships SET data');
  });
});

describe('applyResearchUpdateToMigration against the real fusion dataset', () => {
  it('a realistic update using real entity ids from the actual fixture merges and validates cleanly', () => {
    const real = createFusionFixtureDataset();
    const updateFilePath = join(tempDir, 'update.json');
    writeFileSync(
      updateFilePath,
      JSON.stringify({
        evidence: [
          {
            id: 'evidence-test-elmt-sample-update',
            observedAt: '2026-09-12T00:00:00Z',
            source: { name: 'Sample wire report', uri: 'https://example.com/sample' },
            description: 'A sample evidence record for pipeline testing purposes only.',
            entityIds: ['entity-elmt'],
          },
        ],
      }),
      'utf8',
    );

    const result = applyResearchUpdateToMigration(updateFilePath, {
      store,
      migrationsDir,
      now: '2026-09-12T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.addedCounts).toEqual({ evidence: 1 });

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('evidence-test-elmt-sample-update');
    expect(real.evidence.length).toBeGreaterThan(0);
  });
});
