import type { MarketDataProvider } from '@thunderdome/market-data';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Securities: identity, tickers, and lifecycle (spec §12)
//
// A security's `id` is its permanent identity — stable and never reused, even across a ticker
// change or corporate restructuring ("ticker changes should not create a new security"). Its
// ticker/name/lifecycle state are point-in-time facts, not fixed fields, so they're recorded as
// a chronological history in `lifecycle` rather than mutated in place. This is deliberately the
// same "dated records, resolved as-of a timestamp" idiom used throughout this project's research
// system — reimplemented independently here, not imported, since this game must not depend on
// any research package (research is a bot concern, not a market-simulation concern).
// ---------------------------------------------------------------------------

export const ASSET_TYPES = ['equity', 'index'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const SECURITY_LIFECYCLE_STATES = [
  'not-listed',
  'ipo',
  'trading',
  'acquired',
  'merged',
  'delisted',
  'bankrupt',
] as const;
export type SecurityLifecycleState = (typeof SECURITY_LIFECYCLE_STATES)[number];

/** An ISO calendar date (yyyy-mm-dd) — the trading calendar's own date granularity. Plain string
 * comparison (`<`/`>=`) is chronologically correct for these without parsing, since they're
 * always zero-padded and in the same format. */
export type CalendarDate = string;

const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const CalendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE_REGEX, 'must be an ISO calendar date (yyyy-mm-dd)');

/** One dated fact about a security's ticker/name/lifecycle state — the unit `lifecycle` is built
 * from. A bot must only ever see the record in effect as of a given date, never a later one (see
 * `market/security.ts`'s `resolveSecurityAsOf`). */
export const SecurityLifecycleRecordSchema = z
  .object({
    effectiveDate: CalendarDateSchema,
    state: z.enum(SECURITY_LIFECYCLE_STATES),
    ticker: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
export type SecurityLifecycleRecord = z.infer<typeof SecurityLifecycleRecordSchema>;

const BaseSecuritySchema = z.object({
  id: z.string().min(1),
  assetType: z.enum(ASSET_TYPES),
  /** Chronological; must be non-empty (a security must be known as *something* to exist at
   * all) and sorted by strictly increasing `effectiveDate` — see the `superRefine` below. */
  lifecycle: z.array(SecurityLifecycleRecordSchema).min(1),
});

export const SecuritySchema = BaseSecuritySchema.strict().superRefine((security, ctx) => {
  for (let i = 1; i < security.lifecycle.length; i++) {
    const previous = security.lifecycle[i - 1];
    const current = security.lifecycle[i];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.effectiveDate >= current.effectiveDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lifecycle', i, 'effectiveDate'],
        message: `lifecycle must be sorted by strictly increasing effectiveDate (index ${String(i - 1)} "${previous.effectiveDate}" is not before index ${String(i)} "${current.effectiveDate}")`,
      });
    }
  }
});
export type Security = z.infer<typeof SecuritySchema>;

// ---------------------------------------------------------------------------
// Portfolio & money (spec §29/§30, carried forward from stock-market-3's proven accounting —
// see src/portfolio/accounting.ts). Keyed by ticker (the same string `marketDataUniverse`/
// `historicalPrices`/`corporateActions` all use) rather than a resolved `Security.id` — the
// original intent was the latter (stable across a ticker change/rename), but no full security
// registry is wired into config yet (see `Security` above), so this stays consistent with the
// pragmatic ticker-keyed convention every other module in this game already uses. Revisit once
// that registry lands for real.
// ---------------------------------------------------------------------------

/** `SELL` both closes/reduces a long AND opens/adds to a short (when `config.risk.allowShortSelling`)
 * — one signed-position model, same convention as stock-market-2/3, rather than a separate SHORT
 * side. */
export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export interface Position {
  shares: number;
  averageEntryPriceCents: number;
  realizedPnlCents: number;
}

export interface PortfolioAccount {
  cashCents: number;
  positions: Map<string, Position>;
}

// ---------------------------------------------------------------------------
// Risk & financing (spec §37/§38, carried forward from stock-market-3's proven margin math — see
// `portfolio/accounting.ts`'s buying-power/maintenance functions, `portfolio/borrow.ts`, and
// `portfolio/liquidation.ts`). `allowShortSelling` is really "is this a margin/short account
// (true) or a plain cash account (false)" — when it's off, execution stays exactly Phase 17's
// long-only/cash-only behavior (an order can never take cash or a position negative); when it's
// on, buying power/margin/borrow/forced-liquidation all engage (see `execution/orders.ts`).
//
// One deliberate simplification vs. stock-market-3: `borrowableShares`/`borrowFeeAnnualized` are
// static, organizer-declared numbers, not dynamically scaled by aggregate short interest across
// every participant relative to shares outstanding — this game has no `sharesOutstanding`/
// fundamentals model to scale against (unlike stock-market-3's simulated companies), and cross-
// participant short-interest aggregation is a meaningfully bigger feature than a starter
// risk/financing phase needs.
// ---------------------------------------------------------------------------

export const RiskConfigSchema = z
  .object({
    /** Off by default — unlike stock-market-3, this game defaults to the simpler cash-account
     * model; set to `true` for a match that wants margin/short-selling available. */
    allowShortSelling: z.boolean().default(false),
    /** Per-ticker borrowable-share cap (spec §37) — static for the whole match; see the section
     * doc comment above for why this isn't dynamically scaled. */
    borrowableShares: z.number().nonnegative().default(1000),
    borrowFeeAnnualized: z.number().min(0).default(0.03),
    /** Reg-T-style: total gross position value across ALL tickers may not exceed equity /
     * initialMarginRatio (spec §38 — portfolio-level, not per-ticker). */
    initialMarginRatio: z.number().min(0.01).max(1).default(0.5),
    maintenanceMarginRatio: z.number().min(0.01).max(1).default(0.3),
  })
  .strict()
  .refine((risk) => risk.maintenanceMarginRatio <= risk.initialMarginRatio, {
    message: 'maintenanceMarginRatio must be <= initialMarginRatio',
    path: ['maintenanceMarginRatio'],
  });
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

/** Per-participant risk/financing history, accumulated across the match (spec §38) — not derived
 * from `PortfolioAccount` alone, since a margin call or forced liquidation is an EVENT (it
 * happened this round), not a durable property of the current portfolio the way `cashCents` is. */
export interface RiskStats {
  borrowFeesPaidCents: number;
  marginCalls: number;
  forcedLiquidations: number;
}

// ---------------------------------------------------------------------------
// Orders & fills (spec §29/§30 — execution deliberately has no order book/matching engine, per
// this game's manifest: every participant fills independently against the real historical tape,
// never against another participant's order, so there's no cross-participant matching to do).
// An order is evaluated ONLY against the round it's submitted for — there is no resting/GTC order
// that persists into a later round; a bot that wants another chance simply resubmits.
// ---------------------------------------------------------------------------

export const OrderKindSchema = z.enum(['MARKET', 'LIMIT']);
export type OrderKind = z.infer<typeof OrderKindSchema>;

/** A LIMIT order needs a `limitPrice`; a MARKET order doesn't (and fills at that day's close
 * regardless of one, so accepting one would be misleading) — hence the discriminated union
 * rather than one shape with an optional field. */
export const OrderRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MARKET'),
    ticker: z.string().min(1),
    side: OrderSideSchema,
    quantity: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('LIMIT'),
    ticker: z.string().min(1),
    side: OrderSideSchema,
    quantity: z.number().int().positive(),
    limitPrice: z.number().positive(),
  }),
]);
export type OrderRequest = z.infer<typeof OrderRequestSchema>;

/** What actually happened to one order at resolution (spec §30) — `filledQuantity` may be less
 * than `requestedQuantity` (this phase caps a BUY to what cash affords and a SELL to shares
 * actually held, rather than rejecting the whole order), and may be `0` (no cash/shares
 * available, a LIMIT that never crossed, or no bar for `ticker` that day — see
 * `execution/orders.ts`'s `resolveOrdersForPortfolio`). Always reported, even a `0`-fill, so a
 * bot can tell "I asked and nothing happened" apart from "I never asked." */
export interface Fill {
  ticker: string;
  side: OrderSide;
  kind: OrderKind;
  requestedQuantity: number;
  filledQuantity: number;
  priceCents: number;
  feeCents: number;
}

// ---------------------------------------------------------------------------
// Historical market data (spec §10 — historical replay's daily bars, config-embedded per the
// project's rule that everything a game needs must flow through `parseConfig`, not a side-channel
// fetch/file convention). Keyed by ticker (the same string `marketDataUniverse` declares), not a
// resolved `Security.id` — this phase doesn't yet wire a full security registry into config (see
// `market/security.ts`'s docstring); that lands once ticker changes/delistings need it for real.
// ---------------------------------------------------------------------------

/** One trading day's OHLCV bar. Prices are plain dollars (not cents) here — this is
 * organizer-authored market data, not portfolio accounting, so it stays in the units a historical
 * data source would naturally hand you; `money.ts`'s `toCents` converts at the point a price
 * actually enters portfolio math (e.g. a fill). */
export const DailyBarSchema = z
  .object({
    date: CalendarDateSchema,
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().nonnegative(),
  })
  .strict()
  .superRefine((bar, ctx) => {
    if (bar.high < bar.low) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['high'], message: 'high must be >= low' });
    }
    if (bar.high < bar.open || bar.high < bar.close) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['high'],
        message: 'high must be >= both open and close',
      });
    }
    if (bar.low > bar.open || bar.low > bar.close) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['low'],
        message: 'low must be <= both open and close',
      });
    }
  });
export type DailyBar = z.infer<typeof DailyBarSchema>;

/** One security's full bar series, organizer-supplied — non-empty and sorted by strictly
 * increasing `date` (same "dated records, chronological, no duplicates" discipline as
 * `Security.lifecycle` above). May, and generally should, extend earlier than the match's own
 * `startDate` — that leading portion is exactly what `historicalContextDays` warmup is drawn
 * from (spec §10), not just days played out during the match itself. */
const HistoricalPriceSeriesSchema = z.array(DailyBarSchema).min(1);

// ---------------------------------------------------------------------------
// Corporate actions (spec §40 — carried forward from stock-market-3's proven mechanics, but
// organizer-declared historical fact rather than randomly triggered: this game replays real
// history, it doesn't simulate one). Every action names the `ticker` it applies to, the `date`
// it takes mechanical effect (a split rescales price/positions; a dividend pays cash), and,
// for ACQUISITION/DELISTING only, an earlier `announcedDate` — real M&A/delisting announcements
// always give advance notice before the deal actually closes, and that notice is itself public
// (spec §40/§42's "announced the round it becomes public knowledge"). Dividends/splits/buybacks
// are conventionally announced and effective the same day in this simplified model, matching
// stock-market-3 (see `market/corporateActions.ts`'s `visibleCorporateActions`).
//
// Amounts are dollars, matching `DailyBar` above — never cents (that conversion happens only at
// the portfolio-accounting boundary).
// ---------------------------------------------------------------------------

export const CORPORATE_ACTION_TYPES = [
  'CASH_DIVIDEND',
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'BUYBACK',
  'ACQUISITION',
  'DELISTING',
] as const;
export type CorporateActionType = (typeof CORPORATE_ACTION_TYPES)[number];

const CorporateActionBaseFields = {
  ticker: z.string().min(1),
  date: CalendarDateSchema,
  /** ACQUISITION/DELISTING only in practice — see the section doc comment above. Structurally
   * allowed on every type for schema simplicity, but meaningless (and unused) elsewhere. */
  announcedDate: CalendarDateSchema.optional(),
};

const CorporateActionUnion = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CASH_DIVIDEND'),
    ...CorporateActionBaseFields,
    perShare: z.number().positive(),
  }),
  z.object({
    type: z.literal('STOCK_SPLIT'),
    ...CorporateActionBaseFields,
    fromShares: z.number().int().positive(),
    toShares: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('REVERSE_SPLIT'),
    ...CorporateActionBaseFields,
    fromShares: z.number().int().positive(),
    toShares: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('BUYBACK'),
    ...CorporateActionBaseFields,
    sharesRepurchased: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('ACQUISITION'),
    ...CorporateActionBaseFields,
    cashPerShare: z.number().positive(),
  }),
  z.object({
    type: z.literal('DELISTING'),
    ...CorporateActionBaseFields,
    reason: z.string().min(1),
  }),
]);

export const CorporateActionSchema = CorporateActionUnion.superRefine((action, ctx) => {
  if (action.announcedDate !== undefined && action.announcedDate > action.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['announcedDate'],
      message: 'announcedDate must be at or before date',
    });
  }
  if (action.type === 'STOCK_SPLIT' && action.toShares <= action.fromShares) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toShares'],
      message: 'a STOCK_SPLIT must increase share count: toShares must be > fromShares',
    });
  }
  if (action.type === 'REVERSE_SPLIT' && action.fromShares <= action.toShares) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toShares'],
      message: 'a REVERSE_SPLIT must decrease share count: fromShares must be > toShares',
    });
  }
});
export type CorporateAction = z.infer<typeof CorporateActionSchema>;

// ---------------------------------------------------------------------------
// Research boundary (spec's research-boundary requirement — non-negotiable #2/#11: this package
// must stay completely unaware of any bot, and equally unaware of any *research*, that might
// eventually consume/produce it). A `ResearchEntry.payload` is delivered exactly as given, with
// no schema of its own, no validation of its shape, and no interpretation whatsoever — this game
// is a dumb pipe from `researchTimeline` to a bot's observation, on a delay gated by `date`, and
// nothing more.
//
// This is deliberately NOT `@thunderdome/research-core`'s own `ResearchSnapshot` type, even
// though that's the shape a real match would put in `payload` — importing it would couple this
// market-simulation package to a specific research representation, when the whole point of an
// opaque boundary is that this game never needs to know research exists as a concept, let alone
// which package models it. A real organizer builds each `payload` by calling that package's
// `createResearchSnapshot(dataset, timestamp)` themselves, entirely outside this game, and hands
// the resulting JSON straight through here.
// ---------------------------------------------------------------------------

export const ResearchEntrySchema = z
  .object({
    /** When this became knowable — gates delivery the same way every other dated record in this
     * game does (see `research/timeline.ts`'s `researchAsOf`). Not necessarily a trading day. */
    date: CalendarDateSchema,
    /** Completely opaque — see the section doc comment above. `unknown`, not `z.record(...)` or
     * similar, because there is deliberately no schema to enforce here at all. */
    payload: z.unknown(),
  })
  .strict();
export type ResearchEntry = z.infer<typeof ResearchEntrySchema>;

/** Sorted by strictly increasing `date`, no duplicates — same "dated records, chronological"
 * discipline as `Security.lifecycle`/`historicalPrices` above, so `researchAsOf`'s "last record at
 * or before this date" resolution is well-defined. */
const ResearchTimelineSchema = z.array(ResearchEntrySchema).superRefine((timeline, ctx) => {
  for (let i = 1; i < timeline.length; i++) {
    const previous = timeline[i - 1];
    const current = timeline[i];
    if (previous !== undefined && current !== undefined && previous.date >= current.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'date'],
        message: `researchTimeline must be sorted by strictly increasing date (index ${String(i - 1)} "${previous.date}" is not before index ${String(i)} "${current.date}")`,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Market data mode — purely a label. `historicalPrices` below holds a match's whole declared
// price series either way; nothing about how it's read, replayed, split-adjusted, or traded
// against differs by mode (spec §45's synthetic-mode requirement, satisfied the same way this
// game already satisfies "historical": supply the bars, the game/bots use whatever's supplied,
// with no procedural price-generation engine of its own — that's a deliberate difference from
// stock-market-3, which has one). `marketDataMode` exists only so a bot, a replay viewer, or a
// results dashboard can tell which kind of match it's looking at without out-of-band context.
// ---------------------------------------------------------------------------

export const MARKET_DATA_MODES = ['historical', 'synthetic'] as const;
export type MarketDataMode = (typeof MARKET_DATA_MODES)[number];
export const MarketDataModeSchema = z.enum(MARKET_DATA_MODES);

// ---------------------------------------------------------------------------
// Market dataset reference (roadmap Phase 1 — see docs/adr/0010-sqlite-market-data-store.md).
// An ALTERNATIVE to declaring `historicalPrices`/`corporateActions` inline: a match may instead
// point at a published, versioned dataset in a `@thunderdome/market-data` SQLite store, so a
// competition stays reproducible against the exact dataset version it ran with even after that
// dataset is later corrected (a correction publishes a new version; it never mutates an existing
// one). The two are mutually exclusive (enforced below) — inline fields remain fully supported so
// every existing match config keeps working unchanged; this is additive, not a replacement.
// ---------------------------------------------------------------------------

export const MarketDatasetRefSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    /** Directory containing `<id>.sqlite`. Not something a match organizer typically hand-authors
     * inline — resolved by whatever builds `configRaw` (e.g. a CLI default, mirroring
     * `tournament-store`'s own `defaultStoreDir` convention) and merged in before `parseConfig`
     * runs, so `parseConfig`/`initialize` themselves stay pure functions of their own `raw`/
     * `config` input. Stripped from what a bot ever sees — see `redactConfigForBots` below. */
    storeDir: z.string().min(1),
  })
  .strict();
export type MarketDatasetRef = z.infer<typeof MarketDatasetRefSchema>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Base match configuration (spec §9-§11). Risk/financing/execution sub-configs are added in
 * later phases; this covers the trading-calendar window, decision timing, starting capital, and
 * the declared market-data universe.
 *
 * `marketDataUniverse` is declared once per match (a list of tickers, resolved to stable
 * `Security.id`s once the match's security registry is known — see
 * `market/security.ts`'s `resolveMarketDataUniverse`), applying uniformly to every participant.
 * The source spec frames this as something each bot individually declares, but this engine's
 * config always flows organizer -> game, never bot -> game (`GameDefinition.parseConfig` has no
 * per-participant input) — every participant in a shared-market match observing the same
 * declared universe is the closest fit to the spec's intent within that existing architecture.
 */
const BaseStockMarket4ConfigSchema = z.object({
  startDate: CalendarDateSchema,
  endDate: CalendarDateSchema,
  /** "HH:MM", 24-hour, interpreted in `decisionTimezone`. */
  decisionTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'must be "HH:MM"')
    .default('12:00'),
  decisionTimezone: z.string().min(1).default('America/New_York'),
  /** Trading days of historical context a bot receives before its first decision (spec §10). */
  historicalContextDays: z.number().int().positive().default(250),
  startingCapital: z.number().positive().default(100_000),
  marketDataUniverse: z.array(z.string().min(1)).min(1),
  /** Non-trading dates within (or spanning) the match window besides weekends — organizer-
   * declared rather than a baked-in exchange calendar, since an arbitrary historical date range
   * could span any exchange's holiday schedule for any year (see `market/calendar.ts`). */
  tradingHolidays: z.array(CalendarDateSchema).default([]),
  /** Every ticker in `marketDataUniverse` must have an entry here (checked below) — the actual
   * bars `market/historicalPrices.ts` replays day by day, whether that's real historical data or
   * an organizer-supplied synthetic series (see `marketDataMode` below and the Market data mode
   * section above) — this field, and everything that reads it, is identical either way.
   *
   * Defaults to `{}` because a match may instead declare `marketDataset` below and source its
   * data from a `@thunderdome/market-data` store — the two are mutually exclusive (checked
   * below), and exactly one must be provided. */
  historicalPrices: z.record(z.string().min(1), HistoricalPriceSeriesSchema).default({}),
  /** Which kind of series `historicalPrices` (or `marketDataset`) actually holds for this
   * match — a label only (see the Market data mode section above); defaults to `'historical'`
   * since that's this game's original, primary mode. */
  marketDataMode: MarketDataModeSchema.default('historical'),
  /** Every action's `ticker` must be in `marketDataUniverse` (checked below) — real historical
   * dividends/splits/reverse-splits/buybacks/acquisitions/delistings `market/corporateActions.ts`
   * applies day by day alongside `historicalPrices`. Ignored when `marketDataset` is set — see
   * that field's own doc comment. */
  corporateActions: z.array(CorporateActionSchema).default([]),
  /** Alternative to `historicalPrices`/`corporateActions`: sources this match's market data from
   * a published, versioned `@thunderdome/market-data` SQLite dataset instead of inline config —
   * see the Market dataset reference section above. Mutually exclusive with the inline fields
   * (checked below). */
  marketDataset: MarketDatasetRefSchema.optional(),
  /** Fraction of trade notional charged as a fee on every fill (spec §29), same convention as
   * stock-market-3. */
  transactionFeeRate: z.number().min(0).max(1).default(0.001),
  risk: RiskConfigSchema.default({}),
  /** Organizer-supplied, opaque research payloads, delivered one at a time as each becomes
   * knowable — see the Research boundary section above and `research/timeline.ts`. */
  researchTimeline: ResearchTimelineSchema.default([]),
  /** Optional comparison yardstick for `StockMarket4Result.benchmarkReturn` (spec §22) — a
   * buy-and-hold return computed from this ticker's own `historicalPrices` entry (checked below).
   * Deliberately doesn't have to be in `marketDataUniverse`: a benchmark (e.g. a broad index) is
   * something a bot's performance is measured against, not necessarily something it can trade. */
  benchmarkTicker: z.string().min(1).optional(),
  /** Annualized, for `PerformanceMetrics.sharpeRatio` (spec §22) — `0` (the common simplifying
   * default) unless a match wants to compare against an actual risk-free rate for its period. */
  riskFreeRate: z.number().default(0),
});

export const StockMarket4ConfigSchema = BaseStockMarket4ConfigSchema.strict()
  .refine((config) => config.startDate < config.endDate, {
    message: 'startDate must be before endDate',
    path: ['endDate'],
  })
  .refine(
    (config) => new Set(config.marketDataUniverse).size === config.marketDataUniverse.length,
    {
      message: 'marketDataUniverse must not contain duplicate tickers',
      path: ['marketDataUniverse'],
    },
  )
  .superRefine((config, ctx) => {
    // Market dataset reference vs. inline historicalPrices/corporateActions: mutually exclusive,
    // and exactly one must be provided. When `marketDataset` is set, ticker-coverage/ordering
    // checks against the ACTUAL dataset can't happen here — this is a pure, in-memory Zod schema
    // with no filesystem/database access (the same "keep I/O out of schema validation" principle
    // `@thunderdome/research-core` follows for its own dataset cross-referencing) — so that
    // coverage check happens once, at `initialize()` time instead (see game.ts).
    if (config.marketDataset !== undefined) {
      if (Object.keys(config.historicalPrices).length > 0 || config.corporateActions.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['marketDataset'],
          message:
            'marketDataset and inline historicalPrices/corporateActions are mutually exclusive',
        });
      }
      return;
    }
    if (Object.keys(config.historicalPrices).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['historicalPrices'],
        message: 'either historicalPrices or marketDataset must be provided',
      });
    }
    for (const ticker of config.marketDataUniverse) {
      const series = config.historicalPrices[ticker];
      if (series === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['historicalPrices', ticker],
          message: `marketDataUniverse declares "${ticker}", but historicalPrices has no entry for it`,
        });
        continue;
      }
      for (let i = 1; i < series.length; i++) {
        const previous = series[i - 1];
        const current = series[i];
        if (previous !== undefined && current !== undefined && previous.date >= current.date) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['historicalPrices', ticker, i, 'date'],
            message: `historicalPrices["${ticker}"] must be sorted by strictly increasing date (index ${String(i - 1)} "${previous.date}" is not before index ${String(i)} "${current.date}")`,
          });
        }
      }
    }
    const universe = new Set(config.marketDataUniverse);
    config.corporateActions.forEach((action, index) => {
      if (!universe.has(action.ticker)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['corporateActions', index, 'ticker'],
          message: `corporateActions[${String(index)}] names "${action.ticker}", which is not in marketDataUniverse`,
        });
      }
    });
    if (
      config.benchmarkTicker !== undefined &&
      config.historicalPrices[config.benchmarkTicker] === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['benchmarkTicker'],
        message: `benchmarkTicker "${config.benchmarkTicker}" has no entry in historicalPrices`,
      });
    }
  });
export type StockMarket4Config = z.infer<typeof StockMarket4ConfigSchema>;

/** A participant's whole submission for one round (spec §30): every order is decided against the
 * same one observation snapshot, and may span any mix of tickers. */
export const StockMarket4ActionSchema = z.object({
  orders: z.array(OrderRequestSchema).max(50),
});
export type StockMarket4Action = z.infer<typeof StockMarket4ActionSchema>;

export interface StockMarket4State {
  participantIds: string[];
  config: StockMarket4Config;
  /** Resolved once in `initialize()` from `config.marketDataset` when present, `null` when this
   * match uses inline `historicalPrices`/`corporateActions` instead — see `game.ts`'s
   * `securitiesAsOf`. Not serializable (a live SQLite handle) — consistent with every other `Map`
   * already in this state; there is no save/resume mechanism for `StockMarket4State` yet (see
   * docs/adr/0005-observation-vs-game-state.md's own consequences section). */
  marketData: MarketDataProvider | null;
  round: number;
  portfolios: Map<string, PortfolioAccount>;
  /** Fills from the most recently resolved round, per participant — empty before that
   * participant's first resolve. Surfaced in the NEXT `getObservation` as `fills` (see below), so
   * a bot can see the concrete outcome of the action it just submitted before deciding its next
   * one. Not accumulated across rounds; each resolve replaces it, it doesn't append. */
  lastFills: Map<string, Fill[]>;
  riskStats: Map<string, RiskStats>;
  /** Every participant's whole equity curve so far, oldest first (spec §22) — seeded with one
   * point at match start (before any trading) and appended once per round in `resolve()`. The
   * input `metrics/performance.ts`'s drawdown/volatility/Sharpe-ratio calculations run on. Unlike
   * `lastFills`, this DOES accumulate across rounds rather than being replaced. */
  equityHistory: Map<string, EquityPoint[]>;
}

/** One security's market data as of the observing participant's current decision date —
 * `history`'s trailing window (capped at `config.historicalContextDays`) and `bar` are both
 * filtered to `date <= state`'s current trading date, so a bot can never see a future bar (spec
 * §10) — see `market/historicalPrices.ts`'s `historicalBarsAsOf`. Both are also split-adjusted
 * (never dividend-adjusted) against every STOCK_SPLIT/REVERSE_SPLIT at or before the current
 * date, so a split never looks like a price cliff — see `market/corporateActions.ts`'s
 * `splitAdjustedBarsAsOf`, including why a split that HASN'T happened yet must never retroactively
 * adjust anything (that would leak the split's own existence backward in time). `bar` is also
 * `history`'s own last element when present; exposed separately purely for convenience (a bot
 * needing only today's close shouldn't have to index into `history` for it). `null` means a
 * genuine data gap (a trading day with no recorded bar for this ticker) — never silently carried
 * forward from a prior day. */
export interface SecurityMarketObservation {
  ticker: string;
  bar: DailyBar | null;
  history: DailyBar[];
}

// TODO: this is where a real game would add remaining per-participant fields (research, ...). See
// docs/adr/0005-observation-vs-game-state.md — getObservation, not TState, decides what a
// participant is told.
export interface StockMarket4Observation {
  round: number;
  totalRounds: number;
  opponentIds: string[];
  /** Whether `securities` below is replaying real history or an organizer-supplied synthetic
   * series (see the Market data mode section) — fixed for the whole match, purely informational. */
  marketDataMode: MarketDataMode;
  /** The real calendar date this round's decision is being made for (spec §10/§27's historical
   * replay) — `null` only past the match's last trading day, when there's no further date to
   * report. */
  date: CalendarDate | null;
  securities: SecurityMarketObservation[];
  /** Every corporate action already public as of the current date — a dividend/split/
   * reverse-split/buyback the moment it takes effect, or an acquisition/delisting from its
   * (earlier) `announcedDate`, never before (see `market/corporateActions.ts`'s
   * `visibleCorporateActions`). CASH_DIVIDEND and STOCK_SPLIT/REVERSE_SPLIT are now fully settled
   * onto `portfolio` below the moment they take effect (pure accounting math that doesn't need a
   * forced trade); BUYBACK/ACQUISITION/DELISTING remain observable fact only — forcing a position
   * closed/repurchased on one of those still has no mechanism (this phase's forced liquidation
   * only ever fires off a maintenance-margin shortfall, spec §38, never a corporate action). */
  corporateActions: CorporateAction[];
  /** The observing participant's own portfolio, marked at today's (split-adjusted) close — see
   * `execution/orders.ts`. Never another participant's; isolation is automatic here since
   * `getObservation` is already per-participant. */
  portfolio: PortfolioObservation;
  /** What happened to each order submitted for the PREVIOUS round, now that it's been resolved —
   * empty at round 0 (nothing submitted yet) and briefly empty again for a rejected/missing
   * action. See `Fill`'s own doc comment for why a `0`-filled entry is still reported. */
  fills: Fill[];
  /** The latest research payload knowable as of the current date — the most recent
   * `config.researchTimeline` entry with `date <= this observation's own date`, or `undefined` if
   * none is knowable yet (see `research/timeline.ts`'s `researchAsOf`). Completely opaque to this
   * game (see the Research boundary section in this file) — never validated, interpreted, or
   * even looked at beyond its own `date`; a bot that cares about research must know its shape
   * independently (e.g. by depending on whatever produced it, such as
   * `@thunderdome/research-core`'s `ResearchSnapshot` — this game deliberately doesn't). */
  research: unknown;
}

export interface PositionObservation {
  ticker: string;
  shares: number;
  averageEntryPriceCents: number;
  realizedPnlCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
}

/** One dated equity reading — the unit `PortfolioObservation.equityHistory` and
 * `metrics/performance.ts` are both built from. */
export interface EquityPoint {
  date: CalendarDate;
  equityCents: number;
}

export interface PortfolioObservation {
  cashCents: number;
  /** Cash plus every held position marked at today's close (spec §29) — `cashCents` alone once
   * `date` is `null` (past the match's last trading day, so there's no mark price left to use). */
  equityCents: number;
  positions: PositionObservation[];
  /** This participant's own equity curve, oldest first — one entry at match start (before any
   * trading, marked at `startingCapital`) plus one more per round resolved so far. Never another
   * participant's; see `metrics/performance.ts` for the drawdown/volatility/Sharpe-ratio
   * calculations this is the input to, and `getResult`'s own `performanceMetrics` for where those
   * are actually computed (once, at match end) rather than recomputed by every bot every round. */
  equityHistory: EquityPoint[];
  /** How much MORE gross position value could be opened right now (spec §38) — `0` whenever
   * `config.risk.allowShortSelling` is off (see `portfolio/accounting.ts`'s
   * `remainingBuyingPowerCents`), since a cash account's real spending limit is just `cashCents`
   * itself, already reported above. */
  buyingPowerCents: number;
  /** Equity must stay at or above this or the position gets force-liquidated (spec §38) — always
   * `0` when margin is off or nothing is held. */
  maintenanceRequirementCents: number;
  /** `true` iff `equityCents < maintenanceRequirementCents` right now. `resolve()` force-
   * liquidates the moment this goes true (spec §38), so it's normally `false` by the time a bot
   * observes it — seeing `true` here means even fully liquidating every position still wasn't
   * enough to cure the shortfall (e.g. cash itself is deeply negative), not a call to action a
   * bot could still prevent by trading differently. */
  belowMaintenance: boolean;
  riskStats: RiskStats;
}

/**
 * Standard portfolio-performance metrics (spec §22), computed once at match end from a
 * participant's whole `EquityPoint[]` curve — see `metrics/performance.ts`. `annualizedVolatility`
 * and `sharpeRatio` both annualize using 252 trading days/year, the same convention
 * `portfolio/borrow.ts` already uses for its daily borrow-fee rate.
 */
export interface PerformanceMetrics {
  /** Fractional return from starting capital to final equity (e.g. `0.15` = +15%). */
  totalReturn: number;
  /** Largest peak-to-trough decline across the whole equity curve, as a fraction (e.g. `0.2` =
   * -20% at the worst point) — always `>= 0`. */
  maxDrawdown: number;
  annualizedVolatility: number;
  /** `null` when volatility is 0 (a flat equity curve — e.g. no trades at all), since the ratio
   * is undefined at that point rather than meaningfully infinite or zero. */
  sharpeRatio: number | null;
}

// TODO: this is where a real game reports who won. This placeholder never has a winner — see
// getStandingOutcomes in game.ts, which always reports a draw for it. Real per-participant
// performance (`performanceMetrics` below) now exists to rank on, once the results phase decides
// how (raw return? risk-adjusted? against the benchmark?) — deliberately not decided here.
export interface StockMarket4Result {
  participantIds: string[];
  totalRounds: number;
  /** Whether this match replayed real history or an organizer-supplied synthetic series — see
   * the Market data mode section. Recorded on the result so an audit trail/results dashboard
   * never has to track it separately out of band. */
  marketDataMode: MarketDataMode;
  /** Each participant's equity as of the match's last trading day, marked at that day's
   * (split-adjusted) closes. */
  finalEquityCents: Record<string, number>;
  /** Each participant's accumulated risk/financing history over the whole match (spec §38). */
  riskStats: Record<string, RiskStats>;
  /** Each participant's standard performance metrics over the whole match — see
   * `PerformanceMetrics`'s own doc comment. */
  performanceMetrics: Record<string, PerformanceMetrics>;
  /** Buy-and-hold return of `config.benchmarkTicker` over the same first-to-last trading day this
   * match actually played, for comparison against `performanceMetrics`. `null` when no
   * `benchmarkTicker` was declared, or its series has no bar in that range to compare against. */
  benchmarkReturn: number | null;
}

// ---------------------------------------------------------------------------
// Audit trail (spec's audit-trail requirement) — `resolve()`'s `RoundEvent.data` (engine/
// match-runner.ts) is `unknown` from the engine's own perspective (ADR-0005: the engine never
// inspects a game's events, only forwards them for replay/spectator tooling), but this game gives
// it a real, documented shape rather than leaving every consumer to reverse-engineer it.
// ---------------------------------------------------------------------------

/** The `data` payload of every round's `'round-played'` event — enough detail for a replay/
 * spectator consumer to reconstruct exactly what happened without re-deriving it from a raw
 * `StockMarket4State` diff (which nothing outside this game's own maintainers should ever need
 * to touch directly — see ADR-0005's own consequences section). */
export interface RoundEventData {
  date: CalendarDate;
  /** Every fill each participant received this round — order fills AND any forced-liquidation
   * fills, in the order they were actually applied (order fills first, then any liquidation). */
  fills: Record<string, Fill[]>;
  /** Participants force-liquidated THIS round specifically — a subset of whoever's
   * `RiskStats.marginCalls` is nonzero, which also counts every prior round's margin calls. */
  marginCalledParticipantIds: string[];
  /** Every corporate action that took mechanical effect exactly this round (spec §40) — the
   * same ones `market/corporateActions.ts`'s `settleCorporateActionsForPortfolio` applied to
   * every participant's portfolio this round. */
  corporateActionsSettled: CorporateAction[];
}
