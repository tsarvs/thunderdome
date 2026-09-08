import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import type { SecurityState } from '../types.js';

const INDEX_SPECIFIC_VOLATILITY = 0.004;

/**
 * Market-cap-style weighting (spec §18), fixed once at match init — a coherent, if simplified,
 * methodology rather than a plain average of constituent prices. Weights are hidden simulator
 * configuration; a bot only ever observes the index's own tradable price/history, never this
 * breakdown (spec §18-19).
 */
export function computeIndexWeights(equities: readonly SecurityState[]): Record<string, number> {
  const capsCents = equities.map((security) => security.sharesOutstanding * security.fundamentalValueCents);
  const totalCents = capsCents.reduce((sum, cap) => sum + cap, 0);
  const weights: Record<string, number> = {};
  equities.forEach((security, index) => {
    weights[security.symbol] = totalCents > 0 ? (capsCents[index] ?? 0) / totalCents : 1 / equities.length;
  });
  return weights;
}

/**
 * The index's own hidden fundamental value evolves as the weight-blended log-return of its
 * constituents (spec §18's `Index Return = Market Factor + Weighted Constituent Influence`; the
 * market factor is already embedded in each constituent's own return via its `marketBeta`, so
 * re-adding it here would double-count it) plus a small independent index-specific noise term —
 * enough that the index is never a perfectly redundant linear combination of its constituents.
 */
export function stepIndexFundamentalValue(args: {
  currentIndexValueCents: number;
  constituentLogReturns: Record<string, number>;
  weights: Record<string, number>;
  rng: Rng;
}): number {
  const { currentIndexValueCents, constituentLogReturns, weights, rng } = args;
  let weightedReturn = 0;
  for (const [symbol, weight] of Object.entries(weights)) {
    weightedReturn += weight * (constituentLogReturns[symbol] ?? 0);
  }
  const noise = gaussian(rng) * INDEX_SPECIFIC_VOLATILITY;
  return Math.max(1, Math.round(currentIndexValueCents * Math.exp(weightedReturn + noise)));
}
