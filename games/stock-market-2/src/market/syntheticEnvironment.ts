import { toCents } from '../money.js';
import type { DailyMarketConditions, SyntheticProfile } from '../types.js';
import type { MarketEnvironment } from './environment.js';

/**
 * The simplest possible placeholder synthetic price process: a deterministic log-return random
 * walk off the exchange's own last realized close. `newReferencePrice = oldClose *
 * exp(drift + shock)`, `shock ~ Uniform(-volatility, +volatility)` (scaled via `rng.nextFloat()`).
 *
 * This is deliberately not a "real" market model — there is no hidden fundamental value, no
 * market regime, and no event generator yet (spec Phase 4). Bot trading's actual price impact
 * still shows up (see `exchange/matchingEngine.ts` — walking a real order book naturally produces
 * impact/slippage without a separate formula), and since this walk starts each round from the
 * *previous realized close*, that impact does carry forward into subsequent rounds' baseline. A
 * proper hidden fundamental value with mean-reversion (so impact decays rather than compounding
 * forever) is exactly what Phase 4 will add on top of this seam — not attempted here.
 */
export function createSyntheticMarketEnvironment(
  profile: SyntheticProfile,
  averageDailyVolume: number,
): MarketEnvironment {
  const initialPriceCents = toCents(profile.initialPrice);

  return {
    conditionsFor({ round, rng, lastRealizedCloseCents }): DailyMarketConditions {
      // Round 0 is the match's pinned starting point (config.synthetic.initialPrice) — exact, no
      // shock/drift applied, same convention HISTORICAL mode uses for its own pinned starting day.
      const referencePriceCents =
        round === 0
          ? initialPriceCents
          : Math.max(
              1,
              Math.round(
                lastRealizedCloseCents *
                  Math.exp(
                    profile.drift +
                      (profile.volatility === 0 ? 0 : (rng.nextFloat() * 2 - 1) * profile.volatility),
                  ),
              ),
            );

      return {
        date: `synthetic-day-${String(round)}`,
        event: { type: 'NO_NEWS', description: 'No public events yet — synthetic events are a future addition.' },
        referencePriceCents,
        expectedDailyVolume: averageDailyVolume,
        volatilityHint: profile.volatility,
      };
    },
  };
}
