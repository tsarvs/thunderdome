/**
 * Adaptive Market Maker — Stock Market 2 — a from-scratch design, not another variant of the
 * `tominator-t7x` lineage's "learn a signal, place a lump-sum directional bet" shape. It never
 * submits a MARKET order except its two risk backstops; every round it rests a two-sided DAY
 * LIMIT quote instead, sized as a real fraction of portfolio value.
 *
 * The design rests on one structural fact about this exchange (games/stock-market-2/src/exchange/
 * matchingEngine.ts): a MARKET order crosses *any* resting player LIMIT order unconditionally
 * (`bid.limitPriceCents === null || ask.limitPriceCents === null || ...`), and player-vs-player
 * matching (spec §19 step 14) always resolves before synthetic liquidity (step 15). Since most of
 * this roster's other bots trade via MARKET orders, a resting limit order gets first crack at
 * their flow regardless of how it compares to the synthetic book — there's no need to undercut
 * toward unprofitability to get filled; the real question is only "is this spread wide enough to
 * be worth it," not "am I the tightest quote in the book."
 *
 * Five pieces — the first version (still true) plus a second pass adding the standard real-world
 * defense against adverse selection, once measured testing against this exact roster showed a
 * purely symmetric/signal-only quote getting picked off by other bots' *informed* flow (momentum
 * chasing a real trend, buy-and-hold's large one-time rebalance) rather than the "random noise
 * trader" flow classical market-making theory assumes:
 *
 * 1. A spread floor derived from the real `config.transactionFee` (bots receive the full,
 *    un-redacted config via `onInit`) with real margin on top — this is what makes every filled
 *    round trip profitable on its own, and it's mode-agnostic: unlike a strategy that only acts on
 *    rare discrete events (real events are ~2.6% of HISTORICAL days), spread capture earns on
 *    every single round, including the many quiet ones that punished lump-sum conviction bets on
 *    real data.
 * 2. The quote center is skewed by a directional signal: a learned event-magnitude estimate in
 *    either mode (a real event's *direction* is trustworthy — real in HISTORICAL, synthetic-but-
 *    honest in SYNTHETIC — only its magnitude needs learning), and additionally a mean-reversion
 *    fade in SYNTHETIC mode only, whose reference price is structurally mean-reverting toward its
 *    hidden fundamental value every round (`meanReversionFactor` — see market/
 *    referencePriceModel.ts). HISTORICAL mode's non-event rounds get zero *bet-driven* skew —
 *    fading a real stock's short-term deviations empirically lost more often than it won when an
 *    earlier design tried it as a real bet; this one still makes a market on those days, just a
 *    symmetric one — see point 5 for the (different, defensive rather than alpha-seeking) use of
 *    real-time flow data that HISTORICAL mode's quiet rounds *do* still get.
 * 3. Inventory is mean-reverting by construction: as a position grows, both quotes shift to
 *    encourage unwinding it and discourage adding to it, the standard market-making risk control,
 *    capped by a hard ceiling on gross position size regardless of how favorable the signal looks.
 * 4. A portfolio-level stop-loss and a proactive margin de-risk governor, both firing as urgent
 *    MARKET orders — the only MARKET orders this bot ever sends — when things go wrong regardless
 *    of what the quoting logic would otherwise do.
 * 5. Adverse-selection defenses, using only *observed* information (never a forecast, so this
 *    doesn't carry the same "bet against real data" risk point 2 avoids): the previous round's
 *    real aggregate net demand (`market.lastRoundVolume.netDemand`) skews the quote away from,
 *    and widens the spread against, whichever direction the crowd just actually traded; and a
 *    "toxic flow" streak — this bot's own position growing further in the same direction several
 *    rounds straight despite the inventory skew already leaning against it — adds extra skew
 *    *and* shrinks the size on the side that would extend the streak while boosting the size on
 *    the side that would end it. Both are real trading fundamentals (order-flow-based quote
 *    skewing and inventory-streak risk control), not features specific to this game.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Volume = { sharesBought: number; sharesSold: number; netDemand: number };

interface Observation {
  round: number;
  totalRounds: number;
  symbol: string;
  mode: 'SYNTHETIC' | 'HISTORICAL';
  portfolio: {
    cash: number;
    shares: number;
    value: number;
    availableCash: number;
    availableShares: number;
    buyingPower: number;
    marginUsed: number;
    maintenanceRequirement: number;
    realizedPnl: number;
    bankrupt: boolean;
  };
  market: {
    date: string;
    lastClose: number;
    bid: number | null;
    ask: number | null;
    bidSize: number;
    askSize: number;
    priceHistory: Candle[];
    lastRoundVolume: Volume | null;
  };
  event: { type: string; description: string };
}

type Order = { kind: 'MARKET'; side: 'BUY' | 'SELL'; quantity: number } | LimitOrder;
type LimitOrder = { kind: 'LIMIT'; side: 'BUY' | 'SELL'; quantity: number; limitPrice: number; timeInForce: 'DAY' | 'GTC' };
type Action = { orders: Order[] };

interface Config {
  transactionFee: number;
  risk: {
    allowShortSelling: boolean;
    borrowFeeAnnualized: number;
  };
}

const NO_NEWS = 'NO_NEWS';
const EARNINGS_TYPES = new Set(['EARNINGS_BEAT', 'EARNINGS_MISS']);

// Every other type's direction is real, trustworthy data — never actually hidden — so hardcoded
// rather than something magnitudeFor() has to (mis)learn.
const EVENT_SIGN: Partial<Record<string, 1 | -1>> = {
  POSITIVE_NEWS: 1,
  NEGATIVE_NEWS: -1,
  EARNINGS_BEAT: 1,
  EARNINGS_MISS: -1,
};

// --- Event-magnitude EMA tracking — same proven shape as the tominator lineage; there was never
// anything wrong with *this* part. ---
const MIN_OBSERVATIONS = 2;
const MIN_ALPHA = 0.2;
const CONFIDENCE_SATURATION = 40;
const BASE_MAGNITUDE_PRIOR_EARNINGS = 0.04;
const BASE_MAGNITUDE_PRIOR_NEWS = 0.025;
const MIN_MAGNITUDE_PRIOR = 0.01;
const MAX_MAGNITUDE_PRIOR = 0.08;

// --- Mean-reversion fade — SYNTHETIC mode only (see this file's doc comment, point 2). ---
const MEAN_REVERSION_WINDOW = 20;
const MAX_SIGNAL_MAGNITUDE = 0.08;

// --- Turning a signal magnitude into a *quote-center skew* (a price shift that biases which side
// fills more often, and — combined with EVENT_SIZE_BOOST below — how much bigger a position
// builds up), not a one-shot trade size the way a lump-sum bet would use. A real event gets a
// much wider ceiling than the SYNTHETIC-only mean-reversion fade: measured testing showed a small,
// uniform skew ceiling left real, externally-validated conviction (an actual event) too weak to
// build a meaningful position before the opportunity passed, while a heuristic statistical fade
// deserves to stay modest regardless. ---
const SKEW_SENSITIVITY = 0.4;
const MAX_SKEW_FRACTION_EVENT = 0.08;
const MAX_SKEW_FRACTION_MEAN_REVERSION = 0.02;
/** A real event also gets bigger quote size, not just a bigger skew — building the position fast
 * enough to matter before the fundamental value (SYNTHETIC) or the market's own real reaction
 * (HISTORICAL) has already moved on. */
const EVENT_SIZE_BOOST = 1.6;

// --- Inventory control — the standard market-making risk mechanism: the more one-sided the
// current position, the more both quotes shift to unwind it. ---
const INVENTORY_SKEW_SENSITIVITY = 0.015;
/** Hard ceiling on gross position size, as a fraction of portfolio value — never exceeded
 * regardless of how favorable the signal looks. */
const MAX_INVENTORY_FRACTION = 0.6;

// --- Order-flow imbalance — a real, observed trading fundamental, not a bet: `netDemand` is the
// previous round's actual aggregate buy/sell pressure across every participant (spec §17's
// "external buying pressure -> more aggressive bids -> price rises", generalized to *all* flow,
// not just the synthetic external kind). Unlike this bot's own price-deviation signals, this is
// direct evidence of what *other traders just did* — the single most standard adverse-selection
// defense in real market making is to skew away from (and widen against) exactly this, since flow
// that's been one-sided is the flow most likely to still be one-sided next round too. Read in
// BOTH modes — it's observed fact, not a directional forecast, so it doesn't carry the same
// "fought real data and lost" risk the old mean-reversion bet did in HISTORICAL mode. ---
const FLOW_WINDOW = 10;
const FLOW_SKEW_SENSITIVITY = 0.02;
const FLOW_WIDENING_SENSITIVITY = 1.5;

// --- Toxic-flow detection — the second standard defense: if this bot's own inventory keeps
// growing further in the same direction round after round despite the inventory skew above
// already leaning against it, that streak itself is evidence of persistent, one-directional
// (probably informed) flow overwhelming a passive quote — not just noise. Each additional
// consecutive round adds extra skew *and* asymmetric sizing (smaller size adding to the streak's
// own direction, larger size unwinding it) on top of the ordinary inventory/flow skew. ---
const TOXIC_STREAK_SKEW_PER_ROUND = 0.004;
const MAX_TOXIC_STREAK_SKEW = 0.02;
const UNWIND_SIZE_BOOST = 1.3;
const ADD_ON_SIZE_DAMPEN_PER_ROUND = 0.12;
const MIN_ADD_ON_SIZE_FRACTION = 0.25;

// --- Spread. The real edge: must exceed the real round-trip transaction-fee cost by a healthy
// margin, since a market maker captures roughly one half-spread's worth of that cost twice per
// completed round trip (once buying, once selling). Widened by realized volatility (a choppier
// market both risks adverse selection more and moves the "fair" center faster than a fixed quote
// can track) AND by order-flow imbalance (one-sided flow is itself a warning sign, regardless of
// how volatile price has actually been). ---
const MIN_HALF_SPREAD_OVER_FEE_MULTIPLE = 2.5;
const BASE_HALF_SPREAD_FRACTION = 0.003;
const VOLATILITY_WINDOW = 10;
const BASELINE_VOLATILITY = 0.02;
const MIN_SPREAD_SCALE = 1;
const MAX_SPREAD_SCALE = 4;

// --- Sizing and execution quality. ---
/** Target notional per side, as a fraction of portfolio value, before any capping below. */
const QUOTE_SIZE_FRACTION = 0.12;
const MAX_SHARE_OF_VISIBLE_DEPTH = 0.6;

// --- Margin safety. ---
const BUYING_POWER_UTILIZATION_CAP = 0.5;
const MAINTENANCE_SAFETY_MULTIPLIER = 1.5;
const DE_RISK_FRACTION = 0.5;
/** A high annualized borrow fee shrinks how large a short inventory this bot is willing to carry
 * — e.g. a 10%/year borrow fee cuts the short side's inventory ceiling by ~20%. */
const BORROW_FEE_INVENTORY_HAIRCUT_MULTIPLE = 2;
const MIN_SHORT_INVENTORY_HAIRCUT = 0.3;

// --- Portfolio-level stop-loss — the same backstop the tominator lineage validated: real
// historical data can move against a position for a genuinely sustained stretch. ---
const STOP_LOSS_DRAWDOWN = 0.15;

let config: Config | undefined;
let lastEventType: string | undefined;
let peakEquity: number | undefined;
/** The toxic-flow streak's only state: the previous round's position, and how many consecutive
 * rounds it's grown further in the same direction. */
let previousShares: number | undefined;
let inventoryStreak = 0;
const observationCounts = new Map<string, number>();
const emaLogReturns = new Map<string, number>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Folds one more realized log return into `type`'s running estimate. */
function recordObservation(type: string, logReturn: number): void {
  const count = (observationCounts.get(type) ?? 0) + 1;
  observationCounts.set(type, count);
  const alpha = Math.max(MIN_ALPHA, 1 / count);
  const previous = emaLogReturns.get(type);
  emaLogReturns.set(type, previous === undefined ? logReturn : previous + alpha * (logReturn - previous));
}

function magnitudePriorFor(type: string): number {
  return clamp(
    EARNINGS_TYPES.has(type) ? BASE_MAGNITUDE_PRIOR_EARNINGS : BASE_MAGNITUDE_PRIOR_NEWS,
    MIN_MAGNITUDE_PRIOR,
    MAX_MAGNITUDE_PRIOR,
  );
}

/** `type`'s estimated magnitude (always non-negative — direction comes separately from
 * EVENT_SIGN): starts at `magnitudePriorFor(type)` and shrinks toward the empirical estimate
 * (net of the running NO_NEWS baseline) as observations accumulate. */
function magnitudeFor(type: string): number {
  const typeCount = observationCounts.get(type) ?? 0;
  const baselineCount = observationCounts.get(NO_NEWS) ?? 0;
  const prior = magnitudePriorFor(type);
  if (typeCount < MIN_OBSERVATIONS || baselineCount < MIN_OBSERVATIONS) {
    return prior;
  }
  const baseline = emaLogReturns.get(NO_NEWS) ?? 0;
  const raw = emaLogReturns.get(type) ?? 0;
  const empiricalMagnitude = Math.abs(raw - baseline);
  const confidence = Math.min(1, typeCount / CONFIDENCE_SATURATION);
  return confidence * empiricalMagnitude + (1 - confidence) * prior;
}

/** How far `lastClose` sits from its own longer trailing average — SYNTHETIC mode only (see this
 * file's doc comment, point 2). `sign` points *back toward* the average. */
function meanReversionSignalFrom(
  history: readonly Candle[],
  lastClose: number,
): { sign: -1 | 0 | 1; magnitude: number } {
  const window = history.slice(-MEAN_REVERSION_WINDOW);
  if (window.length === 0) {
    return { sign: 0, magnitude: 0 };
  }
  const average = window.reduce((sum, candle) => sum + candle.close, 0) / window.length;
  if (average <= 0) {
    return { sign: 0, magnitude: 0 };
  }
  const deviation = (lastClose - average) / average;
  if (deviation === 0) {
    return { sign: 0, magnitude: 0 };
  }
  return { sign: deviation > 0 ? -1 : 1, magnitude: Math.min(MAX_SIGNAL_MAGNITUDE, Math.abs(deviation)) };
}

/** The realized daily-return standard deviation over the trailing window, relative to
 * `BASELINE_VOLATILITY` — 1 (no widening) in a calm, typical market. */
function realizedVolatilityScaleFrom(history: readonly Candle[]): number {
  const window = history.slice(-VOLATILITY_WINDOW);
  if (window.length < 3) {
    return 1;
  }
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    returns.push(Math.log(window[i]!.close / window[i - 1]!.close));
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const realizedVolatility = Math.sqrt(variance);
  return Math.max(1, realizedVolatility / BASELINE_VOLATILITY);
}

/** The previous round's net demand, as a fraction of typical daily volume — the real order-flow
 * imbalance signal this file's own doc comment (point 2 addendum) describes. `0` with no volume
 * data yet, or no trailing candles to estimate a typical-volume scale from. */
function orderFlowImbalanceFrom(lastRoundVolume: Volume | null, history: readonly Candle[]): number {
  if (lastRoundVolume === null || lastRoundVolume.netDemand === 0) {
    return 0;
  }
  const window = history.slice(-FLOW_WINDOW);
  if (window.length === 0) {
    return 0;
  }
  const averageVolume = window.reduce((sum, candle) => sum + candle.volume, 0) / window.length;
  if (averageVolume <= 0) {
    return 0;
  }
  return clamp(lastRoundVolume.netDemand / averageVolume, -1, 1);
}

/** Combines realized-volatility widening and order-flow-imbalance widening into one spread scale
 * — either alone can widen the spread, and they compound when both are elevated at once (a
 * choppy, one-sided market is exactly the most dangerous kind to quote a tight, static spread
 * into), capped at `MAX_SPREAD_SCALE` so a single wild round never makes the quote absurd. */
function spreadScaleFrom(history: readonly Candle[], flowImbalance: number): number {
  const volatilityScale = realizedVolatilityScaleFrom(history);
  const flowWideningScale = 1 + Math.abs(flowImbalance) * FLOW_WIDENING_SENSITIVITY;
  return clamp(volatilityScale * flowWideningScale, MIN_SPREAD_SCALE, MAX_SPREAD_SCALE);
}

/** Builds one side's quote, applying every cap: covering/reducing the opposite exposure is always
 * allowed in full; new exposure beyond flat is capped by the hard inventory ceiling, by a
 * self-imposed fraction of current buying power when margin is active (with a haircut on the
 * short side for expensive borrow), or by cash otherwise; and by a fraction of visible depth on
 * that side either way. */
function buildQuote(args: {
  side: 'BUY' | 'SELL';
  limitPrice: number;
  desiredShares: number;
  portfolio: Observation['portfolio'];
  visibleDepth: number;
  config: Config;
}): LimitOrder | undefined {
  const { side, limitPrice, desiredShares, portfolio, visibleDepth, config } = args;
  const currentShares = portfolio.shares;
  const isBuy = side === 'BUY';

  const reducingShares = isBuy ? Math.max(0, -currentShares) : Math.min(Math.max(0, currentShares), portfolio.availableShares);
  const maxInventoryShares = Math.floor((MAX_INVENTORY_FRACTION * portfolio.value) / limitPrice);
  const roomToInventoryCap = Math.max(0, maxInventoryShares - Math.abs(currentShares));

  let newExposureShares = 0;
  if (portfolio.buyingPower > 0) {
    let cap = portfolio.buyingPower * BUYING_POWER_UTILIZATION_CAP - portfolio.marginUsed;
    if (!isBuy) {
      const haircut = clamp(
        1 - config.risk.borrowFeeAnnualized * BORROW_FEE_INVENTORY_HAIRCUT_MULTIPLE,
        MIN_SHORT_INVENTORY_HAIRCUT,
        1,
      );
      cap *= haircut;
    }
    newExposureShares = Math.min(desiredShares, roomToInventoryCap, Math.floor(Math.max(0, cap) / limitPrice));
  } else if (isBuy) {
    const maxAffordable = Math.floor((portfolio.availableCash * 0.99) / limitPrice);
    newExposureShares = Math.min(desiredShares, roomToInventoryCap, maxAffordable);
  }
  // Selling without a margin account can never exceed flat, so there's no new-exposure term there.

  let quantity = reducingShares + Math.max(0, newExposureShares);
  quantity = Math.min(quantity, Math.max(0, Math.floor(visibleDepth * MAX_SHARE_OF_VISIBLE_DEPTH)));
  if (quantity < 1) {
    return undefined;
  }
  return { kind: 'LIMIT', side, quantity, limitPrice: Math.max(0.01, Number(limitPrice.toFixed(2))), timeInForce: 'DAY' };
}

function decideAction(observation: Observation): Action {
  const hold: Action = { orders: [] };
  if (config === undefined || observation.portfolio.bankrupt) {
    return hold;
  }

  const { portfolio, market, event } = observation;
  const history = market.priceHistory;
  const isSynthetic = observation.mode === 'SYNTHETIC';

  if (peakEquity === undefined || portfolio.value > peakEquity) {
    peakEquity = portfolio.value;
  }

  // Toxic-flow streak: how many consecutive rounds has this bot's own position grown further in
  // the same direction — captured once per round, before anything below can return early, so
  // it's always fresh for the next call regardless of which branch this round takes.
  if (
    previousShares !== undefined &&
    portfolio.shares !== 0 &&
    Math.sign(portfolio.shares) === Math.sign(previousShares) &&
    Math.abs(portfolio.shares) > Math.abs(previousShares)
  ) {
    inventoryStreak += 1;
  } else {
    inventoryStreak = 0;
  }
  previousShares = portfolio.shares;

  // Attribute the most recently realized return to whichever event was showing last round (this
  // round's own event hasn't affected any realized price yet — see games/stock-market-2/README.md
  // on avoiding lookahead bias).
  if (history.length >= 2 && lastEventType !== undefined) {
    recordObservation(lastEventType, Math.log(history[history.length - 1]!.close / history[history.length - 2]!.close));
  }
  lastEventType = event.type;

  // --- Portfolio-level stop-loss: checked first of all, overrides everything below. ---
  const drawdownFromPeak = peakEquity > 0 ? (peakEquity - portfolio.value) / peakEquity : 0;
  if (drawdownFromPeak > STOP_LOSS_DRAWDOWN && portfolio.shares !== 0) {
    if (portfolio.shares > 0) {
      const quantity = portfolio.availableShares;
      return quantity >= 1 ? { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] } : hold;
    }
    const quantity = -portfolio.shares;
    return quantity >= 1 ? { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] } : hold;
  }

  // --- Margin safety governor: overrides any quoting below. ---
  const marginActive = config.risk.allowShortSelling && portfolio.maintenanceRequirement > 0;
  if (marginActive && portfolio.value < portfolio.maintenanceRequirement * MAINTENANCE_SAFETY_MULTIPLIER) {
    const reduceBy = Math.max(1, Math.round(Math.abs(portfolio.shares) * DE_RISK_FRACTION));
    if (portfolio.shares > 0) {
      const quantity = Math.min(reduceBy, portfolio.availableShares);
      return quantity >= 1 ? { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] } : hold;
    }
    if (portfolio.shares < 0) {
      const quantity = Math.min(reduceBy, -portfolio.shares);
      return quantity >= 1 ? { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] } : hold;
    }
    return hold;
  }

  if (market.bid === null || market.ask === null) {
    return hold; // no visible quotes yet to build a market around (shouldn't normally happen)
  }
  const mid = (market.bid + market.ask) / 2;

  // --- Directional skew: a real event (both modes), a mean-reversion fade otherwise (SYNTHETIC
  // mode only — see this file's doc comment, point 2). ---
  const eventSign = EVENT_SIGN[event.type];
  const isRealEvent = eventSign !== undefined;
  let signalSign: -1 | 0 | 1 = 0;
  let signalMagnitude = 0;
  if (eventSign !== undefined) {
    signalSign = eventSign;
    signalMagnitude = magnitudeFor(event.type);
  } else if (isSynthetic) {
    const meanReversion = meanReversionSignalFrom(history, market.lastClose);
    signalSign = meanReversion.sign;
    signalMagnitude = meanReversion.magnitude;
  }
  const maxSkewFraction = isRealEvent ? MAX_SKEW_FRACTION_EVENT : MAX_SKEW_FRACTION_MEAN_REVERSION;
  const skewFraction = clamp(signalMagnitude * SKEW_SENSITIVITY, 0, maxSkewFraction) * signalSign;

  // --- Order-flow imbalance: real, observed evidence of what other traders just did, not a
  // forecast — skews away from it and widens against it either way (this file's doc comment,
  // point 2's order-flow addendum). ---
  const flowImbalance = orderFlowImbalanceFrom(market.lastRoundVolume, history);
  const flowSkew = flowImbalance * FLOW_SKEW_SENSITIVITY;

  // --- Inventory skew: the more one-sided the current position, the more both quotes shift to
  // unwind it. Plus an extra "toxic flow" kicker: a position that's kept growing the same
  // direction for several rounds straight despite that skew is itself evidence of persistent,
  // probably-informed flow overwhelming a passive quote. ---
  const inventoryRatio = portfolio.value > 0 ? clamp((portfolio.shares * mid) / portfolio.value, -1, 1) : 0;
  const inventorySkew = -inventoryRatio * INVENTORY_SKEW_SENSITIVITY;
  const toxicSkewMagnitude = Math.min(MAX_TOXIC_STREAK_SKEW, inventoryStreak * TOXIC_STREAK_SKEW_PER_ROUND);
  const toxicSkew = -Math.sign(portfolio.shares) * toxicSkewMagnitude;

  const effectiveCenter = mid * (1 + skewFraction + flowSkew + inventorySkew + toxicSkew);

  const spreadScale = spreadScaleFrom(history, flowImbalance);
  const halfSpreadFraction = Math.max(
    BASE_HALF_SPREAD_FRACTION,
    config.transactionFee * MIN_HALF_SPREAD_OVER_FEE_MULTIPLE,
  ) * spreadScale;

  const buyPrice = effectiveCenter * (1 - halfSpreadFraction);
  const sellPrice = effectiveCenter * (1 + halfSpreadFraction);
  const eventSizeBoost = isRealEvent ? EVENT_SIZE_BOOST : 1;
  const baseDesiredShares = Math.max(
    1,
    Math.round((QUOTE_SIZE_FRACTION * portfolio.value * eventSizeBoost) / effectiveCenter),
  );

  // Asymmetric sizing on top of the price skew above: the side that would add further to an
  // already-persistent one-directional position gets smaller (down to a floor), the side that
  // unwinds it gets a boost — real market makers lean on both size *and* price, not price alone.
  const addOnSizeFactor = Math.max(MIN_ADD_ON_SIZE_FRACTION, 1 - inventoryStreak * ADD_ON_SIZE_DAMPEN_PER_ROUND);
  const buySizeFactor = portfolio.shares < 0 ? UNWIND_SIZE_BOOST : portfolio.shares > 0 ? addOnSizeFactor : 1;
  const sellSizeFactor = portfolio.shares > 0 ? UNWIND_SIZE_BOOST : portfolio.shares < 0 ? addOnSizeFactor : 1;

  const orders: Order[] = [];
  const buyQuote = buildQuote({
    side: 'BUY',
    limitPrice: buyPrice,
    desiredShares: Math.max(1, Math.round(baseDesiredShares * buySizeFactor)),
    portfolio,
    visibleDepth: market.askSize,
    config,
  });
  if (buyQuote !== undefined) {
    orders.push(buyQuote);
  }
  const sellQuote = buildQuote({
    side: 'SELL',
    limitPrice: sellPrice,
    desiredShares: Math.max(1, Math.round(baseDesiredShares * sellSizeFactor)),
    portfolio,
    visibleDepth: market.bidSize,
    config,
  });
  if (sellQuote !== undefined) {
    orders.push(sellQuote);
  }

  return { orders };
}

runBot<Observation, Action>({
  decideAction,
  onInit: (init) => {
    config = init.config as Config;
  },
});
