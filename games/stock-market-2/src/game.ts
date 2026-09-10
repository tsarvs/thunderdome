import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import { buildDailyCandle } from './exchange/candle.js';
import { generateLiquiditySnapshot } from './exchange/liquidity.js';
import { computeAvailability, resolveRound } from './exchange/matchingEngine.js';
import type { MarketEnvironment } from './market/environment.js';
import {
  createHistoricalMarketEnvironment,
  loadDennProvider,
  resolveHistoryStartIndex,
} from './market/historicalEnvironment.js';
import { computeReferencePriceCents } from './market/referencePriceModel.js';
import { INITIAL_REGIME, REGIME_PROFILES } from './market/regime.js';
import { createSyntheticMarketEnvironment } from './market/syntheticEnvironment.js';
import { toCents, toDollars } from './money.js';
import {
  buyingPowerCents,
  equityCents,
  grossPositionValueCents,
  isBelowMaintenance,
  maintenanceRequirementCents,
} from './portfolio/accounting.js';
import { dailyBorrowFeeCents } from './portfolio/borrow.js';
import { forceLiquidate } from './portfolio/margin.js';
import type { Rng } from '@thunderdome/engine';
import {
  DENN_SYMBOL,
  StockMarket2ActionSchema,
  StockMarket2ConfigSchema,
  type LiquidityLevel,
  type LiquidityProfile,
  type LiquiditySnapshot,
  type MarketRegime,
  type PublicOpenOrder,
  type PublicOrderBookLevel,
  type RestingOrder,
  type StockMarket2Action,
  type StockMarket2Config,
  type StockMarket2Observation,
  type StockMarket2RiskStats,
  type StockMarket2Result,
  type StockMarket2State,
  type Trade,
} from './types.js';

/** Reconstructed fresh on every call rather than stored in state — a `MarketEnvironment` closes
 * over config/data, neither of which belongs in serializable game state (state is logged/replayed
 * as plain data; `historyStartIndex` is the one piece of environment-selection state that *is*
 * persisted, precisely so this reconstruction is cheap and deterministic). */
function environmentFor(config: StockMarket2Config, historyStartIndex: number): MarketEnvironment {
  if (config.mode === 'HISTORICAL') {
    return createHistoricalMarketEnvironment(loadDennProvider(), historyStartIndex);
  }
  return createSyntheticMarketEnvironment(config.synthetic, config.liquidity.averageDailyVolume);
}

/** Generates one round's synthetic liquidity ladder, scaling the environment's base expected-
 * volume/volatility-hint by the current regime's own liquidity/volatility multipliers (spec §8 —
 * regime affects liquidity/spread; SYNTHETIC's own price drift already lives in how the
 * fundamental value evolved, HISTORICAL's regime never touches price at all, only this). */
function generateRegimeAdjustedLiquidity(args: {
  referencePriceCents: number;
  expectedDailyVolume: number;
  volatilityHint: number;
  regime: MarketRegime;
  profile: LiquidityProfile;
  rng: Rng;
}): LiquiditySnapshot {
  const regimeProfile = REGIME_PROFILES[args.regime];
  return generateLiquiditySnapshot({
    referencePriceCents: args.referencePriceCents,
    expectedDailyVolume: args.expectedDailyVolume * regimeProfile.liquidityMultiplier,
    volatilityHint: args.volatilityHint * regimeProfile.volatilityMultiplier,
    profile: args.profile,
    rng: args.rng,
  });
}

function aggregateBookLevels(
  openOrders: readonly RestingOrder[],
  liquidity: LiquiditySnapshot,
  depth: number,
): { bids: PublicOrderBookLevel[]; asks: PublicOrderBookLevel[] } {
  const bidCentsByPrice = new Map<number, number>();
  const askCentsByPrice = new Map<number, number>();
  for (const order of openOrders) {
    const map = order.side === 'BUY' ? bidCentsByPrice : askCentsByPrice;
    map.set(order.limitPriceCents, (map.get(order.limitPriceCents) ?? 0) + order.quantity);
  }
  for (const level of liquidity.bids) {
    bidCentsByPrice.set(level.priceCents, (bidCentsByPrice.get(level.priceCents) ?? 0) + level.quantity);
  }
  for (const level of liquidity.asks) {
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

function markPriceCents(state: StockMarket2State): number {
  const lastCandle = state.priceHistory[state.priceHistory.length - 1];
  return lastCandle !== undefined ? toCents(lastCandle.close) : state.referencePriceCents;
}

function describeObservation(observation: StockMarket2Observation): string {
  const { round, totalRounds, portfolio, market, event, openOrders, symbol } = observation;
  const bidAsk =
    market.bid !== null && market.ask !== null
      ? `bid $${market.bid.toFixed(2)} / ask $${market.ask.toFixed(2)}`
      : 'no quotes';
  const openOrdersLine =
    openOrders.length === 0
      ? ''
      : `Open orders: ${openOrders
          .map((o) => `${o.id} ${o.side} ${String(o.quantity)}@$${o.limitPrice.toFixed(2)} (${o.timeInForce})`)
          .join(', ')}\n`;
  const marginLine =
    portfolio.buyingPower > 0 || portfolio.marginUsed > 0
      ? `Margin: buying power $${portfolio.buyingPower.toFixed(2)}, used $${portfolio.marginUsed.toFixed(2)}, ` +
        `maintenance req. $${portfolio.maintenanceRequirement.toFixed(2)}\n`
      : '';
  const bankruptLine = portfolio.bankrupt ? 'BANKRUPT — no further trading is possible.\n' : '';

  return (
    `\nRound ${String(round + 1)}/${String(totalRounds)} — ${symbol} (${market.date}) — ` +
    `last close $${market.lastClose.toFixed(2)}, ${bidAsk}\n` +
    `Portfolio: $${portfolio.cash.toFixed(2)} cash (avail $${portfolio.availableCash.toFixed(2)}), ` +
    `${String(portfolio.shares)} shares (avail ${String(portfolio.availableShares)}), ` +
    `value $${portfolio.value.toFixed(2)}, realized P&L $${portfolio.realizedPnl.toFixed(2)}\n` +
    marginLine +
    bankruptLine +
    openOrdersLine +
    (event.type === 'NO_NEWS' ? '' : `News: ${event.description}\n`) +
    'BUY/SELL <qty> [@<limitPrice>] [gtc], CANCEL <orderId>, or HOLD? '
  );
}

function parseInput(raw: string): StockMarket2Action | undefined {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'hold' || lower === '') {
    return { orders: [] };
  }
  if (lower.startsWith('cancel ')) {
    const orderId = trimmed.slice('cancel '.length).trim();
    return orderId.length > 0 ? { orders: [{ kind: 'CANCEL', orderId }] } : undefined;
  }

  const parts = lower.split(/\s+/);
  const [word, quantityRaw, ...rest] = parts;
  if (word !== 'buy' && word !== 'sell') {
    return undefined;
  }
  const side = word === 'buy' ? 'BUY' : 'SELL';
  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return undefined;
  }

  let limitPrice: number | undefined;
  let timeInForce: 'DAY' | 'GTC' = 'DAY';
  for (const token of rest) {
    if (token === 'gtc') {
      timeInForce = 'GTC';
    } else if (token.startsWith('@')) {
      const price = Number(token.slice(1));
      if (Number.isFinite(price) && price > 0) {
        limitPrice = price;
      }
    }
  }

  return limitPrice !== undefined
    ? { orders: [{ kind: 'LIMIT', side, quantity, limitPrice, timeInForce }] }
    : { orders: [{ kind: 'MARKET', side, quantity }] };
}

function describeAction(action: StockMarket2Action): string {
  if (action.orders.length === 0) {
    return 'Held (no orders).';
  }
  return action.orders
    .map((order) => {
      if (order.kind === 'CANCEL') {
        return `Cancelled order ${order.orderId}.`;
      }
      if (order.kind === 'MARKET') {
        return `${order.side} ${String(order.quantity)} @ MARKET.`;
      }
      return `${order.side} ${String(order.quantity)} @ LIMIT $${order.limitPrice.toFixed(2)} (${order.timeInForce}).`;
    })
    .join(' ');
}

function emptyRiskStats(): StockMarket2RiskStats {
  return { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const stockMarket2: GameDefinition<
  StockMarket2Config,
  StockMarket2State,
  StockMarket2Observation,
  StockMarket2Action,
  StockMarket2Result
> = {
  id: 'stock-market-2',
  version: '0.3.0',

  parseConfig(raw) {
    const result = StockMarket2ConfigSchema.safeParse(raw);
    if (!result.success) {
      return err(result.error.issues.map((issue) => issue.message).join('; '));
    }
    const config = result.data;
    // HISTORICAL mode only ever replays the one bundled dataset — force the symbol so it can
    // never drift from what the data actually is, regardless of what a caller passed.
    return ok(config.mode === 'HISTORICAL' ? { ...config, symbol: DENN_SYMBOL } : config);
  },

  redactConfigForBots(config) {
    // No hidden multiplier/weight table to strip (unlike games/stock-market) — everything in
    // config is either a real, public dataset fact or an organizer-set knob a bot may as well see.
    return config;
  },

  initialize({ config, participantIds, rng }) {
    if (participantIds.length < 1) {
      throw new Error('stock-market-2 requires at least 1 participant');
    }
    const startingCashCents = toCents(config.startingCash);
    const portfolios = new Map(
      participantIds.map((id) => [
        id,
        { cashCents: startingCashCents, shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0, bankrupt: false },
      ]),
    );
    const riskStats = new Map(participantIds.map((id) => [id, emptyRiskStats()]));

    const historyStartIndex =
      config.mode === 'HISTORICAL' ? resolveHistoryStartIndex(config, loadDennProvider(), rng) : 0;
    const environment = environmentFor(config, historyStartIndex);
    const conditions = environment.conditionsFor({
      round: 0,
      rng,
      previousFundamentalValueCents: 0,
      previousRegime: INITIAL_REGIME,
    });
    // Round 0 is the match's pinned starting point: reference price = fundamental value exactly
    // — no pull/shock/event applied yet, since nothing has traded before the match begins.
    const referencePriceCents = conditions.fundamentalValueCents;
    const pendingLiquidity = generateRegimeAdjustedLiquidity({
      referencePriceCents,
      expectedDailyVolume: conditions.expectedDailyVolume,
      volatilityHint: conditions.volatilityHint,
      regime: conditions.regime,
      profile: config.liquidity,
      rng,
    });

    return {
      participantIds: [...participantIds],
      config,
      historyStartIndex,
      round: 0,
      startingPriceCents: referencePriceCents,
      startDate: conditions.date,
      referencePriceCents,
      fundamentalValueCents: conditions.fundamentalValueCents,
      regime: conditions.regime,
      pendingLiquidity,
      currentEvent: conditions.event,
      currentDate: conditions.date,
      openOrders: [],
      priceHistory: [],
      lastRoundVolume: null,
      portfolios,
      riskStats,
      nextOrderSequence: 0,
    };
  },

  getObservation(state, participantId) {
    const portfolio = state.portfolios.get(participantId);
    if (portfolio === undefined) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    const { availableCashCents, availableShares } = computeAvailability(
      portfolio,
      state.openOrders,
      participantId,
    );
    const openOrders: PublicOpenOrder[] = state.openOrders
      .filter((order) => order.participantId === participantId)
      .map((order) => ({
        id: order.id,
        side: order.side,
        limitPrice: toDollars(order.limitPriceCents),
        timeInForce: order.timeInForce,
        quantity: order.quantity,
      }));

    const book = aggregateBookLevels(state.openOrders, state.pendingLiquidity, state.config.orderBookDepth);
    const priceCents = markPriceCents(state);
    const lastClose = toDollars(priceCents);
    const risk = state.config.risk;

    return {
      round: state.round,
      totalRounds: state.config.rounds,
      symbol: state.config.symbol,
      mode: state.config.mode,
      portfolio: {
        cash: toDollars(portfolio.cashCents),
        shares: portfolio.shares,
        value: toDollars(equityCents(portfolio, priceCents)),
        availableCash: toDollars(availableCashCents),
        availableShares,
        buyingPower: toDollars(buyingPowerCents(portfolio, priceCents, risk)),
        marginUsed: toDollars(grossPositionValueCents(portfolio, priceCents)),
        maintenanceRequirement: toDollars(maintenanceRequirementCents(portfolio, priceCents, risk)),
        realizedPnl: toDollars(portfolio.realizedPnlCents),
        bankrupt: portfolio.bankrupt,
      },
      openOrders,
      market: {
        date: state.currentDate,
        lastClose,
        bid: book.bids[0]?.price ?? null,
        ask: book.asks[0]?.price ?? null,
        bidSize: book.bids[0]?.quantity ?? 0,
        askSize: book.asks[0]?.quantity ?? 0,
        orderBook: book,
        priceHistory: state.priceHistory,
        lastRoundVolume: state.lastRoundVolume,
      },
      event: state.currentEvent,
    };
  },

  getPendingActions(state) {
    // Simultaneous: every participant acts every round, each blind to the others' submissions —
    // the same public state (spec §19's daily lifecycle) is what every bot decides against.
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  validateAction(state, participantId, raw) {
    const result = StockMarket2ActionSchema.safeParse(raw);
    if (!result.success) {
      return err(
        'action must be {"orders": [...]}, each order MARKET {kind,side,quantity}, LIMIT ' +
          '{kind,side,quantity,limitPrice,timeInForce?}, or CANCEL {kind,orderId}',
      );
    }
    const action = result.data;
    if (action.orders.length > state.config.maxOrdersPerRound) {
      return err(
        `too many orders: submitted ${String(action.orders.length)}, max ${String(state.config.maxOrdersPerRound)}`,
      );
    }
    const portfolio = state.portfolios.get(participantId);
    if (portfolio === undefined) {
      return err(`unknown participant "${participantId}"`);
    }
    if (portfolio.bankrupt && action.orders.length > 0) {
      return err('participant is bankrupt and can no longer trade');
    }

    // Structural checks only — real economic feasibility (affordability across a whole batch of
    // orders, given resting reservations and same-round interactions) is resolve()'s job, same
    // "validateAction is a light gate" convention the original game used.
    for (const order of action.orders) {
      if (
        order.kind === 'CANCEL' &&
        !state.openOrders.some((o) => o.id === order.orderId && o.participantId === participantId)
      ) {
        return err(`cannot cancel unknown or foreign order "${order.orderId}"`);
      }
    }

    return ok(action);
  },

  resolve({ state, actions, rng }) {
    const risk = state.config.risk;
    const matchResult = resolveRound({
      round: state.round,
      referencePriceCents: state.referencePriceCents,
      openOrders: state.openOrders,
      pendingLiquidity: state.pendingLiquidity,
      portfolios: state.portfolios,
      actions,
      participantIds: state.participantIds,
      feeRate: state.config.transactionFee,
      risk,
      nextOrderSequence: state.nextOrderSequence,
      rng,
    });

    let portfolios = matchResult.portfolios;
    let openOrders = matchResult.openOrders;
    let remainingBidLiquidity: LiquidityLevel[] = matchResult.remainingLiquidity.bids;
    let remainingAskLiquidity: LiquidityLevel[] = matchResult.remainingLiquidity.asks;
    const riskStats = new Map(state.riskStats);
    const forcedTrades: Trade[] = [];

    // Borrow fees and margin calls (spec §23/§25) both need a mark price for THIS round — the
    // last actual transaction price if anything traded, else the day's reference price. The final
    // realized candle (below) still only reflects real executions, forced liquidations included.
    const lastTrade = matchResult.trades[matchResult.trades.length - 1];
    const interimMarkPriceCents = lastTrade?.priceCents ?? state.referencePriceCents;

    if (risk.allowShortSelling) {
      for (const participantId of state.participantIds) {
        const portfolio = portfolios.get(participantId);
        if (portfolio === undefined || portfolio.bankrupt || portfolio.shares >= 0) {
          continue;
        }
        const feeCents = dailyBorrowFeeCents(-portfolio.shares, interimMarkPriceCents, risk.borrowFeeAnnualized);
        if (feeCents <= 0) {
          continue;
        }
        portfolios = new Map(portfolios);
        portfolios.set(participantId, { ...portfolio, cashCents: portfolio.cashCents - feeCents });
        const stats = riskStats.get(participantId) ?? emptyRiskStats();
        riskStats.set(participantId, { ...stats, borrowFeesPaidCents: stats.borrowFeesPaidCents + feeCents });
      }

      for (const participantId of state.participantIds) {
        const portfolio = portfolios.get(participantId);
        if (portfolio === undefined || portfolio.bankrupt || portfolio.shares === 0) {
          continue;
        }
        if (!isBelowMaintenance(portfolio, interimMarkPriceCents, risk)) {
          continue;
        }

        openOrders = openOrders.filter((o) => o.participantId !== participantId);
        const isLong = portfolio.shares > 0;
        const liquidation = forceLiquidate({
          participantId,
          portfolio,
          liquidity: isLong ? remainingBidLiquidity : remainingAskLiquidity,
          feeRate: state.config.transactionFee,
        });
        if (isLong) {
          remainingBidLiquidity = liquidation.remainingLiquidity;
        } else {
          remainingAskLiquidity = liquidation.remainingLiquidity;
        }
        forcedTrades.push(...liquidation.trades);

        const equityAfter = equityCents(liquidation.portfolio, interimMarkPriceCents);
        portfolios = new Map(portfolios);
        portfolios.set(participantId, equityAfter < 0 ? { ...liquidation.portfolio, bankrupt: true } : liquidation.portfolio);

        const stats = riskStats.get(participantId) ?? emptyRiskStats();
        riskStats.set(participantId, {
          ...stats,
          marginCalls: stats.marginCalls + 1,
          forcedLiquidations: stats.forcedLiquidations + (liquidation.trades.length > 0 ? 1 : 0),
        });
      }
    }

    const allTrades = [...matchResult.trades, ...forcedTrades];
    const candle = buildDailyCandle(state.currentDate, state.referencePriceCents, allTrades);
    const priceHistory = [...state.priceHistory, candle].slice(-state.config.priceHistoryLength);

    let sharesBought = 0;
    let sharesSold = 0;
    for (const trade of allTrades) {
      if (trade.buyerParticipantId !== null) {
        sharesBought += trade.quantity;
      }
      if (trade.sellerParticipantId !== null) {
        sharesSold += trade.quantity;
      }
    }
    const lastRoundVolume = { sharesBought, sharesSold, netDemand: sharesBought - sharesSold };

    const environment = environmentFor(state.config, state.historyStartIndex);
    const nextRound = state.round + 1;
    const nextConditions = environment.conditionsFor({
      round: nextRound,
      rng,
      previousFundamentalValueCents: state.fundamentalValueCents,
      previousRegime: state.regime,
    });
    const nextReferencePriceCents = computeReferencePriceCents({
      lastRealizedCloseCents: toCents(candle.close),
      fundamentalValueCents: nextConditions.fundamentalValueCents,
      regime: nextConditions.regime,
      eventImpactReturn: nextConditions.eventImpactReturn,
      meanReversionFactor: state.config.referenceModel.meanReversionFactor,
      referenceVolatility: state.config.referenceModel.referenceVolatility,
      minimumPriceCents: toCents(state.config.minimumStockPrice),
      rng,
    });
    const nextPendingLiquidity = generateRegimeAdjustedLiquidity({
      referencePriceCents: nextReferencePriceCents,
      expectedDailyVolume: nextConditions.expectedDailyVolume,
      volatilityHint: nextConditions.volatilityHint,
      regime: nextConditions.regime,
      profile: state.config.liquidity,
      rng,
    });

    const nextState: StockMarket2State = {
      ...state,
      round: nextRound,
      referencePriceCents: nextReferencePriceCents,
      fundamentalValueCents: nextConditions.fundamentalValueCents,
      regime: nextConditions.regime,
      pendingLiquidity: nextPendingLiquidity,
      currentEvent: nextConditions.event,
      currentDate: nextConditions.date,
      openOrders,
      priceHistory,
      lastRoundVolume,
      portfolios,
      riskStats,
      nextOrderSequence: matchResult.nextOrderSequence,
    };

    return {
      nextState,
      events: [
        {
          type: 'round-result',
          participantIds: state.participantIds,
          data: {
            round: state.round,
            date: state.currentDate,
            candle,
            trades: matchResult.trades,
            forcedLiquidations: forcedTrades,
            lastRoundVolume,
          },
        },
      ],
    };
  },

  // Any missing, invalid, or timed-out submission simply resolves to no orders this round (never
  // a match forfeit) — same default as games/stock-market. Any of the bot's own resting GTC
  // orders are unaffected — they just keep sitting in the book.
  onMissingAction() {
    return { policy: 'substitute', action: { orders: [] } };
  },

  isTerminal(state) {
    return state.round >= state.config.rounds;
  },

  getResult(state) {
    const priceCents = markPriceCents(state);
    const scores: Record<string, number> = {};
    const cash: Record<string, number> = {};
    const shares: Record<string, number> = {};
    const realizedPnl: Record<string, number> = {};
    const borrowFeesPaid: Record<string, number> = {};
    const marginCalls: Record<string, number> = {};
    const forcedLiquidations: Record<string, number> = {};
    const bankrupt: Record<string, boolean> = {};
    for (const participantId of state.participantIds) {
      const portfolio = state.portfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }
      scores[participantId] = toDollars(equityCents(portfolio, priceCents));
      cash[participantId] = toDollars(portfolio.cashCents);
      shares[participantId] = portfolio.shares;
      realizedPnl[participantId] = toDollars(portfolio.realizedPnlCents);
      bankrupt[participantId] = portfolio.bankrupt;
      const stats = state.riskStats.get(participantId);
      borrowFeesPaid[participantId] = toDollars(stats?.borrowFeesPaidCents ?? 0);
      marginCalls[participantId] = stats?.marginCalls ?? 0;
      forcedLiquidations[participantId] = stats?.forcedLiquidations ?? 0;
    }

    const bestScore = Math.max(...Object.values(scores));
    const leaders = state.participantIds.filter((id) => scores[id] === bestScore);
    const lastCandle = state.priceHistory[state.priceHistory.length - 1];

    return {
      participantIds: state.participantIds,
      scores,
      cash,
      shares,
      realizedPnl,
      borrowFeesPaid,
      marginCalls,
      forcedLiquidations,
      bankrupt,
      symbol: state.config.symbol,
      mode: state.config.mode,
      startingPrice: toDollars(state.startingPriceCents),
      finalPrice: lastCandle !== undefined ? lastCandle.close : toDollars(state.startingPriceCents),
      startDate: state.startDate,
      endDate: lastCandle !== undefined ? lastCandle.date : state.startDate,
      roundsPlayed: state.round,
      winnerId: leaders.length === 1 ? (leaders[0] ?? null) : null,
    };
  },

  getStandingOutcomes(result) {
    const ids = result.participantIds;
    const scoreOf = (id: string): number => result.scores[id] ?? 0;
    const bestScore = Math.max(...ids.map(scoreOf));
    const bestIds = ids.filter((id) => scoreOf(id) === bestScore);

    return ids.map((id) => {
      const rank = 1 + ids.filter((other) => scoreOf(other) > scoreOf(id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        bestIds.length > 1
          ? bestIds.includes(id)
            ? 'draw'
            : 'loss'
          : id === bestIds[0]
            ? 'win'
            : 'loss';
      return { participantId: id, rank, score: scoreOf(id), outcome };
    });
  },

  resourceLimits: {
    cpus: 0.5,
    memoryMb: 128,
    turnTimeoutMs: 5000,
  },

  humanInterface: { describeObservation, parseInput, describeAction },
};
