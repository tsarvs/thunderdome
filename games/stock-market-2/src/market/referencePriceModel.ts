import type { Rng } from '@thunderdome/engine';
import type { MarketRegime } from '../types.js';
import { REGIME_PROFILES } from './regime.js';

/**
 * Turns one round's raw environment ingredients into an actual reference/pre-open price — the
 * one piece of math shared by both SYNTHETIC and HISTORICAL mode (spec §6's `dailyReturn`
 * formula), since "how much does the tradable price track the hidden true value, and how much
 * extra noise/event reaction sits on top" doesn't depend on where that true value came from.
 *
 * Regime *drift* deliberately does NOT appear here — it's already folded into how
 * `fundamentalValueCents` evolved this round (SYNTHETIC: `market/syntheticEnvironment.ts`;
 * HISTORICAL: it just *is* the real close, no drift model needed). Including it again here would
 * double-count it. Regime *volatility* still scales this round's own shock, since that's a
 * property of the tradable price's noise, not the fundamental value's drift.
 */
export function computeReferencePriceCents(args: {
  lastRealizedCloseCents: number;
  fundamentalValueCents: number;
  regime: MarketRegime;
  eventImpactReturn: number;
  meanReversionFactor: number;
  referenceVolatility: number;
  minimumPriceCents: number;
  rng: Rng;
}): number {
  const {
    lastRealizedCloseCents,
    fundamentalValueCents,
    regime,
    eventImpactReturn,
    meanReversionFactor,
    referenceVolatility,
    minimumPriceCents,
    rng,
  } = args;

  const pull = meanReversionFactor * Math.log(fundamentalValueCents / lastRealizedCloseCents);
  const volatility = referenceVolatility * REGIME_PROFILES[regime].volatilityMultiplier;
  const shock = volatility === 0 ? 0 : (rng.nextFloat() * 2 - 1) * volatility;
  const dailyReturn = pull + shock + eventImpactReturn;

  return Math.max(minimumPriceCents, Math.round(lastRealizedCloseCents * Math.exp(dailyReturn)));
}
