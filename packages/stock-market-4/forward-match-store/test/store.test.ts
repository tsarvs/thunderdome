import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listForwardMatchRecords,
  loadForwardMatchRecord,
  saveForwardMatchRecord,
} from '../src/store.js';
import type { ForwardMatchRecord } from '../src/types.js';

// See `@thunderdome/market-data`'s `src/store/db.ts` for why `node:sqlite` is loaded this way.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'thunderdome-forward-match-store-test-'));
  dbPath = path.join(root, 'nested', 'db.sqlite');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sampleRecord(overrides: Partial<ForwardMatchRecord> = {}): ForwardMatchRecord {
  return {
    matchId: 'fusion-fundamental-v0-live',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: { gameType: 'FORWARD_SHADOW' },
    participantIds: ['fusion-fundamental-v0'],
    matchSeed: 'deadbeef',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    status: 'active',
    roundsPlayed: 0,
    snapshot: { round: 0 },
    ...overrides,
  };
}

describe('saveForwardMatchRecord + loadForwardMatchRecord', () => {
  it('round-trips a record exactly', async () => {
    const record = sampleRecord();
    const saved = await saveForwardMatchRecord(dbPath, record);
    expect(saved.ok).toBe(true);

    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome).toEqual({ status: 'found', record });
  });

  it('creates the db file (and its parent directory) on first save if it does not exist yet', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(dbPath, record); // dbPath's directory doesn't exist before this call
    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome.status).toBe('found');
  });

  it('overwrites progress on a resave — roundsPlayed/snapshot/updatedAt advance', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(dbPath, record);

    const updated: ForwardMatchRecord = {
      ...record,
      roundsPlayed: 1,
      snapshot: { round: 1 },
      updatedAt: '2026-09-11T00:00:00.000Z',
    };
    await saveForwardMatchRecord(dbPath, updated);

    const outcome = await loadForwardMatchRecord(dbPath, record.matchId);
    expect(outcome).toEqual({ status: 'found', record: updated });
  });

  it('reports "not-found" for a matchId with no saved record', async () => {
    const outcome = await loadForwardMatchRecord(dbPath, 'never-saved');
    expect(outcome).toEqual({ status: 'not-found' });
  });

  it('reports "corrupt" (never "not-found") for a row with unparseable JSON columns', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'broken' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'broken',
    );
    db.close();

    const outcome = await loadForwardMatchRecord(dbPath, 'broken');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('unparseable JSON');
  });

  it('reports "corrupt" for a row whose JSON does not match the schema', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'wrong-shape' }));
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE forward_matches SET rounds_played = ? WHERE match_id = ?').run(
      -1,
      'wrong-shape',
    );
    db.close();

    const outcome = await loadForwardMatchRecord(dbPath, 'wrong-shape');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('corrupt');
  });
});

describe('listForwardMatchRecords', () => {
  it('returns an empty list with no issues when the db does not exist yet', async () => {
    const result = await listForwardMatchRecords(dbPath);
    expect(result).toEqual({ summaries: [], issues: [] });
  });

  it('summarizes every valid record, most-recently-updated first', async () => {
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'older', updatedAt: '2026-09-01T00:00:00.000Z' }),
    );
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'newer', updatedAt: '2026-09-10T00:00:00.000Z' }),
    );

    const result = await listForwardMatchRecords(dbPath);
    expect(result.issues).toEqual([]);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['newer', 'older']);
    expect(result.summaries[0]).toEqual({
      matchId: 'newer',
      gameId: 'stock-market-4',
      status: 'active',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      roundsPlayed: 0,
      participantIds: ['fusion-fundamental-v0'],
    });
  });

  it('collects an issue for a corrupt record without hiding the valid ones', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'valid' }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'corrupt' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'corrupt',
    );
    db.close();

    const result = await listForwardMatchRecords(dbPath);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['valid']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toContain('corrupt');
  });
});
