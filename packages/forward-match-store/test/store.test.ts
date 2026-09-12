import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listForwardMatchRecords,
  loadForwardMatchRecord,
  saveForwardMatchRecord,
} from '../src/store.js';
import type { ForwardMatchRecord } from '../src/types.js';

let root: string;
let storeDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'thunderdome-forward-match-store-test-'));
  storeDir = path.join(root, 'forward-matches');
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
    const saved = await saveForwardMatchRecord(storeDir, record);
    expect(saved.ok).toBe(true);

    const outcome = await loadForwardMatchRecord(storeDir, record.matchId);
    expect(outcome).toEqual({ status: 'found', record });
  });

  it('creates the store directory on first save if it does not exist yet', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(storeDir, record); // storeDir doesn't exist before this call
    const outcome = await loadForwardMatchRecord(storeDir, record.matchId);
    expect(outcome.status).toBe('found');
  });

  it('overwrites progress on a resave — roundsPlayed/snapshot/updatedAt advance', async () => {
    const record = sampleRecord();
    await saveForwardMatchRecord(storeDir, record);

    const updated: ForwardMatchRecord = {
      ...record,
      roundsPlayed: 1,
      snapshot: { round: 1 },
      updatedAt: '2026-09-11T00:00:00.000Z',
    };
    await saveForwardMatchRecord(storeDir, updated);

    const outcome = await loadForwardMatchRecord(storeDir, record.matchId);
    expect(outcome).toEqual({ status: 'found', record: updated });
  });

  it('leaves no leftover .tmp file behind after a successful save', async () => {
    await saveForwardMatchRecord(storeDir, sampleRecord());
    const files = await readdir(storeDir);
    expect(files).toEqual(['fusion-fundamental-v0-live.json']);
  });

  it('reports "not-found" for a matchId with no saved record', async () => {
    const outcome = await loadForwardMatchRecord(storeDir, 'never-saved');
    expect(outcome).toEqual({ status: 'not-found' });
  });

  it('reports "corrupt" (never "not-found") for a non-JSON record file', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'broken.json'), 'not json{{{', 'utf8');

    const outcome = await loadForwardMatchRecord(storeDir, 'broken');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('not valid JSON');
  });

  it('reports "corrupt" for JSON that does not match the schema', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'wrong-shape.json'), JSON.stringify({ hello: 'world' }), 'utf8');

    const outcome = await loadForwardMatchRecord(storeDir, 'wrong-shape');
    expect(outcome.status).toBe('corrupt');
    if (outcome.status === 'corrupt') expect(outcome.reason).toContain('corrupt');
  });

  it('a stray leftover .tmp file (simulating a crash mid-write) never appears as a valid record', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'half-written.json.12345.tmp'), '{"incomplete"', 'utf8');

    const outcome = await loadForwardMatchRecord(storeDir, 'half-written');
    expect(outcome).toEqual({ status: 'not-found' });
  });
});

describe('listForwardMatchRecords', () => {
  it('returns an empty list with no issues when the store directory does not exist yet', async () => {
    const result = await listForwardMatchRecords(storeDir);
    expect(result).toEqual({ summaries: [], issues: [] });
  });

  it('summarizes every valid record, most-recently-updated first', async () => {
    await saveForwardMatchRecord(
      storeDir,
      sampleRecord({ matchId: 'older', updatedAt: '2026-09-01T00:00:00.000Z' }),
    );
    await saveForwardMatchRecord(
      storeDir,
      sampleRecord({ matchId: 'newer', updatedAt: '2026-09-10T00:00:00.000Z' }),
    );

    const result = await listForwardMatchRecords(storeDir);
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
    await saveForwardMatchRecord(storeDir, sampleRecord({ matchId: 'valid' }));
    await writeFile(path.join(storeDir, 'corrupt.json'), 'not json{{{', 'utf8');

    const result = await listForwardMatchRecords(storeDir);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['valid']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toContain('corrupt.json');
  });

  it('ignores a stray leftover .tmp file from an interrupted save', async () => {
    await saveForwardMatchRecord(storeDir, sampleRecord({ matchId: 'valid' }));
    await writeFile(path.join(storeDir, 'valid.json.999.tmp'), '{"incomplete"', 'utf8');

    const result = await listForwardMatchRecords(storeDir);
    expect(result.summaries.map((s) => s.matchId)).toEqual(['valid']);
    expect(result.issues).toEqual([]);
  });
});
