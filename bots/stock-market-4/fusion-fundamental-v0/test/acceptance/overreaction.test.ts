import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import { computeSignal } from '../../src/signal.js';

/**
 * Spec §12/§20's central distinction: "fusion fundamentals improved" is not the same claim as
 * "the stock is undervalued because fusion fundamentals improved." Uses the spec's own worked
 * numbers: model fair value +18%, market +25% (over-reaction — market has already gone further
 * than our model justifies) vs. model +18%, market +4% (under-reaction — market hasn't caught up).
 */
describe('market reaction vs. modeled fair value (spec §12/§20)', () => {
  const thresholds = DEFAULT_FUSION_FUNDAMENTAL_CONFIG.signal;

  it('does not blindly BUY when the market has already over-reacted beyond the modeled improvement', () => {
    // previous fair value 100, previous price 100; model now says 118 (a genuine +18% improvement)
    const signal = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 118,
      marketPrice: 125, // market ran up +25%, further than the model justifies
      effects: [{ factor: 'manufacturing_capability', direction: 'positive', magnitude: 1, confidence: 1, rationale: 'r' }],
      thresholds,
    });
    expect(signal.valuationGap).toBeLessThan(0);
    expect(signal.level).not.toBe('BUY');
    expect(signal.level).not.toBe('STRONG_BUY');
  });

  it('produces a stronger positive signal when the market has under-reacted to the same modeled improvement', () => {
    const overreactionSignal = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 118,
      marketPrice: 125,
      effects: [{ factor: 'manufacturing_capability', direction: 'positive', magnitude: 1, confidence: 1, rationale: 'r' }],
      thresholds,
    });
    const underreactionSignal = computeSignal({
      ticker: 'ELMT',
      fairValuePerShare: 118,
      marketPrice: 104, // market only moved +4%
      effects: [{ factor: 'manufacturing_capability', direction: 'positive', magnitude: 1, confidence: 1, rationale: 'r' }],
      thresholds,
    });
    expect(underreactionSignal.signalScore).toBeGreaterThan(overreactionSignal.signalScore);
    expect(underreactionSignal.level === 'BUY' || underreactionSignal.level === 'STRONG_BUY').toBe(true);
  });

  it('the same positive research event produces different trade signals depending purely on market price, never trading on news direction alone', () => {
    const effects = [{ factor: 'manufacturing_capability', direction: 'positive' as const, magnitude: 1, confidence: 1, rationale: 'r' }];
    const cheap = computeSignal({ ticker: 'ELMT', fairValuePerShare: 118, marketPrice: 90, effects, thresholds });
    const expensive = computeSignal({ ticker: 'ELMT', fairValuePerShare: 118, marketPrice: 160, effects, thresholds });
    expect(cheap.level).toBe('STRONG_BUY');
    expect(expensive.level).toBe('SELL');
  });
});
