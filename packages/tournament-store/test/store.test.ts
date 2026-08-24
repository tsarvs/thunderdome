import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTournamentRecords, loadTournamentRecord, saveTournamentRecord } from '../src/store.js';
import type { TournamentRecord } from '../src/types.js';

let root: string;
let storeDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'thunderdome-tournament-store-test-'));
  storeDir = path.join(root, 'tournaments');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sampleRecord(overrides: Partial<TournamentRecord> = {}): TournamentRecord {
  return {
    id: 'tourney-1',
    createdAt: '2026-08-20T00:00:00.000Z',
    status: 'running',
    gameId: 'connect-four',
    gameVersion: '1.0.0',
    gameConfig: { columns: 7, rows: 6, winLength: 4 },
    formatId: 'round-robin',
    formatVersion: '2.0.0',
    formatConfig: { bestOf: 1 },
    roster: ['leftmost-connect-four', 'random-connect-four'],
    tournamentSeed: 'deadbeef',
    matches: [],
    ...overrides,
  };
}

describe('saveTournamentRecord + loadTournamentRecord', () => {
  it('round-trips a record exactly', async () => {
    const record = sampleRecord();
    await saveTournamentRecord(storeDir, record);

    const result = await loadTournamentRecord(storeDir, record.id);
    expect(result).toEqual({ ok: true, value: record });
  });

  it('creates the store directory on first save if it does not exist yet', async () => {
    const record = sampleRecord();
    await saveTournamentRecord(storeDir, record); // storeDir doesn't exist before this call
    const result = await loadTournamentRecord(storeDir, record.id);
    expect(result.ok).toBe(true);
  });

  it('persists a match appended after the initial save, and a completed status', async () => {
    const record = sampleRecord();
    await saveTournamentRecord(storeDir, record);

    const updated: TournamentRecord = {
      ...record,
      status: 'completed',
      completedAt: '2026-08-20T00:05:00.000Z',
      standings: [{ participantId: 'leftmost-connect-four', wins: 1 }],
      matches: [
        {
          matchId: 'm1',
          participantIds: ['leftmost-connect-four', 'random-connect-four'],
          status: 'completed',
          standingOutcomes: [
            { participantId: 'leftmost-connect-four', rank: 1, outcome: 'win' },
            { participantId: 'random-connect-four', rank: 2, outcome: 'loss' },
          ],
          events: [
            [{ type: 'move', participantIds: ['leftmost-connect-four'], data: { column: 0 } }],
          ],
        },
      ],
    };
    await saveTournamentRecord(storeDir, updated);

    const result = await loadTournamentRecord(storeDir, record.id);
    expect(result).toEqual({ ok: true, value: updated });
  });

  it('reports a clear error for an id with no saved record', async () => {
    const result = await loadTournamentRecord(storeDir, 'never-saved');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no tournament record');
    }
  });

  it('reports a clear error for a corrupt (non-JSON) record file', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'broken.json'), 'not json{{{', 'utf8');

    const result = await loadTournamentRecord(storeDir, 'broken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not valid JSON');
    }
  });

  it('reports a clear error for JSON that does not match the schema', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(
      path.join(storeDir, 'wrong-shape.json'),
      JSON.stringify({ hello: 'world' }),
      'utf8',
    );

    const result = await loadTournamentRecord(storeDir, 'wrong-shape');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('corrupt');
    }
  });
});

describe('listTournamentRecords', () => {
  it('returns an empty list with no issues when the store directory does not exist yet', async () => {
    const result = await listTournamentRecords(storeDir);
    expect(result).toEqual({ summaries: [], issues: [] });
  });

  it('summarizes every valid record, newest first', async () => {
    await saveTournamentRecord(
      storeDir,
      sampleRecord({ id: 'older', createdAt: '2026-08-01T00:00:00.000Z' }),
    );
    await saveTournamentRecord(
      storeDir,
      sampleRecord({ id: 'newer', createdAt: '2026-08-20T00:00:00.000Z' }),
    );

    const result = await listTournamentRecords(storeDir);
    expect(result.issues).toEqual([]);
    expect(result.summaries.map((s) => s.id)).toEqual(['newer', 'older']);
    expect(result.summaries[0]).toEqual({
      id: 'newer',
      createdAt: '2026-08-20T00:00:00.000Z',
      status: 'running',
      gameId: 'connect-four',
      formatId: 'round-robin',
      roster: ['leftmost-connect-four', 'random-connect-four'],
    });
  });

  it('collects an issue for a corrupt record without hiding the valid ones', async () => {
    await saveTournamentRecord(storeDir, sampleRecord({ id: 'valid' }));
    await writeFile(path.join(storeDir, 'corrupt.json'), 'not json{{{', 'utf8');

    const result = await listTournamentRecords(storeDir);
    expect(result.summaries.map((s) => s.id)).toEqual(['valid']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toContain('corrupt.json');
  });

  it('ignores non-.json files in the store directory', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, '.DS_Store'), 'binary junk', 'utf8');
    await saveTournamentRecord(storeDir, sampleRecord({ id: 'valid' }));

    const result = await listTournamentRecords(storeDir);
    expect(result.summaries.map((s) => s.id)).toEqual(['valid']);
    expect(result.issues).toEqual([]);
  });
});
