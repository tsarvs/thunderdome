import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { stockMarket3 } from '../src/game.js';
import type { StockMarket3Action, StockMarket3Config, StockMarket3State } from '../src/types.js';

const PARTICIPANT_IDS = ['alice', 'bob'];

function config(overrides: Record<string, unknown> = {}): StockMarket3Config {
  const result = stockMarket3.parseConfig(overrides);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

function initialState(
  overrides: Record<string, unknown> = {},
  participantIds = PARTICIPANT_IDS,
  seed = 1,
): StockMarket3State {
  return stockMarket3.initialize({ config: config(overrides), participantIds, rng: createRng(Buffer.alloc(16, seed)) });
}

function hold(): StockMarket3Action {
  return { orders: [] };
}

function actionsOf(entries: [string, StockMarket3Action][]): Map<string, StockMarket3Action> {
  return new Map(entries);
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/** Small config shared by most tests below: short enough to run fast, still with an active
 * warmup boundary and every default security. */
const FAST = { rounds: 12, warmupRounds: 3 };

describe('stockMarket3.parseConfig', () => {
  it('applies documented defaults', () => {
    const result = stockMarket3.parseConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startingCash).toBe(100000);
      expect(result.value.rounds).toBe(500);
      expect(result.value.warmupRounds).toBe(250);
      expect(result.value.indexSymbol).toBe('SYNTH_INDEX');
      expect(result.value.equities).toHaveLength(9);
      expect(result.value.risk.allowShortSelling).toBe(true);
    }
  });

  it('rejects warmupRounds >= rounds', () => {
    expect(stockMarket3.parseConfig({ rounds: 10, warmupRounds: 10 }).ok).toBe(false);
    expect(stockMarket3.parseConfig({ rounds: 10, warmupRounds: 9 }).ok).toBe(true);
  });

  it('rejects a duplicate equity symbol or one colliding with indexSymbol', () => {
    expect(stockMarket3.parseConfig({ equities: [{ symbol: 'A', sector: 'TECHNOLOGY' }, { symbol: 'A', sector: 'CONSUMER' }] }).ok).toBe(false);
    expect(stockMarket3.parseConfig({ equities: [{ symbol: 'SYNTH_INDEX', sector: 'TECHNOLOGY' }, { symbol: 'B', sector: 'CONSUMER' }] }).ok).toBe(false);
  });
});

describe('stockMarket3.initialize', () => {
  it('creates every configured equity plus the index, all active and tradable', () => {
    const state = initialState(FAST);
    const cfg = config(FAST);
    for (const equity of cfg.equities) {
      const security = state.securities.get(equity.symbol);
      expect(security?.active).toBe(true);
      expect(security?.kind).toBe('EQUITY');
      expect(security?.sector).toBe(equity.sector);
    }
    expect(state.securities.get(cfg.indexSymbol)?.kind).toBe('INDEX');
    expect(state.securities.size).toBe(cfg.equities.length + 1);
  });

  it('starts every participant with the configured cash and no positions', () => {
    const state = initialState({ ...FAST, startingCash: 5000 });
    for (const participantId of PARTICIPANT_IDS) {
      const portfolio = state.portfolios.get(participantId);
      expect(portfolio?.cashCents).toBe(500000);
      expect(portfolio?.positions.size).toBe(0);
      expect(portfolio?.bankrupt).toBe(false);
    }
  });

  it('is deterministic given the same seed', () => {
    const a = initialState(FAST, PARTICIPANT_IDS, 7);
    const b = initialState(FAST, PARTICIPANT_IDS, 7);
    expect(JSON.stringify(a, mapReplacer)).toBe(JSON.stringify(b, mapReplacer));
  });
});

describe('warmup', () => {
  it('rejects real orders before warmupRounds, but allows an empty order list', () => {
    const state = initialState(FAST);
    const symbol = must(config(FAST).equities[0]?.symbol, 'first equity symbol');
    const buy: StockMarket3Action = { orders: [{ kind: 'MARKET', symbol, side: 'BUY', quantity: 1 }] };
    expect(stockMarket3.validateAction(state, 'alice', buy).ok).toBe(false);
    expect(stockMarket3.validateAction(state, 'alice', hold()).ok).toBe(true);
  });

  it('allows real orders once warmupRounds has elapsed', () => {
    let state = initialState(FAST);
    const rng = createRng(Buffer.alloc(16, 1));
    for (let i = 0; i < config(FAST).warmupRounds; i++) {
      state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()])), rng }).nextState;
    }
    expect(state.round).toBe(config(FAST).warmupRounds);
    const symbol = must(config(FAST).equities[0]?.symbol, 'first equity symbol');
    const buy: StockMarket3Action = { orders: [{ kind: 'MARKET', symbol, side: 'BUY', quantity: 1 }] };
    expect(stockMarket3.validateAction(state, 'alice', buy).ok).toBe(true);
  });

  it('still advances prices and OHLCV history during warmup even with no trading', () => {
    let state = initialState(FAST);
    const rng = createRng(Buffer.alloc(16, 1));
    for (let i = 0; i < 5; i++) {
      state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()])), rng }).nextState;
    }
    const observation = stockMarket3.getObservation(state, 'alice');
    const security = observation.securities[0];
    expect(security?.priceHistory.length).toBeGreaterThan(0);
  });
});

describe('trading', () => {
  it('fills a market buy against synthetic liquidity and updates cash/position', () => {
    let state = initialState(FAST);
    const rng = createRng(Buffer.alloc(16, 1));
    for (let i = 0; i < config(FAST).warmupRounds; i++) {
      state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()])), rng }).nextState;
    }
    const symbol = must(config(FAST).equities[0]?.symbol, 'first equity symbol');
    const before = must(state.portfolios.get('alice'), "alice's portfolio");
    const buy: StockMarket3Action = { orders: [{ kind: 'MARKET', symbol, side: 'BUY', quantity: 10 }] };
    const actions = actionsOf([
      ['alice', buy],
      ['bob', hold()],
    ]);
    state = stockMarket3.resolve({ state, actions, rng }).nextState;
    const after = must(state.portfolios.get('alice'), "alice's portfolio");
    expect(after.positions.get(symbol)?.shares).toBe(10);
    expect(after.cashCents).toBeLessThan(before.cashCents);
  });

  it('supports a GTC limit order resting across rounds and CANCEL removing it', () => {
    let state = initialState(FAST);
    const rng = createRng(Buffer.alloc(16, 1));
    for (let i = 0; i < config(FAST).warmupRounds; i++) {
      state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()])), rng }).nextState;
    }
    const symbol = must(config(FAST).equities[0]?.symbol, 'first equity symbol');
    const referencePrice = must(state.securities.get(symbol), `security ${symbol}`).referencePriceCents / 100;
    // A limit price far below the market should rest unfilled.
    const lowball: StockMarket3Action = {
      orders: [{ kind: 'LIMIT', symbol, side: 'BUY', quantity: 5, limitPrice: Math.max(0.01, referencePrice * 0.1), timeInForce: 'GTC' }],
    };
    state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, id === 'alice' ? lowball : hold()])), rng }).nextState;
    const restingOrder = must(
      must(state.securities.get(symbol), `security ${symbol}`).openOrders.find((o) => o.participantId === 'alice'),
      'alice resting order',
    );

    const cancel: StockMarket3Action = { orders: [{ kind: 'CANCEL', orderId: restingOrder.id }] };
    expect(stockMarket3.validateAction(state, 'alice', cancel).ok).toBe(true);
    state = stockMarket3.resolve({ state, actions: actionsOf(PARTICIPANT_IDS.map((id) => [id, id === 'alice' ? cancel : hold()])), rng }).nextState;
    expect(must(state.securities.get(symbol), `security ${symbol}`).openOrders.some((o) => o.participantId === 'alice')).toBe(false);
  });

  it('rejects an order for an unknown or inactive symbol', () => {
    const state = initialState(FAST);
    const bogus: StockMarket3Action = { orders: [{ kind: 'MARKET', symbol: 'NOT_A_SYMBOL', side: 'BUY', quantity: 1 }] };
    expect(stockMarket3.validateAction(state, 'alice', bogus).ok).toBe(false);
  });
});

describe('full match lifecycle', () => {
  it('is terminal only once exactly config.rounds rounds have been played, and produces a result', () => {
    let state = initialState(FAST);
    const rng = createRng(Buffer.alloc(16, 1));
    const holdAll = actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()]));
    for (let i = 0; i < config(FAST).rounds; i++) {
      expect(stockMarket3.isTerminal(state)).toBe(false);
      state = stockMarket3.resolve({ state, actions: holdAll, rng }).nextState;
    }
    expect(stockMarket3.isTerminal(state)).toBe(true);

    const result = stockMarket3.getResult(state);
    expect(result.roundsPlayed).toBe(config(FAST).rounds);
    for (const participantId of PARTICIPANT_IDS) {
      expect(result.scores[participantId]).toBeCloseTo(config(FAST).startingCash, 0);
      expect(result.startingCapital[participantId]).toBe(config(FAST).startingCash);
    }
    const outcomes = stockMarket3.getStandingOutcomes(result);
    expect(outcomes).toHaveLength(PARTICIPANT_IDS.length);
  });

  it('is deterministic: same seed + same actions => same result', () => {
    function runToResult(seed: number) {
      let state = initialState(FAST, PARTICIPANT_IDS, seed);
      const rng = createRng(Buffer.alloc(16, seed));
      const holdAll = actionsOf(PARTICIPANT_IDS.map((id) => [id, hold()]));
      for (let i = 0; i < config(FAST).rounds; i++) {
        state = stockMarket3.resolve({ state, actions: holdAll, rng }).nextState;
      }
      return stockMarket3.getResult(state);
    }
    expect(runToResult(3)).toEqual(runToResult(3));
  });
});

function mapReplacer(_key: string, value: unknown): unknown {
  return value instanceof Map ? Object.fromEntries(value) : value;
}
