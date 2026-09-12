import { describe, expect, it } from 'vitest';
import { adjustThresholdsForSupplierCapture, marketImpliedConfidenceMultiplier } from '../src/decision.js';
import type { SignalThresholds } from '../src/config.js';
import type { ModelEffect } from '../src/research/interpretEvents.js';

/**
 * Locks in the two mechanisms added specifically to fix a real, verified problem: a real
 * historical head-to-head against fusion-fundamental-v6 produced a BYTE-IDENTICAL portfolio,
 * because every `supplier_capture`/market-implied finding was too weak to cross a `SignalLevel`
 * bucket boundary (see this bot's own decision.ts doc comments). These tests confirm the fix
 * actually moves thresholds/confidence, not just that it compiles.
 */
const THRESHOLDS: SignalThresholds = {
  strongBuyThreshold: 0.15,
  buyThreshold: 0.05,
  reduceThreshold: -0.05,
  sellThreshold: -0.15,
  strongSellThreshold: -0.25,
  hysteresisBand: 0,
};

describe('adjustThresholdsForSupplierCapture', () => {
  it('leaves thresholds untouched when no supplier_capture effect is present', () => {
    const adjusted = adjustThresholdsForSupplierCapture(THRESHOLDS, [], 0.08);
    expect(adjusted).toEqual(THRESHOLDS);
  });

  it('lowers only the BUY-side thresholds for a positive (upgrade) effect, proportional to magnitude*confidence', () => {
    const effects: ModelEffect[] = [
      { factor: 'supplier_capture', direction: 'positive', magnitude: 0.8, confidence: 0.5, rationale: 'test' },
    ];
    const adjusted = adjustThresholdsForSupplierCapture(THRESHOLDS, effects, 0.1);
    // strength = 0.8*0.5 = 0.4; delta = 0.4*0.1 = 0.04
    expect(adjusted.strongBuyThreshold).toBeCloseTo(0.15 - 0.04);
    expect(adjusted.buyThreshold).toBeCloseTo(0.05 - 0.04);
    // SELL-side thresholds are untouched — an upgrade never makes it easier to sell.
    expect(adjusted.sellThreshold).toBe(THRESHOLDS.sellThreshold);
    expect(adjusted.strongSellThreshold).toBe(THRESHOLDS.strongSellThreshold);
  });

  it('raises only the SELL-side thresholds for a negative (downgrade) effect', () => {
    const effects: ModelEffect[] = [
      { factor: 'supplier_capture', direction: 'negative', magnitude: 1, confidence: 1, rationale: 'test' },
    ];
    const adjusted = adjustThresholdsForSupplierCapture(THRESHOLDS, effects, 0.08);
    expect(adjusted.sellThreshold).toBeCloseTo(-0.15 + 0.08);
    expect(adjusted.strongSellThreshold).toBeCloseTo(-0.25 + 0.08);
    expect(adjusted.buyThreshold).toBe(THRESHOLDS.buyThreshold);
    expect(adjusted.strongBuyThreshold).toBe(THRESHOLDS.strongBuyThreshold);
  });

  it('ignores a neutral supplier_capture-adjacent effect (defensive; interpretEvents never actually emits one under this factor)', () => {
    const effects: ModelEffect[] = [
      { factor: 'supplier_capture', direction: 'neutral', magnitude: 0, confidence: 1, rationale: 'test' },
    ];
    expect(adjustThresholdsForSupplierCapture(THRESHOLDS, effects, 0.08)).toEqual(THRESHOLDS);
  });
});

describe('marketImpliedConfidenceMultiplier', () => {
  const policy = { supplierCaptureThresholdShift: 0.08, marketImpliedOptimismConfidencePenalty: 0.5, marketImpliedUpsideConfidenceBoost: 1.2 };

  it('returns 1 (no adjustment) when there is no modeled fusion chain to invert', () => {
    expect(marketImpliedConfidenceMultiplier(undefined, policy)).toBe(1);
  });

  it('returns 1 when the implied capture is within the modeled bear-bull range', () => {
    expect(
      marketImpliedConfidenceMultiplier(
        { impliedSupplierCapture: 0.1, assumedSupplierCapture: 0.1, captureGap: 0, impliedCaptureVsRange: 'within_range' },
        policy,
      ),
    ).toBe(1);
  });

  it('applies the penalty (spec §39 valuation-blindness guard) when the market already prices in more than the bull case', () => {
    expect(
      marketImpliedConfidenceMultiplier(
        { impliedSupplierCapture: 0.5, assumedSupplierCapture: 0.1, captureGap: -0.4, impliedCaptureVsRange: 'above_bull_case' },
        policy,
      ),
    ).toBe(0.5);
  });

  it('applies the boost (spec §14 asymmetric-upside case) when the market prices in less than even the bear case', () => {
    expect(
      marketImpliedConfidenceMultiplier(
        { impliedSupplierCapture: -0.1, assumedSupplierCapture: 0.1, captureGap: 0.2, impliedCaptureVsRange: 'below_bear_case' },
        policy,
      ),
    ).toBe(1.2);
  });
});
