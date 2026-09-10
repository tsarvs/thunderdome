/**
 * Tominator T-71 — Stock Market 2 — a genuine evolution of `stock-market/tominator-t70`, not just
 * a port: it keeps that bot's core insight (a real event carries a free, trustworthy *direction* —
 * real in HISTORICAL mode, synthetic-but-still-honest in SYNTHETIC mode — so the only thing worth
 * learning is *magnitude*, via a prior that shrinks toward the empirical estimate as observations
 * accumulate), then adds everything T-70 couldn't do on the old single-price-no-order-book
 * exchange:
 *
 * 1. Trades both directions, sized off margin buying power, not just cash. A negative signal
 *    opens or adds to a short when `config.risk.allowShortSelling` is on, instead of only ever
 *    selling down to flat. Degrades gracefully to long-only whenever a game has shorting off —
 *    `portfolio.buyingPower` is 0 in that case, so every margin-gated branch below just falls
 *    through to the plain cash-only path on its own.
 * 2. A secondary trend signal for the (very common) rounds with no event at all. Most rounds are
 *    `NO_NEWS` — the hidden fundamental value still drifts every round via regime dynamics
 *    (SYNTHETIC mode) or real day-to-day supply/demand (HISTORICAL mode), so a bot that only
 *    reacts to discrete events leaves most of a match's actual price movement untraded. The trend
 *    signal also confirms/dampens an actual event's size when it agrees/disagrees with it.
 * 3. A self-imposed margin safety governor: never deploys more than a fixed fraction of *current*
 *    buying power into new exposure, and proactively cuts the position if equity gets
 *    uncomfortably close to the maintenance requirement — rather than waiting to get forced-
 *    liquidated, which costs fees and (possibly) worse slippage on top of the loss that triggered
 *    it in the first place.
 * 4. Borrow-cost-aware shorting: reads `config.risk.borrowFeeAnnualized` (bots receive the full,
 *    un-redacted config via `onInit` — see `game.ts`'s `redactConfigForBots`) and discounts a
 *    short's estimated edge by an assumed holding period's worth of carrying cost before deciding
 *    it's actually worth opening.
 * 5. Execution quality: sizes against visible `bidSize`/`askSize` rather than the old
 *    `config.marketImpactFactor` formula (which doesn't exist anymore — impact is organic now
 *    that there's a real order book, see games/stock-market-2/README.md), and trades with a
 *    marketable LIMIT order priced just past the visible touch instead of a blind MARKET order —
 *    bounding worst-case fill price while still filling almost every time.
 * 6. Never averages down: real historical data can decline for a genuinely sustained stretch
 *    (unlike SYNTHETIC mode's bounded, structurally mean-reverting price process — see the
 *    mean-reversion signal's own doc comment below), so repeatedly adding to a losing position on
 *    the theory that it's "due" to revert is a real way to lose a lot of money, worse with
 *    leverage. This bot tracks its own equity trajectory and refuses to add new exposure in the
 *    same direction as an already-open position while that position has been losing money —
 *    reducing/flattening a bad position is always still allowed, and it will happily add to a
 *    position that's currently working.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };

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
/** A real event can command up to `MAX_TRADE_FRACTION_PER_EVENT` of portfolio value; the mean-
 * reversion heuristic never should — it's a statistical bet, not externally-validated information,
 * so it gets a much smaller ceiling on conviction regardless of how large its own estimated
 * magnitude looks. */
const MAX_TRADE_FRACTION_MEAN_REVERSION = 0.3;
/** Cash-only exposure cap (fraction of total portfolio value) — only used when there's no margin
 * account at all (`portfolio.buyingPower <= 0`). */
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
/** Never deploy more than this fraction of *current* buying power into brand-new exposure —
 * deliberately well short of what the exchange would actually allow, so a subsequent adverse move
 * doesn't immediately trigger a margin call. */
const BUYING_POWER_UTILIZATION_CAP = 0.6;
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
// stretch (see this file's doc comment, point 6) — refusing to *add* to a losing position isn't
// enough on its own if the position was opened right before a real decline and simply held
// through all of it. This actively exits (flattens, at market — the same urgency reasoning as the
// margin governor) once total equity has fallen too far from its own best-ever mark, independent
// of margin/maintenance and independent of whatever the current signal says. ---
const STOP_LOSS_DRAWDOWN = 0.15;

let config: Config | undefined;
let lastEventType: string | undefined;
let peakEquity: number | undefined;
/** Equity as of the previous round — the "never average down" guard's only real state (see this
 * file's own doc comment, point 6). */
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
 * actual event's size (see this constant's own doc comment above). `sign: 0` only when there's
 * not even two candles yet to compare; whether a real event is worth trading on at all is
 * `decideAction`'s `MIN_EDGE_OVER_COST` gate's job, not this function's. */
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
 * there's no event this round (see this constant's own doc comment above): `sign` points *back
 * toward* the average (a price above it is faded with a SELL, one below it with a BUY). */
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
 * `allowNewExposure` is false (this file's doc comment, point 6: never add to an already-open
 * position that's currently losing money) — otherwise it's capped by a self-imposed fraction of
 * current buying power headroom, but ONLY when `useMarginForNewExposure` is true: leverage is
 * reserved for a real, externally-validated signal (an actual event), not for the mean-reversion
 * heuristic's mere statistical bet, which is always sized cash-only regardless of how much margin
 * happens to be available (see decideAction's own call site for exactly which is which). */
function buildBuyAction(
  observation: Observation,
  tradeFraction: number,
  allowNewExposure: boolean,
  useMarginForNewExposure: boolean,
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
        portfolio.buyingPower * BUYING_POWER_UTILIZATION_CAP - portfolio.marginUsed,
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

/** Builds a SELL: the mirror image of `buildBuyAction` — reducing an existing long is always
 * allowed in full; new short exposure beyond flat is skipped entirely when `allowNewExposure` is
 * false (either the borrow-cost check or the "never average down" guard fired), and otherwise
 * only drawn against margin when `useMarginForNewExposure` is true (a real event) rather than a
 * mean-reversion heuristic bet — which, without a margin account, simply has no way to add short
 * exposure at all, so it's always capped at flat in that case regardless. */
function buildSellAction(
  observation: Observation,
  tradeFraction: number,
  allowNewExposure: boolean,
  useMarginForNewExposure: boolean,
): Action {
  const { portfolio, market } = observation;
  const price = market.bid ?? market.lastClose;
  const desiredShares = Math.max(1, Math.round((tradeFraction * portfolio.value) / price));
  const reducingShares = Math.min(Math.max(0, portfolio.shares), portfolio.availableShares);

  let newShortShares = 0;
  if (allowNewExposure && portfolio.buyingPower > 0 && useMarginForNewExposure) {
    const safeHeadroomNotional = Math.max(
      0,
      portfolio.buyingPower * BUYING_POWER_UTILIZATION_CAP - portfolio.marginUsed,
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

  // "Never average down" guard (this file's doc comment, point 6) and the portfolio-level stop-
  // loss's own high-water mark — both captured once per round, before anything below can return
  // early, so they're always fresh for the next call regardless of which branch this round takes.
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
  // mean-reversion fade on the (common) quiet rounds otherwise. Only an actual event is treated
  // as a real, externally-validated signal worth leveraging (see buildBuyAction/buildSellAction's
  // own doc comments) — the mean-reversion fade is a heuristic statistical bet, always sized
  // cash-only regardless of how much margin happens to be available. Real historical data can
  // decline for a genuinely sustained stretch in a way SYNTHETIC mode's bounded, structurally
  // mean-reverting price process never does, and "buy the dip" repeatedly with borrowed money into
  // that is a fast way to lose a lot of it. ---
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
  } else {
    const meanReversion = meanReversionSignalFrom(history, market.lastClose);
    if (meanReversion.sign === 0) {
      return hold;
    }
    sign = meanReversion.sign;
    magnitude = meanReversion.magnitude * MEAN_REVERSION_SCALE;
  }

  // A signal smaller than a few multiples of the round-trip cost isn't a real edge, it's fee/
  // spread bleed — hold the current position exactly as-is rather than trade on it (same "no
  // known direction, no reason to change position" philosophy stock-market/tominator-t70 used for
  // NO_NEWS, generalized to "no *trustworthy* direction").
  if (magnitude < MIN_EDGE_OVER_COST * roundTripCostEstimate(config, market)) {
    return hold;
  }
  const maxTradeFraction = isRealEvent ? MAX_TRADE_FRACTION_PER_EVENT : MAX_TRADE_FRACTION_MEAN_REVERSION;

  if (sign > 0) {
    // Adding to an already-open long that's currently losing money is exactly the "average down"
    // pattern point 6 exists to block; opening fresh or covering a short is never affected.
    const allowNewExposure = !(portfolio.shares > 0 && equityWasDeclining);
    const tradeFraction = clamp(magnitude * SENSITIVITY, MIN_TRADE_FRACTION, maxTradeFraction);
    return buildBuyAction(observation, tradeFraction, allowNewExposure, isRealEvent);
  }

  // sign < 0: discount by an estimated borrow-cost carry before deciding a NEW/added short is
  // worth it at all — only relevant when a real event could actually open one on margin (a
  // mean-reversion-only signal never does, regardless of margin availability — see
  // buildSellAction's doc comment); never applies to simply unwinding an existing long.
  let allowNewExposure = !(portfolio.shares < 0 && equityWasDeclining);
  if (allowNewExposure && isRealEvent && config.risk.allowShortSelling) {
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
  const tradeFraction = clamp(magnitude * SENSITIVITY, MIN_TRADE_FRACTION, maxTradeFraction);
  return buildSellAction(observation, tradeFraction, allowNewExposure, isRealEvent);
}

runBot<Observation, Action>({
  decideAction,
  onInit: (init) => {
    config = init.config as Config;
  },
});
