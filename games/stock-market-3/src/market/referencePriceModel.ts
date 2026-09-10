import type { Rng } from '@thunderdome/engine';
import type { MarketRegime } from '../types.js';
import { REGIME_PROFILES } from '../economy/regime.js';

/**
 * Turns one round's hidden fundamental value into an actual pre-open reference/tradable price —
 * ported near-verbatim from games/stock-market-2's `referencePriceModel.ts` (same rationale: how
 * much the tradable price tracks the hidden true value, and how much extra noise sits on top, is
 * the same question for every security regardless of how its fundamental value evolved). Called
 * once per symbol per round (equities AND the index — see `game.ts`).
 */
export function computeReferencePriceCents(args: {
  lastRealizedCloseCents: number;
  fundamentalValueCents: number;
  regime: MarketRegime;
  meanReversionFactor: number;
  referenceVolatility: number;
  minimumPriceCents: number;
  rng: Rng;
  /** Optional technical (momentum/value) drift on top of the pull toward fundamental value —
   * see `market/priceModel.ts`'s `computeStyleTechnicalReturn`. Omitted for the index, which has
   * no style loadings of its own. */
  styleReturn?: number;
}): number {
  const {
    lastRealizedCloseCents,
    fundamentalValueCents,
    regime,
    meanReversionFactor,
    referenceVolatility,
    minimumPriceCents,
    rng,
    styleReturn = 0,
  } = args;

  const pull = meanReversionFactor * Math.log(fundamentalValueCents / lastRealizedCloseCents);
  const volatility = referenceVolatility * REGIME_PROFILES[regime].volatilityMultiplier;
  const shock = volatility === 0 ? 0 : (rng.nextFloat() * 2 - 1) * volatility;
  const dailyReturn = Math.max(-0.3, Math.min(0.3, pull + shock + styleReturn));

  return Math.max(minimumPriceCents, Math.round(lastRealizedCloseCents * Math.exp(dailyReturn)));
}
