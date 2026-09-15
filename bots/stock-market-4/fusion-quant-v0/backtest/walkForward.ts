import { createResearchSnapshot } from '@thunderdome/research-core';
import { createFusionFixtureDataset } from '@thunderdome/research-fusion';
import {
  computePerformanceMetrics,
} from '@thunderdome/game-stock-market-4/dist/metrics/performance.js';
import {
  buildOrders,
  type DailyBar,
  type EquityPoint,
  type OrderPolicy,
  type OrderRequest,
  type PortfolioObservation,
  type PortfolioStrategyName,
  type ResearchAblationMode,
  type SecurityMarketObservation,
  type StockMarket4Observation,
} from '@thunderdome/quant-sdk-js';
import { applyOrdersMultiTicker } from './portfolioLedger.js';
import { DEFAULT_FUSION_QUANT_CONFIG, type FusionQuantConfig } from '../src/config.js';
import { createDecideAction as createQuantDecideAction } from '../src/index.js';
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

const dataset = createFusionFixtureDataset();
const ANNUAL_RISK_FREE_RATE = 0.04;

export const FULL_PRICE_SERIES_BY_TICKER: Record<string, DailyBar[]> = {
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

export type DecideAction = (observation: StockMarket4Observation) => { orders: OrderRequest[] };

/** Every real calendar date any tracked ticker has a bar for, sorted ascending — the SAME "union
 * of every ticker's own dates" trading calendar `runBacktest.ts` already uses. */
export function sharedTradingCalendar(priceSeriesByTicker: Record<string, DailyBar[]>): string[] {
  const allDates = new Set<string>();
  for (const bars of Object.values(priceSeriesByTicker)) for (const bar of bars) allDates.add(bar.date);
  return Array.from(allDates).sort();
}

/**
 * Replays ONE participant's `decideAction` across the shared trading calendar, day by day — the
 * single continuous pass every fold/leakage guarantee in this file rests on: bar `history` for a
 * ticker only ever contains bars STRICTLY BEFORE the current date (built up incrementally, exactly
 * like `runBacktest.ts`), and the research snapshot at each date is `createResearchSnapshot`'s own
 * point-in-time reconstruction — nothing here ever hands a decision a bar or research fact from a
 * later date. `dateLimit`, when given, simply stops the replay early (used by
 * `test/backtest/walkforward-leakage.test.ts` to prove a truncated run reproduces the untruncated
 * run's earlier decisions byte-for-byte).
 */
export function replayParticipant(params: {
  decideAction: DecideAction;
  priceSeriesByTicker: Record<string, DailyBar[]>;
  startingCashCents: number;
  dateLimit?: string;
}): { dates: string[]; equityHistory: EquityPoint[] } {
  const barsByTickerByDate = new Map<string, Map<string, DailyBar>>();
  for (const [ticker, bars] of Object.entries(params.priceSeriesByTicker)) {
    barsByTickerByDate.set(ticker, new Map(bars.map((bar) => [bar.date, bar])));
  }
  const allDates = sharedTradingCalendar(params.priceSeriesByTicker).filter(
    (date) => params.dateLimit === undefined || date <= params.dateLimit,
  );

  let portfolio: PortfolioObservation = {
    cashCents: params.startingCashCents,
    equityCents: params.startingCashCents,
    positions: [],
    equityHistory: [],
    buyingPowerCents: params.startingCashCents,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };

  const equityHistory: EquityPoint[] = [];
  const historySoFarByTicker = new Map<string, DailyBar[]>();

  allDates.forEach((date, index) => {
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
      totalRounds: allDates.length,
      opponentIds: [],
      marketDataMode: 'historical',
      date,
      securities,
      corporateActions: [],
      portfolio,
      fills: [],
      research: createResearchSnapshot(dataset, `${date}T00:00:00Z`),
    };

    const action = params.decideAction(observation);
    portfolio = applyOrdersMultiTicker(portfolio, pricesCentsByTicker, action.orders);
    equityHistory.push({ date, equityCents: portfolio.equityCents });
  });

  return { dates: allDates, equityHistory };
}

const CONTROL_ORDER_POLICY: OrderPolicy = { minOrderNotionalCents: 5_000, rebalanceToleranceWeight: 0.03 };

/** Control: never trades — the "did this strategy even beat doing nothing" floor. */
export function createCashControlDecideAction(): DecideAction {
  return () => ({ orders: [] });
}

/** Control: on the FIRST round with any priced security, buys an equal dollar amount of every
 * priced ticker and never trades again — the classic buy-and-hold benchmark, at the PORTFOLIO
 * level (distinct from `runBacktest.ts`'s own per-ticker `benchmarkBuyAndHoldReturn`, which never
 * combines tickers into one held basket). */
export function createBuyAndHoldControlDecideAction(): DecideAction {
  let bought = false;
  return (observation) => {
    if (bought) return { orders: [] };
    const priced = observation.securities.filter((s) => s.bar !== null);
    if (priced.length === 0) return { orders: [] };
    bought = true;

    const orders: OrderRequest[] = [];
    let remainingCents = observation.portfolio.cashCents;
    const targetWeight = 1 / priced.length;
    for (const security of priced) {
      const priceCents = Math.round(security.bar!.close * 100);
      const budgetCents = Math.min(observation.portfolio.equityCents * targetWeight, remainingCents);
      const quantity = Math.floor(budgetCents / priceCents);
      if (quantity > 0) {
        orders.push({ kind: 'MARKET', ticker: security.ticker, side: 'BUY', quantity });
        remainingCents -= quantity * priceCents;
      }
    }
    return { orders };
  };
}

/** Control: rebalances to equal weight across every priced ticker EVERY round — the naive
 * "no alpha, no research, just diversify and rebalance" baseline every fancier strategy in this
 * harness has to actually beat. */
export function createEqualWeightControlDecideAction(): DecideAction {
  return (observation) => {
    const priced = observation.securities.filter((s) => s.bar !== null);
    if (priced.length === 0) return { orders: [] };
    const targetWeight = 1 / priced.length;
    const orders: OrderRequest[] = [];
    let remainingBuyingPowerCents =
      observation.portfolio.buyingPowerCents > 0 ? observation.portfolio.buyingPowerCents : Math.max(0, observation.portfolio.cashCents);
    for (const security of priced) {
      const generated = buildOrders({
        ticker: security.ticker,
        targetWeight,
        priceDollars: security.bar!.close,
        portfolio: observation.portfolio,
        policy: CONTROL_ORDER_POLICY,
        availableBuyingPowerCents: remainingBuyingPowerCents,
      });
      for (const order of generated) {
        if (order.side === 'BUY') {
          remainingBuyingPowerCents = Math.max(0, remainingBuyingPowerCents - order.quantity * Math.round(security.bar!.close * 100));
        }
      }
      orders.push(...generated);
    }
    return { orders };
  };
}

function quantVariantConfig(strategy: PortfolioStrategyName, ablationMode: ResearchAblationMode): FusionQuantConfig {
  return {
    ...DEFAULT_FUSION_QUANT_CONFIG,
    portfolioConstruction: { ...DEFAULT_FUSION_QUANT_CONFIG.portfolioConstruction, strategy },
    ablationMode,
  };
}

export interface Participant {
  name: string;
  createDecideAction: () => DecideAction | Promise<DecideAction>;
}

/** Dynamically loads a SIBLING bot's built `dist/index.js` + `dist/config.js` — a relative
 * filesystem import, not a package dependency (these bots aren't Yarn workspace members — see
 * `../README.md`/this repo's own ADR on the bots/research-core boundary). The path is held in a
 * plain `string` variable rather than an inline literal specifically so TypeScript treats the
 * `import()` as fully dynamic (untyped) rather than trying — and failing — to resolve type
 * declarations for a sibling bot's dist output, which was never built with `declaration: true`.
 * Used ONLY to read the bot's own `createDecideAction`/`DEFAULT_*_CONFIG` exports — this file never
 * modifies either bot's source, consistent with the plan's "v6/fusion-fundamental-v7 stay frozen
 * benchmarks" requirement. */
async function loadSiblingBotDecideAction(distDirRelativePath: string): Promise<DecideAction> {
  const indexPath: string = `${distDirRelativePath}/index.js`;
  const configPath: string = `${distDirRelativePath}/config.js`;
  const indexModule = await import(indexPath);
  const configModule = await import(configPath);
  const defaultConfig = configModule.DEFAULT_FUSION_FUNDAMENTAL_CONFIG;
  return indexModule.createDecideAction(defaultConfig) as DecideAction;
}

export function buildParticipants(): Participant[] {
  return [
    { name: 'fusion-fundamental-v6 (frozen benchmark)', createDecideAction: () => loadSiblingBotDecideAction('../../fusion-fundamental-v6/dist') },
    { name: 'fusion-fundamental-v7 (frozen benchmark)', createDecideAction: () => loadSiblingBotDecideAction('../../fusion-fundamental-v7/dist') },
    { name: 'fusion-quant-v0 (equal_weight, full)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('equal_weight', 'full')) },
    { name: 'fusion-quant-v0 (inverse_volatility, full)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('inverse_volatility', 'full')) },
    { name: 'fusion-quant-v0 (risk_parity, full)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('risk_parity', 'full')) },
    { name: 'fusion-quant-v0 (inverse_volatility, null_research)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('inverse_volatility', 'null_research')) },
    { name: 'fusion-quant-v0 (inverse_volatility, research_only)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('inverse_volatility', 'research_only')) },
    { name: 'fusion-quant-v0 (inverse_volatility, price_only)', createDecideAction: () => createQuantDecideAction(quantVariantConfig('inverse_volatility', 'price_only')) },
    { name: 'control: equal_weight (rebalanced every round)', createDecideAction: () => createEqualWeightControlDecideAction() },
    { name: 'control: buy_and_hold (equal-dollar, day 1)', createDecideAction: () => createBuyAndHoldControlDecideAction() },
    { name: 'control: cash (never trades)', createDecideAction: () => createCashControlDecideAction() },
  ];
}

export interface FoldWindow {
  index: number;
  startDate: string;
  endDate: string;
}

/** Splits `dates` into `numFolds` contiguous, roughly-equal, NON-overlapping windows, in
 * chronological order — the last fold absorbs any remainder. With this bot's currently-real
 * ~73-day calendar (Jul 1 - Sep 11 2026) and the default `numFolds: 3`, expect ~24-day folds — a
 * genuinely small sample; see this bot's own plan doc for why that is reported plainly here, not
 * treated as a settled result. */
export function splitIntoFolds(dates: string[], numFolds = 3): FoldWindow[] {
  if (dates.length === 0) return [];
  const foldSize = Math.ceil(dates.length / numFolds);
  const folds: FoldWindow[] = [];
  for (let i = 0; i < numFolds; i++) {
    const start = i * foldSize;
    if (start >= dates.length) break;
    const end = Math.min(start + foldSize, dates.length) - 1;
    folds.push({ index: i, startDate: dates[start]!, endDate: dates[end]! });
  }
  return folds;
}

function sliceEquityHistory(equityHistory: EquityPoint[], startDate: string, endDate: string): EquityPoint[] {
  return equityHistory.filter((point) => point.date >= startDate && point.date <= endDate);
}

export interface FoldMetrics {
  foldIndex: number;
  startDate: string;
  endDate: string;
  tradingDays: number;
  performance: ReturnType<typeof computePerformanceMetrics>;
}

export interface WalkForwardParticipantReport {
  name: string;
  foldMetrics: FoldMetrics[];
  aggregatePerformance: ReturnType<typeof computePerformanceMetrics>;
}

export interface WalkForwardReport {
  folds: FoldWindow[];
  participants: WalkForwardParticipantReport[];
}

/**
 * Runs every participant (`buildParticipants`) through ONE continuous replay of the shared real
 * trading calendar (`replayParticipant`) — never restarting capital or state per fold, since a real
 * walk-forward equity curve is continuous; folds only slice the reporting, not the replay itself.
 * Reports BOTH per-fold and aggregate performance, using the game's own
 * `computePerformanceMetrics` (never reimplemented) for every slice.
 *
 * The plan's own load-bearing caveat, restated here in code form: with only ~73 days of real
 * price history, `numFolds: 3` gives ~24-day folds — real out-of-sample slices, correctly isolated
 * from each other and from the future, but a small enough sample that no single number here should
 * be read as a settled verdict on any strategy. This gets more meaningful as
 * `packages/stock-market-4/market-data/scripts/fetchAndAppendBars.ts` accumulates more real history.
 */
export async function runWalkForward(params: {
  priceSeriesByTicker?: Record<string, DailyBar[]>;
  startingCashCents?: number;
  numFolds?: number;
} = {}): Promise<WalkForwardReport> {
  const priceSeriesByTicker = params.priceSeriesByTicker ?? FULL_PRICE_SERIES_BY_TICKER;
  const startingCashCents = params.startingCashCents ?? 10_000_000;
  const dates = sharedTradingCalendar(priceSeriesByTicker);
  const folds = splitIntoFolds(dates, params.numFolds ?? 3);

  const participants: WalkForwardParticipantReport[] = [];
  for (const participant of buildParticipants()) {
    const decideAction = await participant.createDecideAction();
    const { equityHistory } = replayParticipant({ decideAction, priceSeriesByTicker, startingCashCents });

    const foldMetrics: FoldMetrics[] = folds.map((fold) => {
      const slice = sliceEquityHistory(equityHistory, fold.startDate, fold.endDate);
      return {
        foldIndex: fold.index,
        startDate: fold.startDate,
        endDate: fold.endDate,
        tradingDays: slice.length,
        performance: computePerformanceMetrics(slice, ANNUAL_RISK_FREE_RATE),
      };
    });

    participants.push({
      name: participant.name,
      foldMetrics,
      aggregatePerformance: computePerformanceMetrics(equityHistory, ANNUAL_RISK_FREE_RATE),
    });
  }

  return { folds, participants };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runWalkForward()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`walkForward failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
