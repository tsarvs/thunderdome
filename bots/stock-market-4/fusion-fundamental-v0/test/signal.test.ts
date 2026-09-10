import { describe, expect, it } from 'vitest';
import type { SignalThresholds } from '../src/config.js';
import type { ModelEffect } from '../src/research/interpretEvents.js';
import { computeInformationGap, computeSignal, computeSignalConfidence, computeValuationGap } from '../src/signal.js';

const thresholds: SignalThresholds = {
  strongBuyThreshold: 0.15,
  buyThreshold: 0.05,
  reduceThreshold: -0.05,
  sellThreshold: -0.15,
  hysteresisBand: 0,
};

describe('computeValuationGap', () => {
  it('is 0 when fair value equals market price', () => {
    expect(computeValuationGap(100, 100)).toBeCloseTo(0);
  });
  it('is positive when fair value exceeds market price', () => {
    expect(computeValuationGap(120, 100)).toBeCloseTo(0.2);
  });
});

describe('computeSignalConfidence', () => {
  it('is 1 with no effects (nothing new to be uncertain about)', () => {
    expect(computeSignalConfidence([])).toBe(1);
  });
  it('ignores neutral effects and averages the rest', () => {
    const effects: ModelEffect[] = [
      { factor: 'a', direction: 'positive', magnitude: 1, confidence: 0.8, rationale: 'r' },
      { factor: 'b', direction: 'positive', magnitude: 1, confidence: 0.4, rationale: 'r' },
      { factor: 'c', direction: 'neutral', magnitude: 0, confidence: 1, rationale: 'r' },
    ];
    expect(computeSignalConfidence(effects)).toBeCloseTo(0.6);
  });
});

describe('computeSignal', () => {
  it('classifies a large positive gap as STRONG_BUY', () => {
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 130, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('STRONG_BUY');
  });

  it('classifies a modest positive gap as BUY', () => {
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 108, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('BUY');
  });

  it('classifies a near-zero gap as HOLD', () => {
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 101, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('HOLD');
  });

  it('classifies a large negative gap as SELL', () => {
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 70, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('SELL');
  });

  it('low confidence can pull a raw-gap BUY down to HOLD', () => {
    const effects: ModelEffect[] = [{ factor: 'a', direction: 'positive', magnitude: 1, confidence: 0.1, rationale: 'r' }];
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 108, marketPrice: 100, effects, thresholds });
    expect(signal.confidence).toBeCloseTo(0.1);
    expect(signal.level).toBe('HOLD');
  });
});

describe('computeInformationGap', () => {
  it('returns nulls with no previous observation', () => {
    const gap = computeInformationGap({
      currentFairValuePerShare: 110,
      previousFairValuePerShare: undefined,
      currentPrice: 105,
      previousPrice: undefined,
    });
    expect(gap).toEqual({ modelChange: null, marketChange: null, informationGap: null });
  });

  it('flags market over-reaction: model +10%, market +30% -> negative information gap', () => {
    const gap = computeInformationGap({
      currentFairValuePerShare: 110,
      previousFairValuePerShare: 100,
      currentPrice: 130,
      previousPrice: 100,
    });
    expect(gap.modelChange).toBeCloseTo(0.1);
    expect(gap.marketChange).toBeCloseTo(0.3);
    expect(gap.informationGap).toBeCloseTo(-0.2);
  });

  it('flags market under-reaction: model +20%, market +3% -> positive information gap', () => {
    const gap = computeInformationGap({
      currentFairValuePerShare: 120,
      previousFairValuePerShare: 100,
      currentPrice: 103,
      previousPrice: 100,
    });
    expect(gap.modelChange).toBeCloseTo(0.2);
    expect(gap.marketChange).toBeCloseTo(0.03);
    expect(gap.informationGap).toBeGreaterThan(0.1);
  });
});
