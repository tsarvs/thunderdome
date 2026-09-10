import { createResearchSnapshot } from '@thunderdome/research-core';
import { createFusionFixtureDataset } from '@thunderdome/research-fusion';
// Deep-imported on purpose: `@thunderdome/game-stock-market-4`'s barrel (`index.js`) pulls in
// `game.js`/`execution/orders.js`, which need the real `@thunderdome/engine` — not vendored here,
// since this backtest only reuses the game's own performance-metrics MATH (spec §30: "use the
// game's EXISTING metrics rather than duplicating them"), never its execution/accounting engine.
import {
  benchmarkBuyAndHoldReturn,
  computePerformanceMetrics,
} from '@thunderdome/game-stock-market-4/dist/metrics/performance.js';
import { applyOrdersMultiTicker } from './portfolioLedger.js';
import { ELMT_REAL_HISTORICAL_PRICES } from './elmtHistoricalPrices.js';
import { FURUKAWA_REAL_HISTORICAL_PRICES } from './furukawaHistoricalPrices.js';
import { VITZRO_NEXTECH_REAL_HISTORICAL_PRICES } from './vitzroNextechHistoricalPrices.js';
import { ALMONTY_REAL_HISTORICAL_PRICES } from './almontyHistoricalPrices.js';
import { FREEMELT_REAL_HISTORICAL_PRICES } from './freemeltHistoricalPrices.js';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG, type FusionFundamentalConfig } from '../src/config.js';
import { formatStrategyTrace, type TradingDecision } from '../src/decision.js';
import { createDecideAction } from '../src/index.js';
import type {
  DailyBar,
  EquityPoint,
  PortfolioObservation,
  SecurityMarketObservation,
  StockMarket4Observation,
} from '../src/marketTypes.js';

const dataset = createFusionFixtureDataset();

/** An assumption of THIS REPORT (annualizing Sharpe), not a strategy assumption — kept separate
 * from `../src/config.ts`, which only holds assumptions the strategy itself depends on. */
const ANNUAL_RISK_FREE_RATE = 0.04;

/** Every ticker this backtest has REAL price history for (spec follow-up: "scale to a portfolio
 * of multiple symbols") — add an entry here as each new security gets a real, sourced price
 * series the same way `elmtHistoricalPrices.ts` was built for ELMT. A security in
 * `config.securities` with no entry here simply never gets a price this backtest, and so is
 * never traded (same "skip, don't error" behavior `computeTradingDecisions` already has for a
 * missing price). */
const DEFAULT_PRICE_SERIES_BY_TICKER: Record<string, DailyBar[]> = {
  ELMT: ELMT_REAL_HISTORICAL_PRICES,
  // Ticker keys must match `SecurityConfig.ticker` in ../src/config.ts exactly. Furukawa (TSE)
  // and Vitzro Nextech (KOSDAQ) have no US ticker, hence the placeholder string keys there — see
  // config.ts's own comment on those entries.
  FURUKAWA: FURUKAWA_REAL_HISTORICAL_PRICES,
  VITZRONEXTECH: VITZRO_NEXTECH_REAL_HISTORICAL_PRICES,
  ALM: ALMONTY_REAL_HISTORICAL_PRICES,
  FREEM: FREEMELT_REAL_HISTORICAL_PRICES,
};

export interface BacktestResult {
  equityHistory: EquityPoint[];
  decisions: TradingDecision[];
  performance: ReturnType<typeof computePerformanceMetrics>;
  /** Buy-and-hold return per ticker over the exact window THAT ticker's own series covers — kept
   * per-symbol rather than collapsed into one basket number, since this bot doesn't assume an
   * equal-weight (or any other) basket construction. */
  buyAndHoldReturnByTicker: Record<string, number | null>;
}

/**
 * Replays `DEFAULT_FUSION_FUNDAMENTAL_CONFIG` (or an override, for a sweep) against every
 * security's real price history in `priceSeriesByTicker`, day by day, driving the bot exactly the
 * way a real match would round-to-round: build a (possibly multi-security) observation, call
 * `decideAction`, apply whatever orders come back — now potentially spanning several tickers in
 * one round — to a running portfolio ledger (`portfolioLedger.ts` — a deliberately simplified
 * stand-in for the real engine's execution/fee/margin accounting), record the resulting equity
 * point. At the end, hands the resulting equity curve to the game's OWN metrics functions rather
 * than reimplementing Sharpe/drawdown/etc. here.
 *
 * Trading calendar: the union of every date across every ticker's series (not each ticker's own
 * calendar) drives the round loop, so a ticker that IPO'd later or has a gap simply has no bar
 * (and no observation entry) on dates outside its own coverage — `history` for each ticker only
 * ever includes that ticker's own prior real bars, never another ticker's.
 *
 * Deliberately does NOT go through Docker/NDJSON/`@thunderdome/engine` — this is the fast,
 * in-process tier described when this backtest was scoped; a slower, high-fidelity cross-check
 * through the real `thunderdome match run` engine (which DOES enforce real fees/margin/position
 * accounting) is the appropriate next step once a config looks reasonable here, not a replacement
 * for it.
 */
export function runBacktest(
  config: FusionFundamentalConfig = DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
  priceSeriesByTicker: Record<string, DailyBar[]> = DEFAULT_PRICE_SERIES_BY_TICKER,
  startingCashCents = 10_000_000,
): BacktestResult {
  const decisions: TradingDecision[] = [];
  const decideAction = createDecideAction(config, (decision) => decisions.push(decision));

  const barsByTickerByDate = new Map<string, Map<string, DailyBar>>();
  const allDates = new Set<string>();
  for (const [ticker, bars] of Object.entries(priceSeriesByTicker)) {
    const byDate = new Map(bars.map((bar) => [bar.date, bar]));
    barsByTickerByDate.set(ticker, byDate);
    for (const bar of bars) allDates.add(bar.date);
  }
  const sortedDates = Array.from(allDates).sort();

  let portfolio: PortfolioObservation = {
    cashCents: startingCashCents,
    equityCents: startingCashCents,
    positions: [],
    equityHistory: [],
    buyingPowerCents: startingCashCents,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };

  const equityHistory: EquityPoint[] = [];
  const historySoFarByTicker = new Map<string, DailyBar[]>();

  sortedDates.forEach((date, index) => {
    const securities: SecurityMarketObservation[] = [];
    const pricesCentsByTicker = new Map<string, number>();

    for (const [ticker, byDate] of barsByTickerByDate) {
      const bar = byDate.get(date);
      if (bar === undefined) continue;
      const history = historySoFarByTicker.get(ticker) ?? [];
      securities.push({ ticker, bar, history: [...history] });
      pricesCentsByTicker.set(ticker, Math.round(bar.close * 100));
      historySoFarByTicker.set(ticker, [...history, bar]);
    }

    const observation: StockMarket4Observation = {
      round: index + 1,
      totalRounds: sortedDates.length,
      opponentIds: [],
      marketDataMode: 'historical',
      date,
      securities,
      corporateActions: [],
      portfolio,
      fills: [],
      // Real point-in-time research, exactly as a real match would deliver it — the same
      // `createResearchSnapshot` call `games/stock-market-4` itself uses (see
      // `src/research/types.ts`'s own doc comment), reconstructed fresh for each date so no day
      // ever sees research that wasn't yet knowable on that date.
      research: createResearchSnapshot(dataset, `${date}T00:00:00Z`),
    };

    const action = decideAction(observation);
    portfolio = applyOrdersMultiTicker(portfolio, pricesCentsByTicker, action.orders);
    equityHistory.push({ date, equityCents: portfolio.equityCents });
  });

  const performance = computePerformanceMetrics(equityHistory, ANNUAL_RISK_FREE_RATE);

  const buyAndHoldReturnByTicker: Record<string, number | null> = {};
  for (const [ticker, bars] of Object.entries(priceSeriesByTicker)) {
    const firstBar = bars[0];
    const lastBar = bars.at(-1);
    buyAndHoldReturnByTicker[ticker] =
      firstBar === undefined || lastBar === undefined
        ? null
        : benchmarkBuyAndHoldReturn(bars, firstBar.date, lastBar.date);
  }

  return { equityHistory, decisions, performance, buyAndHoldReturnByTicker };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const result = runBacktest();

  for (const decision of result.decisions) {
    process.stderr.write(`${formatStrategyTrace(decision)}\n\n`);
  }

  const finalEquityCents = result.equityHistory.at(-1)?.equityCents ?? null;
  const startingEquityCents = result.equityHistory[0]?.equityCents ?? null;
  const tradingDays = result.equityHistory.length;
  const tradeCount = result.decisions.filter((d) => d.action !== 'HOLD').length;

  process.stdout.write(
    `${JSON.stringify(
      {
        tradingDays,
        tradeCount,
        startingEquityCents,
        finalEquityCents,
        strategyReturn: result.performance.totalReturn,
        maxDrawdown: result.performance.maxDrawdown,
        annualizedVolatility: result.performance.annualizedVolatility,
        sharpeRatio: result.performance.sharpeRatio,
        buyAndHoldReturnByTicker: result.buyAndHoldReturnByTicker,
      },
      null,
      2,
    )}\n`,
  );
}
