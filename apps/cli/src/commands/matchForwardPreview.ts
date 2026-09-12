// `thunderdome match forward preview` — a read-only "what would the bot do right now, compared to
// what it would have done at the config this match was created/last configured with" check for a
// FORWARD_SHADOW match. Never mutates or persists anything: no `ForwardMatchRecord` write, no
// round resolved. See docs/adr/0013-forward-match-persistence.md for the forward-match lifecycle
// this reads from, and this file's own module doc comment below for why the comparison is framed
// as "stored config" vs. "a freshly supplied one," not "this morning" vs. "this instant."
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadForwardMatchRecord } from '@thunderdome/forward-match-store';
import { generateTournamentSeed } from '@thunderdome/rng';
import { DockerActionCollector } from '@thunderdome/runtime';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  startBotLifecycles,
  untrackLifecycles,
} from '../lib/match-execution.js';

function defaultForwardMatchStoreDir(rootDir: string): string {
  return path.join(rootDir, '.thunderdome', 'forward-matches');
}

interface ForwardResumableGameModule {
  resumeForwardState: (args: {
    config: unknown;
    participantIds: readonly string[];
    snapshot: unknown;
  }) => unknown;
}

function isForwardResumableGameModule(value: unknown): value is ForwardResumableGameModule {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).resumeForwardState === 'function';
}

/** Duck-types `{orders: {ticker: string, ...}[]}` out of an otherwise-opaque game action —
 * `AnyGameDefinition` erases the action type, and this command stays game-agnostic the same way
 * `matchForward.ts` duck-types `ForwardResumableGameModule` rather than importing SM4 types. A
 * game whose action doesn't look like this just gets an empty diff, not a crash. */
function ordersByTicker(action: unknown): Map<string, unknown> {
  const byTicker = new Map<string, unknown>();
  if (typeof action !== 'object' || action === null) return byTicker;
  const orders = (action as Record<string, unknown>).orders;
  if (!Array.isArray(orders)) return byTicker;
  for (const order of orders) {
    if (typeof order === 'object' && order !== null && typeof (order as Record<string, unknown>).ticker === 'string') {
      byTicker.set((order as Record<string, unknown>).ticker as string, order);
    }
  }
  return byTicker;
}

const USAGE =
  'Usage: thunderdome match forward preview <matchId> --config-file <path> [--store-dir <path>]';

export interface MatchForwardPreviewOptions {
  rootDir: string;
}

/**
 * Compares the trading decision a match's bot(s) would make against two hypothetical configs for
 * the SAME already-persisted state (same portfolio/round/fills — this never resumes for real):
 * the match's own STORED config (frozen since it was created — a stand-in for "what was known at
 * market open," since nothing in this system updates an existing match's config after creation)
 * against a freshly supplied `--config-file` (e.g. re-run `emit:forward-config` against the
 * live research fixture right now — a stand-in for "what's knowable this instant," since new
 * research can be recorded between a match's creation and any later moment even though prices
 * themselves only ever update once a day). Both configs must describe the SAME
 * `marketDataUniverse`/`marketDataset`/`startDate` — this only ever varies `researchTimeline` (or
 * any other config field), never mutates the match record. Every bot container started here is
 * torn down before returning; nothing about the match itself changes.
 */
export async function runMatchForwardPreviewCommand(
  argv: readonly string[],
  options: MatchForwardPreviewOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { 'config-file': { type: 'string' }, 'store-dir': { type: 'string' } },
    allowPositionals: true,
  });
  const [matchId] = positionals;
  if (matchId === undefined || values['config-file'] === undefined) {
    console.error(USAGE);
    return 1;
  }
  const storeDir = values['store-dir'] ?? defaultForwardMatchStoreDir(options.rootDir);

  const loadOutcome = await loadForwardMatchRecord(storeDir, matchId);
  if (loadOutcome.status !== 'found') {
    console.error(
      loadOutcome.status === 'corrupt' ? loadOutcome.reason : `No forward match record found for "${matchId}".`,
    );
    return 1;
  }
  const { record } = loadOutcome;

  let freshConfigString: string;
  try {
    freshConfigString = await readFile(values['config-file'], 'utf8');
  } catch (error) {
    console.error(`Could not read --config-file "${values['config-file']}": ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  let freshConfigRaw: unknown;
  try {
    freshConfigRaw = JSON.parse(freshConfigString);
  } catch (error) {
    console.error(`--config-file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, record.participantIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;
  const game = await loadGame(gameEntry);
  const gameModule: unknown = await import(gameEntry.manifest.entryPackage);
  if (!isForwardResumableGameModule(gameModule)) {
    console.error(`"${gameEntry.manifest.entryPackage}" does not export resumeForwardState.`);
    return 1;
  }

  const storedConfigResult = game.parseConfig(record.config);
  if (!storedConfigResult.ok) {
    console.error(`Match "${matchId}"'s own stored config is no longer valid: ${storedConfigResult.reason}`);
    return 1;
  }
  const freshConfigResult = game.parseConfig(freshConfigRaw);
  if (!freshConfigResult.ok) {
    console.error(`Invalid --config-file: ${freshConfigResult.reason}`);
    return 1;
  }

  const stateOpen = gameModule.resumeForwardState({
    config: storedConfigResult.value,
    participantIds: record.participantIds,
    snapshot: record.snapshot,
  });
  const stateNow = gameModule.resumeForwardState({
    config: freshConfigResult.value,
    participantIds: record.participantIds,
    snapshot: record.snapshot,
  });

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  for (const participantId of record.participantIds) {
    const observationOpen = game.getObservation(stateOpen, participantId);
    const observationNow = game.getObservation(stateNow, participantId);
    const observedDate = (observationNow as { date?: string | null } | null)?.date ?? null;
    if (observedDate === null) {
      // Distinct from "no orders under either scenario" below — that means the bot looked at a
      // real round and chose to do nothing; this means there's no NEW round to decide at all yet
      // (this match has already played every day its dataset currently knows about), so the two
      // hypotheticals trivially agree with nothing to compare.
      console.log(
        `\n${participantId}: no round to preview yet — this match has already played every ` +
          `trading day its dataset currently knows about.`,
      );
      continue;
    }

    // One freshly-started container per hypothetical, never reused between the two calls: a bot
    // may keep its own in-process hysteresis/previous-state between decisions (e.g.
    // fusion-fundamental-v6's `previousByTicker` — see its own doc comment), which would leak the
    // "at open" call's output into the "now" call's baseline if the same running container
    // answered both. Matches how a real resumed `match forward run` invocation already starts a
    // brand-new container per invocation, with no memory of an earlier invocation's decisions.
    const openLifecycles = await startBotLifecycles({
      game,
      gameEntry,
      config: storedConfigResult.value,
      matchId: `${matchId}-preview-open`,
      participantIds: [participantId],
      imageTagsByBotId,
      tournamentSeed: generateTournamentSeed(),
    });
    let openAction: unknown;
    try {
      const outcome = await new DockerActionCollector(openLifecycles).requestAction({
        participantId,
        roundId: (stateOpen as { round: number }).round,
        observation: observationOpen,
        deadlineMs: 5_000,
        required: true,
      });
      openAction = outcome.ok ? outcome.action : undefined;
    } finally {
      await Promise.all([...openLifecycles.values()].map((lifecycle) => lifecycle.finish({ result: null, reason: 'aborted' })));
      untrackLifecycles(openLifecycles);
    }

    const nowLifecycles = await startBotLifecycles({
      game,
      gameEntry,
      config: freshConfigResult.value,
      matchId: `${matchId}-preview-now`,
      participantIds: [participantId],
      imageTagsByBotId,
      tournamentSeed: generateTournamentSeed(),
    });
    let nowAction: unknown;
    try {
      const outcome = await new DockerActionCollector(nowLifecycles).requestAction({
        participantId,
        roundId: (stateNow as { round: number }).round,
        observation: observationNow,
        deadlineMs: 5_000,
        required: true,
      });
      nowAction = outcome.ok ? outcome.action : undefined;
    } finally {
      await Promise.all([...nowLifecycles.values()].map((lifecycle) => lifecycle.finish({ result: null, reason: 'aborted' })));
      untrackLifecycles(nowLifecycles);
    }

    const openOrders = ordersByTicker(openAction);
    const nowOrders = ordersByTicker(nowAction);
    const tickers = new Set([...openOrders.keys(), ...nowOrders.keys()]);

    console.log(`\n${participantId}:`);
    if (tickers.size === 0) {
      console.log('  No orders under either scenario — no change.');
      continue;
    }
    for (const ticker of tickers) {
      const openOrder = openOrders.get(ticker);
      const nowOrder = nowOrders.get(ticker);
      const changed = JSON.stringify(openOrder) !== JSON.stringify(nowOrder);
      console.log(
        `  ${ticker}: at stored config -> ${JSON.stringify(openOrder) ?? 'none'}; right now -> ` +
          `${JSON.stringify(nowOrder) ?? 'none'}${changed ? '  [CHANGED]' : ''}`,
      );
    }
  }

  return 0;
}
