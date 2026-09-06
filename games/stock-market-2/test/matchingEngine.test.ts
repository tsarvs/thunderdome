import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { computeAvailability, resolveRound, type ResolveRoundArgs } from '../src/exchange/matchingEngine.js';
import {
  RiskConfigSchema,
  type LiquiditySnapshot,
  type RestingOrder,
  type RiskConfig,
  type StockMarket2Action,
  type StockMarket2Portfolio,
} from '../src/types.js';

const CASH = 1_000_000; // $10,000.00
const DEFAULT_RISK: RiskConfig = RiskConfigSchema.parse({});

function portfolio(overrides: Partial<StockMarket2Portfolio> = {}): StockMarket2Portfolio {
  return { cashCents: CASH, shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0, bankrupt: false, ...overrides };
}

function portfolios(overrides: Record<string, Partial<StockMarket2Portfolio>> = {}): Map<string, StockMarket2Portfolio> {
  const ids = new Set(['alice', 'bob', ...Object.keys(overrides)]);
  return new Map([...ids].map((id) => [id, portfolio(overrides[id])]));
}

function emptyLiquidity(): LiquiditySnapshot {
  return { bids: [], asks: [] };
}

function baseArgs(overrides: Partial<ResolveRoundArgs> = {}): ResolveRoundArgs {
  return {
    round: 0,
    referencePriceCents: 10000,
    openOrders: [],
    pendingLiquidity: emptyLiquidity(),
    portfolios: portfolios(),
    actions: new Map(),
    participantIds: ['alice', 'bob'],
    feeRate: 0,
    risk: DEFAULT_RISK,
    nextOrderSequence: 0,
    rng: createRng(Buffer.alloc(16, 1)),
    ...overrides,
  };
}

function actionsOf(entries: [string, StockMarket2Action][]): Map<string, StockMarket2Action> {
  return new Map(entries);
}

describe('resolveRound — market orders against synthetic liquidity', () => {
  it('fills a market buy against the best ask level', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10010, quantity: 100 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10010, quantity: 10 },
    ]);
    expect(result.portfolios.get('alice')).toMatchObject({ cashCents: CASH - 10 * 10010, shares: 10 });
  });

  it('fills a market sell against the best bid level', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [{ priceCents: 9990, quantity: 100 }], asks: [] },
        portfolios: portfolios({ alice: { shares: 10 } }),
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: null, sellerParticipantId: 'alice', priceCents: 9990, quantity: 10 },
    ]);
    expect(result.portfolios.get('alice')).toMatchObject({ cashCents: CASH + 10 * 9990, shares: 0 });
  });

  it('walks multiple price levels when one level is insufficient, producing worse blended prices (slippage)', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: {
          bids: [],
          asks: [
            { priceCents: 10010, quantity: 5 },
            { priceCents: 10020, quantity: 5 },
            { priceCents: 10030, quantity: 5 },
          ],
        },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 12 }] }]]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10010, quantity: 5 },
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10020, quantity: 5 },
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10030, quantity: 2 },
    ]);
    expect(result.portfolios.get('alice')?.shares).toBe(12);
  });

  it('drops the unfilled remainder of a market order when liquidity runs out — it never rests', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10010, quantity: 5 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 100 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(5);
    expect(result.openOrders).toEqual([]);
  });

  it('caps a market buy by the buyer\'s own cash, not just by liquidity', () => {
    const result = resolveRound(
      baseArgs({
        portfolios: portfolios({ alice: { cashCents: 10010 * 3 } }), // affords exactly 3 shares
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10010, quantity: 100 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(3);
    expect(result.portfolios.get('alice')?.cashCents).toBe(0);
  });

  it('caps a market sell by the seller\'s own held shares', () => {
    const result = resolveRound(
      baseArgs({
        portfolios: portfolios({ alice: { shares: 3 } }),
        pendingLiquidity: { bids: [{ priceCents: 9990, quantity: 100 }], asks: [] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(0);
  });
});

describe('resolveRound — limit orders', () => {
  it('a limit buy does not cross a liquidity ask priced above its limit', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10010, quantity: 100 }] },
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 100.0, timeInForce: 'DAY' }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([]);
    expect(result.openOrders).toEqual([]); // DAY: unfilled remainder is dropped, not resting
  });

  it('a limit buy at or above the ask fills', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10010, quantity: 100 }] },
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 100.1, timeInForce: 'DAY' }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: null, priceCents: 10010, quantity: 10 },
    ]);
  });

  it('a GTC limit order that does not fully fill rests in the returned book', () => {
    const result = resolveRound(
      baseArgs({
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 99.0, timeInForce: 'GTC' }] }],
        ]),
      }),
    );
    expect(result.openOrders).toHaveLength(1);
    expect(result.openOrders[0]).toMatchObject({
      participantId: 'alice',
      side: 'BUY',
      limitPriceCents: 9900,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    });
    expect(result.nextOrderSequence).toBe(1);
  });

  it('two player limit orders that cross execute at the midpoint of the two limits', () => {
    const result = resolveRound(
      baseArgs({
        portfolios: portfolios({ bob: { shares: 10 } }),
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 101, timeInForce: 'DAY' }] }],
          ['bob', { orders: [{ kind: 'LIMIT', side: 'SELL', quantity: 10, limitPrice: 99, timeInForce: 'DAY' }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: 'bob', priceCents: 10000, quantity: 10 },
    ]);
  });

  it('non-crossing player limit orders do not trade', () => {
    const result = resolveRound(
      baseArgs({
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 10, limitPrice: 99, timeInForce: 'DAY' }] }],
          ['bob', { orders: [{ kind: 'LIMIT', side: 'SELL', quantity: 10, limitPrice: 101, timeInForce: 'DAY' }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([]);
  });

  it('a market order takes the resting limit order\'s own price', () => {
    const result = resolveRound(
      baseArgs({
        portfolios: portfolios({ bob: { shares: 10 } }),
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }],
          ['bob', { orders: [{ kind: 'LIMIT', side: 'SELL', quantity: 10, limitPrice: 99, timeInForce: 'DAY' }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: 'bob', priceCents: 9900, quantity: 10 },
    ]);
  });

  it('partially fills a resting order across multiple new counter-orders', () => {
    const resting: RestingOrder = {
      id: 'bob:0',
      participantId: 'bob',
      side: 'SELL',
      limitPriceCents: 10000,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    };
    const result = resolveRound(
      baseArgs({
        openOrders: [resting],
        nextOrderSequence: 1,
        portfolios: portfolios({ bob: { shares: 10 } }),
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 4 }] }],
        ]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: 'bob', priceCents: 10000, quantity: 4 },
    ]);
    expect(result.openOrders).toEqual([{ ...resting, quantity: 6 }]);
  });
});

describe('resolveRound — cancellation', () => {
  it('removes a cancelled resting order from the book without matching it', () => {
    const resting: RestingOrder = {
      id: 'alice:0',
      participantId: 'alice',
      side: 'BUY',
      limitPriceCents: 10000,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    };
    const result = resolveRound(
      baseArgs({
        openOrders: [resting],
        pendingLiquidity: { bids: [], asks: [{ priceCents: 9000, quantity: 100 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'CANCEL', orderId: 'alice:0' }] }]]),
      }),
    );
    expect(result.trades).toEqual([]);
    expect(result.openOrders).toEqual([]);
  });

  it('a cancel earlier in the same submission frees buying power for a later new order', () => {
    const resting: RestingOrder = {
      id: 'alice:0',
      participantId: 'alice',
      side: 'BUY',
      limitPriceCents: 9990, // reserves nearly all of alice's cash at CASH/9990 shares
      timeInForce: 'GTC',
      quantity: Math.floor(CASH / 9990),
      submittedRound: 0,
    };
    const result = resolveRound(
      baseArgs({
        openOrders: [resting],
        actions: actionsOf([
          [
            'alice',
            {
              orders: [
                { kind: 'CANCEL', orderId: 'alice:0' },
                { kind: 'LIMIT', side: 'BUY', quantity: 1, limitPrice: 50, timeInForce: 'GTC' },
              ],
            },
          ],
        ]),
      }),
    );
    expect(result.openOrders).toHaveLength(1);
    expect(result.openOrders[0]).toMatchObject({ limitPriceCents: 5000, quantity: 1 });
  });
});

describe('resolveRound — self-trade prevention', () => {
  it('does not match a participant\'s new order against their own resting order', () => {
    const resting: RestingOrder = {
      id: 'alice:0',
      participantId: 'alice',
      side: 'SELL',
      limitPriceCents: 9900,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    };
    const result = resolveRound(
      baseArgs({
        openOrders: [resting],
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([]);
    expect(result.openOrders).toEqual([resting]);
  });

  it('still matches against a third party once the self-trade is skipped', () => {
    const aliceResting: RestingOrder = {
      id: 'alice:0',
      participantId: 'alice',
      side: 'SELL',
      limitPriceCents: 9900,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    };
    const bobResting: RestingOrder = {
      id: 'bob:0',
      participantId: 'bob',
      side: 'SELL',
      limitPriceCents: 9950,
      timeInForce: 'GTC',
      quantity: 10,
      submittedRound: 0,
    };
    const result = resolveRound(
      baseArgs({
        openOrders: [aliceResting, bobResting],
        portfolios: portfolios({ alice: { shares: 10 }, bob: { shares: 10 } }),
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([
      { buyerParticipantId: 'alice', sellerParticipantId: 'bob', priceCents: 9950, quantity: 10 },
    ]);
  });
});

describe('resolveRound — deterministic equal-price priority', () => {
  it('is fully deterministic given the same seed', () => {
    const args = (): ResolveRoundArgs =>
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10000, quantity: 5 }] },
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 100, timeInForce: 'DAY' }] }],
          ['bob', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 100, timeInForce: 'DAY' }] }],
        ]),
        rng: createRng(Buffer.alloc(16, 42)),
      });
    expect(resolveRound(args()).trades).toEqual(resolveRound(args()).trades);
  });

  it('does not always favor the same participant regardless of submission order across seeds', () => {
    const args = (rng: ReturnType<typeof createRng>): ResolveRoundArgs =>
      baseArgs({
        pendingLiquidity: { bids: [], asks: [{ priceCents: 10000, quantity: 5 }] },
        actions: actionsOf([
          ['alice', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 100, timeInForce: 'DAY' }] }],
          ['bob', { orders: [{ kind: 'LIMIT', side: 'BUY', quantity: 5, limitPrice: 100, timeInForce: 'DAY' }] }],
        ]),
        rng,
      });
    const winners = new Set<string | null>();
    for (let seed = 0; seed < 20; seed++) {
      const result = resolveRound(args(createRng(Buffer.alloc(16, seed + 1))));
      winners.add(result.trades[0]?.buyerParticipantId ?? null);
    }
    expect(winners.size).toBeGreaterThan(1);
  });
});

describe('computeAvailability', () => {
  it('subtracts reserved cash/shares from resting orders owned by the participant', () => {
    const openOrders: RestingOrder[] = [
      { id: 'a:0', participantId: 'alice', side: 'BUY', limitPriceCents: 10000, timeInForce: 'GTC', quantity: 3, submittedRound: 0 },
      { id: 'a:1', participantId: 'alice', side: 'SELL', limitPriceCents: 11000, timeInForce: 'GTC', quantity: 2, submittedRound: 0 },
      { id: 'b:0', participantId: 'bob', side: 'BUY', limitPriceCents: 10000, timeInForce: 'GTC', quantity: 100, submittedRound: 0 },
    ];
    const result = computeAvailability(portfolio({ shares: 5 }), openOrders, 'alice');
    expect(result).toEqual({ availableCashCents: CASH - 3 * 10000, availableShares: 3 });
  });
});

describe('resolveRound — short selling and margin (config.risk.allowShortSelling)', () => {
  const MARGIN_RISK: RiskConfig = RiskConfigSchema.parse({ allowShortSelling: true });

  it('a SELL beyond current holdings is rejected when shorting is disabled (default)', () => {
    const result = resolveRound(
      baseArgs({
        pendingLiquidity: { bids: [{ priceCents: 9990, quantity: 100 }], asks: [] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([]);
    expect(result.portfolios.get('alice')?.shares).toBe(0);
  });

  it('a SELL beyond current holdings opens a short when shorting is enabled', () => {
    const result = resolveRound(
      baseArgs({
        risk: MARGIN_RISK,
        pendingLiquidity: { bids: [{ priceCents: 9990, quantity: 100 }], asks: [] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(-10);
    expect(result.portfolios.get('alice')?.cashCents).toBe(CASH + 10 * 9990);
  });

  it('a short position is capped by config.risk.borrowableShares', () => {
    const result = resolveRound(
      baseArgs({
        risk: RiskConfigSchema.parse({ allowShortSelling: true, borrowableShares: 6 }),
        pendingLiquidity: { bids: [{ priceCents: 9990, quantity: 100 }], asks: [] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(-6);
  });

  it('a short position is capped by margin buying power', () => {
    const result = resolveRound(
      baseArgs({
        risk: RiskConfigSchema.parse({ allowShortSelling: true, initialMarginRatio: 1 }),
        portfolios: portfolios({ alice: { cashCents: 50_000 } }), // equity $500 -> buying power $500 @ initialMarginRatio 1
        pendingLiquidity: { bids: [{ priceCents: 10000, quantity: 100 }], asks: [] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'SELL', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(-5); // $500 buying power / $100 per share
  });

  it('covering a short is always allowed even with zero margin buying power', () => {
    const result = resolveRound(
      baseArgs({
        risk: MARGIN_RISK,
        portfolios: portfolios({ alice: { cashCents: 0, shares: -10, averageEntryPriceCents: 10000 } }),
        pendingLiquidity: { bids: [], asks: [{ priceCents: 9000, quantity: 100 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.portfolios.get('alice')?.shares).toBe(0);
    expect(result.portfolios.get('alice')?.realizedPnlCents).toBe(10 * (10000 - 9000));
  });

  it('a bankrupt participant can never trade again, regardless of what they submit', () => {
    const result = resolveRound(
      baseArgs({
        risk: MARGIN_RISK,
        portfolios: portfolios({ alice: { bankrupt: true, cashCents: 1_000_000 } }),
        pendingLiquidity: { bids: [], asks: [{ priceCents: 9000, quantity: 100 }] },
        actions: actionsOf([['alice', { orders: [{ kind: 'MARKET', side: 'BUY', quantity: 10 }] }]]),
      }),
    );
    expect(result.trades).toEqual([]);
    expect(result.portfolios.get('alice')?.shares).toBe(0);
  });
});
