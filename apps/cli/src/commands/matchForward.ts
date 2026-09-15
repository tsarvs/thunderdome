// `thunderdome match forward run|list|inspect` — roadmap Phase 3's persistent, resumable forward
// match lifecycle (see docs/adr/0013-forward-match-persistence.md). Mirrors `tournament
// run/list/inspect`'s one-level dispatch pattern (index.ts), one level deeper (`match forward
// run` vs. `tournament run`). Explicitly SM4-specific for now via duck-typing (see
// `loadForwardResumableModule` below), not a generic `GameDefinition` capability — only one game
// needs this today; see the ADR's own consequences section for why that's deliberate.
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  listForwardMatchRecords,
  loadForwardMatchRecord,
  saveForwardMatchRecord,
  type ForwardMatchRecord,
} from '@thunderdome/forward-match-store';
import { runAvailableRounds } from '@thunderdome/engine';
import {
  createRng,
  deriveSeed,
  generateTournamentSeed,
  seedFromHex,
  seedToHex,
} from '@thunderdome/rng';
import { DockerActionCollector } from '@thunderdome/runtime';
import type { GameRegistryEntry } from '@thunderdome/registry';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  startBotLifecycles,
  untrackLifecycles,
} from '../lib/match-execution.js';
import { printForwardStandings, printRoundEvents } from './match.js';

// Despite the name (kept for call-site/flag-name compatibility — `--store-dir`), this now
// resolves to the ONE shared Stock Market 4 SQLite file, not a directory of per-match JSON files
// — see docs/adr/0014-sqlite-standard-and-migrations.md. `@thunderdome/forward-match-store`
// creates this file (and its parent directory) on first use if it doesn't exist yet.
function defaultForwardMatchStoreDir(rootDir: string): string {
  return path.join(rootDir, '.thunderdome', 'stock-market-4', 'db.sqlite');
}

/**
 * The three functions a game must export (alongside its usual `game`) to be usable with `match
 * forward run` — `games/stock-market-4/src/game.ts`'s `serializeForwardState`/
 * `resumeForwardState`/`isForwardMatchFullyResolved`. Duck-typed the same way `loadGame`
 * (`lib/match-execution.ts`) duck-types a `GameDefinition` itself, rather than a new engine-level
 * interface — see this file's own module comment for why.
 */
interface ForwardResumableGameModule {
  serializeForwardState: (state: unknown) => unknown;
  resumeForwardState: (args: {
    config: unknown;
    participantIds: readonly string[];
    snapshot: unknown;
  }) => unknown;
  isForwardMatchFullyResolved: (state: unknown) => boolean;
  /** Optional: a game that also exports this (stock-market-4's `getCurrentStandings`) gets a
   * standings/portfolio/"what each bot did today" summary printed after `run` processes whatever
   * new rounds were available — see `printForwardStandings` (`./match.js`). Absent for any other
   * forward-resumable game, which just skips the summary rather than failing. */
  getCurrentStandings?: (state: unknown) => unknown;
}

function isForwardResumableGameModule(value: unknown): value is ForwardResumableGameModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.serializeForwardState === 'function' &&
    typeof candidate.resumeForwardState === 'function' &&
    typeof candidate.isForwardMatchFullyResolved === 'function'
  );
}

async function loadForwardResumableModule(
  entry: GameRegistryEntry,
): Promise<ForwardResumableGameModule> {
  const loaded: unknown = await import(entry.manifest.entryPackage);
  if (!isForwardResumableGameModule(loaded)) {
    throw new Error(
      `"${entry.manifest.entryPackage}" does not export serializeForwardState/resumeForwardState/` +
        `isForwardMatchFullyResolved — match forward run requires a FORWARD_SHADOW-capable game ` +
        `(see games/stock-market-4/src/game.ts for the convention).`,
    );
  }
  return loaded;
}

/** Same whole-invocation wall-clock safety net as `runSingleMatch`'s own `MATCH_DEADLINE_MS`
 * (docs/adr/0003-docker-bot-isolation.md) — bounds how long ONE `match forward run` invocation
 * can run, not the forward match's own lifetime (which may span weeks via repeated invocations). */
const MATCH_DEADLINE_MS = 120_000;

export interface MatchForwardRunOptions {
  rootDir: string;
}

const RUN_USAGE =
  'Usage: thunderdome match forward run <matchId> <botId> [<botId>...] ' +
  '[--config \'{"gameType":"FORWARD_SHADOW",...}\' | --config-file <path>] [--store-dir <path>]';

export async function runMatchForwardRunCommand(
  argv: readonly string[],
  options: MatchForwardRunOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      config: { type: 'string' },
      'config-file': { type: 'string' },
      'store-dir': { type: 'string' },
    },
    allowPositionals: true,
  });

  const [matchId, ...botIds] = positionals;
  if (matchId === undefined || botIds.length < 1) {
    console.error(RUN_USAGE);
    return 1;
  }
  if (values.config !== undefined && values['config-file'] !== undefined) {
    console.error(`--config and --config-file are mutually exclusive.\n${RUN_USAGE}`);
    return 1;
  }
  // A researchTimeline-bearing config (see @thunderdome/research-fusion's `buildResearchTimeline`)
  // can run to megabytes — comfortably past a shell's argv length limit for inline `--config`, so
  // `--config-file` exists specifically to carry a config that large.
  let configString: string | undefined = values.config;
  if (values['config-file'] !== undefined) {
    try {
      configString = await readFile(values['config-file'], 'utf8');
    } catch (error) {
      console.error(
        `Could not read --config-file "${values['config-file']}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const loadOutcome = await loadForwardMatchRecord(storeDir, matchId);
  if (loadOutcome.status === 'corrupt') {
    // Never silently treated as "not found" — that would quietly create a brand-new match under
    // this same id, discarding whatever trading history the corrupted file held.
    console.error(loadOutcome.reason);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;
  const game = await loadGame(gameEntry);
  let forwardModule;
  try {
    forwardModule = await loadForwardResumableModule(gameEntry);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let record: ForwardMatchRecord;
  let state: unknown;

  if (loadOutcome.status === 'not-found') {
    if (configString === undefined) {
      console.error(
        `No existing forward match "${matchId}" — provide --config or --config-file to create one.\n${RUN_USAGE}`,
      );
      return 1;
    }
    let configRaw: unknown;
    try {
      configRaw = JSON.parse(configString);
    } catch (error) {
      console.error(
        `--config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    const configResult = game.parseConfig(configRaw);
    if (!configResult.ok) {
      console.error(`Invalid --config for game "${gameEntry.manifest.id}": ${configResult.reason}`);
      return 1;
    }
    const config = configResult.value;
    const gameType = (config as Record<string, unknown>).gameType;
    if (gameType !== 'FORWARD_SHADOW') {
      console.error(
        `match forward run requires config.gameType === "FORWARD_SHADOW" (got ${String(gameType)}).`,
      );
      return 1;
    }

    const matchSeed = generateTournamentSeed();
    const initState = game.initialize({
      config,
      participantIds: botIds,
      rng: createRng(deriveSeed(matchSeed, 'match', matchId)),
    });
    const nowIso = new Date().toISOString();
    record = {
      matchId,
      gameId: gameEntry.manifest.id,
      gameVersion: gameEntry.manifest.version,
      config,
      participantIds: botIds,
      matchSeed: seedToHex(matchSeed),
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'active',
      roundsPlayed: 0,
      snapshot: forwardModule.serializeForwardState(initState),
    };
    const saved = await saveForwardMatchRecord(storeDir, record);
    if (!saved.ok) {
      console.error(saved.reason);
      return 1;
    }
    state = initState;
    console.log(`Created forward match "${matchId}" (${gameEntry.manifest.name}).`);
  } else {
    record = loadOutcome.record;
    if (record.gameId !== gameEntry.manifest.id) {
      console.error(
        `Forward match "${matchId}" was created for game "${record.gameId}", not "${gameEntry.manifest.id}".`,
      );
      return 1;
    }
    if (configString !== undefined) {
      console.error(
        `warning: ignoring --config/--config-file — resuming "${matchId}" uses its own stored config.`,
      );
    }
    if (record.status !== 'active') {
      console.log(
        `Forward match "${matchId}" is already ${record.status} — nothing to do. ` +
          `Run "thunderdome match forward inspect ${matchId}" to see its final state.`,
      );
      return 0;
    }
    const configResult = game.parseConfig(record.config);
    if (!configResult.ok) {
      console.error(
        `Cannot resume "${matchId}": stored config is no longer valid: ${configResult.reason}`,
      );
      return 1;
    }
    state = forwardModule.resumeForwardState({
      config: configResult.value,
      participantIds: record.participantIds,
      snapshot: record.snapshot,
    });
    console.log(
      `Resuming forward match "${matchId}" (${String(record.roundsPlayed)} round(s) played so far).`,
    );
  }

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);
  const matchSeedBuffer = seedFromHex(record.matchSeed);
  const matchRng = createRng(deriveSeed(matchSeedBuffer, 'match', matchId));

  const lifecycles = await startBotLifecycles({
    game,
    gameEntry,
    config: record.config,
    matchId,
    participantIds: record.participantIds,
    imageTagsByBotId,
    tournamentSeed: matchSeedBuffer,
  });

  let roundsThisInvocation = 0;
  try {
    const outcome = await runAvailableRounds({
      game,
      state,
      participantIds: record.participantIds,
      rng: matchRng,
      collector: new DockerActionCollector(lifecycles),
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: MATCH_DEADLINE_MS,
      startingRoundId: record.roundsPlayed,
      onRoundResolved: async ({ state: newState, events }) => {
        roundsThisInvocation += 1;
        record = {
          ...record,
          roundsPlayed: record.roundsPlayed + 1,
          snapshot: forwardModule.serializeForwardState(newState),
          updatedAt: new Date().toISOString(),
        };
        const saved = await saveForwardMatchRecord(storeDir, record);
        if (!saved.ok) {
          // Aborts the loop rather than silently continuing to play rounds whose results might
          // never be persisted — see runAvailableRounds's own onRoundResolved doc comment.
          throw new Error(`failed to persist forward match progress: ${saved.reason}`);
        }
        printRoundEvents([events]);
      },
    });

    const fullyResolved = forwardModule.isForwardMatchFullyResolved(outcome.finalState);
    const forfeited = outcome.terminalOutcome?.status === 'forfeit';
    const matchEndPayload: { result: unknown; reason: 'completed' | 'aborted' | 'suspended' } =
      forfeited
        ? { result: null, reason: 'aborted' }
        : fullyResolved
          ? {
              result:
                outcome.terminalOutcome?.status === 'completed'
                  ? outcome.terminalOutcome.result
                  : null,
              reason: 'completed',
            }
          : { result: null, reason: 'suspended' };
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) => lifecycle.finish(matchEndPayload)),
    );

    if (forfeited && outcome.terminalOutcome?.status === 'forfeit') {
      record = {
        ...record,
        status: 'forfeited',
        forfeitedParticipantIds: outcome.terminalOutcome.forfeitedParticipantIds,
      };
    } else if (fullyResolved) {
      record = { ...record, status: 'completed' };
    }
    const finalSave = await saveForwardMatchRecord(storeDir, record);
    if (!finalSave.ok) {
      console.error(finalSave.reason);
      return 1;
    }

    const standingsSummary = forwardModule.getCurrentStandings?.(outcome.finalState);
    if (standingsSummary !== undefined) {
      printForwardStandings(standingsSummary, record.participantIds);
    }

    console.log(
      `\nForward match "${matchId}": played ${String(roundsThisInvocation)} new round(s) this ` +
        `invocation (${String(record.roundsPlayed)} total).`,
    );
    console.log(
      record.status === 'active'
        ? 'Still resumable — more data may arrive later; re-run the same command to continue.'
        : `Status: ${record.status}.`,
    );
    return 0;
  } catch (error) {
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    untrackLifecycles(lifecycles);
  }
}

export interface MatchForwardListOptions {
  rootDir: string;
}

export async function runMatchForwardListCommand(
  argv: readonly string[],
  options: MatchForwardListOptions,
): Promise<number> {
  const { values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: false,
  });
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const { summaries, issues } = await listForwardMatchRecords(storeDir);
  if (summaries.length === 0) {
    console.log('No forward matches recorded yet.');
  }
  for (const summary of summaries) {
    console.log(
      `${summary.matchId}  ${summary.updatedAt}  ${summary.status}  ${summary.gameId}  ` +
        `${String(summary.roundsPlayed)} round(s)  ${summary.participantIds.join(', ')}`,
    );
  }
  for (const issue of issues) {
    console.error(`warning: could not read ${issue.path}: ${issue.message}`);
  }
  return 0;
}

export interface MatchForwardInspectOptions {
  rootDir: string;
}

export async function runMatchForwardInspectCommand(
  argv: readonly string[],
  options: MatchForwardInspectOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined) {
    console.error('Usage: thunderdome match forward inspect <matchId> [--store-dir <path>]');
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const outcome = await loadForwardMatchRecord(storeDir, matchId);
  if (outcome.status === 'not-found') {
    console.error(`No forward match record found for "${matchId}".`);
    return 1;
  }
  if (outcome.status === 'corrupt') {
    console.error(outcome.reason);
    return 1;
  }
  const { record } = outcome;

  console.log(`Forward match ${record.matchId}`);
  console.log(`  status: ${record.status}`);
  console.log(`  game: ${record.gameId}@${record.gameVersion}`);
  console.log(`  participants: ${record.participantIds.join(', ')}`);
  console.log(`  created: ${record.createdAt}, updated: ${record.updatedAt}`);
  console.log(`  rounds played: ${String(record.roundsPlayed)}`);
  if (record.forfeitedParticipantIds !== undefined) {
    console.log(`  forfeited: ${record.forfeitedParticipantIds.join(', ')}`);
  }
  return 0;
}
