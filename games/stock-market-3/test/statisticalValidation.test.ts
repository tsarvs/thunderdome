import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { stockMarket3 } from '../src/game.js';
import { annualizedVolatility, correlationMatrix, logReturns } from '../src/validation/statisticalChecks.js';
import type { StockMarket3Action, StockMarket3Config } from '../src/types.js';

const PARTICIPANT_IDS = ['alice', 'bob'];
const ROUNDS = 260;

function config(): StockMarket3Config {
  const result = stockMarket3.parseConfig({ rounds: ROUNDS, warmupRounds: 0 });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function hold(): StockMarket3Action {
  return { orders: [] };
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

function runSeed(seed: number) {
  const rng = createRng(Buffer.alloc(16, seed));
  let state = stockMarket3.initialize({ config: config(), participantIds: PARTICIPANT_IDS, rng });
  const holdAll = new Map(PARTICIPANT_IDS.map((id) => [id, hold()]));
  for (let i = 0; i < ROUNDS; i++) {
    state = stockMarket3.resolve({ state, actions: holdAll, rng }).nextState;
  }
  const observation = stockMarket3.getObservation(state, 'alice');
  const returnsBySymbol: Record<string, number[]> = {};
  for (const security of observation.securities) {
    returnsBySymbol[security.symbol] = logReturns(security.priceHistory);
  }
  return { returnsBySymbol, indexWeights: state.indexWeights };
}

describe('statistical validation across seeds (spec §55/§56)', () => {
  const seedResults = [1, 2, 3].map((seed) => runSeed(seed));

  it('produces meaningful (non-zero) volatility for every security in every seed', () => {
    for (const { returnsBySymbol } of seedResults) {
      for (const [symbol, returns] of Object.entries(returnsBySymbol)) {
        expect(annualizedVolatility(returns), `symbol ${symbol}`).toBeGreaterThan(0);
      }
    }
  });

  it('correlation is neither degenerately perfect nor degenerately absent across the universe', () => {
    for (const { returnsBySymbol } of seedResults) {
      const matrix = correlationMatrix(returnsBySymbol);
      const symbols = Object.keys(returnsBySymbol);
      const offDiagonal: number[] = [];
      for (const a of symbols) {
        for (const b of symbols) {
          if (a !== b) {
            offDiagonal.push(must(matrix[a], `matrix row ${a}`)[b] ?? 0);
          }
        }
      }
      // Not everything moving in lockstep...
      expect(offDiagonal.some((c) => Math.abs(c) < 0.9)).toBe(true);
      // ...and not everything mutually independent either — shared economic-factor/market
      // exposure should show up as SOME meaningfully correlated pair.
      expect(offDiagonal.some((c) => Math.abs(c) > 0.15)).toBe(true);
    }
  });

  it('the index correlates meaningfully with the market-cap-weighted blend of its constituents (spec §19)', () => {
    for (const { returnsBySymbol, indexWeights } of seedResults) {
      const indexReturns = must(returnsBySymbol.SYNTH_INDEX, 'SYNTH_INDEX returns');
      const weightedConstituentReturns = indexReturns.map((_, i) => {
        let sum = 0;
        for (const [symbol, weight] of Object.entries(indexWeights)) {
          sum += weight * (returnsBySymbol[symbol]?.[i] ?? 0);
        }
        return sum;
      });
      const matrix = correlationMatrix({ SYNTH_INDEX: indexReturns, WEIGHTED: weightedConstituentReturns });
      expect(must(matrix.SYNTH_INDEX, 'matrix row SYNTH_INDEX').WEIGHTED ?? 0).toBeGreaterThan(0.3);
    }
  });

  it('different seeds produce visibly different market paths (not one hard-coded seed)', () => {
    // TECH_A may occasionally have been acquired/delisted partway through a given seed's run
    // (spec §42's dynamic universe) — fall back to the index, which always survives, if so.
    const finalReturns = seedResults.map(({ returnsBySymbol }) =>
      must(returnsBySymbol.TECH_A ?? returnsBySymbol.SYNTH_INDEX, 'TECH_A or SYNTH_INDEX returns').reduce((sum, v) => sum + v, 0),
    );
    const distinctValues = new Set(finalReturns.map((v) => v.toFixed(6)));
    expect(distinctValues.size).toBeGreaterThan(1);
  });
});

/**
 * Regression coverage for a real bug found during development: the economic-factor cross-links
 * were originally coupled to each upstream factor's persistent LEVEL rather than its per-round
 * shock, which (because a factor's stationary mean under a constant input scales as
 * `input / speed`) turned small link weights into a 5-13x gain per stage once chained across the
 * whole factor graph — every downstream factor saturated at its clamp within ~80 rounds, taking
 * every loaded security down with it (one seed produced a -99.7% index return over 100 rounds).
 * A full-length match is long enough for this class of bug to show up; a short one isn't.
 */
describe('long-run economic stability (regression coverage)', () => {
  const fullConfig = (() => {
    const result = stockMarket3.parseConfig({ rounds: 500, warmupRounds: 0 });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    return result.value;
  })();

  it('no hidden economic factor drifts to (or gets stuck at) its clamp over a full-length match', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = createRng(Buffer.alloc(16, seed));
      let state = stockMarket3.initialize({ config: fullConfig, participantIds: PARTICIPANT_IDS, rng });
      const holdAll = new Map(PARTICIPANT_IDS.map((id) => [id, hold()]));
      for (let i = 0; i < 500; i++) {
        state = stockMarket3.resolve({ state, actions: holdAll, rng }).nextState;
      }
      for (const [factor, value] of Object.entries(state.economicFactors)) {
        expect(Math.abs(value), `seed ${String(seed)}, factor ${factor}`).toBeLessThan(3);
      }
    }
  });

  it("the index never collapses toward zero or explodes over a full-length match's own default horizon", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = createRng(Buffer.alloc(16, seed));
      let state = stockMarket3.initialize({ config: fullConfig, participantIds: PARTICIPANT_IDS, rng });
      const holdAll = new Map(PARTICIPANT_IDS.map((id) => [id, hold()]));
      for (let i = 0; i < 500; i++) {
        state = stockMarket3.resolve({ state, actions: holdAll, rng }).nextState;
      }
      const result = stockMarket3.getResult(state);
      const cumulativeLogReturn = Math.log(result.indexFinalPrice / result.indexStartingPrice);
      expect(Math.abs(cumulativeLogReturn), `seed ${String(seed)}`).toBeLessThan(3);
    }
  });
});
