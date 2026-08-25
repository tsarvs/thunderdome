// Shared by `match run` and `tournament run`: resolving bot/game ids through
// the registry, building bot images on demand, and driving one real match through the engine and
// runtime. Neither command duplicates this — a tournament is just this same single-match wiring,
// called once per `MatchDescriptor` a `TournamentFormat` unlocks.
import type { GameDefinition, RoundEvent, StandingOutcome } from '@thunderdome/engine';
import { runMatch } from '@thunderdome/engine';
import { createRng, deriveSeed, seedToHex } from '@thunderdome/rng';
import {
  scanBots,
  scanGames,
  type BotRegistryEntry,
  type GameRegistryEntry,
} from '@thunderdome/registry';
import {
  BotLifecycle,
  buildBotImage,
  botImageTag,
  DEFAULT_RESOURCE_LIMITS,
  DockerActionCollector,
  DockerBotProcess,
} from '@thunderdome/runtime';
import { TerminalHumanCollector } from './human-collector.js';

export type AnyGameDefinition = GameDefinition<unknown, unknown, unknown, unknown, unknown>;

const GAME_DEFINITION_METHODS = [
  'parseConfig',
  'initialize',
  'getObservation',
  'getPendingActions',
  'validateAction',
  'resolve',
  'isTerminal',
  'getResult',
  'getStandingOutcomes',
] as const;

function isGameDefinitionLike(value: unknown): value is AnyGameDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return GAME_DEFINITION_METHODS.every((method) => typeof candidate[method] === 'function');
}

export async function loadGame(entry: GameRegistryEntry): Promise<AnyGameDefinition> {
  const loaded: unknown = await import(entry.manifest.entryPackage);
  const candidate = (loaded as Record<string, unknown>).game;
  if (!isGameDefinitionLike(candidate)) {
    throw new Error(
      `"${entry.manifest.entryPackage}" does not export a "game" GameDefinition (see games/rock-paper-scissors/src/index.ts for the convention)`,
    );
  }
  return candidate;
}

export type ResolveBotsAndGameResult =
  | { ok: true; entries: BotRegistryEntry[]; gameEntry: GameRegistryEntry }
  | { ok: false; message: string };

/** Resolves every bot id through the registry and confirms they all share one game. */
export async function resolveBotsAndGame(
  rootDir: string,
  botIds: readonly string[],
): Promise<ResolveBotsAndGameResult> {
  const [botsResult, gamesResult] = await Promise.all([scanBots(rootDir), scanGames(rootDir)]);

  const entries: BotRegistryEntry[] = [];
  for (const id of botIds) {
    const entry = botsResult.entries.get(id);
    if (!entry) {
      const known = [...botsResult.entries.keys()].join(', ') || '(none found)';
      return { ok: false, message: `Unknown bot id "${id}". Known bots: ${known}` };
    }
    entries.push(entry);
  }

  const gameIds = new Set(entries.map((entry) => entry.manifest.game));
  if (gameIds.size > 1) {
    return {
      ok: false,
      message: `All bots must play the same game; got: ${[...gameIds].join(', ')}`,
    };
  }
  const [gameId] = gameIds;
  const gameEntry = gameId === undefined ? undefined : gamesResult.entries.get(gameId);
  if (!gameEntry) {
    const known = [...gamesResult.entries.keys()].join(', ') || '(none found)';
    return { ok: false, message: `Unknown game "${String(gameId)}". Known games: ${known}` };
  }

  return { ok: true, entries, gameEntry };
}

/** Builds every bot's image on demand, once, keyed by bot id — never once per match. */
export async function buildBotImages(
  entries: readonly BotRegistryEntry[],
): Promise<Map<string, string>> {
  const imageTagsByBotId = new Map<string, string>();
  for (const entry of entries) {
    const imageTag = botImageTag(entry.manifest.id);
    await buildBotImage({
      botDir: entry.dir,
      dockerfile: entry.manifest.build.dockerfile,
      context: entry.manifest.build.context,
      imageTag,
    });
    imageTagsByBotId.set(entry.manifest.id, imageTag);
  }
  return imageTagsByBotId;
}

export interface RunSingleMatchArgs {
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  config: unknown;
  matchId: string;
  participantIds: readonly string[];
  imageTagsByBotId: ReadonlyMap<string, string>;
  /** The tournament's one entropy boundary (ADR-0004) — everything else derives from this. */
  tournamentSeed: Buffer;
}

export interface SingleMatchOutcome {
  status: 'completed' | 'forfeit' | 'match-timeout';
  events: RoundEvent[][];
  standingOutcomes: StandingOutcome[];
  forfeitedParticipantIds?: string[];
}

/**
 * The whole-match wall-clock safety net (docs/adr/0003-docker-bot-isolation.md): protects
 * against a game state that never satisfies `isTerminal()` even though every participant is
 * responding correctly and on time every round. Rock-Paper-Scissors itself no longer has this
 * problem — it's bounded by a fixed `totalRounds` regardless of how the hands fall
 * (games/rock-paper-scissors/src/types.ts) — so in practice this is defense-in-depth against a
 * different or future game whose own termination logic has a similar gap, not something normal
 * RPS play should ever actually hit.
 */
const MATCH_DEADLINE_MS = 120_000;

/**
 * Every `BotLifecycle` currently in flight, across whichever single match `runSingleMatch` is
 * driving right now — `match run`/`tournament run` only ever run one match at a time (each
 * awaits the previous before starting the next), so this never needs to track more than one
 * match's worth of containers. Exists so a process-level interrupt (`apps/cli/src/index.ts`'s
 * `SIGINT`/`SIGTERM` handler) has something to reach into: closing the terminal mid-tournament
 * would otherwise leave every currently-running container behind, since nothing else outside
 * this module's own call stack knows they exist.
 */
const activeLifecycles = new Set<BotLifecycle>();

/** Best-effort teardown of every container currently in flight — used by the CLI's interrupt
 * handler. A no-op if nothing is running right now. Never throws: `BotLifecycle.finish()` itself
 * never rejects, and an already-terminated lifecycle just resolves immediately. */
export async function abortActiveMatch(): Promise<void> {
  await Promise.all(
    [...activeLifecycles].map((lifecycle) => lifecycle.finish({ result: null, reason: 'aborted' })),
  );
}

/** Spins up a fresh container per participant, runs one real match, tears them down —
 * guaranteed by the `try`/`catch`/`finally` below regardless of *how* things go wrong: a later
 * participant's own container failing to start, a bot failing to initialize, or `runMatch()`
 * itself throwing unexpectedly all still leave zero containers behind. */
export async function runSingleMatch(args: RunSingleMatchArgs): Promise<SingleMatchOutcome> {
  const { game, gameEntry, config, matchId, participantIds, imageTagsByBotId, tournamentSeed } =
    args;
  const roster = [...participantIds];
  const matchRng = createRng(deriveSeed(tournamentSeed, 'match', matchId));

  const lifecycles = new Map<string, BotLifecycle>();
  try {
    for (const participantId of roster) {
      const imageTag = imageTagsByBotId.get(participantId);
      if (imageTag === undefined) {
        throw new Error(`unreachable: no image built for participant "${participantId}"`);
      }
      const botProcess = new DockerBotProcess({
        imageRef: imageTag,
        matchId,
        participantId,
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      });
      await botProcess.start();
      const lifecycle = new BotLifecycle({ process: botProcess, matchId });
      // Tracked immediately — before `initialize()` even resolves — so that a later
      // participant's `start()`/`initialize()` failing still tears this one down too, via the
      // catch block below, without needing its own special-cased cleanup.
      lifecycles.set(participantId, lifecycle);
      activeLifecycles.add(lifecycle);

      const rngSeedHex = seedToHex(deriveSeed(tournamentSeed, 'bot', matchId, participantId));
      const initOutcome = await lifecycle.initialize(
        {
          gameId: gameEntry.manifest.id,
          gameVersion: gameEntry.manifest.version,
          participantId,
          roster,
          rngSeed: rngSeedHex,
          config,
        },
        { initTimeoutMs: 10_000 },
      );
      if (!initOutcome.ok) {
        throw new Error(`${participantId} failed to initialize: ${initOutcome.detail}`);
      }
    }

    const outcome = await runMatch({
      game,
      config,
      participantIds: roster,
      rng: matchRng,
      collector: new DockerActionCollector(lifecycles),
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: MATCH_DEADLINE_MS,
    });

    const matchEndPayload =
      outcome.status === 'completed'
        ? { result: outcome.result, reason: 'completed' as const }
        : { result: null, reason: 'aborted' as const };
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) => lifecycle.finish(matchEndPayload)),
    );

    return {
      status: outcome.status,
      events: outcome.events,
      standingOutcomes: outcome.standingOutcomes,
      // Omit the key entirely when absent, rather than setting it to `undefined` — required by
      // tsconfig.base.json's `exactOptionalPropertyTypes`.
      ...(outcome.forfeitedParticipantIds !== undefined
        ? { forfeitedParticipantIds: outcome.forfeitedParticipantIds }
        : {}),
    };
  } catch (error) {
    // Whatever went wrong — a sibling's container failing to start, a bot failing to
    // initialize, or `runMatch()` itself throwing — every lifecycle tracked so far still gets
    // torn down. `finish()` on an already-terminated lifecycle (e.g. the one whose own
    // `initialize()` just failed) is a safe no-op, so this needs no special-casing per failure.
    await Promise.all(
      [...lifecycles.values()].map((lifecycle) =>
        lifecycle.finish({ result: null, reason: 'aborted' }),
      ),
    );
    throw error;
  } finally {
    for (const lifecycle of lifecycles.values()) {
      activeLifecycles.delete(lifecycle);
    }
  }
}

export interface RunHumanMatchArgs {
  game: AnyGameDefinition;
  gameEntry: GameRegistryEntry;
  config: unknown;
  matchId: string;
  humanParticipantId: string;
  botParticipantId: string;
  botImageTag: string;
  /** The tournament's one entropy boundary (ADR-0004) — everything else derives from this. */
  tournamentSeed: Buffer;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * A human, unlike a Docker container, sets their own pace — this is a generous outer bound
 * against a genuinely abandoned session (docs/adr/0003's whole-match wall-clock safety net,
 * `runSingleMatch`'s own `MATCH_DEADLINE_MS` above), not a per-turn deadline. The human's own
 * `TerminalHumanCollector.requestAction` never times out on its own.
 */
const HUMAN_MATCH_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

/** `thunderdome play`'s single-bot, single-human counterpart to `runSingleMatch` — one real
 * Docker container for the bot, one `TerminalHumanCollector` prompting a real terminal for the
 * human, driven through the same `runMatch()` loop either way. */
export async function runHumanMatch(args: RunHumanMatchArgs): Promise<SingleMatchOutcome> {
  const {
    game,
    gameEntry,
    config,
    matchId,
    humanParticipantId,
    botParticipantId,
    botImageTag: imageTag,
    tournamentSeed,
    input,
    output,
  } = args;
  const roster = [humanParticipantId, botParticipantId];
  const matchRng = createRng(deriveSeed(tournamentSeed, 'match', matchId));

  const botProcess = new DockerBotProcess({
    imageRef: imageTag,
    matchId,
    participantId: botParticipantId,
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });
  activeLifecycles.add(lifecycle);

  const collector = new TerminalHumanCollector({
    humanParticipantId,
    game,
    fallback: new DockerActionCollector(new Map([[botParticipantId, lifecycle]])),
    // Omitted entirely when absent, rather than set to `undefined` — required by
    // tsconfig.base.json's `exactOptionalPropertyTypes`.
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  });

  try {
    const rngSeedHex = seedToHex(deriveSeed(tournamentSeed, 'bot', matchId, botParticipantId));
    const initOutcome = await lifecycle.initialize(
      {
        gameId: gameEntry.manifest.id,
        gameVersion: gameEntry.manifest.version,
        participantId: botParticipantId,
        roster,
        rngSeed: rngSeedHex,
        config,
      },
      { initTimeoutMs: 10_000 },
    );
    if (!initOutcome.ok) {
      throw new Error(`${botParticipantId} failed to initialize: ${initOutcome.detail}`);
    }

    const outcome = await runMatch({
      game,
      config,
      participantIds: roster,
      rng: matchRng,
      collector,
      defaultDeadlineMs: 5_000,
      matchDeadlineMs: HUMAN_MATCH_DEADLINE_MS,
    });

    const matchEndPayload =
      outcome.status === 'completed'
        ? { result: outcome.result, reason: 'completed' as const }
        : { result: null, reason: 'aborted' as const };
    await lifecycle.finish(matchEndPayload);

    return {
      status: outcome.status,
      events: outcome.events,
      standingOutcomes: outcome.standingOutcomes,
      ...(outcome.forfeitedParticipantIds !== undefined
        ? { forfeitedParticipantIds: outcome.forfeitedParticipantIds }
        : {}),
    };
  } catch (error) {
    await lifecycle.finish({ result: null, reason: 'aborted' });
    throw error;
  } finally {
    activeLifecycles.delete(lifecycle);
    collector.close();
  }
}
