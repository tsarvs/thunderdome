import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { computeReferencePriceCents } from '../src/market/referencePriceModel.js';

function baseArgs(overrides: Partial<Parameters<typeof computeReferencePriceCents>[0]> = {}) {
  return {
    lastRealizedCloseCents: 10000,
    fundamentalValueCents: 10000,
    regime: 'SIDEWAYS' as const,
    eventImpactReturn: 0,
    meanReversionFactor: 0.15,
    referenceVolatility: 0,
    minimumPriceCents: 1,
    rng: createRng(Buffer.alloc(16, 1)),
    ...overrides,
  };
}

describe('computeReferencePriceCents', () => {
  it('with no gap, no shock, and no event, the price is unchanged', () => {
    expect(computeReferencePriceCents(baseArgs())).toBe(10000);
  });

  it('pulls toward a higher fundamental value', () => {
    const price = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 12000 }));
    expect(price).toBeGreaterThan(10000);
    expect(price).toBeLessThan(12000);
  });

  it('pulls toward a lower fundamental value', () => {
    const price = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 8000 }));
    expect(price).toBeLessThan(10000);
    expect(price).toBeGreaterThan(8000);
  });

  it('a higher meanReversionFactor closes more of the gap in one round', () => {
    const slow = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 12000, meanReversionFactor: 0.1 }));
    const fast = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 12000, meanReversionFactor: 0.9 }));
    expect(fast).toBeGreaterThan(slow);
  });

  it('meanReversionFactor 1 snaps exactly to the fundamental value when there is no other noise', () => {
    const price = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 12345, meanReversionFactor: 1 }));
    expect(price).toBe(12345);
  });

  it('meanReversionFactor 0 ignores the fundamental value entirely', () => {
    const price = computeReferencePriceCents(baseArgs({ fundamentalValueCents: 999999, meanReversionFactor: 0 }));
    expect(price).toBe(10000);
  });

  it('a positive eventImpactReturn pushes the price up even with no gap to close', () => {
    const price = computeReferencePriceCents(baseArgs({ eventImpactReturn: 0.05 }));
    expect(price).toBeGreaterThan(10000);
  });

  it('a negative eventImpactReturn pushes the price down', () => {
    const price = computeReferencePriceCents(baseArgs({ eventImpactReturn: -0.05 }));
    expect(price).toBeLessThan(10000);
  });

  it('CRISIS scales the random shock wider than SIDEWAYS, given the same rng draws', () => {
    const sideways = computeReferencePriceCents(
      baseArgs({ referenceVolatility: 0.1, regime: 'SIDEWAYS', rng: createRng(Buffer.alloc(16, 9)) }),
    );
    const crisis = computeReferencePriceCents(
      baseArgs({ referenceVolatility: 0.1, regime: 'CRISIS', rng: createRng(Buffer.alloc(16, 9)) }),
    );
    expect(Math.abs(crisis - 10000)).toBeGreaterThan(Math.abs(sideways - 10000));
  });

  it('never returns below the configured minimum price', () => {
    const price = computeReferencePriceCents(
      baseArgs({ fundamentalValueCents: 1, meanReversionFactor: 1, minimumPriceCents: 500 }),
    );
    expect(price).toBe(500);
  });

  it('is deterministic given the same seed', () => {
    const build = () => computeReferencePriceCents(baseArgs({ referenceVolatility: 0.05, rng: createRng(Buffer.alloc(16, 7)) }));
    expect(build()).toBe(build());
  });
});
