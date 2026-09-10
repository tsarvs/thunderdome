import type { Rng } from '@thunderdome/engine';
import { weightedTransition } from '../rngUtil.js';
import type { EconomicFactor, MarketRegime } from '../types.js';

/** How a regime shapes that round's numbers — never exposed to bots directly (spec §14: a bot
 * infers regime from behavior, the same way a real trader would). Fixed constants rather than
 * configurable knobs, same rationale as games/stock-market-2's `REGIME_PROFILES`. */
export interface RegimeProfile {
  volatilityMultiplier: number;
  liquidityMultiplier: number;
  /** Multiplies the base per-round probability of an unscheduled company-news event. */
  newsFrequencyMultiplier: number;
  /** -1 (skews unscheduled news positive) .. +1 (skews it negative). */
  negativeBias: number;
  /** A level shift applied to a factor's OU mean-reversion target this round — this is how a
   * regime pushes GROWTH/RISK_APPETITE down in a BEAR/CRISIS without double-counting drift
   * anywhere else (the factor's own OU step is the only place drift is ever applied). */
  factorMeanShift: Partial<Record<EconomicFactor, number>>;
}

export const REGIME_PROFILES: Record<MarketRegime, RegimeProfile> = {
  BULL: {
    volatilityMultiplier: 0.85,
    liquidityMultiplier: 1.15,
    newsFrequencyMultiplier: 1.0,
    negativeBias: -0.3,
    factorMeanShift: { GROWTH: 0.4, RISK_APPETITE: 0.4 },
  },
  BEAR: {
    volatilityMultiplier: 1.15,
    liquidityMultiplier: 0.9,
    newsFrequencyMultiplier: 1.1,
    negativeBias: 0.3,
    factorMeanShift: { GROWTH: -0.4, RISK_APPETITE: -0.4 },
  },
  SIDEWAYS: {
    volatilityMultiplier: 0.8,
    liquidityMultiplier: 1.0,
    newsFrequencyMultiplier: 0.8,
    negativeBias: 0,
    factorMeanShift: {},
  },
  HIGH_VOLATILITY: {
    volatilityMultiplier: 1.8,
    liquidityMultiplier: 0.8,
    newsFrequencyMultiplier: 1.4,
    negativeBias: 0.1,
    factorMeanShift: {},
  },
  LOW_VOLATILITY: {
    volatilityMultiplier: 0.5,
    liquidityMultiplier: 1.2,
    newsFrequencyMultiplier: 0.6,
    negativeBias: 0,
    factorMeanShift: {},
  },
  CRISIS: {
    volatilityMultiplier: 2.8,
    liquidityMultiplier: 0.4,
    newsFrequencyMultiplier: 2.0,
    negativeBias: 0.8,
    factorMeanShift: { GROWTH: -1.2, RISK_APPETITE: -1.5, LIQUIDITY: -1.0 },
  },
};

export const INITIAL_REGIME: MarketRegime = 'SIDEWAYS';

/** A simple Markov-style transition table — deliberately not over-engineered (spec §8/§14). */
const TRANSITIONS: Record<MarketRegime, readonly { to: MarketRegime; weight: number }[]> = {
  BULL: [
    { to: 'BULL', weight: 0.85 },
    { to: 'SIDEWAYS', weight: 0.08 },
    { to: 'HIGH_VOLATILITY', weight: 0.04 },
    { to: 'BEAR', weight: 0.02 },
    { to: 'CRISIS', weight: 0.01 },
  ],
  BEAR: [
    { to: 'BEAR', weight: 0.8 },
    { to: 'SIDEWAYS', weight: 0.08 },
    { to: 'HIGH_VOLATILITY', weight: 0.06 },
    { to: 'CRISIS', weight: 0.04 },
    { to: 'BULL', weight: 0.02 },
  ],
  SIDEWAYS: [
    { to: 'SIDEWAYS', weight: 0.7 },
    { to: 'BULL', weight: 0.12 },
    { to: 'BEAR', weight: 0.12 },
    { to: 'LOW_VOLATILITY', weight: 0.05 },
    { to: 'HIGH_VOLATILITY', weight: 0.01 },
  ],
  HIGH_VOLATILITY: [
    { to: 'HIGH_VOLATILITY', weight: 0.5 },
    { to: 'SIDEWAYS', weight: 0.2 },
    { to: 'BULL', weight: 0.1 },
    { to: 'BEAR', weight: 0.1 },
    { to: 'CRISIS', weight: 0.1 },
  ],
  LOW_VOLATILITY: [
    { to: 'LOW_VOLATILITY', weight: 0.75 },
    { to: 'SIDEWAYS', weight: 0.2 },
    { to: 'BULL', weight: 0.05 },
  ],
  CRISIS: [
    { to: 'CRISIS', weight: 0.4 },
    { to: 'HIGH_VOLATILITY', weight: 0.35 },
    { to: 'BEAR', weight: 0.2 },
    { to: 'SIDEWAYS', weight: 0.05 },
  ],
};

/** Deterministic given `rng`'s next draw. */
export function nextRegime(current: MarketRegime, rng: Rng): MarketRegime {
  return weightedTransition(TRANSITIONS[current], rng);
}
