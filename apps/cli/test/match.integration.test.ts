import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { runMatchCommand } from '../src/commands/match.js';

/**
 * The one place the full registry -> on-demand image build -> real Docker match path gets
 * automated coverage, run against the actual repo (not a fixture) — the same bots and games a
 * real `yarn thunderdome match run` invocation would resolve. Skipped entirely at collection
 * time when no Docker daemon is reachable, matching packages/runtime's integration test
 * convention.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await new Docker().ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await checkDockerAvailable();

describe.runIf(dockerAvailable)('runMatchCommand (real Docker, real registry)', () => {
  it('runs a real match between two registry-resolved bots and prints standings', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runMatchCommand(
      ['only-rock', 'only-paper', '--config', '{"totalRounds":3}'],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // paper always beats rock, so only-paper wins all 3 configured hands.
    expect(loggedLines.some((line) => line.includes('only-paper (win, score=3)'))).toBe(true);
    expect(loggedLines.some((line) => line.includes('only-rock (loss, score=0)'))).toBe(true);

    log.mockRestore();
  }, 60_000);

  it('exits 1 for an unknown bot id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runMatchCommand(['only-rock', 'not-a-real-bot'], { rootDir: repoRoot });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));

    error.mockRestore();
    log.mockRestore();
  });
});
