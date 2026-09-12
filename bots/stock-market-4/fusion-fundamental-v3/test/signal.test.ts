import { describe, expect, it } from 'vitest';
import type { SignalThresholds } from '../src/config.js';
import type { DailyBar } from '../src/marketTypes.js';
import type { ModelEffect } from '../src/research/interpretEvents.js';
import {
  computeInformationGap,
  computePriceStabilityConfidence,
  computeSignal,
  computeSignalConfidence,
  computeValuationGap,
} from '../src/signal.js';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

const thresholds: SignalThresholds = {
  strongBuyThreshold: 0.15,
  buyThreshold: 0.05,
  reduceThreshold: -0.05,
  sellThreshold: -0.15,
  strongSellThreshold: -0.25,
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
    // -0.2 sits between sellThreshold (-0.15) and strongSellThreshold (-0.25) — see the dedicated
    // STRONG_SELL test below for the more extreme v1-only tier.
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 80, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('SELL');
  });

  it('low confidence can pull a raw-gap BUY down to HOLD', () => {
    const effects: ModelEffect[] = [{ factor: 'a', direction: 'positive', magnitude: 1, confidence: 0.1, rationale: 'r' }];
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 108, marketPrice: 100, effects, thresholds });
    expect(signal.confidence).toBeCloseTo(0.1);
    expect(signal.level).toBe('HOLD');
  });

  it('classifies a very large negative gap as STRONG_SELL (v1)', () => {
    // valuationGap = 40/100 - 1 = -0.6, past strongSellThreshold (-0.25).
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 40, marketPrice: 100, effects: [], thresholds });
    expect(signal.level).toBe('STRONG_SELL');
  });

  it('low confidence can pull a raw-gap STRONG_SELL back up to SELL', () => {
    // Same magnitude gap as the STRONG_SELL case above, but confidence low enough that
    // signalScore no longer clears strongSellThreshold, only sellThreshold.
    const effects: ModelEffect[] = [{ factor: 'a', direction: 'negative', magnitude: 1, confidence: 0.3, rationale: 'r' }];
    const signal = computeSignal({ ticker: 'ELMT', fairValuePerShare: 40, marketPrice: 100, effects, thresholds });
    expect(signal.confidence).toBeCloseTo(0.3);
    expect(signal.signalScore).toBeCloseTo(-0.18, 2);
    expect(signal.level).toBe('SELL');
  });
});

describe('computeSignal hysteresis around STRONG_SELL (v1)', () => {
  const withBand: SignalThresholds = { ...thresholds, hysteresisBand: 0.05 };

  it('holds STRONG_SELL as the score recovers slightly, past the plain threshold but within the band', () => {
    // strongSellThreshold -0.25; a score of -0.22 is above (less extreme than) -0.25 but still
    // within the 0.05 exit band (-0.25 + 0.05 = -0.20), so STRONG_SELL should still be held.
    const first = computeSignal({ ticker: 'ELMT', fairValuePerShare: 30, marketPrice: 100, effects: [], thresholds: withBand });
    expect(first.level).toBe('STRONG_SELL');

    const second = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 78,
      marketPrice: 100,
      effects: [],
      thresholds: withBand,
      previousLevel: 'STRONG_SELL',
    });
    expect(second.signalScore).toBeCloseTo(-0.22, 2);
    expect(second.level).toBe('STRONG_SELL');
    expect(second.heldByHysteresis).toBe(true);
  });

  it('gives up STRONG_SELL for SELL once the score recovers past the exit band', () => {
    const second = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 82,
      marketPrice: 100,
      effects: [],
      thresholds: withBand,
      previousLevel: 'STRONG_SELL',
    });
    expect(second.signalScore).toBeCloseTo(-0.18, 2);
    expect(second.level).toBe('SELL');
  });

  it('entering STRONG_SELL from SELL always uses the plain threshold, never resisted by hysteresis', () => {
    // Symmetric with BUY -> STRONG_BUY: hysteresis only resists LEAVING a level, never delays
    // entering a MORE extreme one.
    const signal = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 30,
      marketPrice: 100,
      effects: [],
      thresholds: withBand,
      previousLevel: 'SELL',
    });
    expect(signal.level).toBe('STRONG_SELL');
    expect(signal.heldByHysteresis).toBe(false);
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

describe('computePriceStabilityConfidence (v2)', () => {
  it('is full confidence with fewer than 2 bars of history (nothing to compute a return from yet)', () => {
    expect(computePriceStabilityConfidence([])).toBe(1);
    expect(computePriceStabilityConfidence([bar('d1', 10)])).toBe(1);
  });

  it('is full confidence for a perfectly calm (flat) recent price history', () => {
    const history = [bar('d1', 10), bar('d2', 10), bar('d3', 10), bar('d4', 10)];
    expect(computePriceStabilityConfidence(history)).toBe(1);
  });

  it('bottoms out at the floor for a wildly choppy recent price history', () => {
    // Alternating +10%/-9.09% swings -> ~9.5% daily volatility, well past the 5% "chaotic"
    // calibration point -> clamped to the floor.
    const history = [bar('d1', 100), bar('d2', 110), bar('d3', 100), bar('d4', 110), bar('d5', 100)];
    expect(computePriceStabilityConfidence(history)).toBeCloseTo(0.3);
  });

  it('rates a moderately choppy history above the floor but below full confidence', () => {
    // Two DIFFERENT-sized returns (+2%, -0.98%) -> a genuinely non-zero variance (~1.49% daily
    // vol), between the calm and chaotic calibration points. (A single return, e.g. just two
    // bars, always has zero variance against its own mean — degenerate, not a useful case here.)
    const history = [bar('d1', 100), bar('d2', 102), bar('d3', 101)];
    const confidence = computePriceStabilityConfidence(history);
    expect(confidence).toBeGreaterThan(0.3);
    expect(confidence).toBeLessThan(1);
  });

  it('is monotonic: a choppier history never rates higher confidence than a calmer one', () => {
    const calm = [bar('d1', 100), bar('d2', 101), bar('d3', 100)];
    const choppy = [bar('d1', 100), bar('d2', 108), bar('d3', 100)];
    expect(computePriceStabilityConfidence(choppy)).toBeLessThanOrEqual(computePriceStabilityConfidence(calm));
  });
});
