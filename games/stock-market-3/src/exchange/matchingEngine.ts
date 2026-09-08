import type { Rng } from '@thunderdome/engine';
import {
  applyFill,
  getPosition,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
  remainingBuyingPowerCents,
} from '../portfolio/accounting.js';
import type {
  LiquiditySnapshot,
  OrderRequest,
  PortfolioAccount,
  RestingOrder,
  RiskConfig,
  StockMarket3Action,
  Trade,
} from '../types.js';

/** Cash/shares not already reserved by this participant's own resting orders — what a new order
 * can actually draw on. Cash is reserved across ALL of a participant's own symbols (a resting BUY
 * anywhere commits cash); shares are reserved only within the SAME symbol (a resting SELL in
 * TECH_A has no bearing on how many CONSUMER_A shares are available). */
export function computeAvailability(
  portfolio: PortfolioAccount,
  openOrders: readonly RestingOrder[],
  participantId: string,
  symbol: string,
): { availableCashCents: number; availableShares: number } {
  let reservedCashCents = 0;
  let reservedShares = 0;
  for (const order of openOrders) {
    if (order.participantId !== participantId) {
      continue;
    }
    if (order.side === 'BUY') {
      reservedCashCents += order.quantity * order.limitPriceCents;
    } else if (order.symbol === symbol) {
      reservedShares += order.quantity;
    }
  }
  return {
    availableCashCents: portfolio.cashCents - reservedCashCents,
    availableShares: getPosition(portfolio, symbol).shares - reservedShares,
  };
}

interface WorkingOrder {
  participantId: string;
  side: 'BUY' | 'SELL';
  limitPriceCents: number | null;
  remaining: number;
  timeInForce: 'DAY' | 'GTC';
  resting: { id: string; submittedRound: number } | null;
  rank: number;
}

function capTradeQuantity(args: {
  desiredQuantity: number;
  symbol: string;
  buyerId: string | null;
  sellerId: string | null;
  priceCents: number;
  feeRate: number;
  portfolios: Map<string, PortfolioAccount>;
  markPricesCents: ReadonlyMap<string, number>;
  risk: RiskConfig;
}): { quantity: number; buyerExhausted: boolean; sellerExhausted: boolean } {
  const { desiredQuantity, symbol, buyerId, sellerId, priceCents, feeRate, portfolios, markPricesCents, risk } = args;

  let maxBuyQty = Number.POSITIVE_INFINITY;
  if (buyerId !== null) {
    const buyer = portfolios.get(buyerId);
    if (buyer === undefined || buyer.bankrupt) {
      maxBuyQty = 0;
    } else if (!risk.allowShortSelling) {
      const costPerShareCents = priceCents * (1 + feeRate);
      maxBuyQty = costPerShareCents > 0 ? Math.floor(buyer.cashCents / costPerShareCents) : Number.POSITIVE_INFINITY;
    } else {
      maxBuyQty = maxBuyQuantityByMargin(
        getPosition(buyer, symbol).shares,
        remainingBuyingPowerCents(buyer, markPricesCents, risk),
        priceCents,
      );
    }
  }

  let maxSellQty = Number.POSITIVE_INFINITY;
  if (sellerId !== null) {
    const seller = portfolios.get(sellerId);
    if (seller === undefined || seller.bankrupt) {
      maxSellQty = 0;
    } else if (!risk.allowShortSelling) {
      maxSellQty = Math.max(0, getPosition(seller, symbol).shares);
    } else {
      maxSellQty = maxSellQuantityByMargin(
        getPosition(seller, symbol).shares,
        remainingBuyingPowerCents(seller, markPricesCents, risk),
        priceCents,
        risk.borrowableShares,
      );
    }
  }

  return {
    quantity: Math.max(0, Math.min(desiredQuantity, maxBuyQty, maxSellQty)),
    buyerExhausted: maxBuyQty <= 0,
    sellerExhausted: maxSellQty <= 0,
  };
}

function tradePriceFor(bid: WorkingOrder, ask: WorkingOrder, referencePriceCents: number): number {
  if (bid.limitPriceCents !== null && ask.limitPriceCents !== null) {
    return Math.round((bid.limitPriceCents + ask.limitPriceCents) / 2);
  }
  if (bid.limitPriceCents !== null) {
    return bid.limitPriceCents;
  }
  if (ask.limitPriceCents !== null) {
    return ask.limitPriceCents;
  }
  return referencePriceCents;
}

function sortBids(orders: WorkingOrder[]): void {
  orders.sort((a, b) => {
    const priceA = a.limitPriceCents ?? Number.POSITIVE_INFINITY;
    const priceB = b.limitPriceCents ?? Number.POSITIVE_INFINITY;
    return priceB - priceA || a.rank - b.rank;
  });
}

function sortAsks(orders: WorkingOrder[]): void {
  orders.sort((a, b) => {
    const priceA = a.limitPriceCents ?? Number.NEGATIVE_INFINITY;
    const priceB = b.limitPriceCents ?? Number.NEGATIVE_INFINITY;
    return priceA - priceB || a.rank - b.rank;
  });
}

export interface ResolveRoundArgs {
  round: number;
  /** Every currently-tradable symbol, matched in this fixed (sorted) order — a documented
   * simplification: cash freed by a symbol earlier in this order is available to a LATER symbol
   * in the very same round (spec §30's "one snapshot, many orders"), but the reverse is not true
   * within a single round. Sorting alphabetically rather than trying to honor per-participant
   * submission order across DIFFERENT participants' order lists avoids an otherwise ambiguous
   * "whose symbol goes first" question when two participants list the same two symbols in
   * opposite orders. */
  symbols: readonly string[];
  referencePricesCents: ReadonlyMap<string, number>;
  openOrders: readonly RestingOrder[];
  pendingLiquidity: ReadonlyMap<string, LiquiditySnapshot>;
  portfolios: ReadonlyMap<string, PortfolioAccount>;
  actions: ReadonlyMap<string, StockMarket3Action>;
  participantIds: readonly string[];
  feeRate: number;
  risk: RiskConfig;
  nextOrderSequence: number;
  rng: Rng;
}

export interface ResolveRoundResult {
  portfolios: Map<string, PortfolioAccount>;
  openOrders: RestingOrder[];
  trades: Trade[];
  nextOrderSequence: number;
  remainingLiquidity: Map<string, LiquiditySnapshot>;
}

/**
 * One round's full multi-symbol exchange lifecycle — the same admit/cancel/match/synthetic-
 * liquidity pipeline as games/stock-market-2's `resolveRound`, run once per symbol in a fixed
 * order (see `symbols` doc above). Margin/buying-power checks throughout use each symbol's
 * pre-open `referencePricesCents` as the mark price for every OTHER symbol a participant holds —
 * fixed for the whole round rather than updated fill-by-fill, so a trade in one symbol can never
 * change the mark used to gate a trade in a different symbol within that same round (order-
 * independence).
 */
export function resolveRound(args: ResolveRoundArgs): ResolveRoundResult {
  const { round, referencePricesCents, actions, participantIds, feeRate, risk, rng } = args;

  const portfolios = new Map(args.portfolios);
  let openOrdersWorking: RestingOrder[] = [...args.openOrders];
  let nextOrderSequence = args.nextOrderSequence;
  const trades: Trade[] = [];
  const remainingLiquidity = new Map<string, LiquiditySnapshot>();

  // --- Cancels: global, processed once before any symbol's matching. ---
  for (const participantId of participantIds) {
    const action = actions.get(participantId);
    if (action === undefined) {
      continue;
    }
    for (const order of action.orders) {
      if (order.kind !== 'CANCEL') {
        continue;
      }
      openOrdersWorking = openOrdersWorking.filter(
        (o) => !(o.id === order.orderId && o.participantId === participantId),
      );
    }
  }

  const nextOpenOrders: RestingOrder[] = [];

  for (const symbol of args.symbols) {
    const referencePriceCents = referencePricesCents.get(symbol) ?? 1;
    const committedCashCents = new Map<string, number>();
    const committedShares = new Map<string, number>();
    const newBuys: WorkingOrder[] = [];
    const newSells: WorkingOrder[] = [];

    function admit(participantId: string, order: OrderRequest): void {
      if (order.kind === 'CANCEL' || order.symbol !== symbol) {
        return;
      }
      const portfolio = portfolios.get(participantId);
      if (portfolio === undefined || portfolio.bankrupt) {
        return;
      }

      if (order.kind === 'LIMIT') {
        const limitPriceCents = Math.round(order.limitPrice * 100);

        if (risk.allowShortSelling) {
          const power = remainingBuyingPowerCents(portfolio, referencePricesCents, risk);
          const currentShares = getPosition(portfolio, symbol).shares;
          const maxQty =
            order.side === 'BUY'
              ? maxBuyQuantityByMargin(currentShares, power, limitPriceCents)
              : maxSellQuantityByMargin(currentShares, power, limitPriceCents, risk.borrowableShares);
          if (order.quantity > maxQty) {
            return;
          }
        } else {
          const { availableCashCents, availableShares } = computeAvailability(portfolio, openOrdersWorking, participantId, symbol);
          if (order.side === 'BUY') {
            const alreadyCommitted = committedCashCents.get(participantId) ?? 0;
            const worstCaseCostCents = order.quantity * limitPriceCents;
            if (worstCaseCostCents > availableCashCents - alreadyCommitted) {
              return;
            }
            committedCashCents.set(participantId, alreadyCommitted + worstCaseCostCents);
          } else {
            const alreadyCommitted = committedShares.get(participantId) ?? 0;
            if (order.quantity > availableShares - alreadyCommitted) {
              return;
            }
            committedShares.set(participantId, alreadyCommitted + order.quantity);
          }
        }

        const working: WorkingOrder = {
          participantId,
          side: order.side,
          limitPriceCents,
          remaining: order.quantity,
          timeInForce: order.timeInForce,
          resting: null,
          rank: rng.nextFloat(),
        };
        (order.side === 'BUY' ? newBuys : newSells).push(working);
      } else {
        const working: WorkingOrder = {
          participantId,
          side: order.side,
          limitPriceCents: null,
          remaining: order.quantity,
          timeInForce: 'DAY',
          resting: null,
          rank: rng.nextFloat(),
        };
        (order.side === 'BUY' ? newBuys : newSells).push(working);
      }
    }

    for (const participantId of participantIds) {
      const action = actions.get(participantId);
      if (action === undefined) {
        continue;
      }
      for (const order of action.orders) {
        admit(participantId, order);
      }
    }

    function toWorking(order: RestingOrder): WorkingOrder {
      return {
        participantId: order.participantId,
        side: order.side,
        limitPriceCents: order.limitPriceCents,
        remaining: order.quantity,
        timeInForce: order.timeInForce,
        resting: { id: order.id, submittedRound: order.submittedRound },
        rank: rng.nextFloat(),
      };
    }

    const restingForSymbol = openOrdersWorking.filter((o) => o.symbol === symbol);
    const bidPool: WorkingOrder[] = [...restingForSymbol.filter((o) => o.side === 'BUY').map(toWorking), ...newBuys];
    const askPool: WorkingOrder[] = [...restingForSymbol.filter((o) => o.side === 'SELL').map(toWorking), ...newSells];

    sortBids(bidPool);
    sortAsks(askPool);

    let bi = 0;
    let ai = 0;
    while (bi < bidPool.length && ai < askPool.length) {
      const bid = bidPool[bi];
      const ask = askPool[ai];
      if (bid === undefined) {
        break;
      }
      if (bid.remaining <= 0) {
        bi++;
        continue;
      }
      if (ask === undefined) {
        break;
      }
      if (ask.remaining <= 0) {
        ai++;
        continue;
      }
      const crosses = bid.limitPriceCents === null || ask.limitPriceCents === null || bid.limitPriceCents >= ask.limitPriceCents;
      if (!crosses) {
        break;
      }
      if (bid.participantId === ask.participantId) {
        ai++;
        continue;
      }

      const priceCents = tradePriceFor(bid, ask, referencePriceCents);
      const desired = Math.min(bid.remaining, ask.remaining);
      const cap = capTradeQuantity({
        desiredQuantity: desired,
        symbol,
        buyerId: bid.participantId,
        sellerId: ask.participantId,
        priceCents,
        feeRate,
        portfolios,
        markPricesCents: referencePricesCents,
        risk,
      });

      if (cap.quantity > 0) {
        const trade: Trade = {
          symbol,
          buyerParticipantId: bid.participantId,
          sellerParticipantId: ask.participantId,
          priceCents,
          quantity: cap.quantity,
        };
        settleTrade(portfolios, trade, feeRate);
        trades.push(trade);
        bid.remaining -= cap.quantity;
        ask.remaining -= cap.quantity;
      }
      if (cap.buyerExhausted) {
        bid.remaining = 0;
      }
      if (cap.sellerExhausted) {
        ask.remaining = 0;
      }
    }

    const snapshot = args.pendingLiquidity.get(symbol) ?? { bids: [], asks: [] };
    const askLiquidity = snapshot.asks.map((level) => ({ ...level }));
    const bidLiquidity = snapshot.bids.map((level) => ({ ...level }));

    for (const bid of bidPool) {
      for (const level of askLiquidity) {
        if (bid.remaining <= 0) {
          break;
        }
        if (level.quantity <= 0) {
          continue;
        }
        if (bid.limitPriceCents !== null && bid.limitPriceCents < level.priceCents) {
          break;
        }
        const desired = Math.min(bid.remaining, level.quantity);
        const cap = capTradeQuantity({
          desiredQuantity: desired,
          symbol,
          buyerId: bid.participantId,
          sellerId: null,
          priceCents: level.priceCents,
          feeRate,
          portfolios,
          markPricesCents: referencePricesCents,
          risk,
        });
        if (cap.quantity > 0) {
          const trade: Trade = { symbol, buyerParticipantId: bid.participantId, sellerParticipantId: null, priceCents: level.priceCents, quantity: cap.quantity };
          settleTrade(portfolios, trade, feeRate);
          trades.push(trade);
          bid.remaining -= cap.quantity;
          level.quantity -= cap.quantity;
        }
        if (cap.buyerExhausted) {
          bid.remaining = 0;
          break;
        }
      }
    }

    for (const ask of askPool) {
      for (const level of bidLiquidity) {
        if (ask.remaining <= 0) {
          break;
        }
        if (level.quantity <= 0) {
          continue;
        }
        if (ask.limitPriceCents !== null && ask.limitPriceCents > level.priceCents) {
          break;
        }
        const desired = Math.min(ask.remaining, level.quantity);
        const cap = capTradeQuantity({
          desiredQuantity: desired,
          symbol,
          buyerId: null,
          sellerId: ask.participantId,
          priceCents: level.priceCents,
          feeRate,
          portfolios,
          markPricesCents: referencePricesCents,
          risk,
        });
        if (cap.quantity > 0) {
          const trade: Trade = { symbol, buyerParticipantId: null, sellerParticipantId: ask.participantId, priceCents: level.priceCents, quantity: cap.quantity };
          settleTrade(portfolios, trade, feeRate);
          trades.push(trade);
          ask.remaining -= cap.quantity;
          level.quantity -= cap.quantity;
        }
        if (cap.sellerExhausted) {
          ask.remaining = 0;
          break;
        }
      }
    }

    remainingLiquidity.set(symbol, { bids: bidLiquidity, asks: askLiquidity });

    for (const working of [...bidPool, ...askPool]) {
      if (working.remaining <= 0 || working.limitPriceCents === null || working.timeInForce !== 'GTC') {
        continue;
      }
      if (working.resting !== null) {
        nextOpenOrders.push({
          id: working.resting.id,
          participantId: working.participantId,
          symbol,
          side: working.side,
          limitPriceCents: working.limitPriceCents,
          timeInForce: 'GTC',
          quantity: working.remaining,
          submittedRound: working.resting.submittedRound,
        });
      } else {
        nextOpenOrders.push({
          id: `${working.participantId}:${String(nextOrderSequence)}`,
          participantId: working.participantId,
          symbol,
          side: working.side,
          limitPriceCents: working.limitPriceCents,
          timeInForce: 'GTC',
          quantity: working.remaining,
          submittedRound: round,
        });
        nextOrderSequence += 1;
      }
    }
  }

  return { portfolios, openOrders: nextOpenOrders, trades, nextOrderSequence, remainingLiquidity };
}

function settleTrade(portfolios: Map<string, PortfolioAccount>, trade: Trade, feeRate: number): void {
  const tradeValueCents = trade.priceCents * trade.quantity;
  const feeCents = Math.round(tradeValueCents * feeRate);
  if (trade.buyerParticipantId !== null) {
    const buyer = portfolios.get(trade.buyerParticipantId);
    if (buyer !== undefined) {
      portfolios.set(trade.buyerParticipantId, applyFill(buyer, trade.symbol, 'BUY', trade.quantity, trade.priceCents, feeCents));
    }
  }
  if (trade.sellerParticipantId !== null) {
    const seller = portfolios.get(trade.sellerParticipantId);
    if (seller !== undefined) {
      portfolios.set(trade.sellerParticipantId, applyFill(seller, trade.symbol, 'SELL', trade.quantity, trade.priceCents, feeCents));
    }
  }
}
