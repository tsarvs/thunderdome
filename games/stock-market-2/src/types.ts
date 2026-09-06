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
 * Real-data-grounded event taxonomy for HISTORICAL mode (see `src/data/events.ts` for how each
 * type is derived from Denny's real SEC filings). SYNTHETIC mode currently only ever reports
 * `NO_NEWS` — a synthetic event generator (regime-aware, with its own hidden impact) is explicit
 * future work (spec Phase 4), not something this rework attempts.
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
// Market mode
// ---------------------------------------------------------------------------

export const MARKET_MODES = ['SYNTHETIC', 'HISTORICAL'] as const;
export type MarketMode = (typeof MARKET_MODES)[number];

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
 * they either fill now (fully or partially) or their remainder is simply dropped. */
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
 * liquidity, not another participant (see `exchange/matchingEngine.ts`). */
export interface Trade {
  buyerParticipantId: string | null;
  sellerParticipantId: string | null;
  priceCents: number;
  quantity: number;
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
  /** The day's pre-open reference/mid price, in cents — never today's real closing price in
   * HISTORICAL mode (that would be lookahead bias, spec §32). Only used to center the synthetic
   * liquidity ladder; actual executions come from the exchange, not this value directly. */
  referencePriceCents: number;
  /** Used to scale synthetic liquidity depth. */
  expectedDailyVolume: number;
  /** A rough daily-return standard deviation estimate, used to scale the liquidity ladder's
   * spread/depth — never derived from the day's own not-yet-realized move. */
  volatilityHint: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const SyntheticProfileSchema = z.object({
  /** Round 0's reference price — SYNTHETIC mode has no real data to seed from. */
  initialPrice: z.number().positive().default(100),
  /** Daily log-return standard deviation driving the placeholder random-walk reference price.
   * This is deliberately the simplest possible placeholder market model — no hidden fundamental
   * value, regime, or event-impact model yet (spec Phase 4, out of scope for this rework). */
  volatility: z.number().min(0).default(0.02),
  /** Constant daily log-return drift added on top of the random shock. */
  drift: z.number().default(0),
});
export type SyntheticProfile = z.infer<typeof SyntheticProfileSchema>;

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
    liquidity: LiquidityProfileSchema.default({}),
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
  shares: number;
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
    shares: number;
    value: number;
    /** Cash/shares not already reserved by this participant's own resting orders — what a new
     * order can actually draw on. */
    availableCash: number;
    availableShares: number;
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
  scores: Record<string, number>;
  cash: Record<string, number>;
  shares: Record<string, number>;
  symbol: string;
  mode: MarketMode;
  startingPrice: number;
  finalPrice: number;
  startDate: string;
  endDate: string;
  roundsPlayed: number;
  winnerId: string | null;
}
