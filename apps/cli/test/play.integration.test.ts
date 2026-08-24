import { dirname, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { runPlayCommand } from '../src/commands/play.js';

/**
 * The one place the full registry -> on-demand image build -> real Docker `play` path gets
 * automated coverage, run against the actual repo. A scripted `Readable` stands in for the human
 * typing at a real terminal — `TerminalHumanCollector` only cares that it's some
 * `NodeJS.ReadableStream`, not that it's `process.stdin`. Skipped entirely at collection time
 * when no Docker daemon is reachable, matching match.integration.test.ts's convention.
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

function scriptedInput(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`));
}

function discardOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

describe.runIf(dockerAvailable)('runPlayCommand (real Docker, real registry)', () => {
  it('plays a real match against only-rock, always winning with paper', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runPlayCommand(['only-rock', '--game-config', '{"totalRounds":3}'], {
      rootDir: repoRoot,
      input: scriptedInput(['paper', 'paper', 'paper']),
      output: discardOutput(),
    });

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    expect(loggedLines.some((line) => line.includes('you (win, score=3)'))).toBe(true);
    expect(loggedLines.some((line) => line.includes('only-rock (loss, score=0)'))).toBe(true);

    log.mockRestore();
  }, 60_000);

  it('lets the human resign early with "quit", forfeiting the match', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runPlayCommand(['only-rock', '--game-config', '{"totalRounds":10}'], {
      rootDir: repoRoot,
      input: scriptedInput(['paper', 'quit']),
      output: discardOutput(),
    });

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    expect(loggedLines).toContain('Forfeit: you');

    log.mockRestore();
  }, 60_000);

  it('exits 1 for a game with no humanInterface yet', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runPlayCommand(['leftmost-connect-four'], {
      rootDir: repoRoot,
      input: scriptedInput([]),
      output: discardOutput(),
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('humanInterface'));

    error.mockRestore();
    log.mockRestore();
  });

  it('exits 1 for an unknown bot id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runPlayCommand(['not-a-real-bot'], {
      rootDir: repoRoot,
      input: scriptedInput([]),
      output: discardOutput(),
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));

    error.mockRestore();
  });

  it("exits 1 when --as collides with the bot's own id", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runPlayCommand(['only-rock', '--as', 'only-rock'], {
      rootDir: repoRoot,
      input: scriptedInput([]),
      output: discardOutput(),
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("can't be the same id"));

    error.mockRestore();
  });
});
