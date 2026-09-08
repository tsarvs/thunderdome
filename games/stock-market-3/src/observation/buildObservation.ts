import { computeAvailability } from '../exchange/matchingEngine.js';
import { toDollars } from '../money.js';
import {
  equityCents,
  grossPositionValueCents,
  longExposureCents,
  maintenanceRequirementCents,
  remainingBuyingPowerCents,
  shortExposureCents,
} from '../portfolio/accounting.js';
import type {
  AnalystRevisionPublic,
  PortfolioObservation,
  PublicEvent,
  PublicEventDollars,
  PublicFundamentalsSnapshot,
  PublicOpenOrder,
  PublicOrderBookLevel,
  RestingOrder,
  SecurityObservation,
  SecurityState,
  StockMarket3Observation,
  StockMarket3State,
} from '../types.js';

/**
 * The single choke point through which every piece of public information reaches a bot (spec
 * §57/§58's "Hidden Information Audit"/"No-Future-Information Audit" both start here). Every field
 * this function reads off `SecurityState`/`StockMarket3State` is either already public-by-
 * construction (this round's and earlier rounds' price/volume/order-book/event/analyst-revision
 * history — nothing about a LATER round is ever written into these arrays before that round
 * arrives, so there is nothing to filter) or is deliberately converted/derived here in a way that
 * can never leak a hidden field (see the `HIDDEN — never read below this line` markers). Grepping
 * this file against `SecurityState`'s own doc comment in types.ts is the audit.
 */
export function buildObservation(state: StockMarket3State, participantId: string): StockMarket3Observation {
  const portfolio = state.portfolios.get(participantId);
  if (portfolio === undefined) {
    throw new Error(`unknown participant "${participantId}"`);
  }

  const allOpenOrders: RestingOrder[] = [...state.securities.values()].flatMap((security) => security.openOrders);
  const markPricesCents = new Map<string, number>();
  for (const security of state.securities.values()) {
    markPricesCents.set(security.symbol, markPriceCentsOf(security));
  }

  const securities: SecurityObservation[] = [...state.securities.values()]
    .filter((security) => security.active)
    .map((security) => buildSecurityObservation(security, state.config.orderBookDepth));

  const positions = [...portfolio.positions.entries()]
    .filter(([, position]) => position.shares !== 0)
    .map(([symbol, position]) => {
      const markCents = markPricesCents.get(symbol) ?? 0;
      const { availableShares } = computeAvailability(portfolio, allOpenOrders, participantId, symbol);
      return {
        symbol,
        shares: position.shares,
        availableShares,
        averageEntryPrice: toDollars(position.averageEntryPriceCents),
        marketValue: toDollars(position.shares * markCents),
        unrealizedPnl: toDollars(position.shares * (markCents - position.averageEntryPriceCents)),
        realizedPnl: toDollars(position.realizedPnlCents),
      };
    });

  const openOrders: PublicOpenOrder[] = allOpenOrders
    .filter((order) => order.participantId === participantId)
    .map((order) => ({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      limitPrice: toDollars(order.limitPriceCents),
      timeInForce: order.timeInForce,
      quantity: order.quantity,
    }));

  let reservedCashCents = 0;
  for (const order of allOpenOrders) {
    if (order.participantId === participantId && order.side === 'BUY') {
      reservedCashCents += order.quantity * order.limitPriceCents;
    }
  }

  const nlvCents = equityCents(portfolio, markPricesCents);
  const grossCents = grossPositionValueCents(portfolio, markPricesCents);
  const risk = state.config.risk;
  const portfolioObservation: PortfolioObservation = {
    cash: toDollars(portfolio.cashCents),
    availableCash: toDollars(portfolio.cashCents - reservedCashCents),
    nlv: toDollars(nlvCents),
    buyingPower: toDollars(remainingBuyingPowerCents(portfolio, markPricesCents, risk)),
    marginUsed: toDollars(grossCents),
    maintenanceRequirement: toDollars(maintenanceRequirementCents(portfolio, markPricesCents, risk)),
    grossExposure: toDollars(grossCents),
    netExposure: toDollars(longExposureCents(portfolio, markPricesCents) - shortExposureCents(portfolio, markPricesCents)),
    longExposure: toDollars(longExposureCents(portfolio, markPricesCents)),
    shortExposure: toDollars(shortExposureCents(portfolio, markPricesCents)),
    leverage: nlvCents > 0 ? grossCents / nlvCents : 0,
    drawdown: portfolio.maxDrawdown,
    realizedPnl: toDollars([...portfolio.positions.values()].reduce((sum, position) => sum + position.realizedPnlCents, 0)),
    bankrupt: portfolio.bankrupt,
    positions,
    openOrders,
  };

  return {
    round: state.round,
    totalRounds: state.config.rounds,
    warmupRounds: state.config.warmupRounds,
    phase: state.round < state.config.warmupRounds ? 'WARMUP' : 'COMPETITION',
    indexSymbol: state.config.indexSymbol,
    securities,
    calendar: state.calendar,
    marketEvents: state.marketEvents,
    portfolio: portfolioObservation,
  };
}

export function markPriceCentsOf(security: SecurityState): number {
  const lastCandle = security.priceHistory[security.priceHistory.length - 1];
  return lastCandle !== undefined ? Math.round(lastCandle.close * 100) : security.referencePriceCents;
}

function aggregateBookLevels(
  security: SecurityState,
  depth: number,
): { bids: PublicOrderBookLevel[]; asks: PublicOrderBookLevel[] } {
  const bidCentsByPrice = new Map<number, number>();
  const askCentsByPrice = new Map<number, number>();
  for (const order of security.openOrders) {
    const map = order.side === 'BUY' ? bidCentsByPrice : askCentsByPrice;
    map.set(order.limitPriceCents, (map.get(order.limitPriceCents) ?? 0) + order.quantity);
  }
  for (const level of security.pendingLiquidity.bids) {
    bidCentsByPrice.set(level.priceCents, (bidCentsByPrice.get(level.priceCents) ?? 0) + level.quantity);
  }
  for (const level of security.pendingLiquidity.asks) {
    askCentsByPrice.set(level.priceCents, (askCentsByPrice.get(level.priceCents) ?? 0) + level.quantity);
  }

  const bids = [...bidCentsByPrice.entries()]
    .sort(([a], [b]) => b - a)
    .slice(0, depth)
    .map(([priceCents, quantity]) => ({ price: toDollars(priceCents), quantity }));
  const asks = [...askCentsByPrice.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, depth)
    .map(([priceCents, quantity]) => ({ price: toDollars(priceCents), quantity }));

  return { bids, asks };
}

function latestFundamentalsOf(security: SecurityState): PublicFundamentalsSnapshot | null {
  for (let i = security.events.length - 1; i >= 0; i--) {
    const event = security.events[i];
    if (event?.type === 'EARNINGS_REPORT') {
      return {
        periodLabel: event.periodLabel,
        revenue: toDollars(event.reported.revenueCents),
        earnings: toDollars(Math.round((event.reported.revenueCents * event.reported.marginBps) / 10000)),
        marginBps: event.reported.marginBps,
      };
    }
  }
  return null;
}

function toPublicEvent(event: PublicEvent): PublicEventDollars {
  if (event.type === 'EARNINGS_REPORT') {
    return {
      ...event,
      reported: { eps: toDollars(event.reported.epsCents), revenue: toDollars(event.reported.revenueCents), marginBps: event.reported.marginBps },
      consensus: { eps: toDollars(event.consensus.epsCents), revenue: toDollars(event.consensus.revenueCents), marginBps: event.consensus.marginBps },
    };
  }
  if (event.type === 'ECONOMIC_RELEASE') {
    return event;
  }
  if (!('details' in event)) {
    return event; // CompanyNewsEvent — no cents fields to convert
  }
  const details = event.details;
  switch (details.type) {
    case 'CASH_DIVIDEND':
      return { ...event, details: { type: 'CASH_DIVIDEND', perShare: toDollars(details.perShareCents) } };
    case 'STOCK_SPLIT':
      return { ...event, details: { type: 'STOCK_SPLIT', fromShares: details.fromShares, toShares: details.toShares } };
    case 'REVERSE_SPLIT':
      return { ...event, details: { type: 'REVERSE_SPLIT', fromShares: details.fromShares, toShares: details.toShares } };
    case 'BUYBACK':
      return { ...event, details: { type: 'BUYBACK', sharesRepurchased: details.sharesRepurchased, price: toDollars(details.priceCents) } };
    case 'ACQUISITION':
      return { ...event, details: { type: 'ACQUISITION', effectiveRound: details.effectiveRound, cashPerShare: toDollars(details.cashPerShareCents) } };
    case 'DELISTING':
      return { ...event, details: { type: 'DELISTING', effectiveRound: details.effectiveRound, reason: details.reason } };
  }
}

function buildSecurityObservation(security: SecurityState, orderBookDepth: number): SecurityObservation {
  const lastCandle = security.priceHistory[security.priceHistory.length - 1];
  const book = aggregateBookLevels(security, orderBookDepth);

  const analystRevisionHistory: AnalystRevisionPublic[] = security.analystRevisions.map((revision) => ({
    observedAtRound: revision.observedAtRound,
    periodLabel: revision.periodLabel,
    eps: toDollars(revision.consensus.epsCents),
    revenue: toDollars(revision.consensus.revenueCents),
    marginBps: revision.consensus.marginBps,
  }));
  const latestRevision = security.analystRevisions[security.analystRevisions.length - 1];

  return {
    symbol: security.symbol,
    kind: security.kind,
    sector: security.sector,
    active: security.active,
    sharesOutstanding: security.sharesOutstanding,
    quote: {
      lastClose: lastCandle !== undefined ? lastCandle.close : toDollars(security.referencePriceCents),
      bid: book.bids[0]?.price ?? null,
      ask: book.asks[0]?.price ?? null,
      bidSize: book.bids[0]?.quantity ?? 0,
      askSize: book.asks[0]?.quantity ?? 0,
      orderBook: book,
    },
    priceHistory: security.priceHistory,
    lastRoundVolume: security.lastRoundVolume,
    borrow: { availableShares: security.borrowableShares, feeAnnualized: security.borrowFeeAnnualized },
    latestFundamentals: latestFundamentalsOf(security),
    analystConsensus:
      latestRevision !== undefined
        ? {
            periodLabel: latestRevision.periodLabel,
            eps: toDollars(latestRevision.consensus.epsCents),
            revenue: toDollars(latestRevision.consensus.revenueCents),
            marginBps: latestRevision.consensus.marginBps,
          }
        : null,
    analystRevisionHistory,
    events: security.events.map(toPublicEvent),
  };
}
