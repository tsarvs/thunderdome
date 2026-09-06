import { toCents } from '../money.js';
import type { DailyMarketConditions, SyntheticProfile } from '../types.js';
import type { MarketEnvironment } from './environment.js';
import { generateSyntheticEvent } from './eventGenerator.js';
import { INITIAL_REGIME, REGIME_PROFILES, nextRegime } from './regime.js';

const NO_EVENT_YET: DailyMarketConditions['event'] = {
  type: 'NO_NEWS',
  description: 'No news yet — round 0 is the match\'s pinned starting point.',
};

/**
 * SYNTHETIC mode's market environment: a hidden fundamental value that evolves independently of
 * the tradable reference price (spec §7), a regime that transitions Markov-style each round
 * (`market/regime.ts`), and a regime-aware public event generator (`market/eventGenerator.ts`).
 *
 * `fundamentalValueCents` is genuinely hidden — nothing in `game.ts`'s observation-building code
 * ever reads it. The reference/tradable price the exchange actually uses only gravitates toward
 * it (`market/referencePriceModel.ts`); it never snaps to it, so there's always a gap left to
 * trade on (momentum, mean-reversion, value, and event-driven strategies all become meaningful
 * exactly because the fundamental value and the tradable price aren't the same number).
 */
export function createSyntheticMarketEnvironment(
  profile: SyntheticProfile,
  averageDailyVolume: number,
): MarketEnvironment {
  const initialPriceCents = toCents(profile.initialPrice);

  return {
    conditionsFor({ round, rng, previousFundamentalValueCents, previousRegime }): DailyMarketConditions {
      if (round === 0) {
        // Round 0 is the match's pinned starting point — no regime transition, no event, no
        // shock yet (nothing has happened before the match's first day).
        return {
          date: 'synthetic-day-0',
          event: NO_EVENT_YET,
          eventImpactReturn: 0,
          fundamentalValueCents: initialPriceCents,
          regime: INITIAL_REGIME,
          expectedDailyVolume: averageDailyVolume,
          volatilityHint: profile.fundamentalVolatility,
        };
      }

      const regime = nextRegime(previousRegime, rng);
      const { event, impactReturn } = generateSyntheticEvent(regime, rng);
      const regimeProfile = REGIME_PROFILES[regime];
      const shock =
        profile.fundamentalVolatility === 0 ? 0 : (rng.nextFloat() * 2 - 1) * profile.fundamentalVolatility;
      const fundamentalReturn = regimeProfile.driftPerRound + profile.fundamentalDrift + shock + impactReturn;
      const fundamentalValueCents = Math.max(
        1,
        Math.round(previousFundamentalValueCents * Math.exp(fundamentalReturn)),
      );

      return {
        date: `synthetic-day-${String(round)}`,
        event,
        eventImpactReturn: impactReturn,
        fundamentalValueCents,
        regime,
        expectedDailyVolume: averageDailyVolume,
        volatilityHint: profile.fundamentalVolatility,
      };
    },
  };
}
