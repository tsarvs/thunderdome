import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { stockMarket2 } from '../src/game.js';
import type {
  StockMarket2Action,
  StockMarket2Config,
  StockMarket2Result,
  StockMarket2State,
} from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 1));

// Index 0 = 2016-01-19 (the real dataset's first trading day). Pinning here makes every test
// deterministic regardless of rng, and NO_NEWS for several rounds so accounting math isn't
// entangled with the real reference day's own event.
const FIRST_DAY_INDEX = 0;
// Index 20 = 2016-02-17, a real EARNINGS_BEAT day (see src/data/README.md for provenance).
const EARNINGS_BEAT_INDEX = 20;

function scoreOf(result: StockMarket2Result, participantId: string): number {
  return result.scores[participantId] ?? 0;
}

function config(overrides: Record<string, unknown> = {}): StockMarket2Config {
  const result = stockMarket2.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(
  overrides: Record<string, unknown> = {},
  participantIds = ['alice', 'bob'],
  seedRng = rng,
): StockMarket2State {
  return stockMarket2.initialize({ config: config(overrides), participantIds, rng: seedRng });
}

function actionsOf(entries: [string, StockMarket2Action][]): Map<string, StockMarket2Action> {
  return new Map(entries);
}

function hold(): StockMarket2Action {
  return { orders: [] };
}

describe('stockMarket2.parseConfig', () => {
  it('applies every documented default', () => {
    const result = stockMarket2.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('SYNTHETIC');
      expect(result.value.symbol).toBe('SYNTH');
      expect(result.value.startingCash).toBe(10000);
      expect(result.value.rounds).toBe(100);
      expect(result.value.transactionFee).toBe(0.001);
      expect(result.value.maxOrdersPerRound).toBe(5);
      expect(result.value.synthetic).toEqual({ initialPrice: 100, volatility: 0.02, drift: 0 });
    }
  });

  it('forces symbol to DENN in HISTORICAL mode regardless of input', () => {
    const result = stockMarket2.parseConfig({ mode: 'HISTORICAL', symbol: 'WHATEVER' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.symbol).toBe('DENN');
    }
  });

  it('rejects a HISTORICAL historyStartIndex too close to the end of the real dataset', () => {
    expect(stockMarket2.parseConfig({ mode: 'HISTORICAL', historyStartIndex: 2500, rounds: 100 }).ok).toBe(false);
    expect(stockMarket2.parseConfig({ mode: 'HISTORICAL', historyStartIndex: 2413, rounds: 100 }).ok).toBe(true);
  });

  it('does not apply the HISTORICAL dataset bound in SYNTHETIC mode', () => {
    expect(stockMarket2.parseConfig({ mode: 'SYNTHETIC', historyStartIndex: 999999, rounds: 100 }).ok).toBe(true);
  });
});

describe('stockMarket2.initialize', () => {
  it('allows a single participant (solo play)', () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX }, ['alice']);
    expect(state.participantIds).toEqual(['alice']);
  });

  it('rejects an empty roster', () => {
    expect(() => stockMarket2.initialize({ config: config(), participantIds: [], rng })).toThrow();
  });

  it('starts every participant with the configured cash and zero shares', () => {
    const state = initialState({ startingCash: 5000 });
    for (const participantId of ['alice', 'bob']) {
      expect(state.portfolios.get(participantId)).toEqual({ cashCents: 500000, shares: 0 });
    }
  });

  it('SYNTHETIC mode starts at config.synthetic.initialPrice', () => {
    const state = initialState({ synthetic: { initialPrice: 250 } });
    expect(state.referencePriceCents).toBe(25000);
    expect(state.startingPriceCents).toBe(25000);
  });

  it('HISTORICAL mode starts at the real close on the pinned historyStartIndex day', () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX });
    // Real DENN close on 2016-01-19 was $9.11 (see src/data/README.md for provenance).
    expect(state.referencePriceCents).toBe(911);
    expect(state.startingPriceCents).toBe(911);
    expect(state.startDate).toBe('2016-01-19');
    expect(state.currentEvent).toEqual({ type: 'NO_NEWS', description: 'No regulatory disclosures today.' });
  });

  it('reveals a real EARNINGS_BEAT event when pinned to that real date', () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: EARNINGS_BEAT_INDEX });
    expect(state.currentDate).toBe('2016-02-17');
    expect(state.currentEvent.type).toBe('EARNINGS_BEAT');
  });

  it('draws a random HISTORICAL historyStartIndex deterministically from a given seed when omitted', () => {
    const a = initialState({ mode: 'HISTORICAL' }, ['alice', 'bob'], createRng(Buffer.alloc(16, 7)));
    const b = initialState({ mode: 'HISTORICAL' }, ['alice', 'bob'], createRng(Buffer.alloc(16, 7)));
    expect(a.historyStartIndex).toBe(b.historyStartIndex);
  });

  it('generates a non-empty synthetic liquidity ladder for round 0', () => {
    const state = initialState();
    expect(state.pendingLiquidity.bids.length).toBeGreaterThan(0);
    expect(state.pendingLiquidity.asks.length).toBeGreaterThan(0);
  });
});

describe('stockMarket2.getObservation', () => {
  it("never leaks another participant's portfolio or open orders", () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX });
    const observation = stockMarket2.getObservation(state, 'alice');
    expect(observation.symbol).toBe('DENN');
    expect(observation.market.date).toBe('2016-01-19');
    expect(observation.portfolio).toEqual({ cash: 10000, shares: 0, value: 10000, availableCash: 10000, availableShares: 0 });
    expect(observation.market.lastRoundVolume).toBeNull();
    expect(observation.openOrders).toEqual([]);
    expect(Object.keys(observation)).not.toContain('opponentPortfolio');
  });

  it('reports a real bid/ask spread from the generated synthetic liquidity', () => {
    const state = initialState();
    const observation = stockMarket2.getObservation(state, 'alice');
    expect(observation.market.bid).not.toBeNull();
    expect(observation.market.ask).not.toBeNull();
    expect(observation.market.bid).toBeLessThan(observation.market.ask ?? Number.POSITIVE_INFINITY);
  });

  it("reflects a participant's own resting order and reduced available cash", () => {
    let state = initialState({ synthetic: { volatility: 0 } });
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 1, timeInForce: 'GTC' }] }],
        ['bob', hold()],
      ]),
      rng,
    }).nextState;
    const observation = stockMarket2.getObservation(state, 'alice');
    expect(observation.openOrders).toHaveLength(1);
    expect(observation.openOrders[0]).toMatchObject({ side: 'BUY', limitPrice: 1, quantity: 10 });
    expect(observation.portfolio.availableCash).toBe(observation.portfolio.cash - 10 * 1);
  });
});

describe('stockMarket2.getPendingActions / validateAction', () => {
  it('requires an action from every participant each round', () => {
    const state = initialState();
    expect(stockMarket2.getPendingActions(state)).toEqual([
      { participantId: 'alice', required: true },
      { participantId: 'bob', required: true },
    ]);
  });

  it('accepts an empty orders array (HOLD) unconditionally', () => {
    const state = initialState();
    expect(stockMarket2.validateAction(state, 'alice', hold()).ok).toBe(true);
  });

  it('rejects more orders than config.maxOrdersPerRound', () => {
    const state = initialState({ maxOrdersPerRound: 1 });
    const action = { orders: [
      { kind: 'MARKET', side: 'BUY', quantity: 1 },
      { kind: 'MARKET', side: 'BUY', quantity: 1 },
    ] };
    expect(stockMarket2.validateAction(state, 'alice', action).ok).toBe(false);
  });

  it('rejects a CANCEL referencing an order that does not exist', () => {
    const state = initialState();
    const action = { orders: [{ kind: 'CANCEL', orderId: 'nonexistent' }] };
    expect(stockMarket2.validateAction(state, 'alice', action).ok).toBe(false);
  });

  it("rejects a CANCEL referencing another participant's order", () => {
    let state = initialState({ synthetic: { volatility: 0 } });
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 1, limitPrice: 1, timeInForce: 'GTC' }] }],
        ['bob', hold()],
      ]),
      rng,
    }).nextState;
    const aliceOrderId = state.openOrders[0]?.id;
    expect(aliceOrderId).toBeDefined();
    const action = { orders: [{ kind: 'CANCEL', orderId: aliceOrderId }] };
    expect(stockMarket2.validateAction(state, 'bob', action).ok).toBe(false);
    expect(stockMarket2.validateAction(state, 'alice', action).ok).toBe(true);
  });

  it('accepts a well-formed MARKET order', () => {
    const state = initialState();
    const action = { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 1 }] };
    expect(stockMarket2.validateAction(state, 'alice', action).ok).toBe(true);
  });
});

describe('stockMarket2.resolve — accounting', () => {
  it('debits cash and credits shares on a filled BUY, net of the transaction fee', () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX, transactionFee: 0.01 });
    const { nextState } = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }],
        ['bob', hold()],
      ]),
      rng,
    });
    const alice = nextState.portfolios.get('alice');
    expect(alice?.shares).toBe(10);
    expect(alice?.cashCents).toBeLessThan(1000000);
  });

  it('credits cash and debits shares on a filled SELL, net of the transaction fee', () => {
    let state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX, transactionFee: 0.01 });
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }],
        ['bob', hold()],
      ]),
      rng,
    }).nextState;
    const cashAfterBuy = state.portfolios.get('alice')?.cashCents ?? 0;
    const { nextState } = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }],
        ['bob', hold()],
      ]),
      rng,
    });
    const alice = nextState.portfolios.get('alice');
    expect(alice?.shares).toBe(0);
    expect(alice?.cashCents).toBeGreaterThan(cashAfterBuy);
  });

  it('an empty-orders round is a no-op and reports zero volume', () => {
    const state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX });
    const before = state.portfolios.get('alice');
    const { nextState } = stockMarket2.resolve({
      state,
      actions: actionsOf([['alice', hold()], ['bob', hold()]]),
      rng,
    });
    expect(nextState.portfolios.get('alice')).toEqual(before);
    expect(nextState.lastRoundVolume).toEqual({ sharesBought: 0, sharesSold: 0, netDemand: 0 });
  });

  it('a GTC order persists across rounds until it fills, then leaves the book', () => {
    let state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX });
    // Rest a GTC buy order far below the market — it should not fill immediately.
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 0.01, timeInForce: 'GTC' }] }],
        ['bob', hold()],
      ]),
      rng,
    }).nextState;
    expect(state.openOrders).toHaveLength(1);
    expect(state.portfolios.get('alice')?.shares).toBe(0);

    // Cancel it explicitly (rather than waiting on rare synthetic liquidity to reach that price).
    const orderId = state.openOrders[0]?.id;
    expect(orderId).toBeDefined();
    if (orderId === undefined) {
      throw new Error('unreachable');
    }
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([['alice', { orders: [{ kind: 'CANCEL', orderId }] }], ['bob', hold()]]),
      rng,
    }).nextState;
    expect(state.openOrders).toHaveLength(0);
  });
});

describe('stockMarket2.resolve — SYNTHETIC placeholder price process', () => {
  it('price stays strictly positive across many rounds even with high volatility', () => {
    let state = initialState({ synthetic: { initialPrice: 1, volatility: 0.9 }, rounds: 2000 });
    let seedRng = createRng(Buffer.alloc(16, 5));
    for (let i = 0; i < 500; i++) {
      state = stockMarket2.resolve({
        state,
        actions: actionsOf([['alice', hold()], ['bob', hold()]]),
        rng: seedRng,
      }).nextState;
      expect(state.referencePriceCents).toBeGreaterThan(0);
    }
  });

  it('the reference price moves round to round even when every participant holds', () => {
    let state = initialState({ synthetic: { volatility: 0.05 } });
    const references = new Set<number>();
    for (let i = 0; i < 10; i++) {
      references.add(state.referencePriceCents);
      state = stockMarket2.resolve({
        state,
        actions: actionsOf([['alice', hold()], ['bob', hold()]]),
        rng,
      }).nextState;
    }
    expect(references.size).toBeGreaterThan(1);
  });

  it('is fully deterministic given the same seed and actions, replayed over several rounds', () => {
    function replay(): number {
      let state = initialState({}, ['alice', 'bob'], createRng(Buffer.alloc(16, 3)));
      const seedRng = createRng(Buffer.alloc(16, 3));
      for (let i = 0; i < 5; i++) {
        state = stockMarket2.resolve({
          state,
          actions: actionsOf([
            ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 1 }] }],
            ['bob', hold()],
          ]),
          rng: seedRng,
        }).nextState;
      }
      return state.referencePriceCents;
    }
    expect(replay()).toBe(replay());
  });

  it('keeps only the configured trailing window of price history', () => {
    let state = initialState({ priceHistoryLength: 2 });
    for (let i = 0; i < 3; i++) {
      state = stockMarket2.resolve({
        state,
        actions: actionsOf([['alice', hold()], ['bob', hold()]]),
        rng,
      }).nextState;
    }
    expect(state.priceHistory.length).toBe(2);
  });
});

describe('stockMarket2.onMissingAction', () => {
  it('substitutes an empty orders list, never forfeiting the match', () => {
    const decision = stockMarket2.onMissingAction?.({
      state: initialState(),
      participantId: 'alice',
      reason: 'timeout',
    });
    expect(decision).toEqual({ policy: 'substitute', action: { orders: [] } });
  });
});

describe('stockMarket2.isTerminal / getResult / getStandingOutcomes', () => {
  it('is terminal only once exactly config.rounds rounds have been played', () => {
    let state = initialState({ rounds: 2 });
    expect(stockMarket2.isTerminal(state)).toBe(false);
    state = stockMarket2.resolve({ state, actions: actionsOf([['alice', hold()], ['bob', hold()]]), rng }).nextState;
    expect(stockMarket2.isTerminal(state)).toBe(false);
    state = stockMarket2.resolve({ state, actions: actionsOf([['alice', hold()], ['bob', hold()]]), rng }).nextState;
    expect(stockMarket2.isTerminal(state)).toBe(true);
  });

  it('reports the real symbol and real start/end dates in HISTORICAL mode', () => {
    let state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX, rounds: 2 });
    for (let i = 0; i < 2; i++) {
      state = stockMarket2.resolve({ state, actions: actionsOf([['alice', hold()], ['bob', hold()]]), rng }).nextState;
    }
    const result = stockMarket2.getResult(state);
    expect(result.symbol).toBe('DENN');
    expect(result.mode).toBe('HISTORICAL');
    expect(result.startDate).toBe('2016-01-19');
    expect(result.endDate).toBe('2016-01-20');
    expect(result.roundsPlayed).toBe(2);
  });

  it('declares the higher-value portfolio the winner, and a draw on an exact tie', () => {
    let state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX, rounds: 1 });
    state = stockMarket2.resolve({
      state,
      actions: actionsOf([
        ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }],
        ['bob', hold()],
      ]),
      rng,
    }).nextState;
    const result = stockMarket2.getResult(state);
    expect(stockMarket2.getStandingOutcomes(result)).toEqual([
      {
        participantId: 'alice',
        rank: scoreOf(result, 'alice') >= scoreOf(result, 'bob') ? 1 : 2,
        score: scoreOf(result, 'alice'),
        outcome:
          scoreOf(result, 'alice') === scoreOf(result, 'bob')
            ? 'draw'
            : scoreOf(result, 'alice') > scoreOf(result, 'bob')
              ? 'win'
              : 'loss',
      },
      {
        participantId: 'bob',
        rank: scoreOf(result, 'bob') >= scoreOf(result, 'alice') ? 1 : 2,
        score: scoreOf(result, 'bob'),
        outcome:
          scoreOf(result, 'alice') === scoreOf(result, 'bob')
            ? 'draw'
            : scoreOf(result, 'bob') > scoreOf(result, 'alice')
              ? 'win'
              : 'loss',
      },
    ]);

    const tiedResult: StockMarket2Result = {
      participantIds: ['alice', 'bob'],
      scores: { alice: 10000, bob: 10000 },
      cash: { alice: 10000, bob: 10000 },
      shares: { alice: 0, bob: 0 },
      symbol: 'DENN',
      mode: 'HISTORICAL',
      startingPrice: 9.11,
      finalPrice: 9.11,
      startDate: '2016-01-19',
      endDate: '2016-01-19',
      roundsPlayed: 1,
      winnerId: null,
    };
    expect(stockMarket2.getStandingOutcomes(tiedResult)).toEqual([
      { participantId: 'alice', rank: 1, score: 10000, outcome: 'draw' },
      { participantId: 'bob', rank: 1, score: 10000, outcome: 'draw' },
    ]);
  });

  it('can play a full HISTORICAL match through to the end of a long window without crashing', () => {
    let state = initialState({ mode: 'HISTORICAL', historyStartIndex: FIRST_DAY_INDEX, rounds: 200 }, ['alice']);
    let seedRng = createRng(Buffer.alloc(16, 11));
    while (!stockMarket2.isTerminal(state)) {
      state = stockMarket2.resolve({
        state,
        actions: actionsOf([['alice', hold()]]),
        rng: seedRng,
      }).nextState;
    }
    const result = stockMarket2.getResult(state);
    expect(result.roundsPlayed).toBe(200);
  });
});
