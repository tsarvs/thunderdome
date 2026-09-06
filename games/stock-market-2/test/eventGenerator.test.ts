import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { generateSyntheticEvent } from '../src/market/eventGenerator.js';
import { STOCK_MARKET_2_EVENT_TYPES } from '../src/types.js';

describe('generateSyntheticEvent', () => {
  it('is deterministic given the same seed', () => {
    const a = generateSyntheticEvent('SIDEWAYS', createRng(Buffer.alloc(16, 4)));
    const b = generateSyntheticEvent('SIDEWAYS', createRng(Buffer.alloc(16, 4)));
    expect(a).toEqual(b);
  });

  it('always produces one of the shared five event types', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { event } = generateSyntheticEvent('SIDEWAYS', createRng(Buffer.alloc(16, seed + 1)));
      expect(STOCK_MARKET_2_EVENT_TYPES).toContain(event.type);
    }
  });

  it('impactReturn is exactly 0 for NO_NEWS and nonzero otherwise, with the correct sign', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { event, impactReturn } = generateSyntheticEvent('SIDEWAYS', createRng(Buffer.alloc(16, seed + 1)));
      if (event.type === 'NO_NEWS') {
        expect(impactReturn).toBe(0);
      } else if (event.type === 'POSITIVE_NEWS' || event.type === 'EARNINGS_BEAT') {
        expect(impactReturn).toBeGreaterThan(0);
      } else {
        expect(impactReturn).toBeLessThan(0);
      }
    }
  });

  it('most rounds are NO_NEWS, same as real markets', () => {
    let noNewsCount = 0;
    const total = 500;
    for (let seed = 0; seed < total; seed++) {
      const { event } = generateSyntheticEvent('SIDEWAYS', createRng(Buffer.alloc(16, seed + 1)));
      if (event.type === 'NO_NEWS') noNewsCount++;
    }
    expect(noNewsCount / total).toBeGreaterThan(0.85);
  });

  it('CRISIS fires events more often than SIDEWAYS, and skews them negative', () => {
    const total = 1000;
    let sidewaysEvents = 0;
    let crisisEvents = 0;
    let crisisNegative = 0;
    for (let seed = 0; seed < total; seed++) {
      const rngSeed = Buffer.alloc(16, (seed % 250) + 1);
      const sideways = generateSyntheticEvent('SIDEWAYS', createRng(rngSeed));
      if (sideways.event.type !== 'NO_NEWS') sidewaysEvents++;
      const crisis = generateSyntheticEvent('CRISIS', createRng(rngSeed));
      if (crisis.event.type !== 'NO_NEWS') {
        crisisEvents++;
        if (crisis.impactReturn < 0) crisisNegative++;
      }
    }
    expect(crisisEvents).toBeGreaterThan(sidewaysEvents);
    expect(crisisNegative / crisisEvents).toBeGreaterThan(0.5);
  });
});
