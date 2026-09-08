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

/** Renders one trade as a human-readable line, or `null` if `trade` isn't shaped like one (in
 * which case the caller falls back to a raw dump). Both Stock Market 2
 * (games/stock-market-2/src/types.ts) and Stock Market 3 (games/stock-market-3/src/types.ts) emit
 * this same `Trade` shape — `buyerParticipantId`/`sellerParticipantId` (`null` means the other
 * side was synthetic external liquidity, not another participant), `priceCents`, `quantity`, an
 * optional `symbol` (only Stock Market 3 has more than one), and an optional `forced` flag (a
 * margin-call liquidation rather than the participant's own order). Read generically off
 * `unknown` rather than importing either game's types, so this stays game-agnostic. */
function describeTrade(trade: unknown): string | null {
  if (typeof trade !== 'object' || trade === null) {
    return null;
  }
  const { buyerParticipantId, sellerParticipantId, priceCents, quantity, symbol, forced } =
    trade as Record<string, unknown>;
  if (typeof priceCents !== 'number' || typeof quantity !== 'number') {
    return null;
  }
  const price = `$${(priceCents / 100).toFixed(2)}`;
  const symbolLabel = typeof symbol === 'string' ? `${symbol} ` : '';
  const forcedLabel = forced === true ? ' (forced liquidation)' : '';
  if (typeof buyerParticipantId === 'string') {
    const counterparty = typeof sellerParticipantId === 'string' ? sellerParticipantId : 'the market';
    return `${buyerParticipantId} bought ${String(quantity)} ${symbolLabel}@ ${price} from ${counterparty}${forcedLabel}`;
  }
  if (typeof sellerParticipantId === 'string') {
    return `${sellerParticipantId} sold ${String(quantity)} ${symbolLabel}@ ${price} to the market${forcedLabel}`;
  }
  return null;
}

/** Reads a round's trades off `data.trades`/`data.forcedLiquidations` generically (the shape both
 * Stock Market 2 and Stock Market 3's `round-result` events carry) and renders each as one
 * human-readable line. Returns `null` — meaning "not recognized" — for any other game's event
 * data, so `printRoundEvents` falls back to its original raw dump for those. */
function describeTradesFor(data: unknown): string[] | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { trades, forcedLiquidations } = data as Record<string, unknown>;
  if (!Array.isArray(trades) && !Array.isArray(forcedLiquidations)) {
    return null;
  }
  // `Array.isArray` is typed as `(arg: any) => arg is any[]`, so narrowing an `unknown` through it
  // still yields `any[]` — these explicit `unknown[]` annotations are what keep that `any` from
  // leaking into `all` below (an unsafe spread otherwise).
  const tradesArray: unknown[] = Array.isArray(trades) ? trades : [];
  const forcedLiquidationsArray: unknown[] = Array.isArray(forcedLiquidations) ? forcedLiquidations : [];
  const all = [...tradesArray, ...forcedLiquidationsArray];
  const lines: string[] = [];
  for (const trade of all) {
    const line = describeTrade(trade);
    if (line !== null) {
      lines.push(line);
    }
  }
  return lines;
}

export function printRoundEvents(events: RoundEvent[][]): void {
  if (events.length > MAX_ROUNDS_TO_PRINT_INDIVIDUALLY) {
    console.log(`  (${String(events.length)} rounds played)`);
    return;
  }
  events.forEach((rounds, roundIndex) => {
    for (const event of rounds) {
      const tradeLines = describeTradesFor(event.data);
      if (tradeLines === null) {
        console.log('  round-result:', event.data);
        continue;
      }
      if (tradeLines.length === 0) {
        continue; // nothing traded this round — skip rather than print an empty header
      }
      console.log(`  Round ${String(roundIndex)}:`);
      for (const line of tradeLines) {
        console.log(`    ${line}`);
      }
    }
  });
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

/** Same "read it generically off `result`" idiom as `printHandsPlayed` above — a game's result
 * gets this line whether it carries `startingStockPrice`/`finalStockPrice` (Stock Market,
 * games/stock-market/src/types.ts), `startingPrice`/`finalPrice` (Stock Market 2,
 * games/stock-market-2/src/types.ts — renamed since that result also covers a SYNTHETIC-mode
 * ticker that isn't literally "the stock"), or `indexStartingPrice`/`indexFinalPrice` (Stock
 * Market 3, games/stock-market-3/src/types.ts — its own tradable index, not "the stock" either,
 * since there are several other securities alongside it). A no-op for every other game's result
 * shape. */
export function printStockPriceRange(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { startingStockPrice, finalStockPrice, startingPrice, finalPrice, indexStartingPrice, indexFinalPrice, indexSymbol } =
    result as Record<string, unknown>;
  const starting =
    typeof startingStockPrice === 'number'
      ? startingStockPrice
      : typeof startingPrice === 'number'
        ? startingPrice
        : indexStartingPrice;
  const final =
    typeof finalStockPrice === 'number' ? finalStockPrice : typeof finalPrice === 'number' ? finalPrice : indexFinalPrice;
  if (typeof starting === 'number' && typeof final === 'number') {
    const label = typeof indexSymbol === 'string' ? `${indexSymbol} price` : 'stock price';
    console.log(`  (${label}: $${starting.toFixed(2)} → $${final.toFixed(2)})`);
  }
}

/** Stock Market 3 (games/stock-market-3/src/types.ts) is the only game whose result currently
 * carries a `securityPrices` array — one entry per tradable security (including its own
 * synthetic index) with `symbol`/`startingPrice`/`finalPrice`. Read generically off `unknown` so
 * this stays a no-op for every other game's result shape, same idiom as `printStockPriceRange`. */
export function printSecurityPriceTable(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { securityPrices } = result as Record<string, unknown>;
  if (!Array.isArray(securityPrices) || securityPrices.length === 0) {
    return;
  }
  console.log('  Security prices (before -> after):');
  for (const entry of securityPrices) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { symbol, startingPrice, finalPrice } = entry as Record<string, unknown>;
    if (typeof symbol !== 'string' || typeof startingPrice !== 'number' || typeof finalPrice !== 'number') {
      continue;
    }
    const changePct = startingPrice !== 0 ? ((finalPrice - startingPrice) / startingPrice) * 100 : 0;
    const sign = changePct >= 0 ? '+' : '';
    console.log(`    ${symbol}: $${startingPrice.toFixed(2)} -> $${finalPrice.toFixed(2)} (${sign}${changePct.toFixed(1)}%)`);
  }
}

/** Same idiom, for Stock Market 3's `portfolioSummaries` (participantId -> cash/equity/positions
 * at match end). A no-op for every other game's result shape. */
export function printPortfolioSummaries(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { portfolioSummaries } = result as Record<string, unknown>;
  if (typeof portfolioSummaries !== 'object' || portfolioSummaries === null) {
    return;
  }
  const entries = Object.entries(portfolioSummaries as Record<string, unknown>);
  if (entries.length === 0) {
    return;
  }
  console.log('  Bot portfolios:');
  for (const [participantId, summaryRaw] of entries) {
    if (typeof summaryRaw !== 'object' || summaryRaw === null) {
      continue;
    }
    const { cash, equity, bankrupt, positions } = summaryRaw as Record<string, unknown>;
    if (typeof cash !== 'number' || typeof equity !== 'number') {
      continue;
    }
    const bankruptLabel = bankrupt === true ? ' [BANKRUPT]' : '';
    console.log(`    ${participantId}: equity $${equity.toFixed(2)}, cash $${cash.toFixed(2)}${bankruptLabel}`);
    if (!Array.isArray(positions) || positions.length === 0) {
      console.log('      (no open positions)');
      continue;
    }
    for (const positionRaw of positions) {
      if (typeof positionRaw !== 'object' || positionRaw === null) {
        continue;
      }
      const { symbol, shares, averageEntryPrice, marketValue, unrealizedPnl } = positionRaw as Record<string, unknown>;
      if (
        typeof symbol !== 'string' ||
        typeof shares !== 'number' ||
        typeof averageEntryPrice !== 'number' ||
        typeof marketValue !== 'number' ||
        typeof unrealizedPnl !== 'number'
      ) {
        continue;
      }
      const pnlSign = unrealizedPnl >= 0 ? '+' : '';
      console.log(
        `      ${symbol}: ${String(shares)} sh @ avg $${averageEntryPrice.toFixed(2)}, value $${marketValue.toFixed(2)} (${pnlSign}$${unrealizedPnl.toFixed(2)} unrealized)`,
      );
    }
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
  printStockPriceRange(outcome.result);
  printSecurityPriceTable(outcome.result);
  printPortfolioSummaries(outcome.result);
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
