import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveForwardMatchRecord, type ForwardMatchRecord } from '@thunderdome/forward-match-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMatchForwardPreviewCommand } from '../src/commands/matchForwardPreview.js';

/**
 * Unit-level coverage against the REAL registry, same spirit as `matchForward.test.ts` — every
 * path here returns before ever touching Docker (bad input, a not-yet-existing record, an invalid
 * --config-file), matching that file's own "validation paths, no Docker" scope. The real
 * "actually asks a bot container for a decision twice" path is exercised by hand, not here.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let storeDir: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'thunderdome-match-forward-preview-test-'));
  storeDir = join(root, 'forward-matches');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const VALID_FORWARD_CONFIG = {
  gameType: 'FORWARD_SHADOW',
  marketDataUniverse: ['ELMT'],
  marketDataset: {
    id: 'fusion-fundamental-v0',
    version: '3',
    storeDir: './.thunderdome/market-data',
  },
  startDate: '2026-07-13',
  endDate: '2026-12-31',
};

function sampleRecord(overrides: Partial<ForwardMatchRecord> = {}): ForwardMatchRecord {
  return {
    matchId: 'test-forward-match',
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

describe('runMatchForwardPreviewCommand: validation paths (no Docker touched)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with usage when matchId or --config-file is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runMatchForwardPreviewCommand([], { rootDir: repoRoot })).toBe(1);
    expect(await runMatchForwardPreviewCommand(['some-match'], { rootDir: repoRoot })).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Usage: thunderdome match forward preview'),
    );
  });

  it('exits 1 when the match does not exist', async () => {
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['no-such-match', '--config-file', configPath, '--store-dir', storeDir],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No forward match record found'));
  });

  it('exits 1 when --config-file does not exist', async () => {
    const saved = await saveForwardMatchRecord(storeDir, sampleRecord());
    expect(saved.ok).toBe(true);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', join(root, 'missing.json'), '--store-dir', storeDir],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not read --config-file'));
  });

  it('exits 1 for invalid --config-file JSON', async () => {
    const saved = await saveForwardMatchRecord(storeDir, sampleRecord());
    expect(saved.ok).toBe(true);
    const configPath = join(root, 'config.json');
    await writeFile(configPath, 'not json{{', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', configPath, '--store-dir', storeDir],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it("exits 1 when --config-file fails the game's own schema", async () => {
    const saved = await saveForwardMatchRecord(
      storeDir,
      sampleRecord({ config: VALID_FORWARD_CONFIG }),
    );
    expect(saved.ok).toBe(true);
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', configPath, '--store-dir', storeDir],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid --config-file'));
  });

  it('exits 1 for a corrupt existing record', async () => {
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, 'broken.json'), 'not json{{{', 'utf8');
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['broken', '--config-file', configPath, '--store-dir', storeDir],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });
});
