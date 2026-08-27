// `thunderdome match run` — the registry-backed, real end-to-end match runner. Resolves
// bot/game ids through @thunderdome/registry, builds each bot's Docker image on demand from its
// own manifest (no manual pre-build step), then drives a real match through @thunderdome/engine
// and @thunderdome/runtime — the registry-driven successor to an earlier ad hoc scrimmage script
// that proved the same wiring by hand against a hardcoded bot list.
import { parseArgs } from 'node:util';
import type { RoundEvent } from '@thunderdome/engine';
import { generateTournamentSeed } from '@thunderdome/rng';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  runSingleMatch,
} from '../lib/match-execution.js';

const USAGE =
  'Usage: thunderdome match run <botId> <botId> [...moreBotIds] [--config \'{"totalRounds":300}\']';

/** Printing every round is fine for a handful of rounds, but floods the terminal at 300 — past
 * this threshold, just report how many rounds were played and let the final standings speak.
 * Exported so `tournament replay` (commands/tournament.ts) can print a persisted match's events
 * identically to how a live `match run`/`tournament run` would have shown them. */
export const MAX_ROUNDS_TO_PRINT_INDIVIDUALLY = 20;

export function printRoundEvents(events: RoundEvent[][]): void {
  if (events.length <= MAX_ROUNDS_TO_PRINT_INDIVIDUALLY) {
    for (const rounds of events) {
      for (const event of rounds) {
        console.log('  round-result:', event.data);
      }
    }
    return;
  }
  console.log(`  (${String(events.length)} rounds played)`);
}

/** Not every game's result carries this — only a game made up of multiple sub-units beneath the
 * per-round event stream `printRoundEvents` already reports on, e.g. Hearts's `handsPlayed`
 * (games/card-game-hearts/src/types.ts). Reads it generically off whatever shape `result` happens
 * to be rather than hardcoding to Hearts, so any other such game gets this for free too — a no-op
 * for a game whose result has no such field. */
export function printHandsPlayed(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { handsPlayed } = result as Record<string, unknown>;
  if (typeof handsPlayed === 'number') {
    console.log(`  (${String(handsPlayed)} hands played)`);
  }
}

export interface MatchRunOptions {
  /** Repo root to scan games/ and bots/ under. */
  rootDir: string;
}

export async function runMatchCommand(
  argv: readonly string[],
  options: MatchRunOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { config: { type: 'string', default: '{}' } },
    allowPositionals: true,
  });

  const botIds = positionals;
  if (botIds.length < 2) {
    console.error(USAGE);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;

  let configRaw: unknown;
  try {
    configRaw = JSON.parse(values.config);
  } catch (error) {
    console.error(
      `--config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const game = await loadGame(gameEntry);
  const configResult = game.parseConfig(configRaw);
  if (!configResult.ok) {
    console.error(`Invalid --config for game "${gameEntry.manifest.id}": ${configResult.reason}`);
    return 1;
  }
  const config = configResult.value;

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  const roster = botIds;
  const matchId = `match-${String(Date.now())}`;
  const tournamentSeed = generateTournamentSeed(); // the one entropy boundary (ADR-0004)

  console.log(`\nMatch: ${roster.join(' vs ')} (${gameEntry.manifest.name})\n`);

  let outcome;
  try {
    outcome = await runSingleMatch({
      game,
      gameEntry,
      config,
      matchId,
      participantIds: roster,
      imageTagsByBotId,
      tournamentSeed,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  printRoundEvents(outcome.events);
  printHandsPlayed(outcome.result);
  console.log();

  if (outcome.status === 'forfeit') {
    console.log(`Forfeit: ${(outcome.forfeitedParticipantIds ?? []).join(', ')}`);
  } else if (outcome.status === 'match-timeout') {
    console.log(
      'Match hit its overall wall-clock budget without the game itself declaring an end — scored as a draw between all participants. This is a rare defense-in-depth case (see docs/adr/0003-docker-bot-isolation.md), not expected in normal play.',
    );
  }
  const standings = [...outcome.standingOutcomes].sort((a, b) => a.rank - b.rank);
  for (const standing of standings) {
    const parts = [`${String(standing.rank)}.`, standing.participantId];
    if (standing.outcome !== undefined) {
      parts.push(
        `(${standing.outcome}${standing.score !== undefined ? `, score=${String(standing.score)}` : ''})`,
      );
    }
    console.log(parts.join(' '));
  }

  return 0;
}
