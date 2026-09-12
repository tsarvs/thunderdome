import { createResearchSnapshot } from '@thunderdome/research-core';
import { createFusionFixtureDataset } from '@thunderdome/research-fusion';
// Deep-imported on purpose (unchanged from fusion-fundamental-v7's own runBacktest.ts): this
// backtest only reuses the game's own performance-metrics MATH, never its execution/accounting
// engine, which isn't vendored here.
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
import { OPTX_REAL_HISTORICAL_PRICES } from './optxHistoricalPrices.js';
import { GFUZ_REAL_HISTORICAL_PRICES } from './gfuzHistoricalPrices.js';
import { FUJIKURA_REAL_HISTORICAL_PRICES } from './fujikuraHistoricalPrices.js';
import { SUMITOMO_REAL_HISTORICAL_PRICES } from './sumitomoHistoricalPrices.js';
import { KMT_REAL_HISTORICAL_PRICES } from './kmtHistoricalPrices.js';
import { AMSC_REAL_HISTORICAL_PRICES } from './amscHistoricalPrices.js';
import { DEFAULT_FUSION_QUANT_CONFIG, type FusionQuantConfig } from '../src/config.js';
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

const ANNUAL_RISK_FREE_RATE = 0.04;

const DEFAULT_PRICE_SERIES_BY_TICKER: Record<string, DailyBar[]> = {
  ELMT: ELMT_REAL_HISTORICAL_PRICES,
  FURUKAWA: FURUKAWA_REAL_HISTORICAL_PRICES,
  VITZRONEXTECH: VITZRO_NEXTECH_REAL_HISTORICAL_PRICES,
  ALM: ALMONTY_REAL_HISTORICAL_PRICES,
  FREEM: FREEMELT_REAL_HISTORICAL_PRICES,
  OPTX: OPTX_REAL_HISTORICAL_PRICES,
  GFUZ: GFUZ_REAL_HISTORICAL_PRICES,
  FUJIKURA: FUJIKURA_REAL_HISTORICAL_PRICES,
  SUMITOMO: SUMITOMO_REAL_HISTORICAL_PRICES,
  KMT: KMT_REAL_HISTORICAL_PRICES,
  AMSC: AMSC_REAL_HISTORICAL_PRICES,
};

export interface BacktestResult {
  equityHistory: EquityPoint[];
  decisions: TradingDecision[];
  performance: ReturnType<typeof computePerformanceMetrics>;
  buyAndHoldReturnByTicker: Record<string, number | null>;
}

/**
 * Replays `DEFAULT_FUSION_QUANT_CONFIG` (or an override, for `backtest/walkForward.ts`'s own
 * per-fold/per-strategy/per-ablation-mode runs) against every security's real price history, day
 * by day — unchanged in structure from `fusion-fundamental-v7`'s own `runBacktest.ts` (same
 * simplified portfolio ledger, same real game performance-metrics functions, same "fast in-process
 * tier, not a replacement for a real `thunderdome match run` cross-check" caveat).
 */
export function runBacktest(
  config: FusionQuantConfig = DEFAULT_FUSION_QUANT_CONFIG,
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
      firstBar === undefined || lastBar === undefined ? null : benchmarkBuyAndHoldReturn(bars, firstBar.date, lastBar.date);
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
