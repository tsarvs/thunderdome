/**
 * Merges a JSON "research update" file into `data/dataset.json` — the no-coding-agent path for
 * growing the research dataset. An update file is a PARTIAL `ResearchDataset`: any subset of
 * `entities`/`relationships`/`evidence`/`assertions`/`hypotheses`/`assumptions`/`variables`/
 * `models`/`scenarios`/`events`/`questions`, each an array of full research-core objects using
 * EXISTING entity ids (see `scripts/printKnownEntities.ts`) or freshly minted ones following this
 * dataset's own `entity-<slug>`/`rel-<slug>`/`evidence-<slug>` convention (see
 * `FUSION_FIXTURE_IDS` in `../src/fixture.ts`).
 *
 * Merge semantics (see `mergeResearchUpdate`):
 * - A new id in any collection is appended as a new record.
 * - An id that already exists is refused — this script never silently overwrites a published
 *   record — EXCEPT relationships, where an update may append new entries to an EXISTING
 *   relationship id's `states[]` (the normal "status changed" case); the relationship's own
 *   `type`/`fromEntityId`/`toEntityId` must match the existing record exactly, or the update is
 *   refused rather than silently redefining it.
 * - The WHOLE merged dataset is then validated with `validateResearchDataset` — the SAME function
 *   `fixture.ts`'s own load path uses, so an update can never produce a dataset that dataset
 *   loader would itself reject — before anything is written. Any issue refuses the WHOLE batch;
 *   nothing is written. This matches `packages/stock-market-4/market-data/scripts/fetchAndAppendBars.ts`'s own
 *   refuse-rather-than-guess posture: ambiguity is a hard stop, never a best-effort guess.
 *
 * Usage:
 *   yarn workspace @thunderdome/research-fusion run apply:research-update -- \
 *     --update-file /path/to/update.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatValidationIssues,
  validateResearchDataset,
  type ResearchDataset,
} from '@thunderdome/research-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = resolve(__dirname, '../data/dataset.json');

/** Every array-valued collection on `ResearchDataset` an update file may populate. */
const COLLECTION_KEYS = [
  'entities',
  'relationships',
  'evidence',
  'assertions',
  'hypotheses',
  'assumptions',
  'variables',
  'models',
  'scenarios',
  'events',
  'questions',
] as const;
type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** A partial `ResearchDataset` — only the collections an update actually touches, each optional. */
export type ResearchUpdate = Partial<Pick<ResearchDataset, CollectionKey>>;

export interface MergeSummary {
  /** Collection name -> count of brand-new records appended. */
  addedCounts: Partial<Record<CollectionKey, number>>;
  /** Relationship id -> count of new states appended to that EXISTING relationship. */
  appendedRelationshipStates: Record<string, number>;
}

export type MergeResult =
  { ok: true; dataset: ResearchDataset; summary: MergeSummary } | { ok: false; reason: string };

/**
 * Pure merge function — no I/O — so it's directly testable without touching the real dataset
 * file. Refuses (returns `ok: false`) rather than guessing whenever an update is ambiguous: an id
 * collision outside the one relationship-states exception, or a relationship whose
 * type/fromEntityId/toEntityId don't match the existing record it's trying to add states to.
 * Does NOT itself run `validateResearchDataset` on the result — the caller does that once, after
 * merging every collection, so a single validation pass reports every structural/cross-reference
 * issue at once rather than stopping at the first collection checked.
 */
type RelationshipState = ResearchDataset['relationships'][number]['states'][number];

/**
 * A relationship's states must never overlap, and only the chronologically LAST one may be
 * open-ended (`research-core`'s own `findOverlappingRelationshipStates` enforces this on every
 * parse) — see the real fixture's own multi-state relationships (e.g. `rel-walter-tosto-sparc`'s
 * tested -> qualified -> production contract) for the established convention: every EARLIER state
 * carries an explicit `effectiveTo` matching the next state's `effectiveFrom`.
 *
 * An update file only ever supplies the NEW state(s) being appended — asking every update to also
 * re-supply a closing `effectiveTo` for whatever state used to be last would mean re-transcribing
 * a value that's entirely determined by the new state's own `effectiveFrom` anyway. So this fills
 * in that one derived field — `effectiveTo` on every state except the last — automatically. This
 * is NOT an edit to a state's substantive content (status/confidence/evidence are never touched);
 * it only closes the validity window a later state has, by construction, already superseded. The
 * final state (new or existing) is left exactly as supplied, open or not.
 */
function closeOutIntermediateStates(states: RelationshipState[]): RelationshipState[] {
  return states.map((state, index) => {
    const next = states[index + 1];
    if (next === undefined || state.effectiveTo !== undefined) return state;
    return { ...state, effectiveTo: next.effectiveFrom };
  });
}
export function mergeResearchUpdate(current: ResearchDataset, update: ResearchUpdate): MergeResult {
  const merged: Record<string, unknown> = { ...current };
  const addedCounts: Partial<Record<CollectionKey, number>> = {};
  const appendedRelationshipStates: Record<string, number> = {};

  for (const key of COLLECTION_KEYS) {
    const incomingItems = update[key];
    if (incomingItems === undefined || incomingItems.length === 0) continue;

    if (key === 'relationships') {
      const existingRelationships = current.relationships;
      const existingById = new Map(existingRelationships.map((r) => [r.id, r]));
      const nextRelationships = [...existingRelationships];
      let addedNew = 0;

      for (const incoming of incomingItems as ResearchDataset['relationships']) {
        const existing = existingById.get(incoming.id);
        if (existing === undefined) {
          nextRelationships.push(incoming);
          addedNew++;
          continue;
        }
        if (
          incoming.type !== existing.type ||
          incoming.fromEntityId !== existing.fromEntityId ||
          incoming.toEntityId !== existing.toEntityId
        ) {
          return {
            ok: false,
            reason:
              `relationship "${incoming.id}" already exists with a different type/fromEntityId/` +
              `toEntityId than the update provides — refusing rather than silently redefining ` +
              `it. Existing: type="${existing.type}" fromEntityId="${existing.fromEntityId}" ` +
              `toEntityId="${existing.toEntityId}"; update: type="${incoming.type}" ` +
              `fromEntityId="${incoming.fromEntityId}" toEntityId="${incoming.toEntityId}".`,
          };
        }
        if (incoming.states.length === 0) {
          return {
            ok: false,
            reason:
              `relationship "${incoming.id}" already exists and the update supplies no new ` +
              `states to append — nothing to do, refusing the no-op.`,
          };
        }
        const index = nextRelationships.findIndex((r) => r.id === incoming.id);
        const combinedStates = closeOutIntermediateStates([...existing.states, ...incoming.states]);
        nextRelationships[index] = { ...existing, states: combinedStates };
        appendedRelationshipStates[incoming.id] =
          (appendedRelationshipStates[incoming.id] ?? 0) + incoming.states.length;
      }

      merged.relationships = nextRelationships;
      if (addedNew > 0) addedCounts.relationships = addedNew;
      continue;
    }

    const existingItems = current[key] as { id: string }[];
    const existingIds = new Set(existingItems.map((item) => item.id));
    for (const incoming of incomingItems as { id: string }[]) {
      if (existingIds.has(incoming.id)) {
        return {
          ok: false,
          reason:
            `${key} id "${incoming.id}" already exists in the dataset — this script never ` +
            `overwrites a published record. Give the new/changed record its own, distinct id.`,
        };
      }
    }
    merged[key] = [...existingItems, ...(incomingItems as { id: string }[])];
    addedCounts[key] = incomingItems.length;
  }

  return {
    ok: true,
    dataset: merged as unknown as ResearchDataset,
    summary: { addedCounts, appendedRelationshipStates },
  };
}

/**
 * `version` bump convention for this pipeline: the base snapshot version (e.g. `"2026.09"`) gets
 * an `+update.N` suffix, incremented on every successful `applyResearchUpdate` run — distinct from
 * a new hand-authored snapshot (which would get a whole new base version), so it's always visible
 * from the version string alone whether a dataset is the original snapshot or has one or more
 * script-applied updates layered on top.
 */
export function bumpDatasetVersion(version: string): string {
  const match = /^(.*)\+update\.(\d+)$/.exec(version);
  if (match) {
    const base = match[1] ?? '';
    const n = Number(match[2]);
    return `${base}+update.${String(n + 1)}`;
  }
  return `${version}+update.1`;
}

/** Reads and validates a `ResearchDataset` JSON file at `path` (defaults to the real
 * `data/dataset.json`) — factored out with a path parameter so tests can point this at a temp
 * copy instead of the real dataset. */
export function loadDatasetFromFile(path: string = DATASET_PATH): ResearchDataset {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = validateResearchDataset(raw);
  if (!result.ok) {
    throw new Error(
      `${path} itself fails validation (this should never happen — the on-disk dataset is ` +
        `supposed to always be valid): ${formatValidationIssues(result.issues)}`,
    );
  }
  return result.value;
}

export type ApplyResult =
  { ok: true; version: string; summary: MergeSummary } | { ok: false; reason: string };

/**
 * The full load -> merge -> validate -> write pipeline, factored out from `main()` with a
 * `datasetPath` parameter so it's testable end-to-end (including the "nothing is written on
 * refusal" guarantee) against a temp copy of the dataset rather than the real file. `main()` is a
 * thin CLI wrapper around this — same shape
 * `packages/stock-market-4/market-data/scripts/appendBarsFromFile.ts` already uses.
 */
export function applyResearchUpdateToFile(
  updateFilePath: string,
  datasetPath: string = DATASET_PATH,
): ApplyResult {
  let update: ResearchUpdate;
  try {
    update = JSON.parse(readFileSync(resolve(updateFilePath), 'utf8')) as ResearchUpdate;
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read/parse "${updateFilePath}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const current = loadDatasetFromFile(datasetPath);
  const mergeResult = mergeResearchUpdate(current, update);
  if (!mergeResult.ok) {
    return { ok: false, reason: mergeResult.reason };
  }

  const bumped: ResearchDataset = {
    ...mergeResult.dataset,
    version: bumpDatasetVersion(current.version),
  };
  const validated = validateResearchDataset(bumped);
  if (!validated.ok) {
    return {
      ok: false,
      reason:
        `merged dataset fails validation, nothing was written:\n` +
        formatValidationIssues(validated.issues),
    };
  }

  writeFileSync(datasetPath, `${JSON.stringify(validated.value, null, 2)}\n`, 'utf8');
  return { ok: true, version: bumped.version, summary: mergeResult.summary };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    args[name] = value;
    i++;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const updateFilePath = args['update-file'];
  if (updateFilePath === undefined) {
    console.error('Usage: apply:research-update -- --update-file <path>');
    process.exitCode = 1;
    return;
  }

  const result = applyResearchUpdateToFile(updateFilePath);
  if (!result.ok) {
    console.error(`Update refused: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log('Applied update:');
  for (const [key, count] of Object.entries(result.summary.addedCounts)) {
    console.log(`  ${key}: +${String(count)}`);
  }
  for (const [relationshipId, count] of Object.entries(result.summary.appendedRelationshipStates)) {
    console.log(`  relationship "${relationshipId}": +${String(count)} state(s)`);
  }
  console.log(`\n${DATASET_PATH} updated to version "${result.version}".`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
