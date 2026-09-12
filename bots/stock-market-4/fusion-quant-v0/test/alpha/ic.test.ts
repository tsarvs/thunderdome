import { describe, expect, it } from 'vitest';
import {
  combineAlphaEnsemble,
  computeEnsembleWeights,
  measureAlphaIC,
  pearsonCorrelation,
  spearmanRankCorrelation,
  type RealizedAlphaSample,
} from '../../src/alpha/ic.js';
import type { AlphaSignal } from '../../src/alpha/types.js';

describe('pearsonCorrelation', () => {
  it('is undefined for fewer than 2 pairs', () => {
    expect(pearsonCorrelation([1], [1])).toBeUndefined();
  });

  it('is undefined for a zero-variance series', () => {
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeUndefined();
  });

  it('is 1 for a perfectly linear positive relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });

  it('is -1 for a perfectly linear inverse relationship', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
});

describe('spearmanRankCorrelation', () => {
  it('is 1 for a monotonic (but non-linear) positive relationship — a case plain Pearson would understate', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => x ** 3); // monotonic, strongly non-linear
    expect(spearmanRankCorrelation(xs, ys)).toBeCloseTo(1);
  });

  it('handles tied values without throwing', () => {
    expect(spearmanRankCorrelation([1, 1, 2, 2], [1, 2, 1, 2])).toBeDefined();
  });
});

describe('measureAlphaIC', () => {
  it('groups samples by factor and measures each independently', () => {
    const samples: RealizedAlphaSample[] = [
      { factor: 'a', predicted: 1, realizedForwardReturn: 1 },
      { factor: 'a', predicted: 2, realizedForwardReturn: 2 },
      { factor: 'a', predicted: 3, realizedForwardReturn: 3 },
      { factor: 'b', predicted: 1, realizedForwardReturn: -1 },
      { factor: 'b', predicted: 2, realizedForwardReturn: -2 },
    ];
    const stats = measureAlphaIC(samples);
    expect(stats.get('a')?.sampleSize).toBe(3);
    expect(stats.get('a')?.pearsonIC).toBeCloseTo(1);
    expect(stats.get('b')?.pearsonIC).toBeCloseTo(-1);
  });

  it('returns an empty map for no samples', () => {
    expect(measureAlphaIC([]).size).toBe(0);
  });
});

describe('computeEnsembleWeights', () => {
  it('falls back to equal weight across every present factor when NONE has enough history', () => {
    const weights = computeEnsembleWeights(new Map(), ['a', 'b', 'c'], 10);
    expect(weights.get('a')).toBeCloseTo(1 / 3);
    expect(weights.get('b')).toBeCloseTo(1 / 3);
    expect(weights.get('c')).toBeCloseTo(1 / 3);
  });

  it('weights a reliably-measured factor by its |rank IC|, and gives an under-sampled factor the average of the measured ones', () => {
    const stats = new Map([
      ['a', { factor: 'a', sampleSize: 20, pearsonIC: 0.8, rankIC: 0.8 }],
      ['b', { factor: 'b', sampleSize: 3, pearsonIC: 0.99, rankIC: 0.99 }], // too few samples to trust
    ]);
    const weights = computeEnsembleWeights(stats, ['a', 'b'], 10);
    // b falls back to a's own measured weight (the only measured one) before normalization, so a
    // real 2-factor case with one measured/one not still ends up roughly equal-weighted, NOT
    // dominated by b's unreliable, un-vetted 0.99 correlation.
    expect(weights.get('a')).toBeCloseTo(0.5);
    expect(weights.get('b')).toBeCloseTo(0.5);
  });

  it('never assigns a negative weight even to a reliably NEGATIVE predictor — magnitude only', () => {
    const stats = new Map([['a', { factor: 'a', sampleSize: 20, pearsonIC: -0.9, rankIC: -0.9 }]]);
    const weights = computeEnsembleWeights(stats, ['a'], 10);
    expect(weights.get('a')).toBeGreaterThan(0);
  });

  it('returns an empty map when no factors are present', () => {
    expect(computeEnsembleWeights(new Map(), [], 10).size).toBe(0);
  });
});

describe('combineAlphaEnsemble', () => {
  function signal(factor: string, value: number, confidence: number): AlphaSignal {
    return { factor, ticker: 'X', date: null, value, confidence };
  }

  it('returns a zero-confidence zero when no signal carries any weight', () => {
    const result = combineAlphaEnsemble([signal('a', 1, 1)], new Map());
    expect(result).toEqual({ expectedReturn: 0, confidence: 0 });
  });

  it('is a weighted average of value*confidence, normalized by present weight', () => {
    const weights = new Map([
      ['a', 0.75],
      ['b', 0.25],
    ]);
    const result = combineAlphaEnsemble([signal('a', 0.1, 1), signal('b', -0.1, 1)], weights);
    // (0.75*0.1*1 + 0.25*-0.1*1) / (0.75+0.25) = (0.075 - 0.025) = 0.05
    expect(result.expectedReturn).toBeCloseTo(0.05);
    expect(result.confidence).toBeCloseTo(1);
  });

  it('excludes a factor absent from the signal list entirely, rather than treating it as a confident zero', () => {
    const weights = new Map([
      ['a', 0.5],
      ['b', 0.5],
    ]);
    // Only 'a' present this round (e.g. 'b' was ablated away) — the combined result should be
    // exactly 'a' alone, not diluted by 'b's absent weight.
    const result = combineAlphaEnsemble([signal('a', 0.2, 1)], weights);
    expect(result.expectedReturn).toBeCloseTo(0.2);
  });
});
