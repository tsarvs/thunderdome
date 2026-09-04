// `thunderdome play` — a human, typing into this very terminal, playing one interactive match
// against a single registry-resolved bot. Reuses the same registry-resolution and on-demand
// image build as `match run`/`tournament run` (apps/cli/src/lib/match-execution.ts); the only new
// piece is `runHumanMatch`, which drives the bot through the usual Docker/BotLifecycle path while
// a `TerminalHumanCollector` (apps/cli/src/lib/human-collector.ts) prompts the human for theirs.
//
// Requires the game to opt in via `GameDefinition.humanInterface` — Rock-Paper-Scissors does
// (games/rock-paper-scissors/src/game.ts); a game that hasn't implemented it yet gets a clear
// error here rather than a garbled or silently-wrong prompt.
import { parseArgs } from 'node:util';
import { generateTournamentSeed } from '@thunderdome/rng';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  runHumanMatch,
} from '../lib/match-execution.js';
import { printHandsPlayed, printRoundEvents, printStockPriceRange } from './match.js';

const USAGE =
  'Usage: thunderdome play <botId> [...moreBotIds] [--as <yourParticipantId>] ' +
  '[--game-config \'{"totalRounds":300}\']\n' +
  '  One bot id per remaining seat, in order after you — a 2-player game takes exactly one; a ' +
  '4-player game like Hearts takes three. Type your move at each prompt; type "quit" (or ' +
  '"resign") anytime to end the match early.';

export interface PlayOptions {
  /** Repo root to scan games/ and bots/ under. */
  rootDir: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function runPlayCommand(
  argv: readonly string[],
  options: PlayOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: {
      as: { type: 'string', default: 'you' },
      'game-config': { type: 'string', default: '{}' },
    },
    allowPositionals: true,
  });

  const botIds = positionals;
  if (botIds.length === 0) {
    console.error(USAGE);
    return 1;
  }
  const humanParticipantId = values.as;
  if (botIds.includes(humanParticipantId)) {
    console.error(`--as "${humanParticipantId}" can't be the same id as a bot you're playing.`);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;

  const game = await loadGame(gameEntry);
  if (!game.humanInterface) {
    console.error(
      `"${gameEntry.manifest.id}" doesn't support human play yet (no GameDefinition.humanInterface).`,
    );
    return 1;
  }

  let configRaw: unknown;
  try {
    configRaw = JSON.parse(values['game-config']);
  } catch (error) {
    console.error(
      `--game-config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const configResult = game.parseConfig(configRaw);
  if (!configResult.ok) {
    console.error(
      `Invalid --game-config for game "${gameEntry.manifest.id}": ${configResult.reason}`,
    );
    return 1;
  }
  const config = configResult.value;

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  const matchId = `play-${String(Date.now())}`;
  const tournamentSeed = generateTournamentSeed(); // the one entropy boundary (ADR-0004)

  console.log(
    `\nYou (${humanParticipantId}) vs ${botIds.join(', ')} (${gameEntry.manifest.name}). Type "quit" anytime to resign.\n`,
  );

  let outcome;
  try {
    outcome = await runHumanMatch({
      game,
      gameEntry,
      config,
      matchId,
      humanParticipantId,
      botParticipantIds: botIds,
      botImageTagsByBotId: imageTagsByBotId,
      tournamentSeed,
      // Omitted entirely when absent, rather than set to `undefined` — required by
      // tsconfig.base.json's `exactOptionalPropertyTypes`.
      ...(options.input !== undefined ? { input: options.input } : {}),
      ...(options.output !== undefined ? { output: options.output } : {}),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log();
  printRoundEvents(outcome.events);
  printHandsPlayed(outcome.result);
  printStockPriceRange(outcome.result);
  console.log();

  if (outcome.status === 'forfeit') {
    console.log(`Forfeit: ${(outcome.forfeitedParticipantIds ?? []).join(', ')}`);
  } else if (outcome.status === 'match-timeout') {
    console.log('Match hit its overall wall-clock budget without a decisive result.');
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
