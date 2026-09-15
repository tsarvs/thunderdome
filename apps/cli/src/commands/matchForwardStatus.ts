// `thunderdome match forward status` — a single read-only "what's stale" view across every
// active forward match: how far each match's own price data actually reaches per ticker (queried
// live from the market-data store its config points at, deduped across matches sharing a
// dataset), plus the research-fusion dataset's own freshness. Never mutates anything — pure reads,
// mirroring `list`/`inspect`'s own design.
import { parseArgs } from 'node:util';
import path from 'node:path';
import { listForwardMatchRecords, loadForwardMatchRecord } from '@thunderdome/forward-match-store';
import {
  createMarketDataStore,
  queryLatestKnownDate,
  queryTickers,
} from '@thunderdome/market-data';
import { createFusionFixtureDataset } from '@thunderdome/research-fusion';
import {
  defaultForwardMatchStoreDir,
  readForwardShadowFields,
} from '../lib/forwardShadowConfig.js';

export interface MatchForwardStatusOptions {
  rootDir: string;
}

function latestPriceDatesByTicker(
  dbPath: string,
  id: string,
  version: string,
): Map<string, string | null> {
  const store = createMarketDataStore(dbPath);
  const identity = { id, version };
  const result = new Map<string, string | null>();
  for (const ticker of queryTickers(store, identity)) {
    result.set(ticker, queryLatestKnownDate(store, identity, ticker));
  }
  return result;
}

/** The freshest calendar day appearing anywhere in a research dataset — same
 * `distinctDatasetDates` scan `@thunderdome/research-fusion`'s own `timeline.ts` uses internally
 * (not exported, so re-derived here rather than reaching into that package's private module). */
function latestResearchDate(dataset: unknown): string | undefined {
  const matches = JSON.stringify(dataset).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g) ?? [];
  return matches
    .map((t) => t.slice(0, 10))
    .sort()
    .at(-1);
}

export async function runMatchForwardStatusCommand(
  argv: readonly string[],
  options: MatchForwardStatusOptions,
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

  const priceCacheByKey = new Map<string, Map<string, string | null>>();

  for (const summary of summaries) {
    console.log(
      `\n${summary.matchId}  (${summary.status}, ${String(summary.roundsPlayed)} round(s), updated ${summary.updatedAt})`,
    );
    if (summary.status !== 'active') continue; // no price freshness to report for a finished match

    const outcome = await loadForwardMatchRecord(storeDir, summary.matchId);
    if (outcome.status !== 'found') continue; // already reported by `issues` below
    const fields = readForwardShadowFields(outcome.record.config);
    if (fields === undefined) {
      console.log('  config not recognized as FORWARD_SHADOW — no price freshness to report.');
      continue;
    }

    const { id, version, storeDir: marketStoreDir } = fields.marketDataset;
    const key = `${id}@${version}@${marketStoreDir ?? ''}`;
    let latestByTicker = priceCacheByKey.get(key);
    if (latestByTicker === undefined) {
      const dbDir =
        marketStoreDir !== undefined
          ? path.resolve(options.rootDir, marketStoreDir)
          : path.join(options.rootDir, '.thunderdome', 'market-data');
      try {
        latestByTicker = latestPriceDatesByTicker(path.join(dbDir, `${id}.sqlite`), id, version);
      } catch (error) {
        console.log(
          `  warning: could not read market-data store for "${id}"@${version}: ${error instanceof Error ? error.message : String(error)}`,
        );
        latestByTicker = new Map();
      }
      priceCacheByKey.set(key, latestByTicker);
    }

    const knownDates = fields.marketDataUniverse
      .map((ticker) => latestByTicker.get(ticker))
      .filter((date): date is string => typeof date === 'string');
    const maxDate =
      knownDates.length > 0 ? knownDates.reduce((a, b) => (a > b ? a : b)) : undefined;
    console.log(`  prices (${id}@${version}): latest known ${maxDate ?? 'unknown'}`);
    for (const ticker of fields.marketDataUniverse) {
      const date = latestByTicker.get(ticker);
      if (date === undefined)
        console.log(`    ${ticker}: no Yahoo Finance mapping / never fetched`);
      else if (date === null) console.log(`    ${ticker}: no bars yet`);
      else if (maxDate !== undefined && date < maxDate)
        console.log(`    ${ticker}: behind — latest ${date} (dataset's latest is ${maxDate})`);
    }
  }
  for (const issue of issues) {
    console.error(`warning: could not read ${issue.path}: ${issue.message}`);
  }

  try {
    const dataset = createFusionFixtureDataset();
    console.log(
      `\nResearch dataset "${dataset.id}" version "${dataset.version}": latest known development ${latestResearchDate(dataset) ?? 'unknown'}`,
    );
  } catch (error) {
    console.log(
      `\nwarning: could not read research-fusion dataset: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return 0;
}
