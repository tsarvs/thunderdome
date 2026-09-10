import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import { initialConsensusEstimate, reviseConsensus } from './company/analystEstimates.js';
import {
  drawInitialFundamentals,
  drawInitialLifecycleStage,
  reportedFinancialsFor,
  stepFundamentalsForNextQuarter,
} from './company/fundamentals.js';
import { maybeAnnounceAcquisition, maybeAnnounceDelisting } from './company/lifecycle.js';
import { initialEconomicFactors, stepEconomicFactors } from './economy/factors.js';
import { INITIAL_REGIME, REGIME_PROFILES, nextRegime } from './economy/regime.js';
import { EXPLICIT_SECTOR_LINKS, sectorFactorLoadings } from './economy/sectors.js';
import { applyLifecycleTilt, drawStyleLoadings } from './economy/styles.js';
import { buildDailyCandle } from './exchange/candle.js';
import { generateLiquiditySnapshot } from './exchange/liquidity.js';
import { computeSectorImpactNudges } from './exchange/marketImpact.js';
import { resolveRound } from './exchange/matchingEngine.js';
import {
  deriveIndicatorReading,
  earningsSurpriseImpact,
  factorFor,
  forecastIndicatorReading,
  initialIndicatorReading,
  maybeUnscheduledNews,
  quarterLabelFor,
  buildCalendar,
} from './market/events.js';
import {
  adjustPositionForCorporateAction,
  applyCorporateActionToSecurity,
  maybeTriggerBuyback,
  maybeTriggerDividend,
  maybeTriggerSplit,
} from './market/corporateActions.js';
import { computeStyleTechnicalReturn, stepEquityFundamentalValue } from './market/priceModel.js';
import { computeReferencePriceCents } from './market/referencePriceModel.js';
import { computeIndexWeights, stepIndexFundamentalValue } from './market/syntheticIndex.js';
import { computeExternalFlowBias } from './market/externalParticipants.js';
import { toCents, toDollars } from './money.js';
import { buildObservation, markPriceCentsOf } from './observation/buildObservation.js';
import { applyFill, equityCents, getPosition, isBelowMaintenance } from './portfolio/accounting.js';
import { computeDynamicBorrowConditions, dailyBorrowFeeCents } from './portfolio/borrow.js';
import { forceLiquidatePortfolio } from './portfolio/liquidation.js';
import { gaussian } from './rngUtil.js';
import {
  ECONOMIC_FACTORS,
  ECONOMIC_RELEASE_INDICATORS,
  StockMarket3ActionSchema,
  StockMarket3ConfigSchema,
  type CorporateActionEvent,
  type EconomicFactorValues,
  type EconomicReleaseEvent,
  type EquityDef,
  type LiquiditySnapshot,
  type PortfolioAccount,
  type PortfolioSummary,
  type PositionSummary,
  type PublicEvent,
  type RestingOrder,
  type RiskStats,
  type ScheduledCorporateAction,
  type SecurityPriceSummary,
  type SecurityState,
  type StockMarket3Action,
  type StockMarket3Config,
  type StockMarket3Result,
  type StockMarket3State,
  type Trade,
} from './types.js';

const MARKET_SHOCK_VOLATILITY = 0.012;
const REFERENCE_MEAN_REVERSION = 0.15;
const REFERENCE_VOLATILITY = 0.008;
const INITIAL_INDEX_PRICE_CENTS = 10_000;
const INDEX_LIQUIDITY_MULTIPLIER = 3;
const SPLIT_COOLDOWN_ROUNDS = 15;

function emptyRiskStats(): RiskStats {
  return {
    borrowFeesPaidCents: 0,
    marginCalls: 0,
    forcedLiquidations: 0,
    totalTrades: 0,
    totalVolume: 0,
    totalFeesCents: 0,
    shortTrades: 0,
  };
}

function roundLabel(round: number): string {
  return `day-${String(round)}`;
}

/** Looks up a value this function's caller has already established must be present (e.g. a
 * symbol drawn from the very list a map was built from) — throwing with a clear message instead
 * of a bare non-null assertion. A thrown error here always indicates an internal invariant
 * violation, never bad input (input is validated separately, in `validateAction`). */
function mustGet<V>(map: ReadonlyMap<string, V>, key: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`stock-market-3 internal error: expected "${key}" to be present`);
  }
  return value;
}

function lastOf<T>(items: readonly T[], label: string): T {
  const last = items[items.length - 1];
  if (last === undefined) {
    throw new Error(`stock-market-3 internal error: expected "${label}" to be non-empty`);
  }
  return last;
}

function buildInitialLiquidity(security: SecurityState, config: StockMarket3Config, rng: Parameters<typeof generateLiquiditySnapshot>[0]['rng']): LiquiditySnapshot {
  return generateLiquiditySnapshot({
    referencePriceCents: security.referencePriceCents,
    expectedDailyVolume: config.liquidity.averageDailyVolume * (security.kind === 'INDEX' ? INDEX_LIQUIDITY_MULTIPLIER : 1),
    volatilityHint: 0.02,
    profile: config.liquidity,
    bidQuantityMultiplier: 1,
    askQuantityMultiplier: 1,
    rng,
  });
}

export const stockMarket3: GameDefinition<
  StockMarket3Config,
  StockMarket3State,
  ReturnType<typeof buildObservation>,
  StockMarket3Action,
  StockMarket3Result
> = {
  id: 'stock-market-3',
  version: '0.1.0',

  parseConfig(raw) {
    const result = StockMarket3ConfigSchema.safeParse(raw);
    return result.success ? ok(result.data) : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  redactConfigForBots(config) {
    // Every field here is either a real organizer-set knob or public dataset shape — no hidden
    // multiplier/weight table to strip (factor loadings, style loadings, regime profiles, and
    // fundamentals all live in TState, generated at initialize() time, never in TConfig).
    return config;
  },

  initialize({ config, participantIds, rng }) {
    if (participantIds.length < 1) {
      throw new Error('stock-market-3 requires at least 1 participant');
    }

    const calendar = buildCalendar(config.equities, config.rounds);

    const equitySecurities: SecurityState[] = config.equities.map((def: EquityDef) => {
      const lifecycleStage = drawInitialLifecycleStage(rng);
      const fundamentals = drawInitialFundamentals(lifecycleStage, rng);
      const styleLoadings = applyLifecycleTilt(drawStyleLoadings(rng), lifecycleStage);
      const factorLoadings = sectorFactorLoadings(def.sector).map((exposure) => ({
        factor: exposure.factor,
        loading: exposure.loading + gaussian(rng) * 0.15,
      }));
      const marketBeta = Math.max(0.4, 1 + gaussian(rng) * 0.3);
      const sharesOutstanding = Math.round(20_000_000 + rng.nextFloat() * 280_000_000);
      const priceCents = toCents(15 + rng.nextFloat() * 185);
      const pendingActual = reportedFinancialsFor(fundamentals, sharesOutstanding);
      const nextEarningsRound = calendar.find((e) => e.type === 'EARNINGS_REPORT' && e.symbol === def.symbol)?.round ?? config.rounds;
      const initialConsensus = initialConsensusEstimate(pendingActual, rng);

      const security: SecurityState = {
        symbol: def.symbol,
        kind: 'EQUITY',
        sector: def.sector,
        active: true,
        factorLoadings,
        styleLoadings,
        marketBeta,
        fundamentals,
        fundamentalValueCents: priceCents,
        pendingActual,
        sharesOutstanding,
        referencePriceCents: priceCents,
        initialReferencePriceCents: priceCents,
        priceHistory: [],
        lastRoundVolume: null,
        openOrders: [],
        pendingLiquidity: { bids: [], asks: [] },
        borrowFeeAnnualized: config.risk.borrowFeeAnnualized,
        borrowableShares: config.risk.borrowableShares,
        analystRevisions: [{ observedAtRound: 0, periodLabel: quarterLabelFor(nextEarningsRound), consensus: initialConsensus }],
        events: [],
      };
      return security;
    });

    const indexWeights = computeIndexWeights(equitySecurities);
    const indexSecurity: SecurityState = {
      symbol: config.indexSymbol,
      kind: 'INDEX',
      sector: null,
      active: true,
      factorLoadings: [],
      styleLoadings: { SIZE: 0, VALUE: 0, MOMENTUM: 0, QUALITY: 0, VOLATILITY: 0 },
      marketBeta: 1,
      fundamentals: null,
      fundamentalValueCents: INITIAL_INDEX_PRICE_CENTS,
      pendingActual: null,
      sharesOutstanding: 1_000_000,
      referencePriceCents: INITIAL_INDEX_PRICE_CENTS,
      initialReferencePriceCents: INITIAL_INDEX_PRICE_CENTS,
      priceHistory: [],
      lastRoundVolume: null,
      openOrders: [],
      pendingLiquidity: { bids: [], asks: [] },
      borrowFeeAnnualized: config.risk.borrowFeeAnnualized,
      borrowableShares: config.risk.borrowableShares,
      analystRevisions: [],
      events: [],
    };

    const allSecurities = [...equitySecurities, indexSecurity];
    for (const security of allSecurities) {
      security.pendingLiquidity = buildInitialLiquidity(security, config, rng);
    }

    const lastEconomicReadings = Object.fromEntries(
      ECONOMIC_RELEASE_INDICATORS.map((indicator) => [indicator, initialIndicatorReading(indicator)]),
    ) as StockMarket3State['lastEconomicReadings'];

    const startingCashCents = toCents(config.startingCash);
    const portfolios = new Map<string, PortfolioAccount>(
      participantIds.map((id) => [
        id,
        { cashCents: startingCashCents, positions: new Map(), bankrupt: false, peakEquityCents: startingCashCents, maxDrawdown: 0 },
      ]),
    );
    const riskStats = new Map(participantIds.map((id) => [id, emptyRiskStats()]));

    return {
      participantIds: [...participantIds],
      config,
      round: 0,
      economicFactors: initialEconomicFactors(),
      regime: INITIAL_REGIME,
      securities: new Map(allSecurities.map((s) => [s.symbol, s])),
      indexWeights,
      calendar,
      scheduledCorporateActions: [],
      marketEvents: [],
      lastEconomicReadings,
      portfolios,
      riskStats,
      nextOrderSequence: 0,
      startingIndexPriceCents: INITIAL_INDEX_PRICE_CENTS,
    };
  },

  getObservation(state, participantId) {
    return buildObservation(state, participantId);
  },

  getPendingActions(state) {
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  validateAction(state, participantId, raw) {
    const result = StockMarket3ActionSchema.safeParse(raw);
    if (!result.success) {
      return err(
        'action must be {"orders": [...]}, each order MARKET {kind,symbol,side,quantity}, LIMIT ' +
          '{kind,symbol,side,quantity,limitPrice,timeInForce?}, or CANCEL {kind,orderId}',
      );
    }
    const action = result.data;
    if (action.orders.length > state.config.maxOrdersPerRound) {
      return err(`too many orders: submitted ${String(action.orders.length)}, max ${String(state.config.maxOrdersPerRound)}`);
    }
    const portfolio = state.portfolios.get(participantId);
    if (portfolio === undefined) {
      return err(`unknown participant "${participantId}"`);
    }
    if (portfolio.bankrupt && action.orders.length > 0) {
      return err('participant is bankrupt and can no longer trade');
    }
    if (state.round < state.config.warmupRounds && action.orders.some((order) => order.kind !== 'CANCEL')) {
      return err(`trading is not allowed during warmup (round ${String(state.round)} of ${String(state.config.warmupRounds)})`);
    }

    for (const order of action.orders) {
      if (order.kind === 'CANCEL') {
        const exists = [...state.securities.values()].some(
          (security) => security.openOrders.some((o) => o.id === order.orderId && o.participantId === participantId),
        );
        if (!exists) {
          return err(`cannot cancel unknown or foreign order "${order.orderId}"`);
        }
      } else {
        const security = state.securities.get(order.symbol);
        if (!security?.active) {
          return err(`unknown or inactive symbol "${order.symbol}"`);
        }
      }
    }

    return ok(action);
  },

  resolve({ state, actions, rng }) {
    const config = state.config;
    const risk = config.risk;
    const nextRoundNumber = state.round + 1;

    const activeSecurities = [...state.securities.values()].filter((s) => s.active).sort((a, b) => a.symbol.localeCompare(b.symbol));
    const activeSymbols = activeSecurities.map((s) => s.symbol);
    const referencePricesCents = new Map(activeSecurities.map((s) => [s.symbol, s.referencePriceCents]));
    const openOrders: RestingOrder[] = activeSecurities.flatMap((s) => s.openOrders);
    const pendingLiquidity = new Map(activeSecurities.map((s) => [s.symbol, s.pendingLiquidity]));

    const matchResult = resolveRound({
      round: state.round,
      symbols: activeSymbols,
      referencePricesCents,
      openOrders,
      pendingLiquidity,
      portfolios: state.portfolios,
      actions,
      participantIds: state.participantIds,
      feeRate: config.transactionFee,
      risk,
      nextOrderSequence: state.nextOrderSequence,
      rng,
    });

    let portfolios = matchResult.portfolios;
    let openOrdersNext = matchResult.openOrders;
    let remainingLiquidity = matchResult.remainingLiquidity;
    const riskStats = new Map(state.riskStats);
    const forcedTrades: Trade[] = [];

    // --- Borrow fees + margin calls (portfolio-level), marks fixed at this round's reference prices. ---
    if (risk.allowShortSelling) {
      for (const participantId of state.participantIds) {
        const portfolio = portfolios.get(participantId);
        if (portfolio === undefined || portfolio.bankrupt) {
          continue;
        }
        let totalFeeCents = 0;
        for (const [symbol, position] of portfolio.positions) {
          if (position.shares >= 0) {
            continue;
          }
          const security = state.securities.get(symbol);
          if (security === undefined) {
            continue;
          }
          totalFeeCents += dailyBorrowFeeCents(-position.shares, referencePricesCents.get(symbol) ?? security.referencePriceCents, security.borrowFeeAnnualized);
        }
        if (totalFeeCents > 0) {
          portfolios = new Map(portfolios);
          portfolios.set(participantId, { ...portfolio, cashCents: portfolio.cashCents - totalFeeCents });
          const stats = riskStats.get(participantId) ?? emptyRiskStats();
          riskStats.set(participantId, { ...stats, borrowFeesPaidCents: stats.borrowFeesPaidCents + totalFeeCents });
        }
      }

      for (const participantId of state.participantIds) {
        const portfolio = portfolios.get(participantId);
        if (portfolio === undefined || portfolio.bankrupt || !isBelowMaintenance(portfolio, referencePricesCents, risk)) {
          continue;
        }
        openOrdersNext = openOrdersNext.filter((o) => o.participantId !== participantId);
        const liquidation = forceLiquidatePortfolio({
          participantId,
          portfolio,
          markPricesCents: referencePricesCents,
          liquidityBySymbol: remainingLiquidity,
          risk,
          feeRate: config.transactionFee,
        });
        remainingLiquidity = liquidation.liquidityBySymbol;
        forcedTrades.push(...liquidation.trades);
        const equityAfter = equityCents(liquidation.portfolio, referencePricesCents);
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
    const tradesBySymbol = new Map<string, Trade[]>();
    for (const trade of allTrades) {
      const list = tradesBySymbol.get(trade.symbol) ?? [];
      list.push(trade);
      tradesBySymbol.set(trade.symbol, list);
    }

    // --- Trade/volume/fee statistics (non-forced only for totalTrades/shortTrades; fees count both). ---
    const netDemandBySymbol = new Map<string, number>();
    for (const trade of allTrades) {
      const feeCents = Math.round(trade.priceCents * trade.quantity * config.transactionFee);
      for (const [participantId, isBuySide] of [
        [trade.buyerParticipantId, true],
        [trade.sellerParticipantId, false],
      ] as const) {
        if (participantId === null) {
          continue;
        }
        const stats = riskStats.get(participantId) ?? emptyRiskStats();
        const next: RiskStats = { ...stats, totalFeesCents: stats.totalFeesCents + feeCents };
        if (trade.forced !== true) {
          next.totalTrades = stats.totalTrades + 1;
          next.totalVolume = stats.totalVolume + trade.quantity;
          if (!isBuySide) {
            const position = portfolios.get(participantId)?.positions.get(trade.symbol);
            if (position !== undefined && position.shares < 0) {
              next.shortTrades = stats.shortTrades + 1;
            }
          }
        }
        riskStats.set(participantId, next);
      }
      const net = netDemandBySymbol.get(trade.symbol) ?? 0;
      netDemandBySymbol.set(
        trade.symbol,
        net + (trade.buyerParticipantId !== null ? trade.quantity : 0) - (trade.sellerParticipantId !== null ? trade.quantity : 0),
      );
    }

    // --- Candles, price history, per-symbol realized volume. ---
    const activeSecurityBySymbol = new Map(activeSecurities.map((s) => [s.symbol, s]));
    const newPriceHistoryBySymbol = new Map<string, ReturnType<typeof buildDailyCandle>[]>();
    const oneRoundReturnBySymbol = new Map<string, number>();
    for (const symbol of activeSymbols) {
      const security = mustGet(activeSecurityBySymbol, symbol);
      const trades = tradesBySymbol.get(symbol) ?? [];
      const referencePriceCents = mustGet(referencePricesCents, symbol);
      const candle = buildDailyCandle(roundLabel(state.round), referencePriceCents, trades);
      const priceHistory = [...security.priceHistory, candle].slice(-config.priceHistoryLength);
      newPriceHistoryBySymbol.set(symbol, priceHistory);

      const previousClose = security.priceHistory[security.priceHistory.length - 1]?.close ?? toDollars(referencePriceCents);
      oneRoundReturnBySymbol.set(symbol, previousClose > 0 ? Math.log(candle.close / previousClose) : 0);
    }

    // --- Portfolio equity/drawdown tracking, marked at this round's realized closes. ---
    const closeMarksCents = new Map(
      activeSymbols.map((symbol) => [symbol, toCents(lastOf(mustGet(newPriceHistoryBySymbol, symbol), `priceHistory[${symbol}]`).close)]),
    );
    for (const participantId of state.participantIds) {
      const portfolio = portfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }
      const nlvCents = equityCents(portfolio, closeMarksCents);
      const peakEquityCents = Math.max(portfolio.peakEquityCents, nlvCents);
      const maxDrawdown = peakEquityCents > 0 ? Math.max(portfolio.maxDrawdown, (peakEquityCents - nlvCents) / peakEquityCents) : portfolio.maxDrawdown;
      portfolios = new Map(portfolios);
      portfolios.set(participantId, { ...portfolio, peakEquityCents, maxDrawdown });
    }

    // --- Economy: regime, factors, market shock (govern nextRoundNumber's conditions). ---
    const nextRegimeValue = nextRegime(state.regime, rng);
    const nextEconomicFactors = stepEconomicFactors(state.economicFactors, nextRegimeValue, rng);
    const factorDeltas = {} as EconomicFactorValues;
    for (const factor of ECONOMIC_FACTORS) {
      factorDeltas[factor] = nextEconomicFactors[factor] - state.economicFactors[factor];
    }
    const marketShock = gaussian(rng) * MARKET_SHOCK_VOLATILITY * REGIME_PROFILES[nextRegimeValue].volatilityMultiplier;

    // --- Cross-sector terms: explicit sparse links (spec §12) + market-impact bleed (spec §35), both lagged one round. ---
    const explicitSectorTermBySymbol: Record<string, number> = {};
    for (const symbol of activeSymbols) {
      explicitSectorTermBySymbol[symbol] = 0;
    }
    for (const link of EXPLICIT_SECTOR_LINKS) {
      const fromPeers = activeSecurities.filter((s) => s.sector === link.from).map((s) => s.symbol);
      if (fromPeers.length === 0) {
        continue;
      }
      const average = fromPeers.reduce((sum, symbol) => sum + (oneRoundReturnBySymbol.get(symbol) ?? 0), 0) / fromPeers.length;
      for (const toSymbol of activeSecurities.filter((s) => s.sector === link.to).map((s) => s.symbol)) {
        explicitSectorTermBySymbol[toSymbol] = (explicitSectorTermBySymbol[toSymbol] ?? 0) + link.weight * average;
      }
    }
    const marketImpactTermBySymbol = computeSectorImpactNudges({
      netDemandBySymbol,
      averageDailyVolume: config.liquidity.averageDailyVolume,
      sectorOfSymbol: new Map(activeSecurities.map((s) => [s.symbol, s.sector])),
    });

    // --- Scheduled maturities (acquisitions/delistings taking effect this round). ---
    const maturing = state.scheduledCorporateActions.filter((a) => !a.applied && a.effectiveRound === nextRoundNumber);
    const maturingSymbols = new Set(maturing.map((a) => a.symbol));
    for (const action of maturing) {
      for (const participantId of state.participantIds) {
        const portfolio = portfolios.get(participantId);
        const position = portfolio !== undefined ? getPosition(portfolio, action.symbol) : undefined;
        if (portfolio === undefined || position === undefined || position.shares === 0) {
          continue;
        }
        const side = position.shares > 0 ? 'SELL' : 'BUY';
        portfolios = new Map(portfolios);
        portfolios.set(participantId, applyFill(portfolio, action.symbol, side, Math.abs(position.shares), action.cashPerShareCents, 0));
      }
    }
    openOrdersNext = openOrdersNext.filter((o) => !maturingSymbols.has(o.symbol));
    const scheduledCorporateActions: ScheduledCorporateAction[] = state.scheduledCorporateActions.map((a) =>
      a.effectiveRound === nextRoundNumber && !a.applied ? { ...a, applied: true } : a,
    );

    // --- Calendar-driven public information for nextRoundNumber. ---
    const earningsToday = new Set(state.calendar.filter((e) => e.type === 'EARNINGS_REPORT' && e.round === nextRoundNumber).map((e) => e.symbol));
    const economicReleaseToday = state.calendar.find((e) => e.type === 'ECONOMIC_RELEASE' && e.round === nextRoundNumber);

    let marketEvents = state.marketEvents;
    let lastEconomicReadings = state.lastEconomicReadings;
    if (economicReleaseToday?.indicator !== undefined) {
      const indicator = economicReleaseToday.indicator;
      const previous = lastEconomicReadings[indicator];
      const consensus = forecastIndicatorReading(indicator, previous, rng);
      const reported = deriveIndicatorReading(indicator, nextEconomicFactors[factorFor(indicator)], rng);
      const release: EconomicReleaseEvent = {
        type: 'ECONOMIC_RELEASE',
        observedAtRound: nextRoundNumber,
        indicator,
        periodLabel: quarterLabelFor(nextRoundNumber),
        reported,
        consensus,
        previous,
      };
      marketEvents = [...marketEvents, release].slice(-config.eventHistoryLength);
      lastEconomicReadings = { ...lastEconomicReadings, [indicator]: reported };
    }

    // --- Per-equity: fundamental value, reference price, events, corporate actions, analyst estimates. ---
    const nextSecurities = new Map(state.securities);
    const nextScheduledCorporateActions = [...scheduledCorporateActions];
    // Captured BEFORE any same-round corporate action (e.g. a stock split) rescales
    // `fundamentalValueCents` — a split is a share-count redenomination, not an economic move, and
    // must never show up as a return in the index construction below (spec §18: index return is a
    // weighted blend of constituents' REAL returns, not an artifact of one constituent's share count).
    const preCorporateActionFundamentalValueCents = new Map<string, number>();

    for (const symbol of activeSymbols) {
      const security = mustGet(activeSecurityBySymbol, symbol);
      if (security.kind === 'INDEX') {
        continue; // handled after every equity has been stepped
      }
      if (maturingSymbols.has(symbol)) {
        nextSecurities.set(symbol, { ...security, active: false, openOrders: [] });
        continue;
      }
      if (security.fundamentals === null || security.pendingActual === null) {
        throw new Error(`stock-market-3 internal error: EQUITY "${symbol}" is missing fundamentals/pendingActual`);
      }

      let events: PublicEvent[] = security.events;
      let eventImpactReturn = 0;
      let fundamentals = security.fundamentals;
      let pendingActual = security.pendingActual;
      let analystRevisions = security.analystRevisions;

      if (earningsToday.has(symbol)) {
        const lastConsensus = analystRevisions[analystRevisions.length - 1]?.consensus ?? pendingActual;
        eventImpactReturn = earningsSurpriseImpact(pendingActual, lastConsensus);
        const periodLabel = quarterLabelFor(nextRoundNumber);
        const earningsEvent: PublicEvent = {
          type: 'EARNINGS_REPORT',
          observedAtRound: nextRoundNumber,
          symbol,
          periodLabel,
          reported: pendingActual,
          consensus: lastConsensus,
        };
        events = [...events, earningsEvent].slice(-config.eventHistoryLength);

        fundamentals = stepFundamentalsForNextQuarter(fundamentals, nextEconomicFactors.GROWTH, rng);
        pendingActual = reportedFinancialsFor(fundamentals, security.sharesOutstanding);
        const nextConsensus = initialConsensusEstimate(pendingActual, rng);
        analystRevisions = [
          ...analystRevisions,
          { observedAtRound: nextRoundNumber, periodLabel: quarterLabelFor(nextRoundNumber + 63), consensus: nextConsensus },
        ].slice(-config.eventHistoryLength);
      } else {
        const news = maybeUnscheduledNews(symbol, nextRegimeValue, nextRoundNumber, rng);
        if (news.event !== null) {
          events = [...events, news.event].slice(-config.eventHistoryLength);
        }
        eventImpactReturn = news.impactReturn;
        const lastConsensus = analystRevisions[analystRevisions.length - 1]?.consensus ?? pendingActual;
        const revised = reviseConsensus(lastConsensus, pendingActual, rng);
        analystRevisions = [
          ...analystRevisions,
          { observedAtRound: nextRoundNumber, periodLabel: analystRevisions[analystRevisions.length - 1]?.periodLabel ?? quarterLabelFor(nextRoundNumber), consensus: revised },
        ].slice(-config.eventHistoryLength);
      }

      const crossSectorTerm = (explicitSectorTermBySymbol[symbol] ?? 0) + (marketImpactTermBySymbol[symbol] ?? 0);
      const stepPriceHistory = mustGet(newPriceHistoryBySymbol, symbol);
      const securityForStep: SecurityState = { ...security, fundamentals, priceHistory: stepPriceHistory };
      const nextFundamentalValueCents = stepEquityFundamentalValue({
        security: securityForStep,
        factorDeltas,
        marketShock,
        regime: nextRegimeValue,
        eventImpactReturn,
        crossSectorTerm,
        rng,
      });
      preCorporateActionFundamentalValueCents.set(symbol, nextFundamentalValueCents);
      const lastClose = lastOf(stepPriceHistory, `priceHistory[${symbol}]`).close;
      const nextReferencePriceCents = computeReferencePriceCents({
        lastRealizedCloseCents: toCents(lastClose),
        fundamentalValueCents: nextFundamentalValueCents,
        regime: nextRegimeValue,
        meanReversionFactor: REFERENCE_MEAN_REVERSION,
        referenceVolatility: REFERENCE_VOLATILITY,
        minimumPriceCents: toCents(config.minimumSecurityPrice),
        rng,
        styleReturn: computeStyleTechnicalReturn(securityForStep),
      });

      let draft: SecurityState = {
        ...security,
        fundamentals,
        pendingActual,
        fundamentalValueCents: nextFundamentalValueCents,
        referencePriceCents: nextReferencePriceCents,
        priceHistory: stepPriceHistory,
        analystRevisions,
        events,
      };

      // --- Corporate action triggers (dividend/split/buyback: same-round announce + apply). ---
      // A cooldown after the most recent split/reverse-split prevents a price that merely
      // oscillates around the trigger threshold from splitting every few rounds — real companies
      // split at most a handful of times ever, not routinely.
      const recentlySplit = draft.events.some(
        (event) => (event.type === 'STOCK_SPLIT' || event.type === 'REVERSE_SPLIT') && nextRoundNumber - event.observedAtRound < SPLIT_COOLDOWN_ROUNDS,
      );
      const dividend = maybeTriggerDividend(draft, rng);
      const buyback = dividend === null ? maybeTriggerBuyback(draft, rng) : null;
      const split = buyback === null && !recentlySplit ? maybeTriggerSplit(draft, draft.initialReferencePriceCents) : null;
      const details = dividend ?? buyback ?? split;
      if (details !== null) {
        draft = applyCorporateActionToSecurity(draft, details);
        events = [...events, { type: details.type, observedAtRound: nextRoundNumber, symbol, details }].slice(-config.eventHistoryLength);
        draft = { ...draft, events };
        for (const participantId of state.participantIds) {
          const portfolio = portfolios.get(participantId);
          if (portfolio === undefined) {
            continue;
          }
          const position = getPosition(portfolio, symbol);
          if (position.shares === 0 && details.type !== 'CASH_DIVIDEND') {
            continue;
          }
          const { position: nextPosition, cashDeltaCents } = adjustPositionForCorporateAction(position, details);
          const nextPositions = new Map(portfolio.positions);
          nextPositions.set(symbol, nextPosition);
          portfolios = new Map(portfolios);
          portfolios.set(participantId, { ...portfolio, cashCents: portfolio.cashCents + cashDeltaCents, positions: nextPositions });
        }
      }

      // --- New acquisition/delisting announcements (only if not already scheduled). ---
      if (!nextScheduledCorporateActions.some((a) => a.symbol === symbol && !a.applied)) {
        const acquisition = maybeAnnounceAcquisition(draft, draft.initialReferencePriceCents, nextRoundNumber, rng);
        const delisting = acquisition === null ? maybeAnnounceDelisting(draft, draft.initialReferencePriceCents, nextRoundNumber, rng) : null;
        const announcement = acquisition ?? delisting;
        if (announcement !== null) {
          nextScheduledCorporateActions.push(announcement);
          draft = {
            ...draft,
            events: [
              ...draft.events,
              {
                type: announcement.type,
                observedAtRound: nextRoundNumber,
                symbol,
                details:
                  announcement.type === 'ACQUISITION'
                    ? { type: 'ACQUISITION', effectiveRound: announcement.effectiveRound, cashPerShareCents: announcement.cashPerShareCents }
                    : { type: 'DELISTING', effectiveRound: announcement.effectiveRound, reason: announcement.reason },
              } satisfies CorporateActionEvent,
            ].slice(-config.eventHistoryLength),
          };
        }
      }

      // --- Dynamic borrow conditions. ---
      let totalShortInterest = 0;
      for (const portfolio of portfolios.values()) {
        const shares = getPosition(portfolio, symbol).shares;
        if (shares < 0) {
          totalShortInterest += -shares;
        }
      }
      const borrowConditions = computeDynamicBorrowConditions({
        baseAnnualizedFee: risk.borrowFeeAnnualized,
        baseBorrowableShares: risk.borrowableShares,
        totalShortInterestShares: totalShortInterest,
        sharesOutstanding: draft.sharesOutstanding,
      });

      // --- Next liquidity ladder, biased by external-participant flow. ---
      const bias = computeExternalFlowBias({
        symbol,
        indexSymbol: config.indexSymbol,
        priceHistory: draft.priceHistory,
        eventImpactReturn,
      });
      const nextLiquidity = generateLiquiditySnapshot({
        referencePriceCents: draft.referencePriceCents,
        expectedDailyVolume: config.liquidity.averageDailyVolume,
        volatilityHint: REFERENCE_VOLATILITY,
        profile: config.liquidity,
        bidQuantityMultiplier: Math.max(0.2, 1 + bias * 0.5),
        askQuantityMultiplier: Math.max(0.2, 1 - bias * 0.5),
        rng,
      });

      nextSecurities.set(symbol, {
        ...draft,
        borrowFeeAnnualized: borrowConditions.feeAnnualized,
        borrowableShares: borrowConditions.availableShares,
        pendingLiquidity: nextLiquidity,
        lastRoundVolume: (() => {
          const trades = tradesBySymbol.get(symbol) ?? [];
          const sharesBought = trades.reduce((sum, t) => sum + (t.buyerParticipantId !== null ? t.quantity : 0), 0);
          const sharesSold = trades.reduce((sum, t) => sum + (t.sellerParticipantId !== null ? t.quantity : 0), 0);
          return { sharesBought, sharesSold, netDemand: sharesBought - sharesSold };
        })(),
        openOrders: openOrdersNext.filter((o) => o.symbol === symbol),
      });
    }

    // --- Index: weighted composite of equities' fundamental-value log-returns. ---
    const indexSecurity = mustGet(state.securities, config.indexSymbol);
    const constituentLogReturns: Record<string, number> = {};
    for (const symbol of Object.keys(state.indexWeights)) {
      const before = state.securities.get(symbol);
      const after = preCorporateActionFundamentalValueCents.get(symbol);
      constituentLogReturns[symbol] =
        before !== undefined && after !== undefined && before.fundamentalValueCents > 0 ? Math.log(after / before.fundamentalValueCents) : 0;
    }
    const nextIndexFundamentalValueCents = stepIndexFundamentalValue({
      currentIndexValueCents: indexSecurity.fundamentalValueCents,
      constituentLogReturns,
      weights: state.indexWeights,
      rng,
    });
    const indexPriceHistory = mustGet(newPriceHistoryBySymbol, config.indexSymbol);
    const indexLastClose = lastOf(indexPriceHistory, `priceHistory[${config.indexSymbol}]`).close;
    const nextIndexReferencePriceCents = computeReferencePriceCents({
      lastRealizedCloseCents: toCents(indexLastClose),
      fundamentalValueCents: nextIndexFundamentalValueCents,
      regime: nextRegimeValue,
      meanReversionFactor: REFERENCE_MEAN_REVERSION,
      referenceVolatility: REFERENCE_VOLATILITY,
      minimumPriceCents: toCents(config.minimumSecurityPrice),
      rng,
    });
    const indexBias = computeExternalFlowBias({
      symbol: config.indexSymbol,
      indexSymbol: config.indexSymbol,
      priceHistory: indexPriceHistory,
      eventImpactReturn: 0,
    });
    nextSecurities.set(config.indexSymbol, {
      ...indexSecurity,
      fundamentalValueCents: nextIndexFundamentalValueCents,
      referencePriceCents: nextIndexReferencePriceCents,
      priceHistory: indexPriceHistory,
      lastRoundVolume: (() => {
        const trades = tradesBySymbol.get(config.indexSymbol) ?? [];
        const sharesBought = trades.reduce((sum, t) => sum + (t.buyerParticipantId !== null ? t.quantity : 0), 0);
        const sharesSold = trades.reduce((sum, t) => sum + (t.sellerParticipantId !== null ? t.quantity : 0), 0);
        return { sharesBought, sharesSold, netDemand: sharesBought - sharesSold };
      })(),
      pendingLiquidity: generateLiquiditySnapshot({
        referencePriceCents: nextIndexReferencePriceCents,
        expectedDailyVolume: config.liquidity.averageDailyVolume * INDEX_LIQUIDITY_MULTIPLIER,
        volatilityHint: REFERENCE_VOLATILITY,
        profile: config.liquidity,
        bidQuantityMultiplier: Math.max(0.2, 1 + indexBias * 0.5),
        askQuantityMultiplier: Math.max(0.2, 1 - indexBias * 0.5),
        rng,
      }),
      openOrders: openOrdersNext.filter((o) => o.symbol === config.indexSymbol),
    });

    const nextState: StockMarket3State = {
      ...state,
      round: nextRoundNumber,
      economicFactors: nextEconomicFactors,
      regime: nextRegimeValue,
      securities: nextSecurities,
      calendar: state.calendar,
      scheduledCorporateActions: nextScheduledCorporateActions,
      marketEvents,
      lastEconomicReadings,
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
          data: { round: state.round, trades: matchResult.trades, forcedLiquidations: forcedTrades },
        },
      ],
    };
  },

  onMissingAction() {
    return { policy: 'substitute', action: { orders: [] } };
  },

  isTerminal(state) {
    return state.round >= state.config.rounds;
  },

  getResult(state) {
    const markPricesCents = new Map([...state.securities.values()].map((security) => [security.symbol, markPriceCentsOf(security)]));
    const scores: Record<string, number> = {};
    const startingCapital: Record<string, number> = {};
    const totalReturn: Record<string, number> = {};
    const maxDrawdown: Record<string, number> = {};
    const totalTrades: Record<string, number> = {};
    const totalVolume: Record<string, number> = {};
    const totalFees: Record<string, number> = {};
    const totalBorrowCosts: Record<string, number> = {};
    const shortTrades: Record<string, number> = {};
    const marginCalls: Record<string, number> = {};
    const forcedLiquidations: Record<string, number> = {};
    const bankrupt: Record<string, boolean> = {};

    for (const participantId of state.participantIds) {
      const portfolio = state.portfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }
      const nlv = toDollars(equityCents(portfolio, markPricesCents));
      scores[participantId] = nlv;
      startingCapital[participantId] = state.config.startingCash;
      totalReturn[participantId] = state.config.startingCash > 0 ? nlv / state.config.startingCash - 1 : 0;
      bankrupt[participantId] = portfolio.bankrupt;
      maxDrawdown[participantId] = portfolio.maxDrawdown;
      const stats = state.riskStats.get(participantId);
      totalTrades[participantId] = stats?.totalTrades ?? 0;
      totalVolume[participantId] = stats?.totalVolume ?? 0;
      totalFees[participantId] = toDollars(stats?.totalFeesCents ?? 0);
      totalBorrowCosts[participantId] = toDollars(stats?.borrowFeesPaidCents ?? 0);
      shortTrades[participantId] = stats?.shortTrades ?? 0;
      marginCalls[participantId] = stats?.marginCalls ?? 0;
      forcedLiquidations[participantId] = stats?.forcedLiquidations ?? 0;
    }

    const bestScore = Math.max(...Object.values(scores));
    const leaders = state.participantIds.filter((id) => scores[id] === bestScore);
    const indexSecurity = state.securities.get(state.config.indexSymbol);

    const securityPrices: SecurityPriceSummary[] = [...state.securities.values()].map((security) => ({
      symbol: security.symbol,
      startingPrice: toDollars(security.initialReferencePriceCents),
      finalPrice: toDollars(markPriceCentsOf(security)),
    }));

    const portfolioSummaries: Record<string, PortfolioSummary> = {};
    for (const participantId of state.participantIds) {
      const portfolio = state.portfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }
      const positions: PositionSummary[] = [...portfolio.positions.entries()]
        .filter(([, position]) => position.shares !== 0)
        .map(([symbol, position]) => {
          const markCents = markPricesCents.get(symbol) ?? 0;
          return {
            symbol,
            shares: position.shares,
            averageEntryPrice: toDollars(position.averageEntryPriceCents),
            marketValue: toDollars(position.shares * markCents),
            unrealizedPnl: toDollars(position.shares * (markCents - position.averageEntryPriceCents)),
          };
        });
      portfolioSummaries[participantId] = {
        cash: toDollars(portfolio.cashCents),
        equity: toDollars(equityCents(portfolio, markPricesCents)),
        bankrupt: portfolio.bankrupt,
        positions,
      };
    }

    return {
      participantIds: state.participantIds,
      scores,
      startingCapital,
      totalReturn,
      maxDrawdown,
      totalTrades,
      totalVolume,
      totalFees,
      totalBorrowCosts,
      shortTrades,
      marginCalls,
      forcedLiquidations,
      bankrupt,
      roundsPlayed: state.round,
      winnerId: leaders.length === 1 ? (leaders[0] ?? null) : null,
      indexSymbol: state.config.indexSymbol,
      indexStartingPrice: toDollars(state.startingIndexPriceCents),
      indexFinalPrice: indexSecurity !== undefined ? toDollars(markPriceCentsOf(indexSecurity)) : toDollars(state.startingIndexPriceCents),
      securityPrices,
      portfolioSummaries,
    };
  },

  getStandingOutcomes(result) {
    const ids = result.participantIds;
    const scoreOf = (id: string): number => result.scores[id] ?? 0;
    const bestScore = Math.max(...ids.map(scoreOf));
    const bestIds = ids.filter((id) => scoreOf(id) === bestScore);

    return ids.map((id): StandingOutcome => {
      const rank = 1 + ids.filter((other) => scoreOf(other) > scoreOf(id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        bestIds.length > 1 ? (bestIds.includes(id) ? 'draw' : 'loss') : id === bestIds[0] ? 'win' : 'loss';
      return { participantId: id, rank, score: scoreOf(id), outcome };
    });
  },

  resourceLimits: {
    cpus: 0.5,
    memoryMb: 256,
    turnTimeoutMs: 8000,
  },
};
