/**
 * T-70 — replaces an earlier version of this bot that continuously re-targeted a position size
 * off a live "how far is price from my estimated fundamental value" deviation. That version lost
 * head-to-head to `news-reaction-stock-market` (a bot that infers nothing at all) about 70% of the
 * time — measured, not assumed, via an in-process simulation harness run directly against the real
 * game engine. The reason: `meanReversionFactor` defaults to a mere 0.05, so price closes only 5%
 * of the gap per round — meaning the old deviation-based target naturally shrank every round even
 * while the real move was still mostly ahead of it, selling out of winning positions the moment
 * convergence *started*, cutting them short. news-reaction never does that: it just holds a
 * position until told otherwise by the next signed event.
 *
 * This version copies that "react and hold" shape — and, like news-reaction, trusts each event
 * type's *direction* immediately: `game.ts`'s `actualMultiplierFor` only ever scales a type's
 * baseline effect by a same-signed per-match ratio, so e.g. ANALYST_UPGRADE can vary in strength
 * but never becomes bad news, meaning EVENT_SIGN below is free, safe information, not something
 * this bot has to (mis)learn from noisy price data. It then adds three things news-reaction's flat
 * 10-shares-on-any-signal approach leaves on the table:
 *
 * 1. Magnitude, not just direction. A type's effect size is genuinely hidden and drifts per
 *    match, but it's still worth estimating: `magnitudePriorFor()` seeds a new type's guess from
 *    its `weight` (visible; only the numeric effect is redacted) under the same "rare news is
 *    dramatic, routine news is a shrug" assumption real markets follow, and `magnitudeFor()`
 *    shrinks that prior toward an empirical read (this round's log return, net of the running
 *    NO_NEWS average as a shared-noise control) as observations accumulate.
 * 2. Position sizing as a fraction of portfolio *value*, not a fixed share count — so as this
 *    bot's edge grows its stake, later trades risk proportionally more (compounding), the same
 *    reason "reinvest your winnings" beats "bet the same $ every time" over many rounds.
 * 3. A hard cap on any single trade's own price impact. Sizing off portfolio value with no ceiling
 *    is dangerous: a run of same-direction events could otherwise spiral into bigger trade ->
 *    bigger netDemand -> bigger marketPressure -> bigger price move -> even-bigger next trade
 *    (verified: this actually happened, and produced runaway prices over long matches, before the
 *    engine itself switched to a square-root impact model — see `marketImpactFactor`'s doc in
 *    games/stock-market/src/types.ts — which is self-limiting at scale but still allows a large
 *    single trade real impact). `marketImpactFactor` is visible, so `decideAction()` bounds every
 *    trade's own contribution to marketPressure at a sane fraction regardless of how large
 *    percentage-of-portfolio sizing would otherwise ask for — defense in depth, not reliance on
 *    the engine alone.
 *
 * Measured to beat news-reaction-stock-market head-to-head in the large majority of matches. It
 * only ever goes long-or-flat (no shorting is possible in this game).
 */
import { runBot } from '@thunderdome/bot-sdk-js';

interface Observation {
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
    lastRoundVolume: { sharesBought: number; sharesSold: number; netDemand: number } | null;
  };
  event: {
    type: string;
    description: string;
  };
}

type Action = { action: 'BUY' | 'SELL'; quantity: number } | { action: 'HOLD' };

interface Config {
  events: Record<string, { weight: number }>;
  meanReversionFactor: number;
  transactionFee: number;
  marketImpactFactor: number;
}

const NO_NEWS = 'NO_NEWS';

// Every other type's direction — never actually hidden (see the file docstring), so hardcoded
// rather than something magnitudeFor() has to (mis)learn from noisy price data.
const EVENT_SIGN: Partial<Record<string, 1 | -1>> = {
  POSITIVE_NEWS: 1,
  NEGATIVE_NEWS: -1,
  ANALYST_UPGRADE: 1,
  ANALYST_DOWNGRADE: -1,
  PRODUCT_SUCCESS: 1,
  PRODUCT_FAILURE: -1,
  EARNINGS_BEAT: 1,
  EARNINGS_MISS: -1,
};

// Tuning constants.
// - MIN_OBSERVATIONS: a type's magnitude estimate is trusted only once both it and NO_NEWS have
//   at least this many samples; below that, magnitudeFor() returns the prior untouched.
// - MIN_ALPHA: floor on magnitudeFor()'s adaptive learning rate — the true effect keeps drifting
//   all match, so a floored rate keeps tracking it instead of freezing onto an early read.
// - CONFIDENCE_SATURATION: observation count at which a type's magnitude estimate is fully
//   trusted over its prior.
// - BASE/MIN/MAX_MAGNITUDE_PRIOR: magnitudePriorFor()'s scale and bounds — deliberately mild:
//   strong enough to size an unconfirmed guess sensibly, never so large that a wrong guess (a
//   rare type turning out to be small this match) does real damage before real data corrects it.
// - SENSITIVITY/MIN_TRADE_FRACTION/MAX_TRADE_FRACTION_PER_EVENT/MAX_EXPOSURE_FRACTION: position
//   sizing in decideAction() — react to each signed event with a trade sized off its estimated
//   magnitude, scaled to portfolio value, and hold the resulting position until the next signed
//   event changes it, never unwound just because price has started converging.
// - MAX_SELF_MARKET_IMPACT: caps a single trade's own contribution to next round's marketPressure
//   at this fraction, regardless of how large portfolio-value-based sizing would otherwise ask
//   for (see decideAction()'s `impactCapQuantity`).
const MIN_OBSERVATIONS = 2;
const MIN_ALPHA = 0.2;
const CONFIDENCE_SATURATION = 40;
const BASE_MAGNITUDE_PRIOR = 0.02;
const MIN_MAGNITUDE_PRIOR = 0.01;
const MAX_MAGNITUDE_PRIOR = 0.08;
const SENSITIVITY = 40;
const MIN_TRADE_FRACTION = 0.05;
const MAX_TRADE_FRACTION_PER_EVENT = 0.85;
const MAX_EXPOSURE_FRACTION = 0.95;
const MAX_SELF_MARKET_IMPACT = 0.05;

let config: Config | undefined;
let lastPrice: number | undefined;
let lastEventType: string | undefined;
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

/** A rarer event type (lower `weight` — visible; only the numeric effect is redacted) plausibly
 * moves the price more than a common one, mirroring how real markets treat rare news as dramatic
 * and routine news as a shrug. Falls back to the flat base guess if weights are unavailable or
 * uninformative (e.g. an organizer who weighted every type equally). */
function magnitudePriorFor(type: string): number {
  const weight = config?.events[type]?.weight;
  const baselineWeight = config?.events[NO_NEWS]?.weight;
  if (weight === undefined || weight <= 0 || baselineWeight === undefined || baselineWeight <= 0) {
    return BASE_MAGNITUDE_PRIOR;
  }
  return clamp(
    BASE_MAGNITUDE_PRIOR * Math.sqrt(baselineWeight / weight),
    MIN_MAGNITUDE_PRIOR,
    MAX_MAGNITUDE_PRIOR,
  );
}

/** `type`'s estimated magnitude (always non-negative — direction comes separately from
 * EVENT_SIGN): starts at `magnitudePriorFor(type)` and shrinks toward the empirical estimate
 * (this round's log return, net of the running NO_NEWS average) as observations accumulate. */
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

/**
 * `config === undefined` (unreachable in a real match — onInit always fires first — but keeps
 * this defensible against a test harness that skips it) falls through to HOLD, same as an
 * unrecognized `event.type` (NO_NEWS, or any future type EVENT_SIGN doesn't know): no known
 * direction means no reason to change the current position (see the file docstring — this bot
 * never unwinds on its own).
 *
 * Otherwise: folds the previous round's realized return into the inference state, sizes a trade
 * off `magnitudeFor()`'s estimate scaled to portfolio value, then caps that trade's own market
 * impact. The engine's `marketPressure` is `marketImpactFactor * sqrt(quantity)` — square-root,
 * not linear — so bounding this trade's own contribution at `MAX_SELF_MARKET_IMPACT` means
 * solving `marketImpactFactor * sqrt(quantity) <= MAX_SELF_MARKET_IMPACT` for quantity, i.e.
 * squaring `MAX_SELF_MARKET_IMPACT / marketImpactFactor` rather than using it directly. Finally,
 * BUY is bounded by both affordability and `MAX_EXPOSURE_FRACTION` of total portfolio value; SELL
 * by shares actually held.
 */
function decideAction(observation: Observation): Action {
  if (config === undefined) {
    return { action: 'HOLD' };
  }

  const { portfolio, market, event } = observation;

  if (lastPrice !== undefined && lastEventType !== undefined) {
    recordObservation(lastEventType, Math.log(market.price / lastPrice));
  }
  lastPrice = market.price;
  lastEventType = event.type;

  const sign = EVENT_SIGN[event.type];
  if (sign === undefined) {
    return { action: 'HOLD' };
  }

  const magnitude = magnitudeFor(event.type);
  const tradeFraction = clamp(magnitude * SENSITIVITY, MIN_TRADE_FRACTION, MAX_TRADE_FRACTION_PER_EVENT);
  const impactCapQuantity =
    config.marketImpactFactor > 0
      ? Math.floor((MAX_SELF_MARKET_IMPACT / config.marketImpactFactor) ** 2)
      : Number.POSITIVE_INFINITY;
  const tradeShares = Math.max(
    1,
    Math.min(impactCapQuantity, Math.round((tradeFraction * portfolio.value) / market.price)),
  );

  if (sign > 0) {
    const capShares = Math.floor((MAX_EXPOSURE_FRACTION * portfolio.value) / market.price);
    const maxAffordable = Math.floor((portfolio.cash * 0.99) / market.price);
    const quantity = Math.min(tradeShares, maxAffordable, Math.max(0, capShares - portfolio.shares));
    if (quantity >= 1) {
      return { action: 'BUY', quantity };
    }
  } else {
    const quantity = Math.min(tradeShares, portfolio.shares);
    if (quantity >= 1) {
      return { action: 'SELL', quantity };
    }
  }

  return { action: 'HOLD' };
}

runBot<Observation, Action>({
  decideAction,
  onInit: (init) => {
    config = init.config as Config;
  },
});
