// `thunderdome tournament run` — Phase 7's tournament orchestrator (round robin), joined in
// Phase 9 by single elimination — wired to real bots. Reuses exactly the same
// registry-resolution, on-demand image build, and single-match execution `match run` (Phase 6)
// already established (apps/cli/src/lib/match-execution.ts) — a tournament is just that same
// wiring, called once per `MatchDescriptor` the format unlocks via `@thunderdome/engine`'s
// `runTournament()`.
//
// Phase 11 added persistence: every `run` writes a `TournamentRecord`
// (`@thunderdome/tournament-store`) to disk as it goes, and `inspect`/`replay`/`list` read it
// back. The tournament-author-guide's original three-piece design (`tournament create`, then a
// separate run-by-id step) was simplified into one — `run` always creates *and* drives its own
// record — since nothing in this platform needs a record to exist before it's actually played.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  runTournament,
  type Rng,
  type RoundEvent,
  type TournamentFormat,
} from '@thunderdome/engine';
import { createRng, deriveSeed, generateTournamentSeed, seedToHex } from '@thunderdome/rng';
import { scanBots, type GameRegistryEntry } from '@thunderdome/registry';
import {
  roundRobinFormat,
  singleEliminationFormat,
  type RoundRobinStandings,
  type SingleEliminationStandings,
} from '@thunderdome/tournament-formats';
import {
  loadTournamentRecord,
  saveTournamentRecord,
  listTournamentRecords,
  type PersistedMatch,
  type TournamentRecord,
} from '@thunderdome/tournament-store';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  runSingleMatch,
  type AnyGameDefinition,
} from '../lib/match-execution.js';
import { printRoundEvents } from './match.js';

const RUN_USAGE =
  'Usage: thunderdome tournament run <botId> <botId> [...moreBotIds] ' +
  '[--tournament-config \'{"format":"round-robin"|"single-elimination","bestOf":1}\'] ' +
  '[--game-config \'{"totalRounds":300}\'] [--store-dir <path>]\n' +
  '   or: thunderdome tournament run --all-bots <gameId> ' +
  '[--tournament-config \'{"format":"round-robin"|"single-elimination","bestOf":7}\'] ' +
  '[--game-config \'{"totalRounds":300}\'] [--store-dir <path>]';

/**
 * Resolves the roster for `--all-bots <gameId>`: every bot the registry finds for that game,
 * sorted for a deterministic roster ordering across runs (the registry itself is a `Map`, whose
 * iteration order otherwise just reflects filesystem scan order). Mutually exclusive with
 * explicit bot-id positionals — the two ways of specifying a roster shouldn't silently merge.
 */
async function resolveAllBotsRoster(
  rootDir: string,
  gameId: string,
): Promise<{ ok: true; botIds: string[] } | { ok: false; message: string }> {
  const { entries } = await scanBots(rootDir);
  const botIds = [...entries.values()]
    .filter((entry) => entry.manifest.game === gameId)
    .map((entry) => entry.manifest.id)
    .sort();
  if (botIds.length < 2) {
    const known = [...entries.keys()].join(', ') || '(none found)';
    return {
      ok: false,
      message: `--all-bots "${gameId}" found ${String(botIds.length)} bot(s); need at least 2. Known bots: ${known}`,
    };
  }
  return { ok: true, botIds };
}

/**
 * A full-roster run (`--all-bots`) defaults to a 7-game series per pairing rather than
 * round-robin's own single-match-per-pairing default — since the point of "everyone plays
 * everyone" is a fair read on each matchup, not one potentially-lucky throw. Only fills the gap:
 * an explicit `bestOf` in `--tournament-config` always wins.
 */
function withAllBotsDefaults(formatConfigRaw: unknown): unknown {
  if (
    typeof formatConfigRaw !== 'object' ||
    formatConfigRaw === null ||
    Array.isArray(formatConfigRaw)
  ) {
    return formatConfigRaw;
  }
  if ('bestOf' in formatConfigRaw) {
    return formatConfigRaw;
  }
  return { ...formatConfigRaw, bestOf: 7 };
}

function defaultStoreDir(rootDir: string): string {
  return path.join(rootDir, '.thunderdome', 'tournaments');
}

/** `--tournament-config`'s own `format` field selects which `TournamentFormat` to run — pulled
 * out ahead of that config's own schema validation (round-robin's/single-elimination's schemas
 * don't declare `format` themselves; zod's default object parsing silently drops it) since it's
 * what decides *which* schema validates the rest of the object. */
function extractFormatId(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const candidate = (raw as Record<string, unknown>).format;
  return typeof candidate === 'string' ? candidate : undefined;
}

interface SeriesTally {
  participantIds: [string, string];
  wins: Map<string, number>;
  matchesPlayed: number;
}

function seriesPairingKey(participantIds: readonly string[]): string {
  return [...participantIds].sort().join('|');
}

/**
 * Pure display logic mirroring the shared best-of-N majority-or-cap decision every format uses
 * for its own matchups (`packages/tournament-formats/src/series.ts`) — duplicated here rather
 * than exposed through `runTournament()`'s generic `MatchExecutor` callback, which only ever sees
 * one `MatchDescriptor` at a time and has no reason to know a format's internal series
 * bookkeeping. Format-agnostic: it only needs the two participant ids and `bestOf`, both equally
 * meaningful whether the matchup is a round-robin pairing or a bracket slot.
 */
function seriesStatusLine(tally: SeriesTally, bestOf: number): string {
  const [a, b] = tally.participantIds;
  const winsA = tally.wins.get(a) ?? 0;
  const winsB = tally.wins.get(b) ?? 0;
  const majorityTarget = Math.ceil(bestOf / 2);
  const decided = Math.max(winsA, winsB) >= majorityTarget || tally.matchesPlayed >= bestOf;

  if (!decided) {
    const score =
      winsA === winsB
        ? `tied ${String(winsA)}-${String(winsB)}`
        : winsA > winsB
          ? `${a} leads ${String(winsA)}-${String(winsB)}`
          : `${b} leads ${String(winsB)}-${String(winsA)}`;
    return `  series: ${score} (${String(tally.matchesPlayed)}/${String(bestOf)} played)`;
  }
  if (winsA === winsB) {
    return `  series decided: tied ${String(winsA)}-${String(winsB)} after ${String(tally.matchesPlayed)} matches`;
  }
  const winner = winsA > winsB ? a : b;
  const loser = winsA > winsB ? b : a;
  return `  series decided: ${winner} wins ${String(Math.max(winsA, winsB))}-${String(Math.min(winsA, winsB))} over ${loser}`;
}

function printRoundRobinStandingsEntries(entries: readonly RoundRobinStandings[string][]): void {
  entries.forEach((entry, index) => {
    console.log(
      `${String(index + 1)}. ${entry.participantId} — ${String(entry.wins)}W ${String(entry.losses)}L ${String(entry.draws)}D (${String(entry.points)} pts)`,
    );
  });
}

function printSingleEliminationStandingsEntries(
  entries: readonly SingleEliminationStandings[string][],
): void {
  entries.forEach((entry, index) => {
    const placement =
      entry.eliminatedInRound === null
        ? index === 0
          ? 'champion'
          : 'still active'
        : `eliminated in round ${String(entry.eliminatedInRound + 1)}`;
    console.log(`${String(index + 1)}. ${entry.participantId} — ${placement}`);
  });
}

/** Dispatches on a persisted record's own `formatId` — used by `inspect`/`replay`, which only
 * ever see the format's already-projected public standings (`TournamentRecord.standings`),
 * never the internal `TStandings` a live run's `printStandings` closes over. */
function printStandingsForFormat(formatId: string, standings: unknown): void {
  if (formatId === singleEliminationFormat.id) {
    printSingleEliminationStandingsEntries(standings as SingleEliminationStandings[string][]);
    return;
  }
  printRoundRobinStandingsEntries(standings as RoundRobinStandings[string][]);
}

export interface TournamentRunOptions {
  /** Repo root to scan games/ and bots/ under. */
  rootDir: string;
}

interface RunFormatArgs<TFormatConfig extends { bestOf: number }, TFormatState, TStandings> {
  format: TournamentFormat<TFormatConfig, TFormatState, TStandings>;
  formatConfig: TFormatConfig;
  gameConfig: unknown;
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  botIds: readonly string[];
  imageTagsByBotId: ReadonlyMap<string, string>;
  tournamentSeed: Buffer;
  formatRng: Rng;
  /** Called with the format's own `getPublicStandings()` projection (not the internal
   * `TStandings`) — the same shape `record.standings` ends up persisted as, so this and
   * `tournament inspect`/`replay`'s printing can share one set of formatting functions. */
  printStandings: (publicStandings: unknown) => void;
  record: TournamentRecord;
  storeDir: string;
}

/**
 * Everything a tournament run needs once its format and both configs are already resolved and
 * valid — generic over which `TournamentFormat` it's driving, since `runTournament()` itself,
 * the per-match printing, and the series-progress display (above) are all format-agnostic; only
 * config parsing/validation and final-standings rendering are genuinely format-specific, and
 * those are pushed to the caller via `formatConfig`/`printStandings`. `record`/`storeDir` are
 * mutated and saved as matches complete, so a tournament interrupted partway through still
 * leaves every match played so far on disk (`tournament inspect`/`replay`).
 */
async function runWithFormat<TFormatConfig extends { bestOf: number }, TFormatState, TStandings>(
  args: RunFormatArgs<TFormatConfig, TFormatState, TStandings>,
): Promise<number> {
  const {
    format,
    formatConfig,
    gameConfig,
    game,
    gameEntry,
    botIds,
    imageTagsByBotId,
    tournamentSeed,
    formatRng,
    printStandings,
    record,
    storeDir,
  } = args;

  console.log(
    `\nTournament ${record.id}: ${botIds.join(', ')} (${gameEntry.manifest.name}, ${format.id})\n`,
  );

  const seriesTallies = new Map<string, SeriesTally>();
  // A format's `MatchDescriptor.round` is advisory (packages/engine/src/tournament.ts) — round
  // robin sets it to "which game number this is within its own pairing's series," which (thanks
  // to runTournament()'s FIFO pull-loop) also happens to line up as a genuine wave: every
  // still-undecided pairing plays its round-N game before any pairing starts round N+1. Tracked
  // here, not in the format itself, since "print a blank line between waves" is pure CLI
  // presentation with no bearing on orchestration or scoring.
  let lastRound: number | undefined;

  let outcome;
  try {
    outcome = await runTournament({
      format,
      config: formatConfig,
      roster: botIds.map((participantId) => ({ participantId })),
      rng: formatRng,
      onNotice: (notice) => {
        console.log(notice);
      },
      runMatch: async (match) => {
        if (match.round !== undefined && lastRound !== undefined && match.round !== lastRound) {
          console.log('');
        }
        lastRound = match.round;

        console.log(`Match ${match.matchId}: ${match.participantIds.join(' vs ')}`);
        const singleOutcome = await runSingleMatch({
          game,
          gameEntry,
          config: gameConfig,
          matchId: match.matchId,
          participantIds: match.participantIds,
          imageTagsByBotId,
          tournamentSeed,
        });
        if (singleOutcome.status === 'forfeit') {
          console.log(`  forfeit: ${(singleOutcome.forfeitedParticipantIds ?? []).join(', ')}`);
        } else if (singleOutcome.status === 'match-timeout') {
          console.log('  timed out without a decisive result — scored as a draw');
        }
        // `rank === 1` alone isn't enough to identify a winner — a genuine tie gives every
        // participant rank 1, so look for the entry actually marked `outcome: 'win'` instead.
        // This also covers a forfeit's survivor (synthesizeForfeitStandings marks them `'win'`
        // for the 2-participant case every format here always has), so one check works for every
        // match status — completed, forfeited, or timed out.
        const winner = singleOutcome.standingOutcomes.find((entry) => entry.outcome === 'win');
        if (singleOutcome.status === 'completed') {
          console.log(winner ? `  winner: ${winner.participantId}` : '  draw');
        }

        if (formatConfig.bestOf > 1) {
          const [p1, p2] = match.participantIds;
          if (p1 !== undefined && p2 !== undefined) {
            const key = seriesPairingKey(match.participantIds);
            const tally = seriesTallies.get(key) ?? {
              participantIds: [p1, p2],
              wins: new Map<string, number>(),
              matchesPlayed: 0,
            };
            tally.matchesPlayed += 1;
            if (winner !== undefined) {
              tally.wins.set(winner.participantId, (tally.wins.get(winner.participantId) ?? 0) + 1);
            }
            seriesTallies.set(key, tally);
            console.log(seriesStatusLine(tally, formatConfig.bestOf));
          }
        }

        const persistedMatch: PersistedMatch = {
          matchId: match.matchId,
          participantIds: match.participantIds,
          status: singleOutcome.status,
          standingOutcomes: singleOutcome.standingOutcomes,
          events: singleOutcome.events,
          ...(singleOutcome.forfeitedParticipantIds !== undefined
            ? { forfeitedParticipantIds: singleOutcome.forfeitedParticipantIds }
            : {}),
        };
        record.matches.push(persistedMatch);
        await saveTournamentRecord(storeDir, record);

        return { matchId: match.matchId, standingOutcomes: singleOutcome.standingOutcomes };
      },
    });
  } catch (error) {
    record.status = 'failed';
    record.completedAt = new Date().toISOString();
    record.error = error instanceof Error ? error.message : String(error);
    await saveTournamentRecord(storeDir, record);
    console.error(record.error);
    return 1;
  }

  const publicStandings = format.getPublicStandings(outcome.standings);
  record.status = 'completed';
  record.completedAt = new Date().toISOString();
  record.standings = publicStandings;
  await saveTournamentRecord(storeDir, record);

  console.log('\nFinal standings:');
  printStandings(publicStandings);

  return 0;
}

export async function runTournamentCommand(
  argv: readonly string[],
  options: TournamentRunOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      'tournament-config': { type: 'string', default: '{}' },
      'game-config': { type: 'string', default: '{}' },
      'store-dir': { type: 'string' },
      'all-bots': { type: 'string' },
    },
    allowPositionals: true,
  });

  const allBotsGameId = values['all-bots'];
  if (allBotsGameId !== undefined && positionals.length > 0) {
    console.error('--all-bots cannot be combined with explicit bot ids.');
    return 1;
  }

  let botIds: readonly string[];
  if (allBotsGameId !== undefined) {
    const roster = await resolveAllBotsRoster(options.rootDir, allBotsGameId);
    if (!roster.ok) {
      console.error(roster.message);
      return 1;
    }
    botIds = roster.botIds;
  } else {
    botIds = positionals;
    if (botIds.length < 2) {
      console.error(RUN_USAGE);
      return 1;
    }
  }
  const storeDir = values['store-dir'] ?? defaultStoreDir(options.rootDir);

  let gameConfigRaw: unknown;
  let formatConfigRaw: unknown;
  try {
    gameConfigRaw = JSON.parse(values['game-config']);
    formatConfigRaw = JSON.parse(values['tournament-config']);
  } catch (error) {
    console.error(
      `--game-config/--tournament-config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  if (allBotsGameId !== undefined) {
    formatConfigRaw = withAllBotsDefaults(formatConfigRaw);
  }

  const formatId = extractFormatId(formatConfigRaw) ?? roundRobinFormat.id;
  if (formatId !== roundRobinFormat.id && formatId !== singleEliminationFormat.id) {
    console.error(
      `Unsupported format "${formatId}" in --tournament-config. Only "${roundRobinFormat.id}" ` +
        `and "${singleEliminationFormat.id}" are implemented today.`,
    );
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;

  const game = await loadGame(gameEntry);
  const gameConfigResult = game.parseConfig(gameConfigRaw);
  if (!gameConfigResult.ok) {
    console.error(
      `Invalid --game-config for game "${gameEntry.manifest.id}": ${gameConfigResult.reason}`,
    );
    return 1;
  }
  const gameConfig = gameConfigResult.value;

  const isSingleElimination = formatId === singleEliminationFormat.id;
  const formatConfigResult = isSingleElimination
    ? singleEliminationFormat.parseConfig(formatConfigRaw)
    : roundRobinFormat.parseConfig(formatConfigRaw);
  if (!formatConfigResult.ok) {
    console.error(
      `Invalid --tournament-config for format "${formatId}": ${formatConfigResult.reason}`,
    );
    return 1;
  }

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  // The one entropy boundary for the whole tournament (ADR-0004) — every match's own seed
  // derives from this, never a fresh one per match.
  const tournamentSeed = generateTournamentSeed();
  const formatRng = createRng(deriveSeed(tournamentSeed, 'format'));

  const formatVersion = isSingleElimination
    ? singleEliminationFormat.version
    : roundRobinFormat.version;
  const record: TournamentRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'running',
    gameId: gameEntry.manifest.id,
    gameVersion: gameEntry.manifest.version,
    gameConfig,
    formatId,
    formatVersion,
    formatConfig: formatConfigResult.value,
    roster: [...botIds],
    tournamentSeed: seedToHex(tournamentSeed),
    matches: [],
  };
  // Saved once up front so a crash during image build or the very first match still leaves a
  // "running, 0 matches" record behind, not silence.
  await saveTournamentRecord(storeDir, record);

  const sharedArgs = {
    gameConfig,
    game,
    gameEntry,
    botIds,
    imageTagsByBotId,
    tournamentSeed,
    formatRng,
    record,
    storeDir,
  };

  if (isSingleElimination) {
    return runWithFormat({
      ...sharedArgs,
      format: singleEliminationFormat,
      formatConfig: formatConfigResult.value,
      printStandings: (standings) => {
        printSingleEliminationStandingsEntries(standings as SingleEliminationStandings[string][]);
      },
    });
  }
  return runWithFormat({
    ...sharedArgs,
    format: roundRobinFormat,
    formatConfig: formatConfigResult.value,
    printStandings: (standings) => {
      printRoundRobinStandingsEntries(standings as RoundRobinStandings[string][]);
    },
  });
}

export interface TournamentListOptions {
  rootDir: string;
}

export async function runTournamentListCommand(
  argv: readonly string[],
  options: TournamentListOptions,
): Promise<number> {
  const { values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: false,
  });
  const storeDir = values['store-dir'] ?? defaultStoreDir(options.rootDir);

  const { summaries, issues } = await listTournamentRecords(storeDir);
  if (summaries.length === 0) {
    console.log('No tournaments recorded yet.');
  }
  for (const summary of summaries) {
    console.log(
      `${summary.id}  ${summary.createdAt}  ${summary.status}  ${summary.gameId}/${summary.formatId}  ${summary.roster.join(', ')}`,
    );
  }
  for (const issue of issues) {
    console.error(`warning: could not read ${issue.path}: ${issue.message}`);
  }
  return 0;
}

export interface TournamentInspectOptions {
  rootDir: string;
}

export async function runTournamentInspectCommand(
  argv: readonly string[],
  options: TournamentInspectOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [id] = positionals;
  if (id === undefined) {
    console.error('Usage: thunderdome tournament inspect <tournamentId> [--store-dir <path>]');
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultStoreDir(options.rootDir);

  const result = await loadTournamentRecord(storeDir, id);
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  const record = result.value;

  console.log(`Tournament ${record.id}`);
  console.log(
    `  status: ${record.status}${record.error !== undefined ? ` — ${record.error}` : ''}`,
  );
  console.log(
    `  created: ${record.createdAt}` +
      (record.completedAt !== undefined ? `, completed: ${record.completedAt}` : ''),
  );
  console.log(`  game: ${record.gameId}@${record.gameVersion}`);
  console.log(`  format: ${record.formatId}@${record.formatVersion}`);
  console.log(`  roster: ${record.roster.join(', ')}`);
  console.log(`  seed: ${record.tournamentSeed}`);
  console.log(`  matches played: ${String(record.matches.length)}`);

  if (record.standings !== undefined) {
    console.log('\nFinal standings:');
    printStandingsForFormat(record.formatId, record.standings);
  }

  return 0;
}

export interface TournamentReplayOptions {
  rootDir: string;
}

/**
 * Replays a persisted tournament purely from its own record — no Docker, no bots, no
 * re-simulation. This is the deterministic kind of replay ADR-0004 describes ("replaying a
 * persisted match record is fully deterministic"), as distinct from re-running the same live
 * bots again, which is not guaranteed to reproduce identical timeouts/forfeits.
 */
export async function runTournamentReplayCommand(
  argv: readonly string[],
  options: TournamentReplayOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [id] = positionals;
  if (id === undefined) {
    console.error('Usage: thunderdome tournament replay <tournamentId> [--store-dir <path>]');
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultStoreDir(options.rootDir);

  const result = await loadTournamentRecord(storeDir, id);
  if (!result.ok) {
    console.error(result.reason);
    return 1;
  }
  const record = result.value;

  console.log(
    `Replaying tournament ${record.id}: ${record.roster.join(', ')} (${record.gameId}, ${record.formatId})\n`,
  );

  for (const match of record.matches) {
    console.log(`Match ${match.matchId}: ${match.participantIds.join(' vs ')}`);
    // `PersistedMatch.events` is zod-inferred, so `participantIds`/`data` come out typed as
    // `T | undefined` rather than genuinely optional — structurally identical to `RoundEvent[][]`
    // for every real value, just not exactOptionalPropertyTypes-identical.
    printRoundEvents(match.events as RoundEvent[][]);
    if (match.status === 'forfeit') {
      console.log(`  forfeit: ${(match.forfeitedParticipantIds ?? []).join(', ')}`);
    } else if (match.status === 'match-timeout') {
      console.log('  timed out without a decisive result — scored as a draw');
    } else {
      const winner = match.standingOutcomes.find((entry) => entry.outcome === 'win');
      console.log(winner ? `  winner: ${winner.participantId}` : '  draw');
    }
  }

  if (record.standings !== undefined) {
    console.log('\nFinal standings:');
    printStandingsForFormat(record.formatId, record.standings);
  } else {
    console.log(`\n(tournament status: ${record.status} — no final standings recorded yet)`);
  }

  return 0;
}
