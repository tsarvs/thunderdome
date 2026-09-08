import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { stockMarket3 } from '../src/game.js';
import type { StockMarket3Action, StockMarket3State } from '../src/types.js';

const PARTICIPANT_IDS = ['alice', 'bob'];

/** Every field name that must NEVER appear in a bot's own observation JSON — the mechanical form
 * of spec §57's "Hidden Information Audit". Each of these lives only in `StockMarket3State`/
 * `SecurityState`, never in `StockMarket3Observation`. */
const HIDDEN_FIELD_NAMES = [
  'economicFactors',
  '"regime"',
  'factorLoadings',
  'styleLoadings',
  'marketBeta',
  '"fundamentals"',
  'fundamentalValueCents',
  'pendingActual',
  'lifecycleStage',
  'indexWeights',
  'lastEconomicReadings',
];

function config(overrides: Record<string, unknown> = {}) {
  const result = stockMarket3.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(overrides: Record<string, unknown> = {}, seed = 1): StockMarket3State {
  return stockMarket3.initialize({ config: config(overrides), participantIds: PARTICIPANT_IDS, rng: createRng(Buffer.alloc(16, seed)) });
}

function hold(): StockMarket3Action {
  return { orders: [] };
}

/** Runs `rounds` rounds forward with everyone holding, using the game's own RNG so hidden state
 * (events, corporate actions, analyst revisions) has a chance to actually populate. */
function advance(state: StockMarket3State, rounds: number, seed = 1): StockMarket3State {
  const rng = createRng(Buffer.alloc(16, seed));
  let next = state;
  for (let i = 0; i < rounds; i++) {
    next = stockMarket3.resolve({ state: next, actions: new Map(PARTICIPANT_IDS.map((id) => [id, hold()])), rng }).nextState;
  }
  return next;
}

describe('hidden information audit (spec §57)', () => {
  it('never serializes any hidden field name into a bot observation', () => {
    const state = advance(initialState({ rounds: 90, warmupRounds: 0 }), 85);
    for (const participantId of PARTICIPANT_IDS) {
      const json = JSON.stringify(stockMarket3.getObservation(state, participantId));
      for (const field of HIDDEN_FIELD_NAMES) {
        expect(json).not.toContain(field);
      }
    }
  });

  it("never includes another participant's portfolio", () => {
    const state = advance(initialState({ rounds: 20, warmupRounds: 0 }), 15);
    const observation = stockMarket3.getObservation(state, 'alice');
    expect(JSON.stringify(observation)).not.toContain('bob');
  });

  it('a security observation never carries a fixed pairwise correlation or precomputed alpha field', () => {
    const state = advance(initialState({ rounds: 20, warmupRounds: 0 }), 15);
    const observation = stockMarket3.getObservation(state, 'alice');
    const json = JSON.stringify(observation);
    for (const forbidden of ['correlation', 'momentumScore', 'fairValue', 'expectedReturn', 'alpha', 'beta', 'factorScore', 'marketRegime', 'riskOn', 'riskOff']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('no-future-information audit (spec §58)', () => {
  it('never shows a security event before its own observedAtRound', () => {
    const state = advance(initialState({ rounds: 90, warmupRounds: 0 }), 40);
    const observation = stockMarket3.getObservation(state, 'alice');
    for (const security of observation.securities) {
      for (const event of security.events) {
        expect(event.observedAtRound).toBeLessThanOrEqual(state.round);
      }
    }
    for (const event of observation.marketEvents) {
      expect(event.observedAtRound).toBeLessThanOrEqual(state.round);
    }
  });

  it('the analyst revision history never contains a revision from a future round', () => {
    const state = advance(initialState({ rounds: 90, warmupRounds: 0 }), 40);
    const observation = stockMarket3.getObservation(state, 'alice');
    for (const security of observation.securities) {
      for (const revision of security.analystRevisionHistory) {
        expect(revision.observedAtRound).toBeLessThanOrEqual(state.round);
      }
    }
  });

  it('priceHistory never has more entries than rounds actually played', () => {
    const state = advance(initialState({ rounds: 90, warmupRounds: 0 }), 10);
    const observation = stockMarket3.getObservation(state, 'alice');
    for (const security of observation.securities) {
      expect(security.priceHistory.length).toBeLessThanOrEqual(state.round);
    }
  });

  it('the calendar exposes future scheduled rounds but never an outcome for them', () => {
    const state = advance(initialState({ rounds: 90, warmupRounds: 0 }), 5);
    const observation = stockMarket3.getObservation(state, 'alice');
    const future = observation.calendar.filter((entry) => entry.round > state.round);
    expect(future.length).toBeGreaterThan(0);
    for (const entry of future) {
      expect(Object.keys(entry).sort()).toEqual(
        entry.type === 'EARNINGS_REPORT' ? ['round', 'symbol', 'type'].sort() : ['indicator', 'round', 'type'].sort(),
      );
    }
  });

  it('the latest reported fundamentals only ever reflect an already-published quarter', () => {
    // TECH_A's first earnings report is scheduled for round 10 (see market/events.ts staggering).
    const beforeReport = advance(initialState({ rounds: 90, warmupRounds: 0 }), 9);
    const beforeObservation = stockMarket3.getObservation(beforeReport, 'alice');
    const techABefore = beforeObservation.securities.find((s) => s.symbol === 'TECH_A');
    expect(techABefore?.latestFundamentals).toBeNull();

    const afterReport = advance(initialState({ rounds: 90, warmupRounds: 0 }), 10);
    const afterObservation = stockMarket3.getObservation(afterReport, 'alice');
    const techAAfter = afterObservation.securities.find((s) => s.symbol === 'TECH_A');
    expect(techAAfter?.latestFundamentals).not.toBeNull();
  });
});
