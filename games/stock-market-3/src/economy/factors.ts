import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import { ECONOMIC_FACTORS, type EconomicFactor, type EconomicFactorValues, type MarketRegime } from '../types.js';
import { REGIME_PROFILES } from './regime.js';

/** Per-factor Ornstein-Uhlenbeck parameters — hidden simulator constants (spec §60: don't expose
 * every microscopic knob). Every factor lives on roughly the same unitless scale, so
 * `FactorExposure.loading` values are directly comparable across factors regardless of which one
 * they're on. `volatility` is calibrated so that a typical sector loading (~1, spec's own §10
 * table) translates a factor's per-round move into a REALISTIC daily-return contribution (a real
 * stock's total daily volatility is usually a few percent, not tens of percent) — this was
 * originally 10-15x larger, which combined across 4-5 loaded factors compounded into an
 * implausible >400%-annualized simulated volatility (an internal calibration finding, not spec
 * text). */
const FACTOR_PARAMS: Record<EconomicFactor, { speed: number; volatility: number }> = {
  GROWTH: { speed: 0.03, volatility: 0.008 },
  INFLATION: { speed: 0.02, volatility: 0.007 },
  INTEREST_RATES: { speed: 0.015, volatility: 0.005 },
  COMMODITY_PRICES: { speed: 0.02, volatility: 0.012 },
  RISK_APPETITE: { speed: 0.05, volatility: 0.01 },
  LIQUIDITY: { speed: 0.04, volatility: 0.007 },
};

/**
 * Sparse, directional cross-factor influence (spec §7/§8's example chains): each link nudges `to`
 * with a fraction of `from`'s OWN SHOCK this round (see `stepEconomicFactors`) — never `from`'s
 * persistent LEVEL. This distinction is load-bearing, not stylistic: an earlier version fed each
 * link off the upstream factor's level, which — because a factor's stationary mean under a
 * constant input scales as `input / speed` — turned every link's small `weight` into an effective
 * gain of `weight / speed` (5x-13x per stage here) once chained across 4-5 stages. That silently
 * amplified any small persistent drift into a runaway that saturated every downstream factor at
 * its clamp within ~80 rounds, well after already destroying every loaded security's fundamental
 * value on the way there (an internal calibration finding, not spec text). Coupling to the
 * zero-mean, non-persistent shock instead means a link can never accumulate a stationary bias —
 * only correlate this round's move with this round's upstream surprise, which is exactly the
 * "commodity shock also nudges inflation" relationship the spec describes.
 */
const CROSS_FACTOR_LINKS: readonly { from: EconomicFactor; to: EconomicFactor; weight: number }[] = [
  // Commodity prices -> inflation -> interest rates -> growth (spec §8's first example chain).
  { from: 'COMMODITY_PRICES', to: 'INFLATION', weight: 0.15 },
  { from: 'INFLATION', to: 'INTEREST_RATES', weight: 0.2 },
  { from: 'INTEREST_RATES', to: 'GROWTH', weight: -0.15 },
  // Growth deterioration -> risk appetite -> liquidity/flows (spec §8's second example chain).
  { from: 'GROWTH', to: 'RISK_APPETITE', weight: 0.25 },
  { from: 'RISK_APPETITE', to: 'LIQUIDITY', weight: 0.2 },
];

export function initialEconomicFactors(): EconomicFactorValues {
  const values = {} as EconomicFactorValues;
  for (const factor of ECONOMIC_FACTORS) {
    values[factor] = 0;
  }
  return values;
}

/** Advances every economic factor by one round: each factor's own mean-reverting shock (its
 * regime-shifted target, per `RegimeProfile.factorMeanShift`), plus a fraction of any linked
 * upstream factor's shock THIS round (see `CROSS_FACTOR_LINKS`'s doc comment for why this must be
 * shock-coupled, not level-coupled). Every factor's own shock is drawn in one pass before any
 * cross-link is applied, so a link never depends on order of iteration or another link having
 * already run. */
export function stepEconomicFactors(previous: EconomicFactorValues, regime: MarketRegime, rng: Rng): EconomicFactorValues {
  const profile = REGIME_PROFILES[regime];
  const shocks = {} as EconomicFactorValues;
  for (const factor of ECONOMIC_FACTORS) {
    shocks[factor] = gaussian(rng) * FACTOR_PARAMS[factor].volatility * profile.volatilityMultiplier;
  }

  const next = {} as EconomicFactorValues;
  for (const factor of ECONOMIC_FACTORS) {
    const mean = profile.factorMeanShift[factor] ?? 0;
    next[factor] = previous[factor] + FACTOR_PARAMS[factor].speed * (mean - previous[factor]) + shocks[factor];
  }
  for (const link of CROSS_FACTOR_LINKS) {
    next[link.to] += link.weight * shocks[link.from];
  }
  // A hard bound on every factor (each is meant to live on a roughly unit z-score-like scale —
  // see FACTOR_PARAMS' doc comment) — a defensive backstop, not load-bearing now that the
  // cross-links are shock-coupled rather than level-coupled.
  for (const factor of ECONOMIC_FACTORS) {
    next[factor] = Math.max(-4, Math.min(4, next[factor]));
  }
  return next;
}
