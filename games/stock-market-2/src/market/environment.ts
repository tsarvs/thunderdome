import type { Rng } from '@thunderdome/engine';
import type { DailyMarketConditions } from '../types.js';

/**
 * The market-environment boundary (spec §33/§34): responsible for *where the day's conditions
 * come from* — synthetic simulation or real historical replay — and nothing else. It never knows
 * about order books, matching, liquidity, or portfolios; `exchange/` and the portfolio logic in
 * `game.ts` never know whether they're trading against a synthetic or historical environment.
 * This is the seam Phase 4 (hidden fundamental value, regimes, event-impact modeling) will extend
 * without touching the exchange at all.
 */
export interface MarketEnvironment {
  /**
   * Conditions for `round` (0-based). `lastRealizedCloseCents` is the previous round's actual
   * realized close from the exchange (see `exchange/candle.ts`) — SYNTHETIC mode's placeholder
   * random walk uses it as this round's starting point; HISTORICAL mode ignores it entirely and
   * instead advances to the next *real* trading day, deliberately decoupled from whatever the
   * simulated exchange actually closed at (spec §31: historical data drives the environment, the
   * environment does not get rewritten by simulated trades). Unused for `round === 0`.
   */
  conditionsFor(args: { round: number; rng: Rng; lastRealizedCloseCents: number }): DailyMarketConditions;
}
