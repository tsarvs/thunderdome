import { z } from 'zod';

export const StockMarketConfigSchema = z
  .object({
    startingCash: z.number().positive().default(10000),
    startingStockPrice: z.number().positive().default(100),
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
    marketImpactFactor: z.number().min(0).default(0.0001),
    meanReversionFactor: z.number().min(0).default(0.05),
    minimumStockPrice: z.number().positive().default(0.01),
  })
  .refine((config) => config.minimumStockPrice <= config.startingStockPrice, {
    message: 'minimumStockPrice must be <= startingStockPrice',
    path: ['minimumStockPrice'],
  });
export type StockMarketConfig = z.infer<typeof StockMarketConfigSchema>;

/**
 * Every event's fundamental-value effect (§12/§15 of the design doc) is a hard-coded property of
 * the event type itself, not part of the config — bots are told the event's `type`/`description`
 * but never this multiplier (docs/adr/0004-deterministic-randomness.md's "never expose the
 * numeric effect" rule, mirrored in `getObservation` below).
 */
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
  /** Hidden simulated intrinsic value, in dollars (never cents — never serialized to a bot, so
   * it doesn't need the same fixed-point discipline as anything bots can observe or trade at). */
  fundamentalValue: number;
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
