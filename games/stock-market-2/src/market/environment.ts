import type { Rng } from '@thunderdome/engine';
import type { DailyMarketConditions, MarketRegime } from '../types.js';

/**
 * The market-environment boundary (spec §33/§34): responsible for *where the day's hidden "true
 * value" and public event come from* — synthetic simulation or real historical replay — and
 * nothing else. It never knows about order books, matching, liquidity, or portfolios; those live
 * in `exchange/` and `game.ts`, and never know whether they're trading against a synthetic or
 * historical environment.
 *
 * `conditionsFor` deliberately does NOT return the day's actual reference/tradable price — only
 * the raw ingredients (`fundamentalValueCents`, `regime`, `event`, `eventImpactReturn`,
 * `expectedDailyVolume`, `volatilityHint`). Turning those into an actual reference price is
 * `market/referencePriceModel.ts`'s job, shared by both modes, since "how does the tradable price
 * track the hidden true value" is the same question regardless of where that true value came
 * from.
 */
export interface MarketEnvironment {
  /**
   * Conditions for `round` (0-based; unused for `round === 0`, which `game.ts` seeds directly from
   * this same environment's own pinned starting value — see `initialize()`). `previousFundamentalValueCents`/
   * `previousRegime` are the prior round's hidden state: SYNTHETIC mode evolves its fundamental
   * value and regime from them; HISTORICAL mode ignores both entirely and instead advances to the
   * next *real* trading day's real close and a classification of real trailing volatility/trend,
   * deliberately decoupled from whatever the simulated exchange actually closed at (spec §31).
   */
  conditionsFor(args: {
    round: number;
    rng: Rng;
    previousFundamentalValueCents: number;
    previousRegime: MarketRegime;
  }): DailyMarketConditions;
}
