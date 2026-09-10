/**
 * Tominator T-72 — Stock Market 2 — an evolution of `tominator-t71-stock-market-2`, keeping its
 * validated core (event-magnitude learning, cost-awareness, never-averaging-down, a margin safety
 * governor, borrow-cost-aware shorting, a portfolio-level stop-loss, and execution via a tight
 * marketable LIMIT order) and changing three things, all backed by running many real matches
 * against this game's actual bot roster rather than assumed from first principles:
 *
 * 1. HISTORICAL mode trades on real events only — no mean-reversion fade at all. T-71's
 *    mean-reversion fade (trading against deviations from a trailing average) earns its keep in
 *    SYNTHETIC mode, whose reference price structurally mean-reverts toward its hidden
 *    fundamental value every single round (`meanReversionFactor` — see games/stock-market-2/src/
 *    market/referencePriceModel.ts). Real historical data has no such bound; across many real
 *    match runs across many random real windows, fading a real stock's short-term deviations lost
 *    more often than it won, even cash-only and cost-gated — simply holding through the (very
 *    common) quiet historical rounds and waiting for real, trustworthy information beat trying to
 *    read tea leaves out of normal real noise.
 * 2. Mean-reversion (SYNTHETIC mode only, now) is margin-eligible, at a smaller, more
 *    conservative buying-power cap than an actual event gets — since it's specifically safe to
 *    lever a bet on a *structurally bounded* price process, in a way it never was on real data.
 * 3. Realized-volatility-scaled sizing (shrinks every trade when the market's own recent
 *    volatility is elevated, allows a modest boost when it's unusually calm) and order-flow
 *    confirmation from `market.lastRoundVolume.netDemand` (the previous round's aggregate
 *    buy/sell pressure across every participant) — neither read by any other bot in this roster.
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

type Order =
  | { kind: 'MARKET'; side: 'BUY' | 'SELL'; quantity: number }
  | { kind: 'LIMIT'; side: 'BUY' | 'SELL'; quantity: number; limitPrice: number; timeInForce: 'DAY' | 'GTC' };
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

// --- Event-magnitude EMA tracking — same shape/rationale as stock-market/tominator-t70. ---
const MIN_OBSERVATIONS = 2;
const MIN_ALPHA = 0.2;
const CONFIDENCE_SATURATION = 40;
const BASE_MAGNITUDE_PRIOR_EARNINGS = 0.04;
const BASE_MAGNITUDE_PRIOR_NEWS = 0.025;
const MIN_MAGNITUDE_PRIOR = 0.01;
const MAX_MAGNITUDE_PRIOR = 0.08;
const SENSITIVITY = 40;
const MIN_TRADE_FRACTION = 0.05;
const MAX_TRADE_FRACTION_PER_EVENT = 0.85;
/** A real event can command up to `MAX_TRADE_FRACTION_PER_EVENT` of portfolio value. The mean-
 * reversion heuristic — SYNTHETIC mode only, see decideAction — gets a smaller ceiling
 * regardless: it's a statistical bet, not externally-validated information. */
const MAX_TRADE_FRACTION_MEAN_REVERSION_SYNTHETIC = 0.4;
/** Cash-only exposure cap (fraction of total portfolio value) — used whenever a trade isn't
 * eligible to draw on margin at all (no margin account). */
const MAX_EXPOSURE_FRACTION = 0.95;

// --- Short-term trend — confirms/dampens an actual event's size only (a real event shifts the
// hidden fundamental value itself, so the price *catching up* to it over the next few rounds is
// genuine, event-driven momentum, not noise). Never traded on by itself — see the mean-reversion
// signal below for what happens on the (much more common) rounds with no event at all. ---
const SHORT_TREND_WINDOW = 5;
const TREND_CONFIRM_BOOST = 1.15;
const TREND_CONTRADICT_DAMPEN = 0.7;
const MAX_TREND_MAGNITUDE = 0.05;

// --- Mean-reversion signal — the ONLY signal traded on when there's no event this round. The
// synthetic reference price structurally mean-reverts toward the (slow-moving) hidden fundamental
// value every single round (`meanReversionFactor` — see market/referencePriceModel.ts); trading
// *momentum* against that on a quiet day would be fighting the market's own mechanics. Fading a
// large deviation from a longer trailing average, the way stock-market-2/mean-reversion-
// stock-market-2 does, is what's actually aligned with how this exchange's price process works. ---
const MEAN_REVERSION_WINDOW = 20;
const MEAN_REVERSION_SCALE = 0.8;

// --- Order-flow confirmation (new in T-72) — the previous round's aggregate net demand across
// every participant, a real (if noisy) signal none of this roster's other bots read at all. ---
const ORDER_FLOW_CONFIRM_BOOST = 1.1;
const ORDER_FLOW_CONTRADICT_DAMPEN = 0.85;

// --- Realized-volatility-scaled sizing (new in T-72). A choppier-than-normal market gets smaller
// trades, a calmer one gets a modest boost — real risk management none of this roster's other
// bots do at all. ---
const VOLATILITY_WINDOW = 10;
/** A reasonable "normal" daily-volatility assumption — deliberately the same order of magnitude
 * as this game's own default `synthetic.fundamentalVolatility`/`referenceModel.referenceVolatility`
 * (see games/stock-market-2/src/types.ts), not read from config (a game can tune those, and real
 * historical volatility varies by regime anyway — this is just the scale to compare the market's
 * *actually observed* recent volatility against). */
const BASELINE_VOLATILITY = 0.02;
const MIN_VOLATILITY_SCALE = 0.5;
const MAX_VOLATILITY_SCALE = 1.5;

// --- Cost-awareness gate. A round trip always costs at least 2x the transaction fee plus
// crossing the spread twice; trading on a signal smaller than that is pure fee/spread bleed, not
// a real edge. `MIN_EDGE_OVER_COST` requires the estimated magnitude to clear that cost by a
// multiple before bothering to trade at all — replaces a fixed noise floor with something that
// actually scales with the game's real fee/spread, both of which vary by config and regime. ---
const MIN_EDGE_OVER_COST = 3;
/** Spread fallback for the rare round with no visible quotes at all (shouldn't normally happen —
 * synthetic liquidity is always present — but stay defensive). */
const FALLBACK_SPREAD_FRACTION = 0.002;

// --- Execution quality. ---
const MAX_SHARE_OF_VISIBLE_DEPTH = 0.5;
/** A marketable LIMIT order priced this far past the visible touch — enough to walk a level or
 * two of real depth if this bot's own (already depth-capped) size needs it, while staying small:
 * matching against synthetic liquidity always fills at that liquidity's own quoted price
 * regardless of how generous this cushion is, but matching against another bot's MARKET order
 * fills at *this* limit price directly (see exchange/matchingEngine.ts's `tradePriceFor` —
 * "the market order takes whatever the resting limit offers") — a wide cushion would mean handing
 * an aggressive give-away price to any bot that happens to cross with a plain MARKET order. */
const LIMIT_PRICE_CUSHION = 0.002;

// --- Margin safety governor. ---
/** Never deploy more than this fraction of *current* buying power into brand-new exposure from a
 * real event — deliberately well short of what the exchange would actually allow, so a subsequent
 * adverse move doesn't immediately trigger a margin call. The mean-reversion heuristic (SYNTHETIC
 * mode only — see this file's own doc comment, point 1) gets a smaller cap of its own. */
const BUYING_POWER_UTILIZATION_CAP_EVENT = 0.6;
const BUYING_POWER_UTILIZATION_CAP_MEAN_REVERSION = 0.35;
/** De-risk once equity falls under this multiple of the maintenance requirement — a personal
 * buffer well above the exchange's own hard 1x maintenance line. */
const MAINTENANCE_SAFETY_MULTIPLIER = 1.5;
const DE_RISK_FRACTION = 0.5;

// --- Borrow-cost awareness. ---
/** Assumed typical holding period (in rounds) for a new short, used only to estimate whether its
 * carrying cost is worth paying — not a real forecast of how long the position will stay open. */
const EXPECTED_HOLD_ROUNDS = 8;
const TRADING_ROUNDS_PER_YEAR = 252;

// --- Portfolio-level stop-loss. Real historical data can decline for a genuinely sustained
// stretch — refusing to *add* to a losing position isn't enough on its own if the position was
// opened right before a real decline and simply held through all of it. This actively exits
// (flattens, at market — the same urgency reasoning as the margin governor) once total equity has
// fallen too far from its own best-ever mark, independent of margin/maintenance and independent of
// whatever the current signal says. ---
const STOP_LOSS_DRAWDOWN = 0.15;

let config: Config | undefined;
let lastEventType: string | undefined;
let peakEquity: number | undefined;
/** Equity as of the previous round — the "never average down" guard's only real state. */
let previousEquity: number | undefined;
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

/** The average daily log return over the short trailing window — used only to confirm/dampen an
 * actual event's size. `sign: 0` only when there's not even two candles yet to compare. */
function shortTrendSignalFrom(history: readonly Candle[]): { sign: -1 | 0 | 1; magnitude: number } {
  const window = history.slice(-SHORT_TREND_WINDOW);
  if (window.length < 2) {
    return { sign: 0, magnitude: 0 };
  }
  let total = 0;
  for (let i = 1; i < window.length; i++) {
    total += Math.log(window[i]!.close / window[i - 1]!.close);
  }
  const average = total / (window.length - 1);
  if (average === 0) {
    return { sign: 0, magnitude: 0 };
  }
  return { sign: average > 0 ? 1 : -1, magnitude: Math.min(MAX_TREND_MAGNITUDE, Math.abs(average)) };
}

/** How far `lastClose` sits from its own longer trailing average — the signal traded on when
 * there's no event this round: `sign` points *back toward* the average (a price above it is
 * faded with a SELL, one below it with a BUY). */
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
  return { sign: deviation > 0 ? -1 : 1, magnitude: Math.min(MAX_TREND_MAGNITUDE, Math.abs(deviation)) };
}

/** The realized daily-return standard deviation over the trailing window, relative to
 * `BASELINE_VOLATILITY` — clamped to `[MIN_VOLATILITY_SCALE, MAX_VOLATILITY_SCALE]` so a single
 * quiet or wild stretch never swings sizing more than that. Defaults to 1 (no adjustment) until
 * there's enough history to measure. */
function volatilityScaleFrom(history: readonly Candle[]): number {
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
  if (realizedVolatility <= 0) {
    return MAX_VOLATILITY_SCALE;
  }
  return clamp(BASELINE_VOLATILITY / realizedVolatility, MIN_VOLATILITY_SCALE, MAX_VOLATILITY_SCALE);
}

/** Confirmation/dampening from the previous round's aggregate net demand — agreement with `sign`
 * is a small tailwind, disagreement a small reason for caution. Neutral (1) with no volume data
 * yet, or on a round with exactly zero net demand. */
function orderFlowFactorFor(sign: -1 | 1, lastRoundVolume: Volume | null): number {
  if (lastRoundVolume === null || lastRoundVolume.netDemand === 0) {
    return 1;
  }
  const flowSign = Math.sign(lastRoundVolume.netDemand);
  return flowSign === sign ? ORDER_FLOW_CONFIRM_BOOST : ORDER_FLOW_CONTRADICT_DAMPEN;
}

/** A round trip's estimated real cost: the transaction fee charged on both legs, plus crossing
 * the visible spread twice (entry and exit) — read live off the current quotes rather than
 * reconstructed from config, since the spread is itself regime-adjusted (see
 * games/stock-market-2/README.md). */
function roundTripCostEstimate(config: Config, market: Observation['market']): number {
  const spreadFraction =
    market.bid !== null && market.ask !== null && market.lastClose > 0
      ? (market.ask - market.bid) / market.lastClose
      : FALLBACK_SPREAD_FRACTION;
  return 2 * config.transactionFee + 2 * spreadFraction;
}

function buyOrder(quantity: number, market: Observation['market']): Order {
  const reference = market.ask ?? market.lastClose;
  const limitPrice = Number((reference * (1 + LIMIT_PRICE_CUSHION)).toFixed(2));
  return { kind: 'LIMIT', side: 'BUY', quantity, limitPrice, timeInForce: 'DAY' };
}

function sellOrder(quantity: number, market: Observation['market']): Order {
  const reference = market.bid ?? market.lastClose;
  const limitPrice = Math.max(0.01, Number((reference * (1 - LIMIT_PRICE_CUSHION)).toFixed(2)));
  return { kind: 'LIMIT', side: 'SELL', quantity, limitPrice, timeInForce: 'DAY' };
}

/** Builds a BUY: covering an existing short is always allowed in full (that's risk-*reducing*,
 * never blocked by anything below). New long exposure beyond flat is skipped entirely when
 * `allowNewExposure` is false (never add to an already-open position that's currently losing
 * money) — otherwise it's capped by a self-imposed fraction of current buying power headroom when
 * `useMarginForNewExposure` is true (an actual event, or a SYNTHETIC-mode mean-reversion fade —
 * see decideAction's own call site for exactly which), using `buyingPowerUtilizationCap`, or by
 * cash/a fixed exposure fraction otherwise. */
function buildBuyAction(
  observation: Observation,
  tradeFraction: number,
  allowNewExposure: boolean,
  useMarginForNewExposure: boolean,
  buyingPowerUtilizationCap: number,
): Action {
  const { portfolio, market } = observation;
  const price = market.ask ?? market.lastClose;
  const desiredShares = Math.max(1, Math.round((tradeFraction * portfolio.value) / price));
  const coveringShares = Math.max(0, -portfolio.shares);

  let newExposureShares = 0;
  if (allowNewExposure) {
    if (portfolio.buyingPower > 0 && useMarginForNewExposure) {
      const safeHeadroomNotional = Math.max(
        0,
        portfolio.buyingPower * buyingPowerUtilizationCap - portfolio.marginUsed,
      );
      newExposureShares = Math.min(desiredShares, Math.floor(safeHeadroomNotional / price));
    } else {
      const maxAffordable = Math.floor((portfolio.availableCash * 0.99) / price);
      const capShares = Math.floor((MAX_EXPOSURE_FRACTION * portfolio.value) / price);
      newExposureShares = Math.min(desiredShares, maxAffordable, Math.max(0, capShares - Math.max(0, portfolio.shares)));
    }
  }

  let quantity = coveringShares + Math.max(0, newExposureShares);
  quantity = Math.min(quantity, Math.max(1, Math.floor(market.askSize * MAX_SHARE_OF_VISIBLE_DEPTH)));
  return quantity >= 1 ? { orders: [buyOrder(quantity, market)] } : { orders: [] };
}

/** Builds a SELL: the mirror image of `buildBuyAction`. */
function buildSellAction(
  observation: Observation,
  tradeFraction: number,
  allowNewExposure: boolean,
  useMarginForNewExposure: boolean,
  buyingPowerUtilizationCap: number,
): Action {
  const { portfolio, market } = observation;
  const price = market.bid ?? market.lastClose;
  const desiredShares = Math.max(1, Math.round((tradeFraction * portfolio.value) / price));
  const reducingShares = Math.min(Math.max(0, portfolio.shares), portfolio.availableShares);

  let newShortShares = 0;
  if (allowNewExposure && portfolio.buyingPower > 0 && useMarginForNewExposure) {
    const safeHeadroomNotional = Math.max(
      0,
      portfolio.buyingPower * buyingPowerUtilizationCap - portfolio.marginUsed,
    );
    newShortShares = Math.min(desiredShares, Math.floor(safeHeadroomNotional / price));
  }

  let quantity = reducingShares + Math.max(0, newShortShares);
  quantity = Math.min(quantity, Math.max(1, Math.floor(market.bidSize * MAX_SHARE_OF_VISIBLE_DEPTH)));
  return quantity >= 1 ? { orders: [sellOrder(quantity, market)] } : { orders: [] };
}

function decideAction(observation: Observation): Action {
  const hold: Action = { orders: [] };
  if (config === undefined || observation.portfolio.bankrupt) {
    return hold;
  }

  const { portfolio, market, event } = observation;
  const history = market.priceHistory;
  const isSynthetic = observation.mode === 'SYNTHETIC';

  // "Never average down" guard and the portfolio-level stop-loss's own high-water mark — both
  // captured once per round, before anything below can return early, so they're always fresh for
  // the next call regardless of which branch this round takes.
  const equityWasDeclining = previousEquity !== undefined && portfolio.value < previousEquity;
  previousEquity = portfolio.value;
  if (peakEquity === undefined || portfolio.value > peakEquity) {
    peakEquity = portfolio.value;
  }

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

  // --- Margin safety governor: overrides any signal below. ---
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

  // --- Directional signal: a real event first (confirmed/dampened by short-term trend), a
  // mean-reversion fade on the (common) quiet rounds otherwise — then order-flow confirmation on
  // top of whichever one fired. ---
  const eventSign = EVENT_SIGN[event.type];
  const isRealEvent = eventSign !== undefined;

  let sign: -1 | 0 | 1;
  let magnitude: number;
  if (eventSign !== undefined) {
    sign = eventSign;
    magnitude = magnitudeFor(event.type);
    const shortTrend = shortTrendSignalFrom(history);
    if (shortTrend.sign !== 0) {
      magnitude *= shortTrend.sign === eventSign ? TREND_CONFIRM_BOOST : TREND_CONTRADICT_DAMPEN;
    }
  } else if (!isSynthetic) {
    // HISTORICAL mode only ever trades on a genuine event. Empirically (many real match runs
    // across many random real windows), fading trailing-average deviations in real single-stock
    // data lost more often than it won, even after cost-gating and reduced/cash-only sizing —
    // real short-term deviations just don't revert reliably enough to earn their own risk, unlike
    // SYNTHETIC mode's structurally bounded price process. Simply holding through the (very
    // common) quiet historical rounds and waiting for real, trustworthy information is the better
    // bet.
    return hold;
  } else {
    const meanReversion = meanReversionSignalFrom(history, market.lastClose);
    if (meanReversion.sign === 0) {
      return hold;
    }
    sign = meanReversion.sign;
    magnitude = meanReversion.magnitude * MEAN_REVERSION_SCALE;
  }
  magnitude *= orderFlowFactorFor(sign, market.lastRoundVolume);

  // A signal smaller than a few multiples of the round-trip cost isn't a real edge, it's fee/
  // spread bleed — hold the current position exactly as-is rather than trade on it.
  if (magnitude < MIN_EDGE_OVER_COST * roundTripCostEstimate(config, market)) {
    return hold;
  }

  // Mean-reversion is only margin-eligible in SYNTHETIC mode (this file's doc comment, point 1) —
  // HISTORICAL mode keeps it exactly as conservative as T-71.
  const useMarginForNewExposure = isRealEvent || isSynthetic;
  const buyingPowerUtilizationCap = isRealEvent
    ? BUYING_POWER_UTILIZATION_CAP_EVENT
    : BUYING_POWER_UTILIZATION_CAP_MEAN_REVERSION;
  // The mean-reversion branch above already returned early for HISTORICAL mode, so reaching here
  // with !isRealEvent means SYNTHETIC mode, guaranteed.
  const maxTradeFraction = isRealEvent ? MAX_TRADE_FRACTION_PER_EVENT : MAX_TRADE_FRACTION_MEAN_REVERSION_SYNTHETIC;
  const volatilityScale = volatilityScaleFrom(history);

  if (sign > 0) {
    // Adding to an already-open long that's currently losing money is exactly the "average down"
    // pattern this bot exists to block; opening fresh or covering a short is never affected.
    const allowNewExposure = !(portfolio.shares > 0 && equityWasDeclining);
    const tradeFraction = clamp(magnitude * SENSITIVITY * volatilityScale, MIN_TRADE_FRACTION, maxTradeFraction);
    return buildBuyAction(observation, tradeFraction, allowNewExposure, useMarginForNewExposure, buyingPowerUtilizationCap);
  }

  // sign < 0: discount by an estimated borrow-cost carry before deciding a NEW/added short is
  // worth it at all — only relevant when this signal could actually open one on margin; never
  // applies to simply unwinding an existing long.
  let allowNewExposure = !(portfolio.shares < 0 && equityWasDeclining);
  if (allowNewExposure && useMarginForNewExposure && config.risk.allowShortSelling) {
    const dailyBorrowRate = config.risk.borrowFeeAnnualized / TRADING_ROUNDS_PER_YEAR;
    const carryCost = dailyBorrowRate * EXPECTED_HOLD_ROUNDS;
    const discountedMagnitude = magnitude - carryCost;
    if (discountedMagnitude <= 0) {
      allowNewExposure = false;
    } else {
      magnitude = discountedMagnitude;
    }
  }
  if (!allowNewExposure && portfolio.shares <= 0) {
    return hold; // nothing to unwind, and a fresh/added short isn't worth opening right now
  }
  const tradeFraction = clamp(magnitude * SENSITIVITY * volatilityScale, MIN_TRADE_FRACTION, maxTradeFraction);
  return buildSellAction(observation, tradeFraction, allowNewExposure, useMarginForNewExposure, buyingPowerUtilizationCap);
}

runBot<Observation, Action>({
  decideAction,
  onInit: (init) => {
    config = init.config as Config;
  },
});
