import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.js';

describe('thunderdome CLI', () => {
  it('prints help and exits 0 with no arguments', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run([]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('thunderdome - community bot'));
    log.mockRestore();
  });

  it('prints the version and exits 0 for --version', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run(['--version']);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('0.1.0');
    log.mockRestore();
  });

  it.each(['games', 'bots', 'tournament'])(
    'reports "%s" as not yet implemented and exits 0',
    async (command) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await run([command]);
      expect(code).toBe(0);
      expect(log).toHaveBeenCalledWith(`'${command}' is not yet implemented.`);
      log.mockRestore();
    },
  );

  it('exits 1 and prints an error for an unknown command', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await run(['not-a-real-command']);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith('Unknown command: not-a-real-command');
    error.mockRestore();
    log.mockRestore();
  });

  describe('match', () => {
    it('reports bare "match" as not yet implemented and exits 0', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await run(['match']);
      expect(code).toBe(0);
      expect(log).toHaveBeenCalledWith("'match' is not yet implemented.");
      log.mockRestore();
    });

    it('exits 1 and prints an error for an unknown match subcommand', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'not-a-real-subcommand']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        'Unknown match subcommand: "not-a-real-subcommand". Only "run" exists today.',
      );
      error.mockRestore();
    });

    it('exits 1 with a usage message when "match run" gets fewer than 2 bot ids', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['match', 'run', 'only-rock']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: thunderdome match run'));
      error.mockRestore();
    });
  });

  describe('play', () => {
    it('exits 1 with a usage message when no bot id is given', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['play']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: thunderdome play'));
      error.mockRestore();
    });

    it('exits 1 with a usage message when given more than one bot id', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['play', 'only-rock', 'only-paper']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage: thunderdome play'));
      error.mockRestore();
    });
  });

  describe('tournament', () => {
    it('reports bare "tournament" as not yet implemented and exits 0', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const code = await run(['tournament']);
      expect(code).toBe(0);
      expect(log).toHaveBeenCalledWith("'tournament' is not yet implemented.");
      log.mockRestore();
    });

    it('exits 1 and prints an error for an unknown tournament subcommand', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['tournament', 'not-a-real-subcommand']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        'Unknown tournament subcommand: "not-a-real-subcommand". Only "run", "list", ' +
          '"inspect", and "replay" exist today.',
      );
      error.mockRestore();
    });

    it('exits 1 with a usage message when "tournament run" gets fewer than 2 bot ids', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run(['tournament', 'run', 'only-rock']);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Usage: thunderdome tournament run'),
      );
      error.mockRestore();
    });

    it('exits 1 for an unsupported format in --tournament-config', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const code = await run([
        'tournament',
        'run',
        'a',
        'b',
        '--tournament-config',
        '{"format":"swiss"}',
      ]);
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unsupported format'));
      error.mockRestore();
    });
  });
});
