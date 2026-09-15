import type { AlphaSignal } from './types.js';

/** Below this many paired (predicted, realized) observations, a factor's own measured IC is
 * treated as too noisy to trust as a WEIGHT — see `computeEnsembleWeights`. Not a hard scientific
 * threshold, just a conservative floor; configurable via `AlphaEnsemblePolicy.minSamplesForMeasuredIC`
 * in `../config.ts` for callers/tests that want to vary it. */
export const DEFAULT_MIN_SAMPLES_FOR_MEASURED_IC = 10;

/** One realized (predicted-vs-actual) observation for one alpha factor — the raw material for
 * `measureAlphaIC`. `predicted` is that factor's own `AlphaSignal.value` from some earlier round;
 * `realizedForwardReturn` is the security's ACTUAL subsequent return over the same horizon the
 * prediction was made for. Never includes anything from AFTER the return window closed — see
 * `../decision.ts`'s bookkeeping of `pendingAlphaByTicker` for how this is assembled without
 * look-ahead. */
export interface RealizedAlphaSample {
  factor: string;
  predicted: number;
  realizedForwardReturn: number;
}

/** Generic Pearson correlation between two equal-length numeric series — the same formula
 * `../correlation.ts`'s `computePearsonCorrelation` uses for price-return series, generalized here
 * to any two paired series (predicted alpha values vs. realized returns). `undefined` for fewer
 * than 2 pairs or a degenerate (zero-variance) series, same as that function. */
export function pearsonCorrelation(xs: number[], ys: number[]): number | undefined {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return undefined;
  const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) continue; // unreachable given n = min(xs.length, ys.length); satisfies noUncheckedIndexedAccess
    const dx = x - meanX;
    const dy = y - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return undefined;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Fractional (average-tie) ranks, ascending — the standard input transform for a Spearman rank
 * correlation. Tied values get the mean of the ranks they would otherwise occupy. */
function fractionalRanks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    const current = indexed[i];
    if (current === undefined) break; // unreachable given the loop condition; satisfies noUncheckedIndexedAccess
    let j = i;
    while (j + 1 < indexed.length) {
      const next = indexed[j + 1];
      if (next?.value !== current.value) break;
      j++;
    }
    const averageRank = (i + j) / 2 + 1; // 1-indexed rank, averaged across the tied block
    for (let k = i; k <= j; k++) {
      const entry = indexed[k];
      if (entry === undefined) continue; // unreachable given i <= k <= j < indexed.length
      ranks[entry.index] = averageRank;
    }
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation — Pearson correlation of the two series' own ranks. Rank-based
 * (rather than plain Pearson alone) is the more standard "information coefficient" in quant
 * practice specifically because it's robust to a few extreme-return outliers dominating the
 * measurement, which real single-day stock returns are prone to. */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number | undefined {
  if (Math.min(xs.length, ys.length) < 2) return undefined;
  return pearsonCorrelation(fractionalRanks(xs), fractionalRanks(ys));
}

export interface AlphaICStats {
  factor: string;
  sampleSize: number;
  pearsonIC: number | undefined;
  rankIC: number | undefined;
}

/** Measures each factor's historical information coefficient — both plain Pearson and rank
 * (Spearman) — against realized forward returns. Grouped by `factor` only (pooled across every
 * ticker/date that produced a sample), since with ~11 securities and ~2 months of real history,
 * measuring a SEPARATE IC per ticker would starve every one of them of sample size; see this
 * bot's own plan doc for the explicit caveat that these numbers stay statistically thin until
 * `fetch:append-bars` accumulates materially more real history.
 */
export function measureAlphaIC(samples: RealizedAlphaSample[]): Map<string, AlphaICStats> {
  const byFactor = new Map<string, RealizedAlphaSample[]>();
  for (const sample of samples) {
    const group = byFactor.get(sample.factor);
    if (group === undefined) byFactor.set(sample.factor, [sample]);
    else group.push(sample);
  }

  const stats = new Map<string, AlphaICStats>();
  for (const [factor, group] of byFactor) {
    const predicted = group.map((s) => s.predicted);
    const realized = group.map((s) => s.realizedForwardReturn);
    stats.set(factor, {
      factor,
      sampleSize: group.length,
      pearsonIC: pearsonCorrelation(predicted, realized),
      rankIC: spearmanRankCorrelation(predicted, realized),
    });
  }
  return stats;
}

/**
 * Ensemble weight per factor — MEASURED from `icStatsByFactor`, never hand-picked (the plan's
 * central requirement). A factor with at least `minSamples` realized observations gets weight
 * `|rankIC|` (falling back to `|pearsonIC|` when rank IC itself is undefined, e.g. degenerate
 * ranks) — magnitude only, since a reliably NEGATIVE predictor is just as informative as a
 * reliably positive one once its sign is already baked into `AlphaSignal.value` upstream... except
 * it isn't (this ensemble never flips a factor's sign based on measured IC — see the doc comment
 * on `combineAlphaEnsemble`), so a strongly negative IC still only earns a weight proportional to
 * its magnitude, not a sign flip. A factor WITHOUT enough history yet falls back to the average of
 * whatever weight the reliably-measured factors received — an honest "we don't know if this one is
 * good or bad yet, treat it as roughly average" default, never a weight of zero (which would
 * silently and permanently mute a brand-new alpha) and never an invented specific number.
 */
export function computeEnsembleWeights(
  icStatsByFactor: Map<string, AlphaICStats>,
  presentFactors: string[],
  minSamples: number = DEFAULT_MIN_SAMPLES_FOR_MEASURED_IC,
): Map<string, number> {
  if (presentFactors.length === 0) return new Map();

  const measuredWeight = new Map<string, number>();
  for (const factor of presentFactors) {
    const stat = icStatsByFactor.get(factor);
    if (stat === undefined || stat.sampleSize < minSamples) continue;
    const ic = stat.rankIC ?? stat.pearsonIC;
    if (ic !== undefined) measuredWeight.set(factor, Math.abs(ic));
  }

  if (measuredWeight.size === 0) {
    const equal = 1 / presentFactors.length;
    return new Map(presentFactors.map((factor) => [factor, equal]));
  }

  const averageMeasured =
    [...measuredWeight.values()].reduce((sum, w) => sum + w, 0) / measuredWeight.size;
  const rawWeight = new Map(
    presentFactors.map((factor) => [factor, measuredWeight.get(factor) ?? averageMeasured]),
  );

  const total = [...rawWeight.values()].reduce((sum, w) => sum + w, 0);
  if (total === 0) {
    const equal = 1 / presentFactors.length;
    return new Map(presentFactors.map((factor) => [factor, equal]));
  }
  return new Map([...rawWeight.entries()].map(([factor, w]) => [factor, w / total]));
}

/**
 * Combines this round's per-factor `AlphaSignal`s into one expected-return/confidence pair, using
 * `weightByFactor` (from `computeEnsembleWeights`) — a plain weighted average of
 * `value * confidence`, normalized by total weight actually present this round (a factor absent
 * from `signals`, e.g. dropped by `../ablation.ts`, contributes neither numerator nor denominator,
 * rather than being treated as a confident zero). Returns `{ expectedReturn: 0, confidence: 0 }`
 * when no signal carries any weight at all (e.g. every alpha ablated away).
 */
export function combineAlphaEnsemble(
  signals: AlphaSignal[],
  weightByFactor: Map<string, number>,
): { expectedReturn: number; confidence: number } {
  let weightedValue = 0;
  let weightedConfidence = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const weight = weightByFactor.get(signal.factor) ?? 0;
    if (weight === 0) continue;
    weightedValue += weight * signal.value * signal.confidence;
    weightedConfidence += weight * signal.confidence;
    totalWeight += weight;
  }
  if (totalWeight === 0) return { expectedReturn: 0, confidence: 0 };
  return {
    expectedReturn: weightedValue / totalWeight,
    confidence: weightedConfidence / totalWeight,
  };
}
