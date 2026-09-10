import type { CorporateAction } from '../schema/corporateAction.js';
import type { CalendarDate, DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import { err, ok, type Result } from '../result.js';
import type { MarketDataStore } from '../store/db.js';
import {
  datasetVersionExists,
  queryBarsAsOf,
  queryCorporateActionsAsOf,
  queryTickers,
  queryTradingHolidays,
} from '../store/queries.js';

/**
 * The ONLY interface a consumer (a game engine) should ever hold — never the raw `MarketDataStore`
 * / `DatabaseSync`. Every method takes an explicit `asOfDate` and never returns a row dated after
 * it, mirroring `games/stock-market-4`'s own "as-of" idiom (`historicalBarsAsOf`,
 * `splitAdjustedBarsAsOf`, `visibleCorporateActions`) so this is a drop-in data source for those
 * existing, unchanged functions rather than a second, parallel implementation of point-in-time
 * filtering.
 */
export interface MarketDataProvider {
  readonly identity: MarketDatasetIdentity;
  /** Every ticker this dataset version has at least one bar for. */
  tickers(): string[];
  /** Every bar for `ticker` at or before `asOfDate`, oldest first, capped to the trailing
   * `maxDays`. */
  barsAsOf(ticker: string, asOfDate: CalendarDate, maxDays: number): DailyBar[];
  /** Every corporate action already public as of `asOfDate`, for `ticker` (or every ticker, when
   * `ticker` is `null`). */
  corporateActionsAsOf(ticker: string | null, asOfDate: CalendarDate): CorporateAction[];
  /** Every organizer-declared non-trading date for this dataset version. */
  tradingHolidays(): CalendarDate[];
}

/**
 * Builds a `MarketDataProvider` over an already-open `store`, scoped to one `(id, version)`.
 * Fails closed (`Result`, never throws) when that dataset version was never published — a match
 * config referencing a dataset that doesn't exist should error clearly at setup time, not
 * silently behave as an empty market.
 */
export function createSqliteMarketDataProvider(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
): Result<MarketDataProvider> {
  if (!datasetVersionExists(store, identity)) {
    return err(`dataset "${identity.id}" has no published version "${identity.version}"`);
  }
  return ok({
    identity,
    tickers: () => queryTickers(store, identity),
    barsAsOf: (ticker, asOfDate, maxDays) =>
      queryBarsAsOf(store, identity, ticker, asOfDate, maxDays),
    corporateActionsAsOf: (ticker, asOfDate) =>
      queryCorporateActionsAsOf(store, identity, ticker, asOfDate),
    tradingHolidays: () => queryTradingHolidays(store, identity),
  });
}
