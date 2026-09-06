import type { StockMarket2EventType } from '../types.js';

/** A single real daily bar from `denn-prices.json`. */
export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A single real, dated 8-K filing from `denn-filings.json` — raw SEC item codes, nothing
 * interpreted yet. */
export interface FilingRecord {
  date: string;
  items: string[];
}

export interface DerivedEvent {
  date: string;
  type: StockMarket2EventType;
}

/**
 * Real-data-grounded event classification (see `docs/guides/game-authoring-guide.md`-style
 * reasoning captured in the plan this was built from — summarized here since it's the load-
 * bearing logic of this whole game):
 *
 * - Item `2.02` ("Results of Operations and Financial Condition") is a real earnings release date
 *   -> EARNINGS_BEAT/MISS, signed by the real realized price reaction. This is the standard real-
 *   world proxy for "beat expectations" in the absence of a historical analyst-consensus feed —
 *   verified against a real DENN earnings press release directly, whose own reported language
 *   (GAAP net income down 9.5% YoY alongside same-store-sales growth and adjusted EPS up 28%)
 *   doesn't reduce cleanly to beat/miss on its own; the market's real reaction is itself real data,
 *   not a fabrication.
 * - Purely procedural item codes never get sentiment-labeled — a shareholder vote result or a
 *   bylaw amendment carries no real directional content, so it's `NO_NEWS`, not manufactured news.
 * - Item codes with a well-established negative-by-convention real-world reading (terminating a
 *   material agreement, a delisting/listing-rule notice) default to `NEGATIVE_NEWS`.
 * - Everything else context-dependent only becomes `POSITIVE_NEWS`/`NEGATIVE_NEWS` when the real
 *   reaction around that date is statistically outsized versus DENN's own normal volatility —
 *   "a filing happened but the market shrugged" is a real, correct `NO_NEWS`, not a gap to paper
 *   over. An outsized real reaction always overrides the negative-by-convention default too — this
 *   is what correctly classifies DENN's real 2026-01-16 delisting filing (item `3.01`, negative by
 *   convention) as `POSITIVE_NEWS`: that filing coincided with the real going-private acquisition,
 *   and the real market's reaction (recall: the actual jump happened on the 2025-11-04
 *   announcement, not the 2026-01-16 completion date — see `reactionReturn` below) is what should
 *   win, not the bare item code.
 */

/** Never independently informative — a Reg-FD disclosure wrapper and the "see attached exhibits"
 * bookkeeping item. Always stripped before classifying what a filing actually represents. */
const WRAPPER_CODES = new Set(['7.01', '9.01']);

/** Purely administrative/procedural — carries no real directional content on its own. */
const PROCEDURAL_CODES = new Set(['5.03', '5.07']);

/** Well-established negative-by-convention real-world reading. */
const NEGATIVE_DEFAULT_CODES = new Set(['1.02', '3.01']);

/** Genuinely context-dependent — only promoted to news when the real reaction is outsized.
 * `3.03` (material modification of security-holder rights) and `2.01`/`5.01` (asset
 * disposition/change of control) are the codes a real going-private acquisition's closing filing
 * actually carries alongside `3.01`. */
const CONTEXT_DEPENDENT_CODES = new Set(['1.01', '2.01', '2.03', '3.03', '5.01', '5.02', '8.01']);

/** How many real trailing daily log-returns to measure "normal" DENN volatility from, ending the
 * day before the day being classified (so the day's own move never contaminates its own
 * baseline). Falls back to whatever's available (down to `MIN_TRAILING_WINDOW`) near the start of
 * the series. */
const TRAILING_VOLATILITY_WINDOW = 60;
const MIN_TRAILING_WINDOW = 10;

/** A real reaction beyond this many trailing-volatility standard deviations counts as "outsized"
 * — the market treating a context-dependent filing as real news, not routine. Mid-point of the
 * 1.5-2 sigma range this was planned against. */
const OUTSIZED_SIGMA_THRESHOLD = 1.75;

/** Indexes into a same-length parallel array. Every call site here is bounds-safe by
 * construction (loop bounds, or an explicit length check just before the call) — see each call
 * site — so an out-of-bounds hit means that invariant broke, not a normal runtime condition. */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`index ${String(index)} out of bounds (length ${String(items.length)})`);
  }
  return value;
}

function dailyLogReturns(prices: readonly PriceBar[]): number[] {
  const returns: number[] = [0];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(at(prices, i).close / at(prices, i - 1).close));
  }
  return returns;
}

function trailingStdDev(returns: readonly number[], endExclusive: number): number {
  const start = Math.max(1, endExclusive - TRAILING_VOLATILITY_WINDOW);
  const window = returns.slice(start, endExclusive);
  if (window.length < MIN_TRAILING_WINDOW) {
    return 0.02; // a reasonable default daily-volatility estimate; only reached for the first
    // handful of days in the whole dataset, when there isn't yet enough real trailing history.
  }
  const mean = window.reduce((sum, r) => sum + r, 0) / window.length;
  const variance = window.reduce((sum, r) => sum + (r - mean) ** 2, 0) / window.length;
  return Math.sqrt(variance);
}

/**
 * The real reaction "around" day `i` — checking both the same-day move (`close[i-1] -> close[i]`)
 * and the next-day move (`close[i] -> close[i+1]`) and taking whichever is larger in magnitude.
 * This isn't optional: DENN's real 2025-11-04 merger-announcement filing moved the price the same
 * day (close $4.11 -> $6.18, filed/disclosed during that trading session), not the next day — a
 * pure "look at tomorrow's close" rule would have missed the single largest real move in the
 * entire dataset. Falls back to whichever side actually exists at the two ends of the series.
 */
function reactionReturn(returns: readonly number[], i: number): number {
  const sameDay = at(returns, i); // close[i-1] -> close[i]; 0 (by construction) for i === 0
  const nextDay = i + 1 < returns.length ? at(returns, i + 1) : sameDay; // close[i] -> close[i+1]
  return Math.abs(nextDay) > Math.abs(sameDay) ? nextDay : sameDay;
}

function classifyFiling(
  items: readonly string[],
  reaction: number,
  isOutsized: boolean,
): StockMarket2EventType {
  const itemSet = new Set(items);
  const substantive = [...itemSet].filter((code) => !WRAPPER_CODES.has(code));
  if (substantive.length === 0 || substantive.every((code) => PROCEDURAL_CODES.has(code))) {
    return 'NO_NEWS';
  }

  const hasEarnings = itemSet.has('2.02');
  if (hasEarnings) {
    // A real earnings release that coincided with some other real, substantive disclosure the
    // same day *and* produced an outsized real reaction is a case where the other disclosure is
    // almost certainly the real driver, not the routine quarterly numbers — this is exactly
    // DENN's real 2025-11-04 filing (a genuine merger announcement, item 1.01/8.01, that happened
    // to land on a scheduled earnings date; the real +50% same-day jump was the acquisition news,
    // not the quarter). A routine earnings reaction, even a large one, with nothing else riding
    // along still reads as EARNINGS_BEAT/MISS, not general news.
    const somethingElseHappened = substantive.some((code) => code !== '2.02');
    if (!(isOutsized && somethingElseHappened)) {
      return reaction > 0 ? 'EARNINGS_BEAT' : 'EARNINGS_MISS';
    }
  }

  // An outsized real reaction is the most direct real signal available and overrides the bare
  // category default — this is what would classify a delisting-adjacent filing (item 3.01,
  // negative by convention) by its real context instead of the naive default, on whichever real
  // day the market actually reacted to it.
  if (isOutsized) {
    return reaction > 0 ? 'POSITIVE_NEWS' : 'NEGATIVE_NEWS';
  }

  if (substantive.some((code) => NEGATIVE_DEFAULT_CODES.has(code))) {
    return 'NEGATIVE_NEWS';
  }

  // Remaining case: only a mix of PROCEDURAL_CODES/CONTEXT_DEPENDENT_CODES survived (the
  // all-procedural case already returned NO_NEWS above), with no outsized reaction to confirm
  // direction — a filing the market didn't actually react to strongly is correctly NO_NEWS, not
  // manufactured sentiment. Defensively confirm every surviving code is one this function
  // actually knows how to categorize — an unrecognized real item code (e.g. a future amendment to
  // Form 8-K itself) should fail loudly here rather than silently falling through to NO_NEWS.
  const unrecognized = substantive.filter(
    (code) => !PROCEDURAL_CODES.has(code) && !CONTEXT_DEPENDENT_CODES.has(code),
  );
  if (unrecognized.length > 0) {
    throw new Error(`events.ts: unrecognized 8-K item code(s): ${unrecognized.join(', ')}`);
  }
  return 'NO_NEWS';
}

/**
 * Builds one event classification per real trading day in `prices` (same order/length), using
 * only the two raw real fixtures — no RNG, no config, fully deterministic. `game.ts` reads the
 * *committed snapshot* this produces (`denn-events.json`) at runtime rather than calling this
 * live; `test/events.test.ts`'s golden-file test is what keeps the two in sync.
 */
export function buildEventSeries(
  prices: readonly PriceBar[],
  filings: readonly FilingRecord[],
): DerivedEvent[] {
  const filingsByDate = new Map(filings.map((filing) => [filing.date, filing.items]));
  const returns = dailyLogReturns(prices);

  return prices.map((bar, i) => {
    const items = filingsByDate.get(bar.date);
    if (items === undefined) {
      return { date: bar.date, type: 'NO_NEWS' as const };
    }
    const reaction = reactionReturn(returns, i);
    const isOutsized = Math.abs(reaction) > OUTSIZED_SIGMA_THRESHOLD * trailingStdDev(returns, i);
    return { date: bar.date, type: classifyFiling(items, reaction, isOutsized) };
  });
}
