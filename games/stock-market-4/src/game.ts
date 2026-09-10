import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import {
  createSqliteMarketDataProvider,
  openMarketDataStore,
  type MarketDataProvider,
} from '@thunderdome/market-data';
import { join } from 'node:path';
import { resolveOrdersForPortfolio } from './execution/orders.js';
import { generateTradingCalendar } from './market/calendar.js';
import {
  settleCorporateActionsForPortfolio,
  splitAdjustedBarsAsOf,
  visibleCorporateActions,
} from './market/corporateActions.js';
import { benchmarkBuyAndHoldReturn, computePerformanceMetrics } from './metrics/performance.js';
import { toCents } from './money.js';
import { researchAsOf } from './research/timeline.js';
import {
  createPortfolio,
  equityCents,
  isBelowMaintenance,
  maintenanceRequirementCents,
  remainingBuyingPowerCents,
} from './portfolio/accounting.js';
import { dailyBorrowFeeCents } from './portfolio/borrow.js';
import { forceLiquidatePortfolio } from './portfolio/liquidation.js';
import {
  StockMarket4ActionSchema,
  StockMarket4ConfigSchema,
  type CalendarDate,
  type EquityPoint,
  type Fill,
  type PerformanceMetrics,
  type PortfolioAccount,
  type PortfolioObservation,
  type RiskConfig,
  type RiskStats,
  type RoundEventData,
  type SecurityMarketObservation,
  type StockMarket4Action,
  type StockMarket4Config,
  type StockMarket4Observation,
  type StockMarket4Result,
  type StockMarket4State,
} from './types.js';

/** The match's real trading calendar (spec §10/§27 — historical replay): `state.round` N is
 * decided for `tradingCalendarFor(config)[N]`. Recomputed from `config` wherever needed rather
 * than stored in state — it's a pure function of `config`, so storing it would just be
 * duplicated, driftable data. */
function tradingCalendarFor(config: StockMarket4Config): CalendarDate[] {
  return generateTradingCalendar(config.startDate, config.endDate, new Set(config.tradingHolidays));
}

/**
 * Resolves `config.marketDataset` (when set) into a live `MarketDataProvider`, called once from
 * `initialize()`. `null` when this match uses inline `historicalPrices`/`corporateActions`
 * instead (the schema's `superRefine` already guarantees exactly one of the two is set — see
 * `types.ts`).
 *
 * The dataset's ticker coverage against `config.marketDataUniverse` is checked HERE rather than
 * in the config schema's own `superRefine`, because that validation needs to query the actual
 * dataset — `parseConfig` deliberately stays a pure, in-memory function with no filesystem/
 * database access (see `types.ts`'s doc comment on that `superRefine` branch).
 *
 * Note on resource lifecycle: the SQLite handle this opens is never explicitly closed — there is
 * currently no `GameDefinition` teardown hook to call it from (see
 * docs/adr/0005-observation-vs-game-state.md). Acceptable for now (a `node:sqlite` read-only
 * handle on a local file has no meaningful external resource cost beyond process lifetime); worth
 * revisiting if/when a long-running host process (e.g. a tournament runner) starts opening many
 * of these per run.
 */
function buildMarketDataProvider(config: StockMarket4Config): MarketDataProvider | null {
  if (config.marketDataset === undefined) return null;
  const { id, version, storeDir } = config.marketDataset;

  const storeResult = openMarketDataStore(join(storeDir, `${id}.sqlite`));
  if (!storeResult.ok) {
    throw new Error(`stock-market-4: ${storeResult.reason}`);
  }
  const providerResult = createSqliteMarketDataProvider(storeResult.value, { id, version });
  if (!providerResult.ok) {
    throw new Error(`stock-market-4: ${providerResult.reason}`);
  }
  const provider = providerResult.value;

  const datasetTickers = provider.tickers();
  const missingTickers = config.marketDataUniverse.filter(
    (ticker) => !datasetTickers.includes(ticker),
  );
  if (missingTickers.length > 0) {
    throw new Error(
      `stock-market-4: marketDataUniverse declares ticker(s) not present in dataset "${id}" version "${version}": ${missingTickers.join(', ')}`,
    );
  }
  if (config.benchmarkTicker !== undefined && !datasetTickers.includes(config.benchmarkTicker)) {
    throw new Error(
      `stock-market-4: benchmarkTicker "${config.benchmarkTicker}" is not present in dataset "${id}" version "${version}"`,
    );
  }
  return provider;
}

/** Every declared security's market data as of `date` — `null` `bar`/date-less `history` never
 * leak a bar past `date` (see `market/historicalPrices.ts`'s `historicalBarsAsOf`). `date === null`
 * (past the match's last trading day) reports every security with no history and a `null` bar.
 *
 * `marketData` is `state.marketData` (see `initialize()`): when present (this match declared
 * `config.marketDataset`), bars/actions come from the SQLite-backed provider instead of
 * `config.historicalPrices`/`config.corporateActions` — everything downstream
 * (`splitAdjustedBarsAsOf`, and every caller of THIS function) is completely unchanged either way,
 * since the provider reproduces the exact same `DailyBar[]`/`CorporateAction[]` shapes. */
function securitiesAsOf(
  config: StockMarket4Config,
  marketData: MarketDataProvider | null,
  date: CalendarDate | null,
): SecurityMarketObservation[] {
  return config.marketDataUniverse.map((ticker) => {
    const series =
      marketData === null
        ? (config.historicalPrices[ticker] ?? [])
        : marketData.barsAsOf(ticker, date ?? config.endDate, Number.POSITIVE_INFINITY);
    const actions =
      marketData === null
        ? config.corporateActions
        : marketData.corporateActionsAsOf(ticker, date ?? config.endDate);
    const history =
      date === null
        ? []
        : splitAdjustedBarsAsOf(series, actions, ticker, date, config.historicalContextDays);
    const latest = history.at(-1);
    return { ticker, bar: latest?.date === date ? latest : null, history };
  });
}

function markPricesCentsFor(securities: readonly SecurityMarketObservation[]): Map<string, number> {
  const marks = new Map<string, number>();
  for (const security of securities) {
    if (security.bar !== null) {
      marks.set(security.ticker, toCents(security.bar.close));
    }
  }
  return marks;
}

/** Builds the bot-facing view of one participant's own portfolio, marked at `securities`' current
 * (already split-adjusted) closes — never another participant's, since callers only ever pass in
 * the observing participant's own `PortfolioAccount`. */
function portfolioObservationFor(
  portfolio: PortfolioAccount,
  securities: readonly SecurityMarketObservation[],
  risk: RiskConfig,
  riskStats: RiskStats,
  equityHistory: readonly EquityPoint[],
): PortfolioObservation {
  const marksCents = markPricesCentsFor(securities);
  const positions = [...portfolio.positions.entries()].map(([ticker, position]) => {
    const markCents = marksCents.get(ticker) ?? 0;
    const marketValueCents = position.shares * markCents;
    return {
      ticker,
      shares: position.shares,
      averageEntryPriceCents: position.averageEntryPriceCents,
      realizedPnlCents: position.realizedPnlCents,
      marketValueCents,
      unrealizedPnlCents: marketValueCents - position.shares * position.averageEntryPriceCents,
    };
  });
  return {
    cashCents: portfolio.cashCents,
    equityCents: equityCents(portfolio, marksCents),
    positions,
    buyingPowerCents: remainingBuyingPowerCents(portfolio, marksCents, risk),
    maintenanceRequirementCents: maintenanceRequirementCents(portfolio, marksCents, risk),
    belowMaintenance: isBelowMaintenance(portfolio, marksCents, risk),
    riskStats,
    equityHistory: [...equityHistory],
  };
}

const EMPTY_RISK_STATS: RiskStats = {
  borrowFeesPaidCents: 0,
  marginCalls: 0,
  forcedLiquidations: 0,
};

/**
 * Stock Market 4 — starter GameDefinition.
 *
 * Every round, each participant submits a batch of BUY/SELL orders against that round's real
 * historical bar for each ticker (spec §29/§30 — no order book: every fill is against the tape,
 * never against another participant), and after every trading day in `config`'s date range has
 * played out the match ends. Ranking is by final equity, highest wins (see
 * `getStandingOutcomes`) — same convention as stock-market-3's own net-liquidation-value scoring,
 * chosen over a risk-adjusted (Sharpe-based) ranking because `PerformanceMetrics.sharpeRatio` is
 * `null` for plenty of legitimate portfolios (e.g. one trade all match), which would need its own
 * tiebreak rule anyway — `performanceMetrics`/`riskStats` stay available on the result for anyone
 * who wants a different scoring rule downstream. Walk through docs/guides/game-authoring-guide.md
 * section by section as you extend this further; it's numbered to match the order below.
 *
 * Fully deterministic (see manifest.json): nothing in this game ever reads its own `rng` argument
 * — every outcome is a pure function of `config` and the action sequence submitted.
 */
export const stockMarket4: GameDefinition<
  StockMarket4Config,
  StockMarket4State,
  StockMarket4Observation,
  StockMarket4Action,
  StockMarket4Result
> = {
  id: 'stock-market-4',
  version: '0.1.0',

  // §9 — parseConfig
  parseConfig(raw) {
    const result = StockMarket4ConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  // §4 (isolation) — redactConfigForBots: `historicalPrices`/`corporateActions`/`researchTimeline`
  // each hold the FULL match — every future date's bar, every future split/dividend/acquisition,
  // every future research entry — not just what's knowable so far. Every other module in this
  // game (`historicalBarsAsOf`, `splitAdjustedBarsAsOf`, `visibleCorporateActions`,
  // `researchAsOf`, ...) exists specifically to keep that future data out of `getObservation`;
  // sending the raw config verbatim via `init` would silently undo all of it by handing a bot the
  // whole tape (and the whole research timeline) up front. Everything else in config (dates,
  // tickers, fees, risk settings, ...) is uniform, static match-ruleset information with nothing
  // to redact.
  //
  // `marketDataset.storeDir` gets the same treatment for a different reason: it's a filesystem
  // path into this HOST's `@thunderdome/market-data` store, not match data a bot could use to see
  // the future — a bot has no legitimate use for it either way, so it's stripped while `id`/
  // `version` (harmless identifiers) pass through.
  redactConfigForBots(config) {
    return {
      ...config,
      historicalPrices: {},
      corporateActions: [],
      researchTimeline: [],
      ...(config.marketDataset === undefined
        ? {}
        : {
            marketDataset: { id: config.marketDataset.id, version: config.marketDataset.version },
          }),
    };
  },

  // §3 — initialize. This game never uses `rng` (see the module doc comment above on
  // determinism) — it's simply not part of this destructure. This game's manifest declares
  // minParticipants: 1, maxParticipants: 10 — keep this check in sync with the manifest if you
  // change either.
  initialize({ participantIds, config }) {
    if (participantIds.length < 1 || participantIds.length > 10) {
      throw new Error(
        `stock-market-4 requires between 1 and 10 participants, got ${String(participantIds.length)}`,
      );
    }
    const startingCashCents = toCents(config.startingCapital);
    return {
      participantIds: [...participantIds],
      config,
      marketData: buildMarketDataProvider(config),
      round: 0,
      portfolios: new Map(participantIds.map((id) => [id, createPortfolio(startingCashCents)])),
      lastFills: new Map(participantIds.map((id) => [id, []])),
      riskStats: new Map(participantIds.map((id) => [id, { ...EMPTY_RISK_STATS }])),
      // Seeded with a pre-trading reading (spec §22) so the equity curve's very first point is
      // the untouched starting capital, not the outcome of round 0's own trading.
      equityHistory: new Map(
        participantIds.map((id) => [
          id,
          [{ date: config.startDate, equityCents: startingCashCents }],
        ]),
      ),
    };
  },

  // §4 — getObservation: the sole authority for what a participant sees
  getObservation(state, participantId) {
    if (!state.participantIds.includes(participantId)) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    const opponentIds = state.participantIds.filter((candidateId) => candidateId !== participantId);
    const calendar = tradingCalendarFor(state.config);
    const date = calendar[state.round] ?? null;
    const securities = securitiesAsOf(state.config, state.marketData, date);
    const portfolio =
      state.portfolios.get(participantId) ?? createPortfolio(toCents(state.config.startingCapital));
    return {
      round: state.round,
      totalRounds: calendar.length,
      opponentIds,
      marketDataMode: state.config.marketDataMode,
      date,
      securities,
      corporateActions:
        date === null
          ? []
          : state.marketData === null
            ? visibleCorporateActions(state.config.corporateActions, date)
            : state.marketData.corporateActionsAsOf(null, date),
      portfolio: portfolioObservationFor(
        portfolio,
        securities,
        state.config.risk,
        state.riskStats.get(participantId) ?? EMPTY_RISK_STATS,
        state.equityHistory.get(participantId) ?? [],
      ),
      fills: state.lastFills.get(participantId) ?? [],
      research: date === null ? undefined : researchAsOf(state.config.researchTimeline, date),
    };
  },

  // §2 — who acts each round. This placeholder is simultaneous (like Rock-Paper-Scissors): every
  // participant is required to act every round. If your game is sequential (like Connect Four),
  // return just `[{ participantId: state.participantIds[state.currentPlayerIndex], required: true }]`
  // instead.
  getPendingActions(state) {
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  // §5 — validateAction
  validateAction(state, _participantId, raw) {
    const result = StockMarket4ActionSchema.safeParse(raw);
    if (!result.success) {
      return err(result.error.issues.map((issue) => issue.message).join('; '));
    }
    const universe = new Set(state.config.marketDataUniverse);
    const unknownTickerOrder = result.data.orders.find((order) => !universe.has(order.ticker));
    if (unknownTickerOrder !== undefined) {
      return err(
        `order references ticker "${unknownTickerOrder.ticker}", which is not in marketDataUniverse`,
      );
    }
    return ok(result.data);
  },

  // §5 — resolve: settles any corporate action effective exactly today (spec §40) onto each
  // participant's portfolio BEFORE that same round's new orders execute, then fills every order
  // against today's (already-adjusted-if-a-split-just-happened) bars.
  resolve({ state, actions }) {
    const calendar = tradingCalendarFor(state.config);
    const date = calendar[state.round];
    if (date === undefined) {
      // Already past the last trading day — isTerminal should have stopped the match before
      // resolve() is ever called again, but this keeps resolve() total rather than throwing.
      return {
        nextState: { ...state, round: state.round + 1 },
        events: [{ type: 'round-played', participantIds: state.participantIds }],
      };
    }

    const securities = securitiesAsOf(state.config, state.marketData, date);
    const barsByTicker = new Map(securities.map((security) => [security.ticker, security.bar]));
    const marksCents = markPricesCentsFor(securities);
    const risk = state.config.risk;
    // Actions effective exactly TODAY (spec §40) — `settleCorporateActionsForPortfolio` and
    // `roundEventData.corporateActionsSettled` below both filter to `action.date === date`
    // internally/explicitly, so passing the broader "every action visible as of today" set from
    // the provider is safe; it's `state.config.corporateActions` itself (empty in `marketDataset`
    // mode) that would silently under-settle if used directly here.
    const corporateActions =
      state.marketData === null
        ? state.config.corporateActions
        : state.marketData.corporateActionsAsOf(null, date);

    const nextPortfolios = new Map(state.portfolios);
    const nextLastFills = new Map<string, Fill[]>();
    const nextRiskStats = new Map(state.riskStats);
    const nextEquityHistory = new Map(state.equityHistory);
    const marginCalledParticipantIds: string[] = [];
    for (const participantId of state.participantIds) {
      const portfolio =
        state.portfolios.get(participantId) ??
        createPortfolio(toCents(state.config.startingCapital));
      const settled = settleCorporateActionsForPortfolio(portfolio, corporateActions, date);
      const orders = actions.get(participantId)?.orders ?? [];
      const { portfolio: filledPortfolio, fills: orderFills } = resolveOrdersForPortfolio(
        settled,
        orders,
        barsByTicker,
        state.config.transactionFeeRate,
        risk,
      );

      // §38 — daily borrow fee on any short position, then a maintenance-margin check that force-
      // liquidates (largest exposure first) if it fails. Both are no-ops whenever
      // `risk.allowShortSelling` is off, since neither a short position nor a margin shortfall can
      // exist in a cash-only account.
      const stats = nextRiskStats.get(participantId) ?? EMPTY_RISK_STATS;
      let portfolioAfterFees = filledPortfolio;
      let borrowFeesPaidCents = stats.borrowFeesPaidCents;
      if (risk.allowShortSelling) {
        for (const [ticker, position] of filledPortfolio.positions) {
          if (position.shares < 0) {
            const feeCents = dailyBorrowFeeCents(
              -position.shares,
              marksCents.get(ticker) ?? 0,
              risk.borrowFeeAnnualized,
            );
            portfolioAfterFees = {
              ...portfolioAfterFees,
              cashCents: portfolioAfterFees.cashCents - feeCents,
            };
            borrowFeesPaidCents += feeCents;
          }
        }
      }

      let finalPortfolio = portfolioAfterFees;
      let marginCalls = stats.marginCalls;
      let forcedLiquidations = stats.forcedLiquidations;
      let liquidationFills: Fill[] = [];
      if (isBelowMaintenance(finalPortfolio, marksCents, risk)) {
        const { portfolio: liquidated, fills: forcedFills } = forceLiquidatePortfolio({
          portfolio: finalPortfolio,
          marksCents,
          risk,
          feeRate: state.config.transactionFeeRate,
        });
        finalPortfolio = liquidated;
        liquidationFills = forcedFills;
        marginCalls += 1;
        forcedLiquidations += forcedFills.length;
        marginCalledParticipantIds.push(participantId);
      }

      nextPortfolios.set(participantId, finalPortfolio);
      nextLastFills.set(participantId, [...orderFills, ...liquidationFills]);
      nextRiskStats.set(participantId, { borrowFeesPaidCents, marginCalls, forcedLiquidations });
      nextEquityHistory.set(participantId, [
        ...(state.equityHistory.get(participantId) ?? []),
        { date, equityCents: equityCents(finalPortfolio, marksCents) },
      ]);
    }

    const roundEventData: RoundEventData = {
      date,
      fills: Object.fromEntries(nextLastFills),
      marginCalledParticipantIds,
      corporateActionsSettled: corporateActions.filter((action) => action.date === date),
    };

    return {
      nextState: {
        ...state,
        round: state.round + 1,
        portfolios: nextPortfolios,
        lastFills: nextLastFills,
        riskStats: nextRiskStats,
        equityHistory: nextEquityHistory,
      },
      events: [
        { type: 'round-played', participantIds: state.participantIds, data: roundEventData },
      ],
    };
  },

  // §6 — onMissingAction: a historical-replay match can run hundreds of rounds, so one missed/
  // late/invalid submission forfeiting the WHOLE match (the engine's default) would be far too
  // harsh — same reasoning as stock-market-3. Substituting an empty order list just means that
  // participant sits out THIS round's trading; their portfolio still carries forward, still
  // accrues borrow fees/gets margin-called if applicable, and they're still fully in the match
  // next round.
  onMissingAction() {
    return { policy: 'substitute', action: { orders: [] } };
  },

  // §7 — isTerminal, getResult, getStandingOutcomes. Bounded by construction: exactly
  // totalRounds rounds are played, full stop — see the guide's §7 for why a new game should be
  // able to point at its own state and say concretely why this always becomes true.
  isTerminal(state) {
    return state.round >= tradingCalendarFor(state.config).length;
  },

  getResult(state) {
    const calendar = tradingCalendarFor(state.config);
    const finalDate = calendar.at(-1);
    const finalSecurities =
      finalDate === undefined ? [] : securitiesAsOf(state.config, state.marketData, finalDate);
    const marksCents = markPricesCentsFor(finalSecurities);

    const finalEquityCents: Record<string, number> = {};
    for (const participantId of state.participantIds) {
      const portfolio =
        state.portfolios.get(participantId) ??
        createPortfolio(toCents(state.config.startingCapital));
      finalEquityCents[participantId] = equityCents(portfolio, marksCents);
    }

    const riskStats: Record<string, RiskStats> = {};
    for (const participantId of state.participantIds) {
      riskStats[participantId] = state.riskStats.get(participantId) ?? EMPTY_RISK_STATS;
    }

    const performanceMetrics: Record<string, PerformanceMetrics> = {};
    for (const participantId of state.participantIds) {
      performanceMetrics[participantId] = computePerformanceMetrics(
        state.equityHistory.get(participantId) ?? [],
        state.config.riskFreeRate,
      );
    }

    const firstDate = calendar[0];
    const benchmarkTicker = state.config.benchmarkTicker;
    const benchmarkSeries =
      benchmarkTicker === undefined
        ? []
        : state.marketData === null
          ? (state.config.historicalPrices[benchmarkTicker] ?? [])
          : state.marketData.barsAsOf(
              benchmarkTicker,
              finalDate ?? state.config.endDate,
              Number.POSITIVE_INFINITY,
            );
    const benchmarkReturn =
      benchmarkTicker === undefined || firstDate === undefined || finalDate === undefined
        ? null
        : benchmarkBuyAndHoldReturn(benchmarkSeries, firstDate, finalDate);

    return {
      participantIds: state.participantIds,
      totalRounds: calendar.length,
      marketDataMode: state.config.marketDataMode,
      finalEquityCents,
      riskStats,
      performanceMetrics,
      benchmarkReturn,
    };
  },

  // Ranked by final equity, highest wins — ties share a rank (competition ranking: 1, 1, 3, not
  // 1, 1, 2), same convention as stock-market-3's own net-liquidation-value scoring. See this
  // file's own module doc comment for why raw equity was chosen over a risk-adjusted ranking.
  getStandingOutcomes(result) {
    const ids = result.participantIds;
    const equityOf = (id: string): number => result.finalEquityCents[id] ?? 0;
    const bestEquity = Math.max(...ids.map(equityOf));
    const leaders = ids.filter((id) => equityOf(id) === bestEquity);

    return ids.map((id): StandingOutcome => {
      const rank = 1 + ids.filter((other) => equityOf(other) > equityOf(id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        leaders.length > 1
          ? leaders.includes(id)
            ? 'draw'
            : 'loss'
          : id === leaders[0]
            ? 'win'
            : 'loss';
      return { participantId: id, rank, score: equityOf(id), outcome };
    });
  },

  // §8 — resourceLimits (opaque to the engine; see docs/guides/security-model.md)
  resourceLimits: { cpus: 0.5, memoryMb: 128, turnTimeoutMs: 5000 },
};
