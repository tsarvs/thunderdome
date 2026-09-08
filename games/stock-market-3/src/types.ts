import { z } from 'zod';

// ---------------------------------------------------------------------------
// Economy: economic factors, sectors, styles, regime, lifecycle
//
// Every one of these enums/loadings is HIDDEN simulator state (or hidden simulator
// configuration) — it drives the numbers a bot sees (prices, fundamentals, events) but is never
// itself serialized into `StockMarket3Observation`. A bot must estimate exposure/regime/style
// statistically from observed price/volume/event behavior, the same way a real quant would
// (see README.md's "Hidden Information Audit").
// ---------------------------------------------------------------------------

export const ECONOMIC_FACTORS = [
  'GROWTH',
  'INFLATION',
  'INTEREST_RATES',
  'COMMODITY_PRICES',
  'RISK_APPETITE',
  'LIQUIDITY',
] as const;
export type EconomicFactor = (typeof ECONOMIC_FACTORS)[number];
export type EconomicFactorValues = Record<EconomicFactor, number>;

/** Generic factor exposure (spec §6) — deliberately not special-purpose fields per factor, so
 * adding a 7th factor later never requires touching every sector/company's shape. */
export interface FactorExposure {
  factor: EconomicFactor;
  loading: number;
}

export const SECTORS = ['TECHNOLOGY', 'CONSUMER', 'INDUSTRIAL', 'FINANCIAL', 'HEALTHCARE'] as const;
export type Sector = (typeof SECTORS)[number];

export const STYLE_FACTORS = ['SIZE', 'VALUE', 'MOMENTUM', 'QUALITY', 'VOLATILITY'] as const;
export type StyleFactor = (typeof STYLE_FACTORS)[number];
export type StyleLoadings = Record<StyleFactor, number>;

/** Never exposed to bots directly — inferred from price/volume/spread/correlation behavior, same
 * as games/stock-market-2's regime (spec §14). */
export const MARKET_REGIMES = [
  'BULL',
  'BEAR',
  'SIDEWAYS',
  'HIGH_VOLATILITY',
  'LOW_VOLATILITY',
  'CRISIS',
] as const;
export type MarketRegime = (typeof MARKET_REGIMES)[number];

/** A company's identity (symbol, sector) stays fixed; its economic *character* evolves through
 * these stages (spec §41) — checked only at that company's own quarterly earnings date, so a
 * company's stage is "sticky" across a whole quarter. Hidden. */
export const LIFECYCLE_STAGES = ['HIGH_GROWTH', 'MATURE', 'DECLINE'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const SECURITY_KINDS = ['EQUITY', 'INDEX'] as const;
export type SecurityKind = (typeof SECURITY_KINDS)[number];

// ---------------------------------------------------------------------------
// Public information: scheduled calendar, events, corporate actions
// ---------------------------------------------------------------------------

/** Indicators a bot could plausibly see on a real economic calendar — deliberately only 4 of the
 * 6 hidden `EconomicFactor`s get a real published release; RISK_APPETITE and LIQUIDITY are never
 * directly published, only inferable from market behavior, same as in reality (there is no
 * scheduled "risk appetite index" release). */
export const ECONOMIC_RELEASE_INDICATORS = ['GDP_GROWTH', 'INFLATION_RATE', 'POLICY_RATE', 'COMMODITY_INDEX'] as const;
export type EconomicReleaseIndicator = (typeof ECONOMIC_RELEASE_INDICATORS)[number];

export const COMPANY_NEWS_TYPES = [
  'PRODUCT_ANNOUNCEMENT',
  'REGULATORY_NOTICE',
  'MANAGEMENT_CHANGE',
  'LEGAL_MATTER',
] as const;
export type CompanyNewsType = (typeof COMPANY_NEWS_TYPES)[number];

export const CORPORATE_ACTION_TYPES = [
  'CASH_DIVIDEND',
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'BUYBACK',
  'ACQUISITION',
  'DELISTING',
] as const;
export type CorporateActionType = (typeof CORPORATE_ACTION_TYPES)[number];

/** A quarter/period label, e.g. "Q3" — purely a display string, no calendar-date meaning. */
export type PeriodLabel = string;

export interface ReportedFinancials {
  epsCents: number;
  revenueCents: number;
  marginBps: number;
}

/** One quarter's earnings release (spec §22): the reported figures AND the last public consensus
 * before them, side by side. A bot computes its own "surprise" — this never carries a
 * BEAT/MISS label. */
export interface EarningsReportEvent {
  type: 'EARNINGS_REPORT';
  observedAtRound: number;
  symbol: string;
  periodLabel: PeriodLabel;
  reported: ReportedFinancials;
  consensus: ReportedFinancials;
}

/** A macro data release (spec §21/§22): reported vs. the last public consensus vs. the prior
 * period's reported value — never the underlying hidden `EconomicFactor` value itself. */
export interface EconomicReleaseEvent {
  type: 'ECONOMIC_RELEASE';
  observedAtRound: number;
  indicator: EconomicReleaseIndicator;
  periodLabel: PeriodLabel;
  reported: number;
  consensus: number;
  previous: number;
}

export interface CompanyNewsEvent {
  type: CompanyNewsType;
  observedAtRound: number;
  symbol: string;
  description: string;
}

export type CorporateActionDetails =
  | { type: 'CASH_DIVIDEND'; perShareCents: number }
  | { type: 'STOCK_SPLIT'; fromShares: number; toShares: number }
  | { type: 'REVERSE_SPLIT'; fromShares: number; toShares: number }
  | { type: 'BUYBACK'; sharesRepurchased: number; priceCents: number }
  | { type: 'ACQUISITION'; effectiveRound: number; cashPerShareCents: number }
  | { type: 'DELISTING'; effectiveRound: number; reason: string };

/** Announced the round it becomes public knowledge. Dividends/splits/buybacks are announced and
 * applied the same round (real-world announce/ex-date gaps aren't modeled); acquisitions and
 * delistings are announced with `effectiveRound` several rounds out (spec §40's corporate-action
 * framework + §42's dynamic universe), which is itself public — real M&A announcements always
 * disclose expected close timing, so declaring it up front is not future leakage. */
export interface CorporateActionEvent {
  type: CorporateActionType;
  observedAtRound: number;
  symbol: string;
  details: CorporateActionDetails;
}

export type PublicEvent = EarningsReportEvent | EconomicReleaseEvent | CompanyNewsEvent | CorporateActionEvent;

/** A scheduled date is safe to expose in full, past and future — it carries no outcome, only
 * "something will be reported here" (spec §23). */
export interface CalendarEntry {
  round: number;
  type: 'EARNINGS_REPORT' | 'ECONOMIC_RELEASE';
  symbol?: string;
  indicator?: EconomicReleaseIndicator;
}

export interface ScheduledCorporateAction {
  symbol: string;
  type: 'ACQUISITION' | 'DELISTING';
  announcedRound: number;
  effectiveRound: number;
  cashPerShareCents: number;
  reason: string;
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Orders / trades / order book
// ---------------------------------------------------------------------------

export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const TimeInForceSchema = z.enum(['DAY', 'GTC']);
export type TimeInForce = z.infer<typeof TimeInForceSchema>;

/** `SELL` both closes/reduces a long AND opens/adds to a short (when `config.risk.allowShortSelling`)
 * — one signed-position model, same convention as games/stock-market-2, rather than a separate
 * SHORT side. */
export const OrderRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MARKET'),
    symbol: z.string().min(1),
    side: OrderSideSchema,
    quantity: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('LIMIT'),
    symbol: z.string().min(1),
    side: OrderSideSchema,
    quantity: z.number().int().positive(),
    limitPrice: z.number().positive(),
    timeInForce: TimeInForceSchema.default('DAY'),
  }),
  z.object({
    kind: z.literal('CANCEL'),
    orderId: z.string(),
  }),
]);
export type OrderRequest = z.infer<typeof OrderRequestSchema>;

/** A portfolio-level submission (spec §30): every order in the list is decided against the same
 * one observation snapshot, and may span any mix of symbols. */
export const StockMarket3ActionSchema = z.object({
  orders: z.array(OrderRequestSchema).max(50),
});
export type StockMarket3Action = z.infer<typeof StockMarket3ActionSchema>;

export interface RestingOrder {
  id: string;
  participantId: string;
  symbol: string;
  side: OrderSide;
  limitPriceCents: number;
  timeInForce: TimeInForce;
  quantity: number;
  submittedRound: number;
}

export interface Trade {
  symbol: string;
  buyerParticipantId: string | null;
  sellerParticipantId: string | null;
  priceCents: number;
  quantity: number;
  forced?: boolean;
}

export interface LiquidityLevel {
  priceCents: number;
  quantity: number;
}

export interface LiquiditySnapshot {
  bids: LiquidityLevel[];
  asks: LiquidityLevel[];
}

export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SecurityVolume {
  sharesBought: number;
  sharesSold: number;
  netDemand: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const EquityDefSchema = z.object({
  symbol: z.string().min(1),
  sector: z.enum(SECTORS),
});
export type EquityDef = z.infer<typeof EquityDefSchema>;

export const DEFAULT_EQUITIES: EquityDef[] = [
  { symbol: 'TECH_A', sector: 'TECHNOLOGY' },
  { symbol: 'TECH_B', sector: 'TECHNOLOGY' },
  { symbol: 'TECH_C', sector: 'TECHNOLOGY' },
  { symbol: 'CONSUMER_A', sector: 'CONSUMER' },
  { symbol: 'CONSUMER_B', sector: 'CONSUMER' },
  { symbol: 'INDUSTRIAL_A', sector: 'INDUSTRIAL' },
  { symbol: 'INDUSTRIAL_B', sector: 'INDUSTRIAL' },
  { symbol: 'FINANCIAL_A', sector: 'FINANCIAL' },
  { symbol: 'HEALTHCARE_A', sector: 'HEALTHCARE' },
];
export const DEFAULT_INDEX_SYMBOL = 'SYNTH_INDEX';

export const RiskConfigSchema = z
  .object({
    /** On by default — unlike games/stock-market-2, this game's whole design (pairs trading,
     * market-neutral index hedging, spec §19/§51) assumes margin/short-selling are ordinarily
     * available; set to `false` for a long-only-only match. */
    allowShortSelling: z.boolean().default(true),
    /** Per-symbol borrowable-share cap, before dynamic borrow conditions scale it (spec §37). */
    borrowableShares: z.number().nonnegative().default(1000),
    /** Base annualized borrow fee before dynamic scaling (spec §37); actual per-round fee also
     * reacts to that symbol's own short interest (see `portfolio/borrow.ts`). */
    borrowFeeAnnualized: z.number().min(0).default(0.03),
    /** Reg-T-style: total gross position value across ALL symbols may not exceed equity /
     * initialMarginRatio (spec §38 — portfolio-level, not per-symbol). */
    initialMarginRatio: z.number().min(0.01).max(1).default(0.5),
    maintenanceMarginRatio: z.number().min(0.01).max(1).default(0.3),
  })
  .refine((risk) => risk.maintenanceMarginRatio <= risk.initialMarginRatio, {
    message: 'maintenanceMarginRatio must be <= initialMarginRatio',
    path: ['maintenanceMarginRatio'],
  });
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const LiquidityProfileSchema = z.object({
  averageDailyVolume: z.number().positive().default(50000),
  baseSpreadBps: z.number().min(0).default(15),
  bookLevels: z.number().int().min(1).max(10).default(5),
  levelSizeDecay: z.number().min(0).max(1).default(0.7),
  levelPriceStepBps: z.number().min(0).default(20),
});
export type LiquidityProfile = z.infer<typeof LiquidityProfileSchema>;

export const StockMarket3ConfigSchema = z
  .object({
    startingCash: z.number().positive().default(100000),
    /** Total match length, in rounds/trading days (spec §26/§27); one round = one day. */
    rounds: z.number().int().min(2).max(3000).default(500),
    /** No trading is accepted before this round — bots may still observe (spec §27). */
    warmupRounds: z.number().int().min(0).default(250),
    transactionFee: z.number().min(0).max(1).default(0.001),
    priceHistoryLength: z.number().int().min(1).max(1000).default(90),
    /** Trailing window of public events/analyst revisions retained per symbol. */
    eventHistoryLength: z.number().int().min(1).max(200).default(30),
    maxOrdersPerRound: z.number().int().min(1).max(50).default(10),
    orderBookDepth: z.number().int().min(1).max(10).default(5),
    minimumSecurityPrice: z.number().positive().default(0.01),
    equities: z.array(EquityDefSchema).min(2).max(30).default(DEFAULT_EQUITIES),
    indexSymbol: z.string().min(1).default(DEFAULT_INDEX_SYMBOL),
    liquidity: LiquidityProfileSchema.default({}),
    risk: RiskConfigSchema.default({}),
  })
  .refine((config) => config.rounds > config.warmupRounds, {
    message: 'rounds must be greater than warmupRounds (there must be at least 1 competition round)',
    path: ['warmupRounds'],
  })
  .superRefine((config, ctx) => {
    const symbols = new Set(config.equities.map((e) => e.symbol));
    if (symbols.size !== config.equities.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['equities'], message: 'equity symbols must be unique' });
    }
    if (symbols.has(config.indexSymbol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['indexSymbol'],
        message: 'indexSymbol must not collide with an equity symbol',
      });
    }
  });
export type StockMarket3Config = z.infer<typeof StockMarket3ConfigSchema>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CompanyFundamentals {
  revenueCents: number;
  /** Fractional per-round revenue growth rate — hidden; slowly drifts with lifecycle stage. */
  revenueGrowth: number;
  earningsCents: number;
  marginBps: number;
  lifecycleStage: LifecycleStage;
}

export interface AnalystRevision {
  observedAtRound: number;
  periodLabel: PeriodLabel;
  consensus: ReportedFinancials;
}

/** Everything the simulator tracks about one tradable symbol — a mix of hidden engine-only state
 * (factorLoadings, styleLoadings, marketBeta, fundamentals, fundamentalValueCents, pendingActual)
 * and public state that `observation/buildObservation.ts` is free to copy forward as-is
 * (priceHistory, analystRevisions, events, openOrders, ...). `getObservation` — never this
 * interface itself — is what draws the hidden/public line (see README's Hidden Information
 * Audit). */
export interface SecurityState {
  symbol: string;
  kind: SecurityKind;
  sector: Sector | null;
  active: boolean;

  // --- hidden ---
  factorLoadings: FactorExposure[];
  styleLoadings: StyleLoadings;
  marketBeta: number;
  fundamentals: CompanyFundamentals | null;
  fundamentalValueCents: number;
  /** This security's own opening reference price — fixed for the life of the match, deliberately
   * NEVER rescaled by a later split/reverse-split (see `market/corporateActions.ts`'s
   * `applyCorporateActionToSecurity` for why rescaling it would make a split re-trigger itself
   * immediately). Used only for corporate-action trigger thresholds (spec §40) and delisting
   * checks — never itself shown to bots (they can derive the same comparison from `priceHistory`,
   * which IS split-adjusted). */
  initialReferencePriceCents: number;
  /** This quarter's true, not-yet-reported outcome — drawn once at quarter start, revealed only
   * in that quarter's `EarningsReportEvent.reported` (never before). `null` for the INDEX. */
  pendingActual: ReportedFinancials | null;

  // --- public ---
  sharesOutstanding: number;
  referencePriceCents: number;
  priceHistory: DailyCandle[];
  lastRoundVolume: SecurityVolume | null;
  openOrders: RestingOrder[];
  pendingLiquidity: LiquiditySnapshot;
  borrowFeeAnnualized: number;
  borrowableShares: number;
  analystRevisions: AnalystRevision[];
  events: PublicEvent[];
}

export interface Position {
  shares: number;
  averageEntryPriceCents: number;
  realizedPnlCents: number;
}

export interface PortfolioAccount {
  cashCents: number;
  positions: Map<string, Position>;
  bankrupt: boolean;
  /** Running peak NLV and max drawdown-from-peak (fraction), updated once per round — avoids
   * needing to retain full NLV history just to compute this at `getResult` time. */
  peakEquityCents: number;
  maxDrawdown: number;
}

export interface RiskStats {
  borrowFeesPaidCents: number;
  marginCalls: number;
  forcedLiquidations: number;
  totalTrades: number;
  totalVolume: number;
  totalFeesCents: number;
  shortTrades: number;
}

export interface StockMarket3State {
  participantIds: string[];
  config: StockMarket3Config;
  round: number;
  /** Hidden — the shared economic environment every sector/company partially loads on. */
  economicFactors: EconomicFactorValues;
  /** Hidden — never exposed; a bot infers it from behavior (spec §14). */
  regime: MarketRegime;
  securities: Map<string, SecurityState>;
  /** Constituent weights (equity symbol -> weight, sums to 1) fixed at init — hidden methodology
   * detail; a bot sees only the index's own tradable price/history (spec §18-19). */
  indexWeights: Record<string, number>;
  /** The full earnings/economic-release schedule, generated once at init — safe to expose in
   * full (spec §23), since a date carries no outcome. */
  calendar: CalendarEntry[];
  scheduledCorporateActions: ScheduledCorporateAction[];
  /** Market-wide (not per-symbol) public events — currently only ECONOMIC_RELEASE. */
  marketEvents: EconomicReleaseEvent[];
  /** The last published reading per indicator — needed to derive both the next release's
   * consensus (extrapolated from this) and to seed the very first one at init. */
  lastEconomicReadings: Record<EconomicReleaseIndicator, number>;
  portfolios: Map<string, PortfolioAccount>;
  riskStats: Map<string, RiskStats>;
  nextOrderSequence: number;
  startingIndexPriceCents: number;
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export interface PublicOrderBookLevel {
  price: number;
  quantity: number;
}

export interface PublicOpenOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  limitPrice: number;
  timeInForce: TimeInForce;
  quantity: number;
}

export interface SecurityQuote {
  lastClose: number;
  bid: number | null;
  ask: number | null;
  bidSize: number;
  askSize: number;
  orderBook: { bids: PublicOrderBookLevel[]; asks: PublicOrderBookLevel[] };
}

export interface PublicFundamentalsSnapshot {
  periodLabel: PeriodLabel;
  revenue: number;
  earnings: number;
  marginBps: number;
}

export interface AnalystConsensusPublic {
  periodLabel: PeriodLabel;
  eps: number;
  revenue: number;
  marginBps: number;
}

export interface AnalystRevisionPublic {
  observedAtRound: number;
  periodLabel: PeriodLabel;
  eps: number;
  revenue: number;
  marginBps: number;
}

export type PublicEventDollars =
  | (Omit<EarningsReportEvent, 'reported' | 'consensus'> & {
      reported: { eps: number; revenue: number; marginBps: number };
      consensus: { eps: number; revenue: number; marginBps: number };
    })
  | EconomicReleaseEvent
  | CompanyNewsEvent
  | (Omit<CorporateActionEvent, 'details'> & {
      details:
        | { type: 'CASH_DIVIDEND'; perShare: number }
        | { type: 'STOCK_SPLIT'; fromShares: number; toShares: number }
        | { type: 'REVERSE_SPLIT'; fromShares: number; toShares: number }
        | { type: 'BUYBACK'; sharesRepurchased: number; price: number }
        | { type: 'ACQUISITION'; effectiveRound: number; cashPerShare: number }
        | { type: 'DELISTING'; effectiveRound: number; reason: string };
    });

export interface SecurityObservation {
  symbol: string;
  kind: SecurityKind;
  sector: Sector | null;
  active: boolean;
  sharesOutstanding: number;
  quote: SecurityQuote;
  priceHistory: DailyCandle[];
  lastRoundVolume: SecurityVolume | null;
  borrow: { availableShares: number; feeAnnualized: number };
  /** The most recently REPORTED quarter's public financials — `null` before this security's first
   * earnings report of the match, and for the INDEX. Never the hidden, still-accruing quarter. */
  latestFundamentals: PublicFundamentalsSnapshot | null;
  analystConsensus: AnalystConsensusPublic | null;
  analystRevisionHistory: AnalystRevisionPublic[];
  events: PublicEventDollars[];
}

export interface PortfolioPositionObservation {
  symbol: string;
  shares: number;
  /** Shares not already reserved by this participant's own resting SELL orders in this symbol. */
  availableShares: number;
  averageEntryPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface PortfolioObservation {
  cash: number;
  availableCash: number;
  nlv: number;
  buyingPower: number;
  marginUsed: number;
  maintenanceRequirement: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  leverage: number;
  drawdown: number;
  realizedPnl: number;
  bankrupt: boolean;
  positions: PortfolioPositionObservation[];
  openOrders: PublicOpenOrder[];
}

export interface StockMarket3Observation {
  round: number;
  totalRounds: number;
  warmupRounds: number;
  phase: 'WARMUP' | 'COMPETITION';
  indexSymbol: string;
  securities: SecurityObservation[];
  calendar: CalendarEntry[];
  marketEvents: EconomicReleaseEvent[];
  portfolio: PortfolioObservation;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface SecurityPriceSummary {
  symbol: string;
  startingPrice: number;
  finalPrice: number;
}

export interface PositionSummary {
  symbol: string;
  shares: number;
  averageEntryPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface PortfolioSummary {
  cash: number;
  equity: number;
  bankrupt: boolean;
  positions: PositionSummary[];
}

export interface StockMarket3Result {
  participantIds: string[];
  scores: Record<string, number>;
  startingCapital: Record<string, number>;
  totalReturn: Record<string, number>;
  maxDrawdown: Record<string, number>;
  totalTrades: Record<string, number>;
  totalVolume: Record<string, number>;
  totalFees: Record<string, number>;
  totalBorrowCosts: Record<string, number>;
  shortTrades: Record<string, number>;
  marginCalls: Record<string, number>;
  forcedLiquidations: Record<string, number>;
  bankrupt: Record<string, boolean>;
  roundsPlayed: number;
  winnerId: string | null;
  indexSymbol: string;
  indexStartingPrice: number;
  indexFinalPrice: number;
  /** Every tradable security's (including the index's own) opening vs. closing price — lets a
   * caller report a before/after per symbol, not just the index. */
  securityPrices: SecurityPriceSummary[];
  /** Each participant's final cash/positions/equity — a portfolio snapshot at match end. */
  portfolioSummaries: Record<string, PortfolioSummary>;
}
