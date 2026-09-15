import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import { createSqliteMarketDataProvider, type MarketDataProvider } from '@thunderdome/market-data';
import { openStockMarket4Db } from '@thunderdome/stock-market-4-db';
import { resolveOrdersForPortfolio } from './execution/orders.js';
import { generateTradingCalendar } from './market/calendar.js';
import {
  settleCorporateActionsForPortfolio,
  splitAdjustedBarsAsOf,
  visibleCorporateActions,
} from './market/corporateActions.js';
import { benchmarkBuyAndHoldReturn, computePerformanceMetrics } from './metrics/performance.js';
import { toCents, toDollars } from './money.js';
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
  StockMarket4ForwardSnapshotSchema,
  type CalendarDate,
  type EquityPoint,
  type Fill,
  type PerformanceMetrics,
  type PortfolioAccount,
  type PortfolioObservation,
  type PortfolioSummary,
  type PositionSummary,
  type RiskConfig,
  type RiskStats,
  type RoundEventData,
  type SecurityMarketObservation,
  type SecurityPriceSummary,
  type StockMarket4Action,
  type StockMarket4Config,
  type StockMarket4ForwardSnapshot,
  type PositionObservation,
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

/** The calendar this match will ACTUALLY play — `tradingCalendarFor(config)` trimmed to
 * `state.forwardShadowCutoffDate` when set (`gameType: 'FORWARD_SHADOW'` only; see types.ts).
 * Identical to `tradingCalendarFor(config)` for `'HISTORICAL'`/`'SYNTHETIC'`, always. This is the
 * ONLY place `gameType` affects match lifecycle — no other function in this file branches on it,
 * which is what keeps trading/execution/portfolio/scoring logic shared across every game type
 * rather than duplicated per type. */
function effectiveTradingCalendar(
  state: Pick<StockMarket4State, 'config' | 'forwardShadowCutoffDate'>,
): CalendarDate[] {
  const nominal = tradingCalendarFor(state.config);
  const cutoff = state.forwardShadowCutoffDate;
  return cutoff === null ? nominal : nominal.filter((date) => date <= cutoff);
}

/** `MIN` over every traded ticker's `latestKnownDate` — "every ticker this match can trade is
 * known through at least this date." Deliberately excludes `config.benchmarkTicker`: a benchmark
 * is a comparison yardstick, not necessarily even tradeable (see its own doc comment in types.ts),
 * so it must never gate how long a FORWARD_SHADOW match itself can run.
 *
 * `MIN`, never `MAX`: a real ingestion pipeline can easily have one ticker's data land before
 * another's on any given day. `MAX` would advance the calendar past a date where some traded
 * ticker has no data yet, corrupting this game's existing "a missing bar is a genuine data gap"
 * semantics (spec's `bar: null` contract) into "a missing bar means the match ran out of data,"
 * every single day, for whichever ticker happens to lag. Do not "simplify" this back to a
 * dataset-wide `MAX` — see docs/adr/0011-explicit-game-types.md for the full rationale and a
 * regression test (`gameType.test.ts`) that would catch exactly that regression. */
function forwardShadowCutoffDateFor(
  config: StockMarket4Config,
  marketData: MarketDataProvider,
): CalendarDate | null {
  let cutoff: CalendarDate | null = null;
  for (const ticker of config.marketDataUniverse) {
    const latest = marketData.latestKnownDate(ticker);
    if (latest === null) return null; // no data at all yet for a traded ticker
    if (cutoff === null || latest < cutoff) cutoff = latest;
  }
  return cutoff;
}

/** Throws unless at least one trading day is actually playable against `cutoff` — shared by
 * `initialize()` and `resumeForwardState` (roadmap Phase 3) so the two entry points that can
 * produce a `FORWARD_SHADOW` state can never drift apart on this check. Not a `Result` — matches
 * every other setup-fatal condition in this file (see `buildMarketDataProvider`), since neither
 * caller has a `Result`-returning contract to honor (`initialize()` per `GameDefinition`; a
 * resume path has no such contract either). */
function assertHasPlayableDays(config: StockMarket4Config, cutoff: CalendarDate | null): void {
  const playableDays = tradingCalendarFor(config).filter(
    (date) => cutoff === null || date <= cutoff,
  );
  if (playableDays.length === 0) {
    throw new Error(
      `stock-market-4: FORWARD_SHADOW match has no playable trading days — dataset's latest ` +
        `known date (${cutoff ?? 'none'}) is before startDate (${config.startDate})`,
    );
  }
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
  const { id, version, dbPath } = config.marketDataset;

  let store: ReturnType<typeof openStockMarket4Db>;
  try {
    store = openStockMarket4Db(dbPath);
  } catch (error) {
    throw new Error(`stock-market-4: ${error instanceof Error ? error.message : String(error)}`);
  }
  const providerResult = createSqliteMarketDataProvider(store, { id, version });
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

/**
 * Marks each security at its close for THIS internal accounting/equity/margin computation — a
 * different contract from `SecurityMarketObservation.bar` itself (see that field's own doc
 * comment: `null` there is a genuine, never-forward-filled gap the BOT must be able to see and
 * react to). When `bar` is null because the ticker's own home exchange was closed (e.g. a Tokyo
 * Stock Exchange or KOSDAQ holiday the shared US trading calendar doesn't know about — confirmed
 * empirically: `daily_bars` has no row at all for FUJIKURA/FURUKAWA/SUMITOMO on 2026-07-20/08-11
 * or VITZRONEXTECH on 2026-07-17/08-17, and Yahoo Finance itself has nothing for those dates,
 * because there was zero trading, not a data-ingestion gap), an ALREADY-HELD position still needs
 * a real value for equity/margin purposes that day. Falling back to `?? 0` (the old behavior)
 * priced such a position at literal zero for one day and "recovered" it the next, a pure
 * valuation artifact that once produced a ~31% single-day fake drawdown in a real forward match
 * — not a real trading loss. Carrying forward `history`'s own last known close (never later than
 * `bar`'s own date, by `securitiesAsOf`'s no-lookahead contract) fixes that without touching order
 * execution at all: `execution/orders.ts`'s `resolveOrdersForPortfolio` already independently
 * refuses to fill any order against a null `bar` (a zero-fill), so a holiday still correctly
 * blocks NEW trades in that ticker — this only fixes how an untouched existing position is valued.
 */
function markPricesCentsFor(securities: readonly SecurityMarketObservation[]): Map<string, number> {
  const marks = new Map<string, number>();
  for (const security of securities) {
    if (security.bar !== null) {
      marks.set(security.ticker, toCents(security.bar.close));
      continue;
    }
    const lastKnown = security.history.at(-1);
    if (lastKnown !== undefined) {
      marks.set(security.ticker, toCents(lastKnown.close));
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
  // `marketDataset.dbPath` gets the same treatment for a different reason: it's a filesystem
  // path into this HOST's shared Stock Market 4 database, not match data a bot could use to see
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
    const marketData = buildMarketDataProvider(config);

    let forwardShadowCutoffDate: CalendarDate | null = null;
    if (config.gameType === 'FORWARD_SHADOW') {
      // config.marketDataset is guaranteed set here (schema superRefine), so
      // buildMarketDataProvider is guaranteed to have returned non-null — this check is that
      // invariant made explicit for the type checker, not a normal runtime failure mode.
      if (marketData === null) {
        throw new Error('stock-market-4: FORWARD_SHADOW requires a resolved marketData provider');
      }
      forwardShadowCutoffDate = forwardShadowCutoffDateFor(config, marketData);
      assertHasPlayableDays(config, forwardShadowCutoffDate);
    }

    return {
      participantIds: [...participantIds],
      config,
      marketData,
      forwardShadowCutoffDate,
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
    const calendar = effectiveTradingCalendar(state);
    const date = calendar[state.round] ?? null;
    const securities = securitiesAsOf(state.config, state.marketData, date);
    const portfolio =
      state.portfolios.get(participantId) ?? createPortfolio(toCents(state.config.startingCapital));
    return {
      round: state.round,
      totalRounds: calendar.length,
      opponentIds,
      gameType: state.config.gameType,
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
    const calendar = effectiveTradingCalendar(state);
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
    return state.round >= effectiveTradingCalendar(state).length;
  },

  getResult(state) {
    const calendar = effectiveTradingCalendar(state);
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
    const firstSecurities =
      firstDate === undefined ? [] : securitiesAsOf(state.config, state.marketData, firstDate);

    // Best-known close at or before each boundary date, not a strict "bar dated exactly here" —
    // `history.at(-1)` (unlike `security.bar`) still reports a price on a name that isn't listed
    // yet / has no trade that exact day, which is what a "before -> after" table should show
    // rather than silently dropping the symbol.
    const securityPrices: SecurityPriceSummary[] = state.config.marketDataUniverse.map(
      (ticker, index) => ({
        symbol: ticker,
        startingPrice: firstSecurities[index]?.history.at(-1)?.close ?? 0,
        finalPrice: finalSecurities[index]?.history.at(-1)?.close ?? 0,
      }),
    );

    const portfolioSummaries: Record<string, PortfolioSummary> = {};
    for (const participantId of state.participantIds) {
      const portfolio =
        state.portfolios.get(participantId) ??
        createPortfolio(toCents(state.config.startingCapital));
      const positions: PositionSummary[] = [...portfolio.positions.entries()].map(
        ([ticker, position]) => {
          const markCents = marksCents.get(ticker) ?? 0;
          const marketValueCents = position.shares * markCents;
          return {
            symbol: ticker,
            shares: position.shares,
            averageEntryPrice: toDollars(position.averageEntryPriceCents),
            marketValue: toDollars(marketValueCents),
            unrealizedPnl: toDollars(
              marketValueCents - position.shares * position.averageEntryPriceCents,
            ),
          };
        },
      );
      const equity = finalEquityCents[participantId] ?? 0;
      portfolioSummaries[participantId] = {
        cash: toDollars(portfolio.cashCents),
        equity: toDollars(equity),
        bankrupt: equity <= 0,
        positions,
      };
    }

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
      gameType: state.config.gameType,
      marketDataMode: state.config.marketDataMode,
      finalEquityCents,
      riskStats,
      performanceMetrics,
      benchmarkReturn,
      securityPrices,
      portfolioSummaries,
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

// ---------------------------------------------------------------------------
// Forward-match resumability (roadmap Phase 3 — see docs/adr/0013-forward-match-persistence.md).
// These three functions are NOT part of `GameDefinition` — that contract has no serialize/resume
// hook, and isn't being extended to gain one (only this one game needs this today). A caller that
// knows it's holding a concrete `stockMarket4` (not a generic `GameDefinition<...>`) imports these
// directly, the same way it would import any other named export from this module.
// ---------------------------------------------------------------------------

/** Flattens the resumable parts of `state` into a plain, `JSON.stringify`-safe snapshot — the
 * save-time counterpart to `resumeForwardState`. Deliberately omits `marketData`/`config`/
 * `participantIds`; see `StockMarket4ForwardSnapshot`'s own doc comment for why. */
export function serializeForwardState(state: StockMarket4State): StockMarket4ForwardSnapshot {
  return {
    snapshotVersion: 1,
    round: state.round,
    forwardShadowCutoffDate: state.forwardShadowCutoffDate,
    portfolios: [...state.portfolios].map(([participantId, portfolio]) => [
      participantId,
      { cashCents: portfolio.cashCents, positions: [...portfolio.positions] },
    ]),
    lastFills: [...state.lastFills],
    riskStats: [...state.riskStats],
    equityHistory: [...state.equityHistory],
  };
}

/**
 * Rebuilds a live `StockMarket4State` from a persisted snapshot — the resume-time counterpart to
 * `initialize()`, used INSTEAD of it (never in addition to it) whenever a `FORWARD_SHADOW` match
 * is picked back up in a new process.
 *
 * `marketData` and `forwardShadowCutoffDate` are ALWAYS rebuilt fresh from the live dataset —
 * NEVER read off `snapshot.forwardShadowCutoffDate` — because the dataset may have grown since the
 * snapshot was taken (that's the entire point of resuming). Re-deriving both from scratch is what
 * makes a resumed bot receive exactly what it would have received had the process never stopped:
 * never less, from a stale cutoff that's since been superseded by newly-published data; never
 * more, since `securitiesAsOf`'s own point-in-time filtering is completely unchanged and still
 * gates everything on the CURRENT round's date, not on when the provider handle happened to open.
 *
 * `snapshot` is `unknown`, not `StockMarket4ForwardSnapshot` — validated here via
 * `StockMarket4ForwardSnapshotSchema`, the same "validate at the boundary" discipline
 * `parseConfig` already applies to organizer-supplied config. This is the actual trust boundary
 * for a snapshot's shape: `@thunderdome/forward-match-store` keeps it fully opaque (`unknown`) on
 * its own end, so nothing upstream of this function ever checks it.
 *
 * Throws, matching `initialize()`'s own setup-fatal convention — this has no `Result`-returning
 * contract to honor, since it isn't part of `GameDefinition`.
 */
export function resumeForwardState(args: {
  config: StockMarket4Config;
  participantIds: readonly string[];
  snapshot: unknown;
}): StockMarket4State {
  const { config, participantIds } = args;
  if (config.gameType !== 'FORWARD_SHADOW') {
    throw new Error(
      'stock-market-4: resumeForwardState is only meaningful for a FORWARD_SHADOW match',
    );
  }
  const parsed = StockMarket4ForwardSnapshotSchema.safeParse(args.snapshot);
  if (!parsed.success) {
    throw new Error(
      `stock-market-4: invalid forward snapshot: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  const snapshot = parsed.data;
  const marketData = buildMarketDataProvider(config);
  if (marketData === null) {
    throw new Error('stock-market-4: FORWARD_SHADOW requires a resolved marketData provider');
  }
  const forwardShadowCutoffDate = forwardShadowCutoffDateFor(config, marketData);
  assertHasPlayableDays(config, forwardShadowCutoffDate);

  const nominalLength = tradingCalendarFor(config).length;
  if (snapshot.round > nominalLength) {
    throw new Error(
      `stock-market-4: snapshot round ${String(snapshot.round)} exceeds this config's own ` +
        `nominal calendar length (${String(nominalLength)}) — resuming against the wrong config?`,
    );
  }

  return {
    participantIds: [...participantIds],
    config,
    marketData,
    forwardShadowCutoffDate,
    round: snapshot.round,
    portfolios: new Map(
      snapshot.portfolios.map(([participantId, portfolio]) => [
        participantId,
        { cashCents: portfolio.cashCents, positions: new Map(portfolio.positions) },
      ]),
    ),
    lastFills: new Map(snapshot.lastFills),
    riskStats: new Map(snapshot.riskStats),
    equityHistory: new Map(snapshot.equityHistory),
  };
}

/**
 * True only once real, published data has caught up through `config.endDate` — as opposed to
 * `isTerminal(state)`, which ALSO becomes true merely because currently-known data has run out
 * for now (a `FORWARD_SHADOW` match waiting on tomorrow's bar looks identically "terminal" to one
 * that's genuinely finished, since both have `state.round >= effectiveTradingCalendar(state).length`).
 * A caller managing a persisted forward match's lifecycle (never the engine, and never this game's
 * own `isTerminal`) uses this — not `isTerminal` — to decide whether to mark that match complete or
 * leave it active for a future resume. Always `true` for `'HISTORICAL'`/`'SYNTHETIC'`, where
 * `isTerminal` already means "genuinely done" with no such ambiguity.
 */
export function isForwardMatchFullyResolved(
  state: Pick<StockMarket4State, 'config' | 'forwardShadowCutoffDate'>,
): boolean {
  if (state.config.gameType !== 'FORWARD_SHADOW') return true;
  return (
    state.forwardShadowCutoffDate !== null && state.forwardShadowCutoffDate >= state.config.endDate
  );
}

// ---------------------------------------------------------------------------
// Current standings (used by `apps/cli`'s `match forward run` to print a summary after each
// invocation — see that command for how). Not part of `GameDefinition` for the same reason the
// forward-resumability functions above aren't: a host that knows it's holding a concrete
// `stockMarket4` state imports this directly.
// ---------------------------------------------------------------------------

export interface CurrentStanding {
  participantId: string;
  /** Competition ranking by current equity (ties share a rank: 1, 1, 3), same convention as
   * `getStandingOutcomes`. */
  rank: number;
  equityCents: number;
  cashCents: number;
  totalReturn: number;
  maxDrawdown: number;
  annualizedVolatility: number;
  sharpeRatio: number | null;
  positions: PositionObservation[];
  /** This participant's fills from the MOST RECENT round resolved so far — "what it decided to do
   * today," the same `fills` `getObservation` itself reports, not re-derived. */
  lastFills: Fill[];
}

export interface CurrentStandingsSummary {
  /** The most recent trading day resolved so far — the match's last trading day once terminal,
   * rather than `null` the way `getObservation`'s own `date` field goes past that point (this
   * summary always has SOME real date's marks/fills to report as of, even once there's no more
   * NEW data to trade against). `null` only in the degenerate case of an empty calendar, which
   * `assertHasPlayableDays` already prevents at `initialize()`/`resumeForwardState()` time. */
  asOfDate: CalendarDate | null;
  benchmarkReturn: number | null;
  /** Ranked best-to-worst by current equity. */
  standings: CurrentStanding[];
}

/**
 * Current standings/portfolio stats/most-recent fills for every participant — safe to call on a
 * NON-terminal, still-active match (a `FORWARD_SHADOW` match waiting on tomorrow's bar, most
 * often), unlike `getResult`. `getResult` marks-to-market at the WHOLE match calendar's END date
 * (`config.endDate`) — correct once a match is actually over, but wrong mid-flight: a still-active
 * forward match's `config.endDate` is typically months past whatever's currently known, so pricing
 * "final" positions there would use stale/unavailable marks. This instead marks as of the most
 * recent trading day actually resolved — `asOfDate` below — even once `state.round` has advanced
 * PAST the end of `effectiveTradingCalendar(state)` (the ordinary post-invocation state for an
 * active `FORWARD_SHADOW` match that just caught up to everything currently known).
 *
 * Deliberately does NOT call `getObservation` for this: that function's own `date` is
 * `calendar[state.round] ?? null` with no further fallback, by design (see `PortfolioObservation`'s
 * own doc comment) — exactly `null`, and therefore cash-only marks with every position's market
 * value zeroed out, in precisely this "just caught up" case. That's the right behavior for a BOT's
 * own observation (there's genuinely no fresher mark to trade against), but the wrong one for a
 * host-side standings summary, which should keep showing real portfolio value at the last real
 * mark rather than degrading to cash-only the moment a match is fully caught up. So this calls
 * `portfolioObservationFor` directly with securities priced at `asOfDate` instead.
 */
export function getCurrentStandings(state: StockMarket4State): CurrentStandingsSummary {
  const calendar = effectiveTradingCalendar(state);
  const asOfDate = calendar[Math.min(state.round, calendar.length - 1)] ?? null;
  const firstDate = calendar[0];
  const securities = securitiesAsOf(state.config, state.marketData, asOfDate);

  const benchmarkTicker = state.config.benchmarkTicker;
  const benchmarkSeries =
    benchmarkTicker === undefined
      ? []
      : state.marketData === null
        ? (state.config.historicalPrices[benchmarkTicker] ?? [])
        : state.marketData.barsAsOf(
            benchmarkTicker,
            asOfDate ?? state.config.endDate,
            Number.POSITIVE_INFINITY,
          );
  const benchmarkReturn =
    benchmarkTicker === undefined || firstDate === undefined || asOfDate === null
      ? null
      : benchmarkBuyAndHoldReturn(benchmarkSeries, firstDate, asOfDate);

  const unranked = state.participantIds.map((participantId) => {
    const portfolio =
      state.portfolios.get(participantId) ?? createPortfolio(toCents(state.config.startingCapital));
    const observation = portfolioObservationFor(
      portfolio,
      securities,
      state.config.risk,
      state.riskStats.get(participantId) ?? EMPTY_RISK_STATS,
      state.equityHistory.get(participantId) ?? [],
    );
    const metrics = computePerformanceMetrics(observation.equityHistory, state.config.riskFreeRate);
    return {
      participantId,
      equityCents: observation.equityCents,
      cashCents: observation.cashCents,
      totalReturn: metrics.totalReturn,
      maxDrawdown: metrics.maxDrawdown,
      annualizedVolatility: metrics.annualizedVolatility,
      sharpeRatio: metrics.sharpeRatio,
      positions: observation.positions,
      lastFills: state.lastFills.get(participantId) ?? [],
    };
  });

  const standings: CurrentStanding[] = [...unranked]
    .sort((a, b) => b.equityCents - a.equityCents)
    .map((standing) => ({
      ...standing,
      rank: 1 + unranked.filter((other) => other.equityCents > standing.equityCents).length,
    }));

  return { asOfDate, benchmarkReturn, standings };
}
