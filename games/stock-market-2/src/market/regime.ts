import type { Rng } from '@thunderdome/engine';
import type { MarketRegime } from '../types.js';

/** How a regime shapes that day's numbers — never exposed to bots directly (spec §8: a bot infers
 * regime from behavior, the same way a real trader would). Deliberately simple, fixed constants
 * rather than configurable knobs — spec explicitly warns against over-engineering this. */
export interface RegimeProfile {
  driftPerRound: number;
  volatilityMultiplier: number;
  liquidityMultiplier: number;
  eventFrequencyMultiplier: number;
  /** -1 (skews generated events positive) .. +1 (skews them negative). */
  negativeBias: number;
}

export const REGIME_PROFILES: Record<MarketRegime, RegimeProfile> = {
  BULL: { driftPerRound: 0.0008, volatilityMultiplier: 0.9, liquidityMultiplier: 1.1, eventFrequencyMultiplier: 1.0, negativeBias: -0.3 },
  BEAR: { driftPerRound: -0.0008, volatilityMultiplier: 1.1, liquidityMultiplier: 0.9, eventFrequencyMultiplier: 1.1, negativeBias: 0.3 },
  SIDEWAYS: { driftPerRound: 0, volatilityMultiplier: 0.8, liquidityMultiplier: 1.0, eventFrequencyMultiplier: 0.8, negativeBias: 0 },
  HIGH_VOLATILITY: { driftPerRound: 0, volatilityMultiplier: 2.0, liquidityMultiplier: 0.8, eventFrequencyMultiplier: 1.4, negativeBias: 0.1 },
  LOW_VOLATILITY: { driftPerRound: 0, volatilityMultiplier: 0.5, liquidityMultiplier: 1.2, eventFrequencyMultiplier: 0.6, negativeBias: 0 },
  CRISIS: { driftPerRound: -0.003, volatilityMultiplier: 3.0, liquidityMultiplier: 0.4, eventFrequencyMultiplier: 2.0, negativeBias: 0.8 },
};

export const INITIAL_REGIME: MarketRegime = 'SIDEWAYS';

/** A simple Markov-style transition table — deliberately not over-engineered (spec §8). Each
 * regime mostly persists, with the rest of its weight spread across plausible neighbors. */
const TRANSITIONS: Record<MarketRegime, ReadonlyArray<{ to: MarketRegime; weight: number }>> = {
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
  const options = TRANSITIONS[current];
  const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
  let draw = rng.nextFloat() * totalWeight;
  for (const option of options) {
    draw -= option.weight;
    if (draw <= 0) {
      return option.to;
    }
  }
  // Floating-point fallback — the loop above always returns for any draw strictly inside
  // [0, totalWeight).
  return options[options.length - 1]?.to ?? current;
}
