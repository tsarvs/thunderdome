import type { Rng } from '@thunderdome/engine';
import {
  applyFill,
  buyingPowerCents,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
} from '../portfolio/accounting.js';
import type {
  LiquiditySnapshot,
  OrderRequest,
  RestingOrder,
  RiskConfig,
  StockMarket2Action,
  StockMarket2Portfolio,
  Trade,
} from '../types.js';

/** Cash/shares not already reserved by this participant's own resting LIMIT orders — what a new
 * order can actually draw on. Shared by `validateAction`/`getObservation` (game.ts) and this
 * module's own admission check for new orders. Note this is a plain cash/share reservation view,
 * distinct from margin buying power (`portfolio/accounting.ts`'s `buyingPowerCents`) — both are
 * surfaced separately in `StockMarket2Observation.portfolio`. */
export function computeAvailability(
  portfolio: StockMarket2Portfolio,
  openOrders: readonly RestingOrder[],
  participantId: string,
): { availableCashCents: number; availableShares: number } {
  let reservedCashCents = 0;
  let reservedShares = 0;
  for (const order of openOrders) {
    if (order.participantId !== participantId) {
      continue;
    }
    if (order.side === 'BUY') {
      reservedCashCents += order.quantity * order.limitPriceCents;
    } else {
      reservedShares += order.quantity;
    }
  }
  return {
    availableCashCents: portfolio.cashCents - reservedCashCents,
    availableShares: portfolio.shares - reservedShares,
  };
}

/** A single side of a live match — wraps either a pre-existing resting order or a brand-new
 * submission this round in one shape the matching loops can treat uniformly. `limitPriceCents:
 * null` means MARKET. */
interface WorkingOrder {
  participantId: string;
  side: 'BUY' | 'SELL';
  limitPriceCents: number | null;
  remaining: number;
  timeInForce: 'DAY' | 'GTC';
  /** Set only for orders that were already resting at the start of this round — carries their
   * original id/submittedRound forward if they end up still resting afterward. */
  resting: { id: string; submittedRound: number } | null;
  /** Fresh random tie-break, reassigned every round for every order (resting or new) — this is
   * what gives "equal price priority" seeded randomization instead of registration order (spec
   * §14), and reassigning it fresh each round is what stops it from ever consistently favoring
   * whichever participant happened to submit first in some earlier round. */
  rank: number;
}

/**
 * When `risk.allowShortSelling` is off, behaves exactly as before this game had shorting at all:
 * a BUY is capped by cash on hand, a SELL is capped by shares already held (never negative). When
 * it's on, both sides are capped by margin buying power instead (see `portfolio/accounting.ts`) —
 * a SELL may also open or add to a short, additionally capped by `risk.borrowableShares`. Either
 * way, a bankrupt participant can never trade again.
 */
function capTradeQuantity(args: {
  desiredQuantity: number;
  buyerId: string | null;
  sellerId: string | null;
  priceCents: number;
  feeRate: number;
  portfolios: Map<string, StockMarket2Portfolio>;
  risk: RiskConfig;
}): { quantity: number; buyerExhausted: boolean; sellerExhausted: boolean } {
  const { desiredQuantity, buyerId, sellerId, priceCents, feeRate, portfolios, risk } = args;

  let maxBuyQty = Number.POSITIVE_INFINITY;
  if (buyerId !== null) {
    const buyer = portfolios.get(buyerId);
    if (buyer === undefined || buyer.bankrupt) {
      maxBuyQty = 0;
    } else if (!risk.allowShortSelling) {
      const costPerShareCents = priceCents * (1 + feeRate);
      maxBuyQty = costPerShareCents > 0 ? Math.floor(buyer.cashCents / costPerShareCents) : Number.POSITIVE_INFINITY;
    } else {
      maxBuyQty = maxBuyQuantityByMargin(buyer.shares, buyingPowerCents(buyer, priceCents, risk), priceCents);
    }
  }

  let maxSellQty = Number.POSITIVE_INFINITY;
  if (sellerId !== null) {
    const seller = portfolios.get(sellerId);
    if (seller === undefined || seller.bankrupt) {
      maxSellQty = 0;
    } else if (!risk.allowShortSelling) {
      maxSellQty = Math.max(0, seller.shares);
    } else {
      maxSellQty = maxSellQuantityByMargin(
        seller.shares,
        buyingPowerCents(seller, priceCents, risk),
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

function settleTrade(portfolios: Map<string, StockMarket2Portfolio>, trade: Trade, feeRate: number): void {
  const tradeValueCents = trade.priceCents * trade.quantity;
  const feeCents = Math.round(tradeValueCents * feeRate);
  if (trade.buyerParticipantId !== null) {
    const buyer = portfolios.get(trade.buyerParticipantId);
    if (buyer !== undefined) {
      portfolios.set(trade.buyerParticipantId, applyFill(buyer, 'BUY', trade.quantity, trade.priceCents, feeCents));
    }
  }
  if (trade.sellerParticipantId !== null) {
    const seller = portfolios.get(trade.sellerParticipantId);
    if (seller !== undefined) {
      portfolios.set(trade.sellerParticipantId, applyFill(seller, 'SELL', trade.quantity, trade.priceCents, feeCents));
    }
  }
}

/** Both LIMIT: the midpoint (rounded half up) — symmetric, favors neither side. One MARKET, one
 * LIMIT: the LIMIT side's price (the market order "takes" whatever the resting limit offers).
 * Both MARKET (only possible player-vs-player, never against synthetic liquidity which always
 * quotes a real price): falls back to the day's reference price. */
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
  referencePriceCents: number;
  openOrders: readonly RestingOrder[];
  pendingLiquidity: LiquiditySnapshot;
  portfolios: ReadonlyMap<string, StockMarket2Portfolio>;
  actions: ReadonlyMap<string, StockMarket2Action>;
  participantIds: readonly string[];
  feeRate: number;
  risk: RiskConfig;
  nextOrderSequence: number;
  rng: Rng;
}

export interface ResolveRoundResult {
  portfolios: Map<string, StockMarket2Portfolio>;
  openOrders: RestingOrder[];
  trades: Trade[];
  nextOrderSequence: number;
  /** Whatever's left of this round's synthetic liquidity ladder after normal matching — `game.ts`
   * feeds this into any margin-call forced liquidation, so a forced sale executes through the
   * same exchange/liquidity system rather than some separate accounting shortcut (spec §25). */
  remainingLiquidity: LiquiditySnapshot;
}

/**
 * One round's full exchange lifecycle (spec §19, steps 11-17): validate/admit new orders, cancel
 * what's asked, match player orders against player orders, match whatever's left against
 * synthetic external liquidity, apply fills (with fees), and return the updated book/portfolios.
 *
 * All the real economic feasibility checking happens here, not in `validateAction` — an order
 * that looked affordable at submission time can still fail to (fully) execute here if, say, an
 * earlier order in the same bot's own submission already spent the cash (same "validateAction is
 * a light gate, resolve() is authoritative" convention the original game used, generalized from a
 * single action to a list of orders). When `risk.allowShortSelling` is on, admission of a new
 * LIMIT order is similarly a light (imprecise) margin check against the participant's *current*
 * state only — it does not try to net multiple simultaneous new LIMIT orders' hypothetical future
 * margin usage against each other. Fill time (`capTradeQuantity`, using live, already-updated
 * portfolio state) is what actually prevents an account from ever overdrawing its real margin
 * capacity; admission just decides whether an order is worth resting in the book at all.
 */
export function resolveRound(args: ResolveRoundArgs): ResolveRoundResult {
  const { round, referencePriceCents, pendingLiquidity, actions, participantIds, feeRate, risk, rng } = args;

  const portfolios = new Map(args.portfolios);
  const openOrdersWorking: RestingOrder[] = [...args.openOrders];
  let nextOrderSequence = args.nextOrderSequence;
  const trades: Trade[] = [];

  // --- 1. Cancels, processed first so they free up buying power for new orders below. ---
  for (const participantId of participantIds) {
    const action = actions.get(participantId);
    if (action === undefined) {
      continue;
    }
    for (const order of action.orders) {
      if (order.kind !== 'CANCEL') {
        continue;
      }
      const index = openOrdersWorking.findIndex(
        (o) => o.id === order.orderId && o.participantId === participantId,
      );
      if (index !== -1) {
        openOrdersWorking.splice(index, 1);
      }
    }
  }

  // --- 2. Admit new MARKET/LIMIT requests. LIMIT orders reserve buying power up front (since
  // they might rest); MARKET orders never rest, so they're admitted unconditionally here and any
  // real affordability constraint is enforced per-fill during matching below. A bankrupt
  // participant's orders are never admitted at all. ---
  const committedCashCents = new Map<string, number>();
  const committedShares = new Map<string, number>();
  const newBuys: WorkingOrder[] = [];
  const newSells: WorkingOrder[] = [];

  function admit(participantId: string, order: OrderRequest): void {
    if (order.kind === 'CANCEL') {
      return;
    }
    const portfolio = portfolios.get(participantId);
    if (portfolio === undefined || portfolio.bankrupt) {
      return;
    }

    if (order.kind === 'LIMIT') {
      const limitPriceCents = Math.round(order.limitPrice * 100);

      if (risk.allowShortSelling) {
        // See this function's docstring: a light, imprecise-under-multiple-orders check against
        // current state, not netted against other new orders admitted this same round.
        const power = buyingPowerCents(portfolio, limitPriceCents, risk);
        const maxQty =
          order.side === 'BUY'
            ? maxBuyQuantityByMargin(portfolio.shares, power, limitPriceCents)
            : maxSellQuantityByMargin(portfolio.shares, power, limitPriceCents, risk.borrowableShares);
        if (order.quantity > maxQty) {
          return;
        }
      } else {
        const { availableCashCents, availableShares } = computeAvailability(
          portfolio,
          openOrdersWorking,
          participantId,
        );
        if (order.side === 'BUY') {
          const alreadyCommitted = committedCashCents.get(participantId) ?? 0;
          const worstCaseCostCents = order.quantity * limitPriceCents;
          if (worstCaseCostCents > availableCashCents - alreadyCommitted) {
            return; // can't reserve this — silently dropped, same defensive convention as before
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

  const bidPool: WorkingOrder[] = [
    ...openOrdersWorking.filter((o) => o.side === 'BUY').map(toWorking),
    ...newBuys,
  ];
  const askPool: WorkingOrder[] = [
    ...openOrdersWorking.filter((o) => o.side === 'SELL').map(toWorking),
    ...newSells,
  ];

  // --- 3. Player-vs-player matching (spec §19 step 14). ---
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
      break; // sorted by price — no later pair can cross either
    }
    if (bid.participantId === ask.participantId) {
      // Self-trade prevention: a bot can't trade against its own order. Deterministic policy —
      // skip past this ask for this bid and try the next-best one instead.
      ai++;
      continue;
    }

    const priceCents = tradePriceFor(bid, ask, referencePriceCents);
    const desired = Math.min(bid.remaining, ask.remaining);
    const cap = capTradeQuantity({
      desiredQuantity: desired,
      buyerId: bid.participantId,
      sellerId: ask.participantId,
      priceCents,
      feeRate,
      portfolios,
      risk,
    });

    if (cap.quantity > 0) {
      const trade: Trade = {
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

  // --- 4. Whatever's left matches against synthetic external liquidity (spec §19 step 15). ---
  const askLiquidity = pendingLiquidity.asks.map((level) => ({ ...level }));
  const bidLiquidity = pendingLiquidity.bids.map((level) => ({ ...level }));

  for (const bid of bidPool) {
    for (const level of askLiquidity) {
      if (bid.remaining <= 0) {
        break;
      }
      if (level.quantity <= 0) {
        continue;
      }
      if (bid.limitPriceCents !== null && bid.limitPriceCents < level.priceCents) {
        break; // sorted best-first; no further level is acceptable either
      }
      const desired = Math.min(bid.remaining, level.quantity);
      const cap = capTradeQuantity({
        desiredQuantity: desired,
        buyerId: bid.participantId,
        sellerId: null,
        priceCents: level.priceCents,
        feeRate,
        portfolios,
        risk,
      });
      if (cap.quantity > 0) {
        const trade: Trade = {
          buyerParticipantId: bid.participantId,
          sellerParticipantId: null,
          priceCents: level.priceCents,
          quantity: cap.quantity,
        };
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
        buyerId: null,
        sellerId: ask.participantId,
        priceCents: level.priceCents,
        feeRate,
        portfolios,
        risk,
      });
      if (cap.quantity > 0) {
        const trade: Trade = {
          buyerParticipantId: null,
          sellerParticipantId: ask.participantId,
          priceCents: level.priceCents,
          quantity: cap.quantity,
        };
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

  // --- 5. Whatever's still unfilled: MARKET remainders and DAY LIMIT remainders are dropped;
  // GTC LIMIT remainders (new or still-resting) persist into the next round's book. ---
  const nextOpenOrders: RestingOrder[] = [];
  for (const working of [...bidPool, ...askPool]) {
    if (working.remaining <= 0 || working.limitPriceCents === null || working.timeInForce !== 'GTC') {
      continue;
    }
    if (working.resting !== null) {
      nextOpenOrders.push({
        id: working.resting.id,
        participantId: working.participantId,
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
        side: working.side,
        limitPriceCents: working.limitPriceCents,
        timeInForce: 'GTC',
        quantity: working.remaining,
        submittedRound: round,
      });
      nextOrderSequence += 1;
    }
  }

  return {
    portfolios,
    openOrders: nextOpenOrders,
    trades,
    nextOrderSequence,
    remainingLiquidity: { bids: bidLiquidity, asks: askLiquidity },
  };
}
