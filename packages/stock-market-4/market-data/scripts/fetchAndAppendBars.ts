/**
 * Deterministic, no-LLM price ingestion: fetches real daily bars from Yahoo Finance's public
 * chart API and appends them to an already-published dataset via `appendBars` — the replacement
 * for asking an AI agent to browse/gather prices by hand each time. Auto-detects each ticker's
 * own gap (`queryLatestKnownDate`), so it's safe to just re-run this daily/whenever with no date
 * arguments at all.
 *
 * BACKGROUND (why this exists, and why it validates currency so aggressively): an earlier manual
 * gap-fill for this exact dataset wrote FUJIKURA/SUMITOMO/FURUKAWA/VITZRONEXTECH/FREEM's bars in
 * their RAW native currency (JPY/KRW/SEK) instead of USD, silently breaking continuity with the
 * rest of the (USD) dataset — a ~150x price discontinuity for the JPY tickers. That required
 * republishing a corrected dataset version. This script hard-codes each ticker's expected
 * currency and conversion rate (the SAME flat per-ticker rate already established in
 * `bots/stock-market-4/fusion-fundamental-v0/backtest/*HistoricalPrices.ts` — reused, not
 * re-derived, for consistency with a ticker's own existing history) and REFUSES to write a bar
 * whose fetched currency doesn't match what's configured, rather than silently trusting the API's
 * response — see `TICKERS` and the currency check in `fetchTicker` below.
 *
 * Usage:
 *   yarn workspace @thunderdome/market-data run fetch:append-bars -- \
 *     --dataset-id fusion-fundamental-v0 --dataset-version 4 [--tickers KMT,AMSC,...] \
 *     [--through 2026-09-11] [--store-dir <dir>] [--dry-run]
 */
import { resolve } from 'node:path';
import { TRACKED_SECURITIES } from '@thunderdome/fusion-universe';
import { appendBars } from '../src/store/append.js';
import { createMarketDataStore } from '../src/store/db.js';
import { queryLatestKnownDate, queryTickers } from '../src/store/queries.js';
import type { DailyBar } from '../src/schema/dailyBar.js';
import { DEFAULT_STORE_DIR } from './seedFusionFundamentalV0.js';

/**
 * One entry per ticker this script knows how to fetch. `yahooSymbol` is Yahoo Finance's own
 * ticker spelling (differs from ours for every non-US listing); `currency`/`usdRate` describe
 * what to expect and how to convert — `usdRate: 1` for an already-USD ticker (still validated
 * against the fetched `meta.currency`, so a source starting to report something unexpected is
 * caught immediately rather than silently trusted).
 */
interface TickerSource {
  yahooSymbol: string;
  currency: string;
  /** Multiply a native-currency price by this to get USD. Same flat, single-rate convention as
   * this dataset's own seed files — NOT refreshed to "today's" FX rate on every run, so a
   * ticker's whole history stays internally consistent. */
  usdRate: number;
}

// Derived from `@thunderdome/fusion-universe`'s `TRACKED_SECURITIES` — the shared source of truth
// with `@thunderdome/research-fusion` (see that package's `scope.ts`) — rather than a second
// hand-copied 11-ticker table living only here.
export const TICKERS: Record<string, TickerSource> = Object.fromEntries(
  TRACKED_SECURITIES.map((security) => [
    security.ticker,
    { yahooSymbol: security.yahooSymbol, currency: security.currency, usdRate: security.usdRate },
  ]),
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toCalendarDate(unixSeconds: number, gmtoffsetSeconds: number): string {
  // Yahoo's per-bar timestamp is the exchange's own local session time; shifting by the
  // exchange's own UTC offset before slicing (rather than slicing the raw UTC instant) gets the
  // LOCAL calendar date a naive UTC slice could get wrong right at a UTC day boundary.
  return new Date((unixSeconds + gmtoffsetSeconds) * 1000).toISOString().slice(0, 10);
}

interface FetchedBars {
  ticker: string;
  bars: DailyBar[];
}

async function fetchTicker(
  ticker: string,
  source: TickerSource,
  sinceDate: string,
  throughDate: string,
): Promise<FetchedBars> {
  const period1 = Math.floor(new Date(`${sinceDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${throughDate}T23:59:59Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(source.yahooSymbol)}?period1=${String(period1)}&period2=${String(period2)}&interval=1d`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) {
    throw new Error(
      `${ticker}: Yahoo Finance request failed (${String(response.status)} ${response.statusText})`,
    );
  }
  const json = (await response.json()) as {
    chart: {
      result: {
        meta: { currency: string; gmtoffset: number };
        timestamp?: number[];
        indicators: {
          quote: {
            open: (number | null)[];
            high: (number | null)[];
            low: (number | null)[];
            close: (number | null)[];
            volume: (number | null)[];
          }[];
        };
      }[];
      error: unknown;
    };
  };
  const result = json.chart.result[0];
  if (result === undefined) {
    throw new Error(`${ticker}: no chart data returned (${JSON.stringify(json.chart.error)})`);
  }
  // The whole point of this check (see this file's own module doc comment): never trust that a
  // fetched bar is in the currency we expect just because we asked for it that way.
  if (result.meta.currency !== source.currency) {
    throw new Error(
      `${ticker}: expected currency "${source.currency}" but Yahoo Finance reports "${result.meta.currency}" — refusing to guess a conversion.`,
    );
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators.quote[0];
  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote?.open[i];
    const high = quote?.high[i];
    const low = quote?.low[i];
    const close = quote?.close[i];
    const volume = quote?.volume[i];
    // Yahoo pads a day it has no real data for (e.g. still in progress) with nulls — skip rather
    // than fabricate.
    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      continue;
    }
    const timestamp = timestamps[i];
    if (timestamp === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
    const date = toCalendarDate(timestamp, result.meta.gmtoffset);
    if (date < sinceDate) continue; // defensive; period1 already excludes these
    bars.push({
      date,
      open: round2(open * source.usdRate),
      high: round2(high * source.usdRate),
      low: round2(low * source.usdRate),
      close: round2(close * source.usdRate),
      volume: Math.round(volume),
    });
  }
  return { ticker, bars };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const datasetId = args['dataset-id'];
  const datasetVersion = args['dataset-version'];
  if (typeof datasetId !== 'string' || typeof datasetVersion !== 'string') {
    console.error(
      'Usage: fetch:append-bars -- --dataset-id <id> --dataset-version <version> ' +
        '[--tickers T1,T2,...] [--through YYYY-MM-DD] [--store-dir <dir>] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }
  const storeDir = typeof args['store-dir'] === 'string' ? args['store-dir'] : DEFAULT_STORE_DIR;
  const through =
    typeof args.through === 'string' ? args.through : new Date().toISOString().slice(0, 10);
  const dryRun = args['dry-run'] === true;

  const dbPath = resolve(storeDir, `${datasetId}.sqlite`);
  const store = createMarketDataStore(dbPath);
  const identity = { id: datasetId, version: datasetVersion };

  const requestedTickers =
    typeof args.tickers === 'string' ? args.tickers.split(',') : queryTickers(store, identity);

  const results: FetchedBars[] = [];
  for (const ticker of requestedTickers) {
    const source = TICKERS[ticker];
    if (source === undefined) {
      console.error(
        `${ticker}: no Yahoo Finance mapping configured in this script's TICKERS table — skipped.`,
      );
      continue;
    }
    const latestKnown = queryLatestKnownDate(store, identity, ticker);
    const sinceDate =
      latestKnown === null
        ? through // unknown ticker in this dataset — nothing to append from here, only via publishDatasetVersion
        : new Date(new Date(`${latestKnown}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
    if (latestKnown !== null && sinceDate > through) {
      console.log(`${ticker}: already known through ${latestKnown} — nothing new to fetch.`);
      continue;
    }
    if (latestKnown === null) {
      console.error(
        `${ticker}: not yet published in dataset "${datasetId}" version "${datasetVersion}" — publish it first, this script only grows an existing ticker.`,
      );
      continue;
    }
    try {
      const fetched = await fetchTicker(ticker, source, sinceDate, through);
      if (fetched.bars.length === 0) {
        console.log(`${ticker}: no new real trading days found in ${sinceDate}..${through}.`);
        continue;
      }
      results.push(fetched);
      const firstBar = fetched.bars[0];
      const lastBar = fetched.bars.at(-1);
      if (firstBar === undefined || lastBar === undefined) {
        throw new Error(
          `${ticker}: unreachable — fetched.bars.length was already checked to be > 0`,
        );
      }
      console.log(
        `${ticker}: fetched ${String(fetched.bars.length)} bar(s), ${firstBar.date} through ${lastBar.date}`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (results.length === 0) {
    console.log('\nNothing to append.');
    return;
  }
  if (dryRun) {
    console.log(
      '\n--dry-run: not appending. Bars found:',
      JSON.stringify(Object.fromEntries(results.map((r) => [r.ticker, r.bars])), null, 2),
    );
    return;
  }

  const bars = Object.fromEntries(results.map((r) => [r.ticker, r.bars]));
  const appendResult = appendBars(store, identity, { bars });
  if (!appendResult.ok) {
    console.error(appendResult.reason);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAppended to dataset "${datasetId}" version "${datasetVersion}" in ${storeDir}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
