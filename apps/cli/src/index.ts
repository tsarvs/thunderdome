#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runCleanupCommand } from './commands/cleanup.js';
import { runMatchCommand } from './commands/match.js';
import { runPlayCommand } from './commands/play.js';
import {
  runTournamentCommand,
  runTournamentInspectCommand,
  runTournamentListCommand,
  runTournamentReplayCommand,
} from './commands/tournament.js';
import { abortActiveMatch } from './lib/match-execution.js';

// Presentation layer only — no engine logic lives here (docs/architecture.md §2), with three
// exceptions: `match run` (Phase 6), `tournament run` (Phase 7), and `play` are real,
// registry-backed behavior — see commands/match.ts, commands/tournament.ts, and commands/play.ts.
// Every other subcommand group below is still a stub.
const SUBCOMMANDS = ['games', 'bots', 'tournament', 'match', 'play', 'cleanup'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function printHelp(): void {
  console.log(`thunderdome - community bot competition platform

Usage:
  thunderdome <command> [subcommand] [options]
  thunderdome --help
  thunderdome --version

Commands:
  games        Manage and inspect game definitions
  bots         Manage and inspect bot submissions
  tournament   Run, list, inspect, and replay tournaments (see "tournament run")
  match        Run and inspect individual matches (see "match run")
  play         Play one interactive match against a bot, turn by turn, from this terminal
  cleanup      Force-remove any leftover Thunderdome bot containers`);
}

/** Routed directly off argv[0], ahead of the generic flag parse below, so `match run`'s own
 * `--config` flag is never mistaken for a top-level CLI flag. */
async function runMatchSubcommand(argv: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    console.log("'match' is not yet implemented.");
    return 0;
  }
  if (subcommand === 'run') {
    return runMatchCommand(rest, { rootDir: process.cwd() });
  }
  console.error(`Unknown match subcommand: "${subcommand}". Only "run" exists today.`);
  return 1;
}

/** Same rationale as runMatchSubcommand: routed ahead of the generic flag parse so
 * `tournament run`'s own `--game-config`/`--tournament-config` flags are never mistaken for
 * top-level flags. */
async function runTournamentSubcommand(argv: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    console.log("'tournament' is not yet implemented.");
    return 0;
  }
  const rootDir = process.cwd();
  if (subcommand === 'run') {
    return runTournamentCommand(rest, { rootDir });
  }
  if (subcommand === 'list') {
    return runTournamentListCommand(rest, { rootDir });
  }
  if (subcommand === 'inspect') {
    return runTournamentInspectCommand(rest, { rootDir });
  }
  if (subcommand === 'replay') {
    return runTournamentReplayCommand(rest, { rootDir });
  }
  console.error(
    `Unknown tournament subcommand: "${subcommand}". Only "run", "list", "inspect", and ` +
      `"replay" exist today.`,
  );
  return 1;
}

export async function run(argv: readonly string[]): Promise<number> {
  if (argv[0] === 'match') {
    return runMatchSubcommand(argv.slice(1));
  }
  if (argv[0] === 'tournament') {
    return runTournamentSubcommand(argv.slice(1));
  }
  // Routed ahead of the generic flag parse below, same rationale as match/tournament: `play`'s
  // own `--as`/`--game-config` flags must never be mistaken for top-level CLI flags.
  if (argv[0] === 'play') {
    return runPlayCommand(argv.slice(1), { rootDir: process.cwd() });
  }
  if (argv[0] === 'cleanup') {
    return runCleanupCommand();
  }

  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version) {
    console.log('0.1.0');
    return 0;
  }

  if (values.help === true || positionals.length === 0) {
    printHelp();
    return 0;
  }

  const [command] = positionals;
  if (command === undefined || !isSubcommand(command)) {
    console.error(`Unknown command: ${command ?? ''}`.trim());
    printHelp();
    return 1;
  }

  console.log(`'${command}' is not yet implemented.`);
  return 0;
}

/**
 * Closing the terminal, or an ordinary Ctrl+C, sends `SIGINT`/`SIGTERM` — without this, either
 * one would kill the process immediately, leaving whatever bot containers `match run`/
 * `tournament run` currently has running behind (nothing else would ever tell them to stop).
 * `abortActiveMatch()` (apps/cli/src/lib/match-execution.ts) tears down the one match currently
 * in flight, if any; a second interrupt while that's in progress exits immediately rather than
 * risk the user feeling stuck if Docker itself is unresponsive. Not registered under `vitest`
 * (only ever called from the real entrypoint below) so tests never install a process-wide signal
 * handler that outlives the test run.
 */
function registerInterruptHandler(): void {
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    console.error(`\nReceived ${signal} — stopping any active bot containers before exiting...`);
    abortActiveMatch()
      .catch(() => {
        // Best-effort: still exit below even if teardown itself hit an error.
      })
      .finally(() => {
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
  };

  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}

/* node:coverage disable */
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  registerInterruptHandler();
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
/* node:coverage enable */
