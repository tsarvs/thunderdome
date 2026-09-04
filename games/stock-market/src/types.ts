import { z } from 'zod';

export const STOCK_MARKET_EVENT_TYPES = [
  'NO_NEWS',
  'POSITIVE_NEWS',
  'NEGATIVE_NEWS',
  'ANALYST_UPGRADE',
  'ANALYST_DOWNGRADE',
  'PRODUCT_SUCCESS',
  'PRODUCT_FAILURE',
  'EARNINGS_BEAT',
  'EARNINGS_MISS',
] as const;
export type StockMarketEventType = (typeof STOCK_MARKET_EVENT_TYPES)[number];

/**
 * Per-event-type configuration — organizer-tunable, but only `weight` is ever visible to a bot
 * (`stockMarket.redactConfigForBots` in game.ts strips `baselineMultiplier`/`volatility` before a
 * bot's own `init` payload is built). A bot only ever gets the same thing a human player would:
 * the list of event types, and — round by round — which one just fired, never the effect size.
 *
 * `baselineMultiplier` is the *center* of the distribution the event's actual, match-specific
 * multiplier is drawn from — not the literal value used every match. `volatility` (0 = fixed at
 * baseline, higher = more variable) controls two things at once: how far the match's initial draw
 * can land from that center, and how far it can subsequently wander, round by round, every time
 * this event type fires again during the same match (see game.ts's `driftEffectRatio`) — so even
 * a bot that somehow learned today's baseline table exactly still couldn't predict a specific
 * match's actual values, or assume they hold steady for the rest of it.
 *
 * `weight`s need not sum to any particular total — only their relative size matters — but every
 * match needs at least one positive weight, or nothing could ever be drawn.
 */
const EventDefinitionSchema = z.object({
  baselineMultiplier: z.number().positive(),
  volatility: z.number().min(0).max(1),
  weight: z.number().nonnegative(),
});
export const StockMarketEventsConfigSchema = z
  .object({
    NO_NEWS: EventDefinitionSchema.default({
      baselineMultiplier: 1.0,
      volatility: 0.25,
      weight: 60,
    }),
    POSITIVE_NEWS: EventDefinitionSchema.default({
      baselineMultiplier: 1.02,
      volatility: 0.25,
      weight: 8,
    }),
    NEGATIVE_NEWS: EventDefinitionSchema.default({
      baselineMultiplier: 0.98,
      volatility: 0.25,
      weight: 8,
    }),
    ANALYST_UPGRADE: EventDefinitionSchema.default({
      baselineMultiplier: 1.03,
      volatility: 0.25,
      weight: 6,
    }),
    ANALYST_DOWNGRADE: EventDefinitionSchema.default({
      baselineMultiplier: 0.97,
      volatility: 0.25,
      weight: 6,
    }),
    PRODUCT_SUCCESS: EventDefinitionSchema.default({
      baselineMultiplier: 1.04,
      volatility: 0.25,
      weight: 5,
    }),
    PRODUCT_FAILURE: EventDefinitionSchema.default({
      baselineMultiplier: 0.96,
      volatility: 0.25,
      weight: 5,
    }),
    EARNINGS_BEAT: EventDefinitionSchema.default({
      baselineMultiplier: 1.05,
      volatility: 0.25,
      weight: 1,
    }),
    EARNINGS_MISS: EventDefinitionSchema.default({
      baselineMultiplier: 0.95,
      volatility: 0.25,
      weight: 1,
    }),
  })
  .default({})
  .refine((events) => Object.values(events).some((event) => event.weight > 0), {
    message: 'at least one event type must have a positive weight',
  });
export type StockMarketEventsConfig = z.infer<typeof StockMarketEventsConfigSchema>;

export const StockMarketConfigSchema = z
  .object({
    events: StockMarketEventsConfigSchema,
    startingCash: z.number().positive().default(10000),
    /** Omitted (the default): drawn uniformly at random per match — see game.ts's
     * `resolveStartingStockPrice` for the range and the `minimumStockPrice` clamp. Give an
     * explicit value here to pin every match to the same starting price instead. */
    startingStockPrice: z.number().positive().optional(),
    rounds: z.number().int().min(1).max(10000).default(100),
    /** Fraction of trade value charged on every executed BUY/SELL (0.001 = 0.10%). */
    transactionFee: z.number().min(0).max(1).default(0.001),
    priceHistoryLength: z.number().int().min(1).max(500).default(20),
    randomShock: z
      .object({
        min: z.number().default(-0.02),
        max: z.number().default(0.02),
      })
      .default({ min: -0.02, max: 0.02 })
      .refine((shock) => shock.min <= shock.max, {
        message: 'randomShock.min must be <= randomShock.max',
        path: ['max'],
      }),
    /** Coefficient in `game.ts`'s square-root impact model: a round's price impact from trading
     * is `sign(netDemand) * marketImpactFactor * sqrt(|netDemand|)` (shares), not linear in
     * netDemand — real order-flow impact has diminishing marginal effect as trade size grows (the
     * "square-root law" practitioners use), so this avoids a linear model's runaway feedback risk
     * (bigger trade -> bigger netDemand -> bigger impact -> even-bigger next trade) when a
     * bot's own position (and so its trade sizing, if proportional to portfolio value) is
     * growing.
     *
     * To calibrate for a target liquidity/volatility profile: `marketImpactFactor = k * sigma /
     * sqrt(ADV)`, where `sigma` is the symbol's typical daily return volatility (dimensionless,
     * e.g. 0.02), `ADV` is its average daily volume in shares, and `k` (~1 as a reference point)
     * is how much of a typical day's volatility should be realized by net demand equal to a full
     * day's ADV. The default below (rounded from 0.02/sqrt(200) ≈ 0.001414) approximately
     * reproduces the platform's original linear-model impact at its own implicit reference scale
     * (netDemand = ADV = 200 shares, sigma = 0.02, k = 1), while scaling more gently below that
     * point and less punishingly above it than the old linear model did. */
    marketImpactFactor: z.number().min(0).default(0.0014),
    meanReversionFactor: z.number().min(0).default(0.05),
    minimumStockPrice: z.number().positive().default(0.01),
  })
  .refine(
    (config) =>
      config.startingStockPrice === undefined ||
      config.minimumStockPrice <= config.startingStockPrice,
    {
      message: 'minimumStockPrice must be <= startingStockPrice',
      path: ['minimumStockPrice'],
    },
  );
export type StockMarketConfig = z.infer<typeof StockMarketConfigSchema>;

/**
 * A bot never learns an event's numeric effect from any channel: `config.events`'s
 * `baselineMultiplier`/`volatility` are stripped from its own `init` payload
 * (`stockMarket.redactConfigForBots` in game.ts, only `weight` survives), and the *observation*
 * it receives each round only ever carries `type`/`description`, never the multiplier
 * (docs/adr/0004-deterministic-randomness.md's "never expose the numeric effect through the
 * observation channel" rule, mirrored in `getObservation` in game.ts). A bot that wants to trade
 * on an event's effect has to infer it empirically from price history.
 */
export interface StockMarketEvent {
  type: StockMarketEventType;
  description: string;
}

export const StockMarketActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('BUY'), quantity: z.number().int().positive() }),
  z.object({ action: z.literal('SELL'), quantity: z.number().int().positive() }),
  z.object({ action: z.literal('HOLD') }).strict(),
]);
export type StockMarketAction = z.infer<typeof StockMarketActionSchema>;

export interface StockMarketVolume {
  sharesBought: number;
  sharesSold: number;
  netDemand: number;
}

/**
 * What a bot sees each round — dollar amounts throughout (never the internal integer-cents
 * representation `StockMarketState` actually uses); the hidden fundamental value never appears
 * here at all. `market.lastRoundVolume` is `null` only for round 0, before any round has traded.
 */
export interface StockMarketObservation {
  round: number;
  totalRounds: number;
  portfolio: {
    cash: number;
    shares: number;
    value: number;
  };
  market: {
    price: number;
    priceHistory: number[];
    lastRoundVolume: StockMarketVolume | null;
  };
  event: StockMarketEvent;
}

/** A single participant's cash/shares — the engine's authoritative accounting, in integer
 * cents (never floats) so BUY/SELL/fee arithmetic never drifts (see `game.ts`'s money helpers). */
export interface StockMarketPortfolio {
  cashCents: number;
  shares: number;
}

export interface StockMarketState {
  participantIds: string[];
  config: StockMarketConfig;
  /** 0-based; the round about to be played (already reflected in `priceCents`/`currentEvent`). */
  round: number;
  priceCents: number;
  /** The actual starting price this match used — set once, at `initialize`, from
   * `config.startingStockPrice` when given, or a random draw when omitted (see game.ts's
   * `resolveStartingStockPrice`). `config.startingStockPrice` itself may be `undefined`, so this
   * is what `getResult` reports rather than reading the config field directly. */
  startingStockPriceCents: number;
  /** Hidden simulated intrinsic value, in dollars (never cents — never serialized to a bot, so
   * it doesn't need the same fixed-point discipline as anything bots can observe or trade at). */
  fundamentalValue: number;
  /** Each event type's actual, match-specific multiplier — expressed as a ratio against its own
   * `baselineMultiplier` (1.0 = exactly baseline). Drawn once per match, per type, at
   * `initialize()` (within `[1 - volatility, 1 + volatility]`), then nudged by a small bounded
   * random step every time that type is drawn — including its very first draw — so the value
   * keeps wandering within that same corridor for the rest of the match (`game.ts`'s
   * `driftEffectRatio`) — never serialized to a bot; see `EventDefinitionSchema` above for why. */
  eventEffectRatios: Record<StockMarketEventType, number>;
  /** Trailing window only (bounded to `config.priceHistoryLength`), newest last — §10 is explicit
   * that bots see recent history, not the full match, so state never grows past that window. */
  priceHistoryCents: number[];
  currentEvent: StockMarketEvent;
  /** The most recently resolved round's aggregate trading volume; `null` before round 0 resolves. */
  lastRoundVolume: StockMarketVolume | null;
  portfolios: Map<string, StockMarketPortfolio>;
}

export interface StockMarketResult {
  participantIds: string[];
  /** Final portfolio value per participant, in dollars. */
  scores: Record<string, number>;
  cash: Record<string, number>;
  shares: Record<string, number>;
  startingStockPrice: number;
  finalStockPrice: number;
  roundsPlayed: number;
  /** `null` when the top score is shared by more than one participant. */
  winnerId: string | null;
}
