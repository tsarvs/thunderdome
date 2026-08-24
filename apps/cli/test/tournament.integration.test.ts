import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runTournamentCommand,
  runTournamentInspectCommand,
  runTournamentListCommand,
  runTournamentReplayCommand,
} from '../src/commands/tournament.js';

/**
 * The one place the full registry -> on-demand image build -> real tournament path (running,
 * persisting, then listing/inspecting/replaying) gets automated coverage, run against the
 * actual repo. Skipped entirely at collection time when no Docker daemon is reachable, matching
 * packages/runtime's and match.integration.test.ts's convention.
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

describe.runIf(dockerAvailable)('runTournamentCommand (real Docker, real registry)', () => {
  // Every test gets its own store directory, outside the real repo tree — `tournament run`
  // always persists a record now (Phase 11), and this keeps that from littering the actual
  // working tree (or one test's records from leaking into another's) on every test run.
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await mkdtemp(path.join(tmpdir(), 'thunderdome-tournament-store-test-'));
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it('runs a real round-robin among three deterministic bots and ends in a three-way tie', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      [
        'only-rock',
        'only-paper',
        'only-scissors',
        '--game-config',
        '{"totalRounds":3}',
        '--store-dir',
        storeDir,
      ],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // rock beats scissors, paper beats rock, scissors beats paper — a deterministic cycle where
    // every bot finishes exactly 1-1.
    expect(loggedLines.filter((line) => /^\d\. .+ — 1W 1L 0D \(1 pts\)$/.test(line))).toHaveLength(
      3,
    );

    log.mockRestore();
  }, 60_000);

  it('prints a running series score and a decided recap for a best-of-N pairing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      [
        'only-rock',
        'only-paper',
        'only-scissors',
        '--game-config',
        '{"totalRounds":3}',
        '--tournament-config',
        '{"bestOf":3}',
        '--store-dir',
        storeDir,
      ],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // rock beats scissors, paper beats rock, scissors beats paper — a deterministic cycle where
    // every pairing's winner is fixed, so bestOf:3's majority (2 wins) decides each pairing after
    // exactly 2 matches: one running "leads 1-0" line, then a "series decided ... 2-0" recap.
    expect(
      loggedLines.filter((line) => /^ {2}series: .+ leads 1-0 \(1\/3 played\)$/.test(line)),
    ).toHaveLength(3);
    expect(
      loggedLines.filter((line) => /^ {2}series decided: .+ wins 2-0 over .+$/.test(line)),
    ).toHaveLength(3);
    // Every pairing's round-1 game is played before any pairing's round-2 game (runTournament()'s
    // FIFO pull-loop), so exactly one blank line should separate them — proving the spacing lands
    // at the actual wave boundary, not once per match or not at all.
    const firstRound2Index = loggedLines.findIndex((line) =>
      line.startsWith('Match round-robin-1-2'),
    );
    expect(firstRound2Index).toBeGreaterThan(0);
    expect(loggedLines[firstRound2Index - 1]).toBe('');

    log.mockRestore();
  }, 60_000);

  it('runs a real single-elimination bracket among three bots (one gets a bye) and crowns exactly one champion', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      [
        'only-rock',
        'only-paper',
        'only-scissors',
        '--tournament-config',
        '{"format":"single-elimination"}',
        '--game-config',
        '{"totalRounds":3}',
        '--store-dir',
        storeDir,
      ],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // rock beats scissors, paper beats rock, scissors beats paper — every matchup here is
    // decisive, so exactly one of the three ends up champion and the other two are eliminated.
    expect(loggedLines.filter((line) => /^\d\. .+ — champion$/.test(line))).toHaveLength(1);
    expect(
      loggedLines.filter((line) => /^\d\. .+ — eliminated in round \d+$/.test(line)),
    ).toHaveLength(2);
    // With 3 bots, exactly one draws a bye — and it's called out as its own line, not silently
    // absent from round 1's matches.
    expect(loggedLines.filter((line) => /^.+ draws a bye in round 1$/.test(line))).toHaveLength(1);

    log.mockRestore();
  }, 60_000);

  it('resolves the full registered roster for --all-bots and defaults to a best-of-7 series', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      [
        '--all-bots',
        'rock-paper-scissors',
        '--game-config',
        '{"totalRounds":3}',
        '--store-dir',
        storeDir,
      ],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // Every bot currently registered under bots/rock-paper-scissors/ — proves the roster came
    // from the registry, not a hardcoded list, and that none were dropped or duplicated.
    expect(
      loggedLines.some((line) =>
        line.includes(
          'copycat-rps, only-paper, only-rock, only-scissors, random-rps, t1000, t800, tx',
        ),
      ),
    ).toBe(true);
    // formatConfig.bestOf > 1 is what gates printing a series line at all (see runWithFormat) —
    // seeing one here is what actually proves the missing --tournament-config defaulted bestOf
    // to 7, not just that the roster resolved.
    expect(loggedLines.some((line) => line.startsWith('  series'))).toBe(true);

    log.mockRestore();
  }, 240_000); // scales with the registered roster size (currently 8 bots, up to 7 games/pairing)

  it("lets an explicit --tournament-config override --all-bots' default bestOf", async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      [
        '--all-bots',
        'rock-paper-scissors',
        '--game-config',
        '{"totalRounds":3}',
        '--tournament-config',
        '{"bestOf":1}',
        '--store-dir',
        storeDir,
      ],
      { rootDir: repoRoot },
    );

    expect(code).toBe(0);
    const loggedLines = log.mock.calls.map((call) => call.join(' '));
    // bestOf:1 never prints a series line (formatConfig.bestOf > 1 gates it) — seeing none here
    // proves the explicit override won over --all-bots' own bestOf:7 default.
    expect(loggedLines.some((line) => line.startsWith('  series'))).toBe(false);

    log.mockRestore();
  }, 120_000);

  it('exits 1 for an unknown bot id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runTournamentCommand(
      ['only-rock', 'not-a-real-bot', '--store-dir', storeDir],
      { rootDir: repoRoot },
    );

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));

    error.mockRestore();
    log.mockRestore();
  });

  describe('persistence (list / inspect / replay)', () => {
    async function runAndCaptureId(extraArgs: string[] = []): Promise<string> {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await runTournamentCommand(
        [
          'only-rock',
          'only-paper',
          'only-scissors',
          '--game-config',
          '{"totalRounds":3}',
          '--store-dir',
          storeDir,
          ...extraArgs,
        ],
        { rootDir: repoRoot },
      );
      expect(code).toBe(0);
      const loggedLines = log.mock.calls.map((call) => call.join(' '));
      log.mockRestore();
      const tournamentLine = loggedLines.find((line) => /Tournament [0-9a-f-]+:/.test(line));
      const match = /Tournament ([0-9a-f-]+):/.exec(tournamentLine ?? '');
      if (match?.[1] === undefined) {
        throw new Error(
          `could not find a tournament id line among: ${JSON.stringify(loggedLines)}`,
        );
      }
      return match[1];
    }

    it('list finds a completed run and inspect reports its details', async () => {
      const id = await runAndCaptureId();

      const listLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const listCode = await runTournamentListCommand(['--store-dir', storeDir], {
        rootDir: repoRoot,
      });
      expect(listCode).toBe(0);
      const listedLines = listLog.mock.calls.map((call) => call.join(' '));
      expect(listedLines.some((line) => line.startsWith(id))).toBe(true);
      listLog.mockRestore();

      const inspectLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const inspectCode = await runTournamentInspectCommand([id, '--store-dir', storeDir], {
        rootDir: repoRoot,
      });
      expect(inspectCode).toBe(0);
      const inspectedLines = inspectLog.mock.calls.map((call) => call.join(' '));
      expect(inspectedLines).toContain('  status: completed');
      expect(inspectedLines.some((line) => line.includes('round-robin'))).toBe(true);
      expect(inspectedLines.some((line) => line.includes('matches played: 3'))).toBe(true);
      // The same three-way-tie shape the live run itself prints, now read back from disk.
      expect(
        inspectedLines.filter((line) => /^\d\. .+ — 1W 1L 0D \(1 pts\)$/.test(line)),
      ).toHaveLength(3);
      inspectLog.mockRestore();
    }, 60_000);

    it('replay reproduces the same match-by-match shape purely from the stored record', async () => {
      const id = await runAndCaptureId();

      const replayLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const replayCode = await runTournamentReplayCommand([id, '--store-dir', storeDir], {
        rootDir: repoRoot,
      });
      expect(replayCode).toBe(0);
      const replayedLines = replayLog.mock.calls.map((call) => call.join(' '));
      expect(replayedLines.filter((line) => line.startsWith('Match '))).toHaveLength(3);
      expect(replayedLines.filter((line) => /^ {2}winner: .+$/.test(line))).toHaveLength(3);
      expect(
        replayedLines.filter((line) => /^\d\. .+ — 1W 1L 0D \(1 pts\)$/.test(line)),
      ).toHaveLength(3);
      replayLog.mockRestore();
    }, 60_000);

    it('inspect exits 1 with a clear error for an unknown tournament id', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await runTournamentInspectCommand(['not-a-real-id', '--store-dir', storeDir], {
        rootDir: repoRoot,
      });
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no tournament record found'));
      error.mockRestore();
    });
  });
});
