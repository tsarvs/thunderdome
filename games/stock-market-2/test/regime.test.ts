import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { MARKET_REGIMES } from '../src/types.js';
import { INITIAL_REGIME, REGIME_PROFILES, nextRegime } from '../src/market/regime.js';

describe('REGIME_PROFILES', () => {
  it('defines a profile for every regime', () => {
    for (const regime of MARKET_REGIMES) {
      expect(REGIME_PROFILES[regime]).toBeDefined();
    }
  });

  it('CRISIS is the most volatile and least liquid regime', () => {
    const crisis = REGIME_PROFILES.CRISIS;
    for (const regime of MARKET_REGIMES) {
      if (regime === 'CRISIS') continue;
      expect(crisis.volatilityMultiplier).toBeGreaterThanOrEqual(REGIME_PROFILES[regime].volatilityMultiplier);
      expect(crisis.liquidityMultiplier).toBeLessThanOrEqual(REGIME_PROFILES[regime].liquidityMultiplier);
    }
  });
});

describe('nextRegime', () => {
  it('is deterministic given the same seed', () => {
    const a = nextRegime(INITIAL_REGIME, createRng(Buffer.alloc(16, 3)));
    const b = nextRegime(INITIAL_REGIME, createRng(Buffer.alloc(16, 3)));
    expect(a).toBe(b);
  });

  it('always returns a valid regime', () => {
    for (let seed = 0; seed < 50; seed++) {
      const regime = nextRegime(INITIAL_REGIME, createRng(Buffer.alloc(16, seed + 1)));
      expect(MARKET_REGIMES).toContain(regime);
    }
  });

  it('produces more than one outcome across many seeds (not degenerate)', () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      outcomes.add(nextRegime('SIDEWAYS', createRng(Buffer.alloc(16, seed + 1))));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('mostly persists — starting in BULL, the modal outcome across many seeds is still BULL', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 200; seed++) {
      const regime = nextRegime('BULL', createRng(Buffer.alloc(16, seed + 1)));
      counts.set(regime, (counts.get(regime) ?? 0) + 1);
    }
    const bullCount = counts.get('BULL') ?? 0;
    for (const [regime, count] of counts) {
      if (regime !== 'BULL') {
        expect(bullCount).toBeGreaterThan(count);
      }
    }
  });
});
