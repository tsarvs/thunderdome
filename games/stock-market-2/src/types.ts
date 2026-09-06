import { z } from 'zod';

// ---------------------------------------------------------------------------
// Symbol / events
// ---------------------------------------------------------------------------

/** The real, fixed historical series HISTORICAL mode replays — Denny's Corporation's real Nasdaq
 * ticker (see src/data/README.md). SYNTHETIC mode's symbol is configurable (`config.symbol`)
 * since it isn't tied to any real company. */
export const DENN_SYMBOL = 'DENN';
export const DEFAULT_SYNTHETIC_SYMBOL = 'SYNTH';

/**
 * Shared across both modes. HISTORICAL mode derives this from Denny's real SEC filings
 * (`src/data/events.ts`) — a bot never sees a numeric effect size, only the headline. SYNTHETIC
 * mode generates the same five types from a regime-aware synthetic event process
 * (`market/eventGenerator.ts`) with its own hidden impact — never a numeric effect size either.
 * Reusing one taxonomy across both modes (rather than the fuller list a real exchange's real
 * newswire might carry) keeps one bot strategy meaningfully portable between them.
 */
export const STOCK_MARKET_2_EVENT_TYPES = [
  'NO_NEWS',
  'POSITIVE_NEWS',
  'NEGATIVE_NEWS',
  'EARNINGS_BEAT',
  'EARNINGS_MISS',
] as const;
export type StockMarket2EventType = (typeof STOCK_MARKET_2_EVENT_TYPES)[number];

/** A bot never sees a numeric effect size here, only the headline — same contract in both modes. */
export interface StockMarket2Event {
  type: StockMarket2EventType;
  description: string;
}

// ---------------------------------------------------------------------------
// Market mode / regime
// ---------------------------------------------------------------------------

export const MARKET_MODES = ['SYNTHETIC', 'HISTORICAL'] as const;
export type MarketMode = (typeof MARKET_MODES)[number];

/** Never exposed to bots directly — a bot infers it from price/volume/spread behavior, same as a
 * real trader would (spec §8). See `market/regime.ts` for transition/profile logic. */
export const MARKET_REGIMES = [
  'BULL',
  'BEAR',
  'SIDEWAYS',
  'HIGH_VOLATILITY',
  'LOW_VOLATILITY',
  'CRISIS',
] as const;
export type MarketRegime = (typeof MARKET_REGIMES)[number];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const TimeInForceSchema = z.enum(['DAY', 'GTC']);
export type TimeInForce = z.infer<typeof TimeInForceSchema>;

/** One order instruction a bot submits this round. `CANCEL` targets a resting order this same
 * participant currently owns (by id, as reported in that participant's own `openOrders`
 * observation) — a bot can only ever cancel its own orders. */
export const OrderRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MARKET'),
    side: OrderSideSchema,
    quantity: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('LIMIT'),
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

/** A round's full submission — up to `config.maxOrdersPerRound` instructions, processed in the
 * order listed (so a CANCEL earlier in the list frees up buying power for a new order later in
 * the same list). Hard cap of 20 here is just a sanity ceiling; the real, configurable cap is
 * enforced in `validateAction` against `config.maxOrdersPerRound`. */
export const StockMarket2ActionSchema = z.object({
  orders: z.array(OrderRequestSchema).max(20),
});
export type StockMarket2Action = z.infer<typeof StockMarket2ActionSchema>;

/** A resting LIMIT order sitting in the book across rounds (only GTC orders ever persist between
 * rounds — DAY orders that don't fully fill are dropped at end of day, so any `RestingOrder` a
 * new round's `resolve()` finds in `state.openOrders` is always GTC). MARKET orders never rest —
 * they either fill now (fully or partially) or their remainder is simply dropped. Also used for
 * the synthetic forced-liquidation order a margin call generates — always MARKET-equivalent, so
 * never itself rests (see `portfolio/margin.ts`). */
export interface RestingOrder {
  id: string;
  participantId: string;
  side: OrderSide;
  limitPriceCents: number;
  timeInForce: TimeInForce;
  quantity: number;
  submittedRound: number;
}

/** One executed fill, in cents. `counterparty: null` means the other side was synthetic external
 * liquidity, not another participant (see `exchange/matchingEngine.ts`). `forced: true` marks a
 * fill that came from a margin-call liquidation rather than the participant's own order (spec
 * §25 — recorded separately from normal trades). */
export interface Trade {
  buyerParticipantId: string | null;
  sellerParticipantId: string | null;
  priceCents: number;
  quantity: number;
  forced?: boolean;
}

// ---------------------------------------------------------------------------
// Synthetic liquidity — the day's simulated external order-book depth
// ---------------------------------------------------------------------------

export interface LiquidityLevel {
  priceCents: number;
  quantity: number;
}

/** Generated fresh once per round (see `exchange/liquidity.ts`) and stored in state so that
 * `getObservation` (which never receives an `Rng`) and `resolve` (which uses it to match) are
 * guaranteed to see the exact same public book — the daily lifecycle's "every bot decides against
 * the same public state before that state changes" invariant (spec §19). Depletes as trades
 * consume it within a round; never carries over — the next round generates a fresh ladder. */
export interface LiquiditySnapshot {
  bids: LiquidityLevel[];
  asks: LiquidityLevel[];
}

// ---------------------------------------------------------------------------
// Market environment — see market/environment.ts for the interface this feeds
// ---------------------------------------------------------------------------

export interface DailyMarketConditions {
  date: string;
  event: StockMarket2Event;
  /** The event's hidden signed log-return contribution — never shown to bots. Zero for NO_NEWS. */
  eventImpactReturn: number;
  /** The day's hidden "true value", in cents — never shown to bots. The day's actual reference/
   * tradable price (computed by `market/referencePriceModel.ts`) gravitates toward this without
   * tracking it perfectly (spec §7). SYNTHETIC mode evolves this as its own process; HISTORICAL
   * mode simply sets it to the real close on this same real day (safe: by the time this value is
   * used, in the NEXT round's reference-price calc, that real day is already "yesterday"). */
  fundamentalValueCents: number;
  /** Hidden — a bot infers it from behavior, never reads it directly. */
  regime: MarketRegime;
  /** Used to scale synthetic liquidity depth (already regime-adjusted). */
  expectedDailyVolume: number;
  /** A rough BASE daily-return standard deviation estimate (before the regime's own volatility
   * multiplier is applied) — never derived from the day's own not-yet-realized move. */
  volatilityHint: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const SyntheticProfileSchema = z.object({
  /** Round 0's reference price AND fundamental value — SYNTHETIC mode has no real data to seed
   * from. */
  initialPrice: z.number().positive().default(100),
  /** Per-round log-return drift of the hidden fundamental value, on top of whatever the current
   * regime's own drift contributes (see `market/regime.ts`). */
  fundamentalDrift: z.number().default(0),
  /** Per-round log-return shock volatility of the hidden fundamental value. */
  fundamentalVolatility: z.number().min(0).default(0.015),
});
export type SyntheticProfile = z.infer<typeof SyntheticProfileSchema>;

/**
 * How the day's actual reference/tradable price tracks the hidden fundamental value —
 * shared by both modes (`market/referencePriceModel.ts`), since "how much does price track true
 * value, and how much extra noise sits on top" is the same question regardless of where the true
 * value came from. Setting `meanReversionFactor: 1, referenceVolatility: 0` in HISTORICAL mode
 * makes the reference price snap exactly to the real fundamental value (the previous real close)
 * every round; `meanReversionFactor: 0` makes either mode ignore the fundamental value entirely
 * and just random-walk.
 */
export const ReferencePriceModelConfigSchema = z.object({
  /** How much of the gap between the reference price and the fundamental value closes each round
   * (0 = never tracks it at all, 1 = snaps to it instantly, leaving nothing to trade on). */
  meanReversionFactor: z.number().min(0).max(1).default(0.15),
  /** Per-round log-return shock volatility of the reference price itself, on top of its pull
   * toward the fundamental value — regime-scaled (see `market/regime.ts`). */
  referenceVolatility: z.number().min(0).default(0.02),
});
export type ReferencePriceModelConfig = z.infer<typeof ReferencePriceModelConfigSchema>;

export const LiquidityProfileSchema = z.object({
  /** Used both to scale synthetic liquidity depth and as the market-impact denominator implicit
   * in walking a shallower/deeper book — see exchange/liquidity.ts. */
  averageDailyVolume: z.number().positive().default(100000),
  /** Round-trip spread at the best level, in basis points of the reference price. */
  baseSpreadBps: z.number().min(0).default(10),
  /** Number of synthetic price levels generated per side. */
  bookLevels: z.number().int().min(1).max(10).default(5),
  /** Fraction each successive level's size shrinks by, moving away from the best price. */
  levelSizeDecay: z.number().min(0).max(1).default(0.7),
  /** Spacing between successive synthetic price levels, in basis points of the reference price —
   * the real lever for "market impact": a shallower/steeper ladder makes the same order size walk
   * through more or less price, which is what naturally produces impact/slippage now that there's
   * a real order book (no separate additive impact formula needed, unlike v1/v2's single-price
   * square-root model). */
  levelPriceStepBps: z.number().min(0).default(15),
});
export type LiquidityProfile = z.infer<typeof LiquidityProfileSchema>;

export const RiskConfigSchema = z
  .object({
    /** Off by default — every position stays long-only/cash-only, exactly as before (spec Phase
     * 3's whole test suite depends on this default never changing). Turning it on enables BOTH
     * short selling and margin buying power for long positions together — a real brokerage
     * likewise requires a margin account to short at all, so this repo doesn't model "margin
     * without shorting" or "shorting without margin" as separate toggles. */
    allowShortSelling: z.boolean().default(false),
    /** A hard ceiling on how large a short position any one participant may hold — deliberately a
     * per-participant limit, not a shared borrow pool across participants (a shared, depleting
     * float would need to track allocation/release across every participant; out of scope for
     * this pass — see README). */
    borrowableShares: z.number().nonnegative().default(1000),
    /** Annualized cost of borrowing shares to short, converted to a per-round rate assuming 252
     * trading days/rounds per year — same convention real brokerages use for day-count. */
    borrowFeeAnnualized: z.number().min(0).default(0.03),
    /** Reg-T-style: total gross position value (long + short) may not exceed equity /
     * initialMarginRatio. */
    initialMarginRatio: z.number().min(0.01).max(1).default(0.5),
    /** Equity must stay at or above maintenanceMarginRatio * gross position value, or a margin
     * call forces liquidation. */
    maintenanceMarginRatio: z.number().min(0.01).max(1).default(0.3),
  })
  .refine((risk) => risk.maintenanceMarginRatio <= risk.initialMarginRatio, {
    message: 'maintenanceMarginRatio must be <= initialMarginRatio',
    path: ['maintenanceMarginRatio'],
  });
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const StockMarket2ConfigSchema = z
  .object({
    mode: z.enum(MARKET_MODES).default('SYNTHETIC'),
    /** SYNTHETIC mode only — forced to `DENN_SYMBOL` in HISTORICAL mode regardless of input (see
     * `game.ts`'s `parseConfig`), since HISTORICAL mode only supports the one bundled dataset. */
    symbol: z.string().min(1).default(DEFAULT_SYNTHETIC_SYMBOL),
    startingCash: z.number().positive().default(10000),
    rounds: z.number().int().min(1).max(2500).default(100),
    /** HISTORICAL mode only. Pins a match to a specific real starting day; omitted, a random
     * valid offset is drawn per match (see `market/historicalEnvironment.ts`). */
    historyStartIndex: z.number().int().min(0).optional(),
    /** Fraction of trade value charged on every executed fill (0.001 = 0.10%), charged to both
     * sides of a trade at the moment it executes — never at order submission (spec §27). */
    transactionFee: z.number().min(0).max(1).default(0.001),
    priceHistoryLength: z.number().int().min(1).max(500).default(20),
    maxOrdersPerRound: z.number().int().min(1).max(20).default(5),
    /** How many aggregated price levels of the public order book each side to reveal to bots. */
    orderBookDepth: z.number().int().min(1).max(10).default(5),
    minimumStockPrice: z.number().positive().default(0.01),
    synthetic: SyntheticProfileSchema.default({}),
    referenceModel: ReferencePriceModelConfigSchema.default({}),
    liquidity: LiquidityProfileSchema.default({}),
    risk: RiskConfigSchema.default({}),
  })
  .superRefine((config, ctx) => {
    if (
      config.mode === 'HISTORICAL' &&
      config.historyStartIndex !== undefined &&
      config.historyStartIndex + config.rounds > 2513
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['historyStartIndex'],
        message:
          'historyStartIndex + rounds must leave at least 2 trading days of real history past ' +
          'the match window, so every round this match could ever reach has a real reference ' +
          'day (and the terminal round-transition lookup) to derive from',
      });
    }
  });
export type StockMarket2Config = z.infer<typeof StockMarket2ConfigSchema>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface StockMarket2Portfolio {
  cashCents: number;
  /** Can be negative — a short position (spec §22). */
  shares: number;
  /** Average cost basis of the current position (long or short), in cents; 0 when flat. Needed to
   * realize P&L correctly across partial fills and long<->short crossings (spec §26). */
  averageEntryPriceCents: number;
  realizedPnlCents: number;
  /** Set once equity goes negative even after a full forced liquidation (spec §25) — a bankrupt
   * participant's future orders are always ignored (treated as HOLD), never re-checked. */
  bankrupt: boolean;
}

/** Running per-participant counters carried across rounds, surfaced in `StockMarket2Result` —
 * kept separate from `StockMarket2Portfolio` since these are cumulative match statistics, not
 * account state the exchange reasons about. */
export interface StockMarket2RiskStats {
  borrowFeesPaidCents: number;
  marginCalls: number;
  forcedLiquidations: number;
}

export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockMarket2Volume {
  sharesBought: number;
  sharesSold: number;
  netDemand: number;
}

export interface StockMarket2State {
  participantIds: string[];
  config: StockMarket2Config;
  /** HISTORICAL mode only; 0 and unused in SYNTHETIC mode. */
  historyStartIndex: number;
  round: number;
  /** Round 0's reference price/date, kept immutable for the life of the match — `priceHistory` is
   * trimmed to `config.priceHistoryLength`, so a long match's own candle 0 may no longer be in
   * `priceHistory` by the time `getResult` needs "what did this match start at". */
  startingPriceCents: number;
  startDate: string;
  /** This round's pre-open reference/mid price, in cents — see `DailyMarketConditions`. */
  referencePriceCents: number;
  /** Hidden "true value" driving this round's reference price — never shown to bots. */
  fundamentalValueCents: number;
  /** Hidden market regime for this round — never shown to bots. */
  regime: MarketRegime;
  /** This round's synthetic liquidity ladder — generated one round ahead (during the previous
   * round's `resolve()`, or during `initialize()` for round 0) so bots always decide against the
   * exact same public book the exchange will actually match against. */
  pendingLiquidity: LiquiditySnapshot;
  currentEvent: StockMarket2Event;
  currentDate: string;
  /** GTC orders resting across rounds. DAY orders never appear here between rounds. */
  openOrders: RestingOrder[];
  /** Realized daily OHLCV candles, oldest first, trimmed to `config.priceHistoryLength`. */
  priceHistory: DailyCandle[];
  lastRoundVolume: StockMarket2Volume | null;
  portfolios: Map<string, StockMarket2Portfolio>;
  riskStats: Map<string, StockMarket2RiskStats>;
  /** Monotonic counter used to mint unique resting-order ids. */
  nextOrderSequence: number;
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
  side: OrderSide;
  limitPrice: number;
  timeInForce: TimeInForce;
  quantity: number;
}

export interface StockMarket2Observation {
  round: number;
  totalRounds: number;
  symbol: string;
  mode: MarketMode;
  portfolio: {
    cash: number;
    /** Can be negative — a short position. */
    shares: number;
    /** Net liquidation value / equity: cash + shares * markPrice. */
    value: number;
    /** Cash/shares not already reserved by this participant's own resting orders — what a new
     * order can actually draw on (does not yet account for margin — see `buyingPower`). */
    availableCash: number;
    availableShares: number;
    /** Total gross position value (long + short) this account may hold right now, given its
     * current equity and `initialMarginRatio` — 0 whenever `config.risk.allowShortSelling` is
     * off, since margin buying power isn't available without a margin account. */
    buyingPower: number;
    /** Gross position value already in use (|shares| * markPrice). */
    marginUsed: number;
    /** Equity must stay at or above this or a margin call forces liquidation. 0 when flat. */
    maintenanceRequirement: number;
    realizedPnl: number;
    bankrupt: boolean;
  };
  openOrders: PublicOpenOrder[];
  market: {
    date: string;
    lastClose: number;
    bid: number | null;
    ask: number | null;
    bidSize: number;
    askSize: number;
    orderBook: { bids: PublicOrderBookLevel[]; asks: PublicOrderBookLevel[] };
    priceHistory: DailyCandle[];
    lastRoundVolume: StockMarket2Volume | null;
  };
  event: StockMarket2Event;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface StockMarket2Result {
  participantIds: string[];
  /** Final net liquidation value per participant, in dollars — the primary win metric (spec §37;
   * risk-adjusted metrics like Sharpe/max-drawdown are explicitly deferred as secondary
   * analytics). */
  scores: Record<string, number>;
  cash: Record<string, number>;
  shares: Record<string, number>;
  realizedPnl: Record<string, number>;
  borrowFeesPaid: Record<string, number>;
  marginCalls: Record<string, number>;
  forcedLiquidations: Record<string, number>;
  bankrupt: Record<string, boolean>;
  symbol: string;
  mode: MarketMode;
  startingPrice: number;
  finalPrice: number;
  startDate: string;
  endDate: string;
  roundsPlayed: number;
  /** `null` when the top score is shared by more than one participant. */
  winnerId: string | null;
}
