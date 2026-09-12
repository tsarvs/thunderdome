import { describe, expect, it } from 'vitest';
import { computeMarketImpliedAlpha } from '../../src/alpha/marketImplied.js';

describe('computeMarketImpliedAlpha', () => {
  it('is silent when there is no modeled fusion chain to invert', () => {
    const result = computeMarketImpliedAlpha({ ticker: 'X', date: null, marketImplied: undefined });
    expect(result.value).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('is positive (bullish) when the market implies LESS capture than assumed, with higher confidence outside the modeled range', () => {
    const result = computeMarketImpliedAlpha({
      ticker: 'X',
      date: null,
      marketImplied: {
        impliedSupplierCapture: -0.1,
        assumedSupplierCapture: 0.1,
        captureGap: 0.2,
        impliedCaptureVsRange: 'below_bear_case',
      },
    });
    expect(result.value).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.8);
  });

  it('is negative (cautionary) when the market already implies MORE capture than assumed', () => {
    const result = computeMarketImpliedAlpha({
      ticker: 'X',
      date: null,
      marketImplied: {
        impliedSupplierCapture: 0.5,
        assumedSupplierCapture: 0.1,
        captureGap: -0.4,
        impliedCaptureVsRange: 'above_bull_case',
      },
    });
    expect(result.value).toBeLessThan(0);
  });

  it('uses the lower, within-range confidence when the finding is inside the modeled bear/bull range', () => {
    const result = computeMarketImpliedAlpha({
      ticker: 'X',
      date: null,
      marketImplied: { impliedSupplierCapture: 0.1, assumedSupplierCapture: 0.1, captureGap: 0, impliedCaptureVsRange: 'within_range' },
    });
    expect(result.confidence).toBe(0.4);
  });
});
