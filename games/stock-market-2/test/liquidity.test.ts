import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { generateLiquiditySnapshot } from '../src/exchange/liquidity.js';
import { LiquidityProfileSchema } from '../src/types.js';

function profile(overrides: Record<string, unknown> = {}) {
  return LiquidityProfileSchema.parse(overrides);
}

describe('generateLiquiditySnapshot', () => {
  it('produces the configured number of levels per side, asks above and bids below the reference', () => {
    const snapshot = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 100000,
      volatilityHint: 0.02,
      profile: profile({ bookLevels: 4 }),
      rng: createRng(Buffer.alloc(16, 1)),
    });
    expect(snapshot.bids).toHaveLength(4);
    expect(snapshot.asks).toHaveLength(4);
    for (const level of snapshot.bids) {
      expect(level.priceCents).toBeLessThan(10000);
    }
    for (const level of snapshot.asks) {
      expect(level.priceCents).toBeGreaterThan(10000);
    }
  });

  it('produces a real bid/ask spread — best bid strictly below best ask', () => {
    const snapshot = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 100000,
      volatilityHint: 0.02,
      profile: profile(),
      rng: createRng(Buffer.alloc(16, 1)),
    });
    const bestBid = Math.max(...snapshot.bids.map((l) => l.priceCents));
    const bestAsk = Math.min(...snapshot.asks.map((l) => l.priceCents));
    expect(bestBid).toBeLessThan(bestAsk);
  });

  it('orders levels best-price-first on each side', () => {
    const snapshot = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 100000,
      volatilityHint: 0.02,
      profile: profile({ bookLevels: 5 }),
      rng: createRng(Buffer.alloc(16, 1)),
    });
    for (let i = 1; i < snapshot.bids.length; i++) {
      expect(snapshot.bids[i]!.priceCents).toBeLessThan(snapshot.bids[i - 1]!.priceCents);
    }
    for (let i = 1; i < snapshot.asks.length; i++) {
      expect(snapshot.asks[i]!.priceCents).toBeGreaterThan(snapshot.asks[i - 1]!.priceCents);
    }
  });

  it('sizes deeper levels smaller, per levelSizeDecay', () => {
    const snapshot = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 1_000_000,
      volatilityHint: 0.01,
      profile: profile({ bookLevels: 5, levelSizeDecay: 0.5 }),
      rng: createRng(Buffer.alloc(16, 3)),
    });
    // Jitter is +/-20%, so compare far-apart levels (0 vs 4: a 0.5^4 = 1/16 decay) rather than
    // adjacent ones, to keep this robust against jitter noise.
    expect(snapshot.asks[4]!.quantity).toBeLessThan(snapshot.asks[0]!.quantity);
    expect(snapshot.bids[4]!.quantity).toBeLessThan(snapshot.bids[0]!.quantity);
  });

  it('is deterministic given the same seed', () => {
    const build = () =>
      generateLiquiditySnapshot({
        referencePriceCents: 10000,
        expectedDailyVolume: 100000,
        volatilityHint: 0.02,
        profile: profile(),
        rng: createRng(Buffer.alloc(16, 9)),
      });
    expect(build()).toEqual(build());
  });

  it('produces a wider ladder for a more volatile stock, same profile otherwise', () => {
    const calm = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 100000,
      volatilityHint: 0.005,
      profile: profile({ bookLevels: 3 }),
      rng: createRng(Buffer.alloc(16, 1)),
    });
    const volatile = generateLiquiditySnapshot({
      referencePriceCents: 10000,
      expectedDailyVolume: 100000,
      volatilityHint: 0.1,
      profile: profile({ bookLevels: 3 }),
      rng: createRng(Buffer.alloc(16, 1)),
    });
    const calmDepthAsk = calm.asks[calm.asks.length - 1]!.priceCents - calm.asks[0]!.priceCents;
    const volatileDepthAsk = volatile.asks[volatile.asks.length - 1]!.priceCents - volatile.asks[0]!.priceCents;
    expect(volatileDepthAsk).toBeGreaterThan(calmDepthAsk);
  });
});
