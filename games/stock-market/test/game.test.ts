import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { stockMarket } from '../src/game.js';
import type {
  StockMarketAction,
  StockMarketConfig,
  StockMarketResult,
  StockMarketState,
} from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

function scoreOf(result: StockMarketResult, participantId: string): number {
  return result.scores[participantId] ?? 0;
}

function config(overrides: Record<string, unknown> = {}): StockMarketConfig {
  const result = stockMarket.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(
  overrides: Record<string, unknown> = {},
  participantIds = ['alice', 'bob'],
  seedRng = rng,
): StockMarketState {
  return stockMarket.initialize({ config: config(overrides), participantIds, rng: seedRng });
}

function actionsOf(entries: [string, StockMarketAction][]): Map<string, StockMarketAction> {
  return new Map(entries);
}

describe('stockMarket.parseConfig', () => {
  it('applies every documented default, leaving startingStockPrice unset (random by default)', () => {
    const result = stockMarket.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startingStockPrice).toBeUndefined();
      expect(result.value).toEqual({
        startingCash: 10000,
        rounds: 100,
        transactionFee: 0.001,
        priceHistoryLength: 20,
        randomShock: { min: -0.02, max: 0.02 },
        marketImpactFactor: 0.0014,
        meanReversionFactor: 0.05,
        minimumStockPrice: 0.01,
        events: {
          NO_NEWS: { baselineMultiplier: 1.0, volatility: 0.25, weight: 60 },
          POSITIVE_NEWS: { baselineMultiplier: 1.02, volatility: 0.25, weight: 8 },
          NEGATIVE_NEWS: { baselineMultiplier: 0.98, volatility: 0.25, weight: 8 },
          ANALYST_UPGRADE: { baselineMultiplier: 1.03, volatility: 0.25, weight: 6 },
          ANALYST_DOWNGRADE: { baselineMultiplier: 0.97, volatility: 0.25, weight: 6 },
          PRODUCT_SUCCESS: { baselineMultiplier: 1.04, volatility: 0.25, weight: 5 },
          PRODUCT_FAILURE: { baselineMultiplier: 0.96, volatility: 0.25, weight: 5 },
          EARNINGS_BEAT: { baselineMultiplier: 1.05, volatility: 0.25, weight: 1 },
          EARNINGS_MISS: { baselineMultiplier: 0.95, volatility: 0.25, weight: 1 },
        },
      });
    }
  });

  it('rejects randomShock.min > randomShock.max', () => {
    const result = stockMarket.parseConfig({ randomShock: { min: 0.05, max: -0.05 } });
    expect(result.ok).toBe(false);
  });

  it('lets a caller override just one event type, defaulting the rest', () => {
    const result = stockMarket.parseConfig({
      events: { EARNINGS_BEAT: { baselineMultiplier: 1.5, volatility: 0.25, weight: 1 } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.EARNINGS_BEAT).toEqual({
        baselineMultiplier: 1.5,
        volatility: 0.25,
        weight: 1,
      });
      // Every other event type is untouched by the override.
      expect(result.value.events.NO_NEWS).toEqual({
        baselineMultiplier: 1.0,
        volatility: 0.25,
        weight: 60,
      });
    }
  });

  it('rejects an event config where every weight is zero', () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 0.25, weight: 0 };
    const result = stockMarket.parseConfig({
      events: Object.fromEntries(
        [
          'NO_NEWS',
          'POSITIVE_NEWS',
          'NEGATIVE_NEWS',
          'ANALYST_UPGRADE',
          'ANALYST_DOWNGRADE',
          'PRODUCT_SUCCESS',
          'PRODUCT_FAILURE',
          'EARNINGS_BEAT',
          'EARNINGS_MISS',
        ].map((type) => [type, zeroWeight]),
      ),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects minimumStockPrice above startingStockPrice', () => {
    const result = stockMarket.parseConfig({ startingStockPrice: 10, minimumStockPrice: 20 });
    expect(result.ok).toBe(false);
  });

  it('rejects a transactionFee outside [0, 1]', () => {
    expect(stockMarket.parseConfig({ transactionFee: -0.1 }).ok).toBe(false);
    expect(stockMarket.parseConfig({ transactionFee: 1.5 }).ok).toBe(false);
  });
});

describe('stockMarket.redactConfigForBots', () => {
  it('strips baselineMultiplier and volatility from every event type, keeping only weight', () => {
    const redacted = stockMarket.redactConfigForBots?.(config()) as {
      events: Record<string, Record<string, unknown>>;
    };
    for (const eventConfig of Object.values(redacted.events)) {
      expect(Object.keys(eventConfig)).toEqual(['weight']);
    }
    expect(redacted.events.EARNINGS_BEAT).toEqual({ weight: 1 });
  });

  it('leaves every other top-level config field untouched', () => {
    const fullConfig = config({ startingCash: 5000, rounds: 42 });
    const redacted = stockMarket.redactConfigForBots?.(fullConfig) as Record<string, unknown>;
    expect(redacted.startingCash).toBe(5000);
    expect(redacted.rounds).toBe(42);
    expect(redacted.transactionFee).toBe(fullConfig.transactionFee);
  });
});

describe('stockMarket.initialize', () => {
  it('gives every participant the configured starting cash and zero shares', () => {
    const state = initialState({ startingCash: 5000 }, ['alice', 'bob', 'carol']);
    for (const id of ['alice', 'bob', 'carol']) {
      const observation = stockMarket.getObservation(state, id);
      expect(observation.portfolio.cash).toBe(5000);
      expect(observation.portfolio.shares).toBe(0);
      expect(observation.portfolio.value).toBe(5000);
    }
  });

  it('starts priceHistory with exactly the starting price', () => {
    const state = initialState({ startingStockPrice: 42 });
    const observation = stockMarket.getObservation(state, 'alice');
    expect(observation.market.price).toBe(42);
    expect(observation.market.priceHistory).toEqual([42]);
  });

  it('has no prior volume to report before round 0 resolves', () => {
    const state = initialState();
    expect(stockMarket.getObservation(state, 'alice').market.lastRoundVolume).toBeNull();
  });

  it('always produces a public event, even when it is NO_NEWS', () => {
    const state = initialState();
    expect(stockMarket.getObservation(state, 'alice').event.type).toBeDefined();
  });

  it('never leaks the hidden fundamental value through the observation', () => {
    const state = initialState();
    const observation: unknown = stockMarket.getObservation(state, 'alice');
    expect(JSON.stringify(observation)).not.toContain('fundamentalValue');
  });

  it("never leaks one participant's portfolio through another's observation", () => {
    const state = initialState({}, ['alice', 'bob']);
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 10 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const bobObservation: unknown = stockMarket.getObservation(nextState, 'bob');
    expect(JSON.stringify(bobObservation)).not.toContain('alice');
  });
});

describe('stockMarket.initialize — random starting price', () => {
  it('draws a random starting price within the default range when startingStockPrice is omitted', () => {
    const state = initialState({}, ['alice', 'bob'], createRng(Buffer.alloc(16, 3)));
    const price = stockMarket.getObservation(state, 'alice').market.price;
    expect(price).toBeGreaterThanOrEqual(50);
    expect(price).toBeLessThanOrEqual(200);
  });

  it('draws a different starting price for a different seed', () => {
    const priceFor = (seed: number) =>
      stockMarket.getObservation(
        initialState({}, ['alice', 'bob'], createRng(Buffer.alloc(16, seed))),
        'alice',
      ).market.price;
    expect(priceFor(3)).not.toBe(priceFor(9));
  });

  it('draws the same starting price again given the same seed (still fully deterministic)', () => {
    const priceFor = () =>
      stockMarket.getObservation(
        initialState({}, ['alice', 'bob'], createRng(Buffer.alloc(16, 5))),
        'alice',
      ).market.price;
    expect(priceFor()).toBe(priceFor());
  });

  it('still uses an explicit startingStockPrice exactly, never randomizing it', () => {
    const priceFor = (seed: number) =>
      stockMarket.getObservation(
        initialState(
          { startingStockPrice: 77 },
          ['alice', 'bob'],
          createRng(Buffer.alloc(16, seed)),
        ),
        'alice',
      ).market.price;
    expect(priceFor(3)).toBe(77);
    expect(priceFor(9)).toBe(77);
  });

  it('clamps a random draw up to a custom minimumStockPrice above the default range', () => {
    const state = initialState(
      { minimumStockPrice: 300 },
      ['alice', 'bob'],
      createRng(Buffer.alloc(16, 3)),
    );
    expect(stockMarket.getObservation(state, 'alice').market.price).toBeGreaterThanOrEqual(300);
  });

  it('getResult reports the actual resolved starting price, not the (possibly unset) config field', () => {
    const state = initialState({}, ['alice', 'bob'], createRng(Buffer.alloc(16, 3)));
    const observedStartingPrice = stockMarket.getObservation(state, 'alice').market.price;
    expect(stockMarket.getResult(state).startingStockPrice).toBe(observedStartingPrice);
  });
});

describe('stockMarket.getPendingActions', () => {
  it('requires an action from every participant, every round', () => {
    const state = initialState({}, ['alice', 'bob', 'carol']);
    expect(stockMarket.getPendingActions(state)).toEqual([
      { participantId: 'alice', required: true },
      { participantId: 'bob', required: true },
      { participantId: 'carol', required: true },
    ]);
  });
});

describe('stockMarket.validateAction', () => {
  it('accepts a well-formed BUY within available cash', () => {
    const state = initialState({ startingCash: 10000, startingStockPrice: 100 });
    const result = stockMarket.validateAction(state, 'alice', { action: 'BUY', quantity: 10 });
    expect(result.ok).toBe(true);
  });

  it('rejects a BUY that costs more than the participant has', () => {
    const state = initialState({ startingCash: 100, startingStockPrice: 100 });
    const result = stockMarket.validateAction(state, 'alice', { action: 'BUY', quantity: 5 });
    expect(result.ok).toBe(false);
  });

  it('rejects a SELL for more shares than the participant owns', () => {
    const state = initialState();
    const result = stockMarket.validateAction(state, 'alice', { action: 'SELL', quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects a negative or fractional quantity', () => {
    const state = initialState();
    expect(stockMarket.validateAction(state, 'alice', { action: 'BUY', quantity: -5 }).ok).toBe(
      false,
    );
    expect(stockMarket.validateAction(state, 'alice', { action: 'BUY', quantity: 1.5 }).ok).toBe(
      false,
    );
    expect(stockMarket.validateAction(state, 'alice', { action: 'BUY', quantity: 0 }).ok).toBe(
      false,
    );
  });

  it('rejects HOLD with a quantity attached', () => {
    const state = initialState();
    const result = stockMarket.validateAction(state, 'alice', { action: 'HOLD', quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown or missing action', () => {
    const state = initialState();
    expect(stockMarket.validateAction(state, 'alice', { action: 'SHORT' }).ok).toBe(false);
    expect(stockMarket.validateAction(state, 'alice', {}).ok).toBe(false);
    expect(stockMarket.validateAction(state, 'alice', 'not json').ok).toBe(false);
  });
});

describe('stockMarket.resolve — accounting', () => {
  it('decreases cash by trade value plus fee and increases shares on a BUY', () => {
    const state = initialState({
      startingCash: 10000,
      startingStockPrice: 100,
      transactionFee: 0.001,
    });
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 10 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const alice = stockMarket.getObservation(nextState, 'alice');
    // $1,000 gross + $1 fee (0.10% of $1,000), matching the design doc's own worked example.
    expect(alice.portfolio.cash).toBeCloseTo(10000 - 1000 - 1, 5);
    expect(alice.portfolio.shares).toBe(10);
  });

  it('increases cash by trade value minus fee and decreases shares on a SELL', () => {
    const state = initialState({
      startingCash: 10000,
      startingStockPrice: 100,
      transactionFee: 0.001,
    });
    const afterBuy = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 10 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const cashAfterBuy = stockMarket.getObservation(afterBuy, 'alice').portfolio.cash;
    const priceAfterBuy = stockMarket.getObservation(afterBuy, 'alice').market.price;

    const afterSell = stockMarket.resolve({
      state: afterBuy,
      actions: actionsOf([
        ['alice', { action: 'SELL', quantity: 5 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const alice = stockMarket.getObservation(afterSell, 'alice');
    // Fees are computed in integer cents (round-half-up), same as the implementation — a plain
    // dollar-float fee here would drift from the engine's own rounding by fractions of a cent.
    const grossProceedsCents = Math.round(5 * priceAfterBuy * 100);
    const feeCents = Math.floor(grossProceedsCents * 0.001 + 0.5);
    const expectedCash = cashAfterBuy + (grossProceedsCents - feeCents) / 100;
    expect(alice.portfolio.cash).toBeCloseTo(expectedCash, 5);
    expect(alice.portfolio.shares).toBe(5);
  });

  it('computes portfolio value as cash + shares * current price', () => {
    const state = initialState({ startingCash: 10000, startingStockPrice: 100 });
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 10 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const alice = stockMarket.getObservation(nextState, 'alice');
    expect(alice.portfolio.value).toBeCloseTo(
      alice.portfolio.cash + alice.portfolio.shares * alice.market.price,
      5,
    );
  });

  it('HOLD changes neither cash nor shares', () => {
    const state = initialState();
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'HOLD' }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const alice = stockMarket.getObservation(nextState, 'alice');
    expect(alice.portfolio.cash).toBe(10000);
    expect(alice.portfolio.shares).toBe(0);
  });

  it("records the round's aggregate volume for the next observation", () => {
    const state = initialState({}, ['alice', 'bob', 'carol']);
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 10 }],
        ['bob', { action: 'SELL', quantity: 3 }],
        ['carol', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    // bob has no shares to sell yet, so his SELL is a no-op — only alice's BUY actually trades.
    expect(stockMarket.getObservation(nextState, 'alice').market.lastRoundVolume).toEqual({
      sharesBought: 10,
      sharesSold: 0,
      netDemand: 10,
    });
  });
});

describe('stockMarket.resolve — configurable events', () => {
  it('always draws the one event type given all of the weight', () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 0.25, weight: 0 };
    let state = initialState({
      events: {
        NO_NEWS: zeroWeight,
        POSITIVE_NEWS: zeroWeight,
        NEGATIVE_NEWS: zeroWeight,
        ANALYST_UPGRADE: zeroWeight,
        ANALYST_DOWNGRADE: zeroWeight,
        PRODUCT_SUCCESS: zeroWeight,
        PRODUCT_FAILURE: zeroWeight,
        EARNINGS_MISS: zeroWeight,
        EARNINGS_BEAT: { baselineMultiplier: 1.2, volatility: 0.25, weight: 1 },
      },
    });
    for (let round = 0; round < 10; round += 1) {
      expect(stockMarket.getObservation(state, 'alice').event.type).toBe('EARNINGS_BEAT');
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
    }
  });
});

describe('stockMarket — event effect ratios (baseline + per-match variation + in-match drift)', () => {
  it('volatility 0 keeps every event exactly at its baseline multiplier (deterministic, backward compatible)', () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 0, weight: 0 };
    let state = initialState({
      startingStockPrice: 100,
      events: {
        NO_NEWS: zeroWeight,
        POSITIVE_NEWS: zeroWeight,
        NEGATIVE_NEWS: zeroWeight,
        ANALYST_UPGRADE: zeroWeight,
        ANALYST_DOWNGRADE: zeroWeight,
        PRODUCT_SUCCESS: zeroWeight,
        PRODUCT_FAILURE: zeroWeight,
        EARNINGS_MISS: zeroWeight,
        EARNINGS_BEAT: { baselineMultiplier: 1.2, volatility: 0, weight: 1 },
      },
    });
    // Round 0's event is already applied at initialize()'s own look-ahead draw.
    let expectedFundamentalValue = 100 * 1.2;
    expect(state.fundamentalValue).toBeCloseTo(expectedFundamentalValue, 10);
    for (let round = 0; round < 5; round += 1) {
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
      expectedFundamentalValue *= 1.2;
      expect(state.fundamentalValue).toBeCloseTo(expectedFundamentalValue, 10);
    }
  });

  it("NO_NEWS's zero baseline effect is unaffected by its effect ratio, however volatile", () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 1, weight: 0 };
    let state = initialState({
      startingStockPrice: 100,
      events: {
        NO_NEWS: { baselineMultiplier: 1.0, volatility: 1, weight: 1 },
        POSITIVE_NEWS: zeroWeight,
        NEGATIVE_NEWS: zeroWeight,
        ANALYST_UPGRADE: zeroWeight,
        ANALYST_DOWNGRADE: zeroWeight,
        PRODUCT_SUCCESS: zeroWeight,
        PRODUCT_FAILURE: zeroWeight,
        EARNINGS_BEAT: zeroWeight,
        EARNINGS_MISS: zeroWeight,
      },
    });
    for (let round = 0; round < 20; round += 1) {
      expect(state.fundamentalValue).toBeCloseTo(100, 10);
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
    }
  });

  it('draws a different per-match effect ratio for the same event type across differently seeded matches', () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 0, weight: 0 };
    const events = {
      NO_NEWS: zeroWeight,
      POSITIVE_NEWS: zeroWeight,
      NEGATIVE_NEWS: zeroWeight,
      ANALYST_UPGRADE: zeroWeight,
      ANALYST_DOWNGRADE: zeroWeight,
      PRODUCT_SUCCESS: zeroWeight,
      PRODUCT_FAILURE: zeroWeight,
      EARNINGS_MISS: zeroWeight,
      EARNINGS_BEAT: { baselineMultiplier: 1.2, volatility: 0.25, weight: 1 },
    };
    const ratios = [1, 2, 3].map((seedByte) => {
      const state = initialState(
        { events },
        ['alice', 'bob'],
        createRng(Buffer.alloc(16, seedByte)),
      );
      return state.eventEffectRatios.EARNINGS_BEAT;
    });
    expect(new Set(ratios).size).toBeGreaterThan(1);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThanOrEqual(0.75);
      expect(ratio).toBeLessThanOrEqual(1.25);
    }
  });

  it("drifts a recurring event type's effect ratio round over round while staying within its volatility corridor", () => {
    const zeroWeight = { baselineMultiplier: 1.0, volatility: 0.25, weight: 0 };
    let state = initialState({
      events: {
        NO_NEWS: zeroWeight,
        POSITIVE_NEWS: zeroWeight,
        NEGATIVE_NEWS: zeroWeight,
        ANALYST_UPGRADE: zeroWeight,
        ANALYST_DOWNGRADE: zeroWeight,
        PRODUCT_SUCCESS: zeroWeight,
        PRODUCT_FAILURE: zeroWeight,
        EARNINGS_MISS: zeroWeight,
        EARNINGS_BEAT: { baselineMultiplier: 1.2, volatility: 0.25, weight: 1 },
      },
    });
    const observedRatios = [state.eventEffectRatios.EARNINGS_BEAT];
    for (let round = 0; round < 30; round += 1) {
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
      observedRatios.push(state.eventEffectRatios.EARNINGS_BEAT);
    }
    for (const ratio of observedRatios) {
      expect(ratio).toBeGreaterThanOrEqual(0.75);
      expect(ratio).toBeLessThanOrEqual(1.25);
    }
    // Genuinely wanders round to round rather than being pinned at one value.
    expect(new Set(observedRatios).size).toBeGreaterThan(1);
  });
});

describe('stockMarket.resolve — market', () => {
  it('never lets the price fall to zero or below, however extreme the config', () => {
    let state = initialState({
      startingStockPrice: 1,
      minimumStockPrice: 0.01,
      randomShock: { min: -0.5, max: -0.5 },
      meanReversionFactor: 0,
      marketImpactFactor: 0,
    });
    for (let round = 0; round < 50; round += 1) {
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
      expect(stockMarket.getObservation(state, 'alice').market.price).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('bounds priceHistory to the configured window', () => {
    let state = initialState({ priceHistoryLength: 3 });
    for (let round = 0; round < 10; round += 1) {
      state = stockMarket.resolve({
        state,
        actions: actionsOf([
          ['alice', { action: 'HOLD' }],
          ['bob', { action: 'HOLD' }],
        ]),
        rng,
      }).nextState;
    }
    expect(stockMarket.getObservation(state, 'alice').market.priceHistory).toHaveLength(3);
  });

  it('produces an identical sequence of prices given the same seed, config, and actions', () => {
    function runMatch(): number[] {
      const seededRng = createRng(Buffer.alloc(16, 7));
      let state = stockMarket.initialize({
        config: config(),
        participantIds: ['alice', 'bob'],
        rng: seededRng,
      });
      const prices: number[] = [stockMarket.getObservation(state, 'alice').market.price];
      for (let round = 0; round < 30; round += 1) {
        state = stockMarket.resolve({
          state,
          actions: actionsOf([
            [
              'alice',
              { action: round % 2 === 0 ? 'BUY' : 'SELL', quantity: round % 2 === 0 ? 5 : 3 },
            ],
            ['bob', { action: 'HOLD' }],
          ]),
          rng: seededRng,
        }).nextState;
        prices.push(stockMarket.getObservation(state, 'alice').market.price);
      }
      return prices;
    }

    expect(runMatch()).toEqual(runMatch());
  });
});

describe('stockMarket.onMissingAction', () => {
  it('always substitutes HOLD rather than forfeiting the match', () => {
    const state = initialState();
    const decision = stockMarket.onMissingAction?.({
      state,
      participantId: 'alice',
      reason: 'invalid',
    });
    expect(decision).toEqual({ policy: 'substitute', action: { action: 'HOLD' } });
  });
});

describe('stockMarket.isTerminal / getResult', () => {
  it('is not terminal before the configured round count, and is at/after it', () => {
    let state = initialState({ rounds: 2 });
    expect(stockMarket.isTerminal(state)).toBe(false);
    state = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'HOLD' }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    expect(stockMarket.isTerminal(state)).toBe(false);
    state = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'HOLD' }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    expect(stockMarket.isTerminal(state)).toBe(true);
  });

  it('declares the higher-portfolio-value participant the winner', () => {
    const state = initialState({ startingCash: 10000, startingStockPrice: 100 });
    const nextState = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'BUY', quantity: 50 }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const result = stockMarket.getResult(nextState);
    // Whichever way the price moved this round, alice and bob started identically except for
    // alice's trade, so this is a real test of getResult picking the actual higher score, not a
    // coincidence of the fixture.
    const expectedWinner = scoreOf(result, 'alice') > scoreOf(result, 'bob') ? 'alice' : 'bob';
    expect(result.winnerId).toBe(expectedWinner);
  });

  it('reports no winner when the final scores tie exactly', () => {
    const state = initialState({}, ['alice', 'bob']);
    const result = stockMarket.getResult(state); // round 0, nobody has traded — an exact tie.
    expect(scoreOf(result, 'alice')).toBe(scoreOf(result, 'bob'));
    expect(result.winnerId).toBeNull();
  });

  it('reports the configured starting price alongside the final price', () => {
    let state = initialState({ startingStockPrice: 55 });
    state = stockMarket.resolve({
      state,
      actions: actionsOf([
        ['alice', { action: 'HOLD' }],
        ['bob', { action: 'HOLD' }],
      ]),
      rng,
    }).nextState;
    const result = stockMarket.getResult(state);
    expect(result.startingStockPrice).toBe(55);
    expect(result.finalStockPrice).toBe(stockMarket.getObservation(state, 'alice').market.price);
  });
});

describe('stockMarket.getStandingOutcomes', () => {
  it('ranks strictly by score and marks the top scorer a win', () => {
    const result = {
      participantIds: ['alice', 'bob', 'carol'],
      scores: { alice: 12000, bob: 9000, carol: 11000 },
      cash: { alice: 12000, bob: 9000, carol: 11000 },
      shares: { alice: 0, bob: 0, carol: 0 },
      startingStockPrice: 100,
      finalStockPrice: 100,
      roundsPlayed: 100,
      winnerId: 'alice',
    };
    const outcomes = stockMarket.getStandingOutcomes(result);
    expect(outcomes).toEqual([
      { participantId: 'alice', rank: 1, score: 12000, outcome: 'win' },
      { participantId: 'bob', rank: 3, score: 9000, outcome: 'loss' },
      { participantId: 'carol', rank: 2, score: 11000, outcome: 'loss' },
    ]);
  });

  it('marks every tied leader a draw at rank 1', () => {
    const result = {
      participantIds: ['alice', 'bob'],
      scores: { alice: 10000, bob: 10000 },
      cash: { alice: 10000, bob: 10000 },
      shares: { alice: 0, bob: 0 },
      startingStockPrice: 100,
      finalStockPrice: 100,
      roundsPlayed: 100,
      winnerId: null,
    };
    const outcomes = stockMarket.getStandingOutcomes(result);
    expect(outcomes).toEqual([
      { participantId: 'alice', rank: 1, score: 10000, outcome: 'draw' },
      { participantId: 'bob', rank: 1, score: 10000, outcome: 'draw' },
    ]);
  });
});
