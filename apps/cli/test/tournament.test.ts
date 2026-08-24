import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTournamentCommand } from '../src/commands/tournament.js';

// `--all-bots`'s validation (mutual exclusion with explicit bot ids, "not enough bots
// registered") happens before any Docker image is built, so it's covered here without the
// Docker-gated skip tournament.integration.test.ts needs for the rest of `tournament run`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('runTournamentCommand — --all-bots validation', () => {
  let emptyRootDir: string;

  beforeEach(async () => {
    emptyRootDir = await mkdtemp(path.join(tmpdir(), 'thunderdome-empty-root-test-'));
  });

  afterEach(async () => {
    await rm(emptyRootDir, { recursive: true, force: true });
  });

  it('exits 1 when --all-bots is combined with explicit bot ids', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      ['--all-bots', 'rock-paper-scissors', 'only-rock', 'only-paper'],
      { rootDir: repoRoot },
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith('--all-bots cannot be combined with explicit bot ids.');
    error.mockRestore();
  });

  it('exits 1 with a clear error when fewer than 2 bots are registered for the game', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runTournamentCommand(['--all-bots', 'rock-paper-scissors'], {
      rootDir: emptyRootDir,
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('--all-bots "rock-paper-scissors" found 0 bot(s); need at least 2'),
    );
    error.mockRestore();
  });
});
