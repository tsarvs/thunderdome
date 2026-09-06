/**
 * Tominator T-70 — Stock Market 2 — a port of `bots/stock-market/tominator-t70` onto the real-
 * historical-data variant of the game. Same "react to a signed event, estimate its magnitude
 * empirically, size a trade as a fraction of portfolio value, hold the resulting position until
 * the next signed event, cap any single trade's own market impact" shape.
 *
 * Ported again for stock-market-2's rebuilt exchange (real order book, bid/ask spread, limit
 * orders, multi-order submissions): this bot still only ever submits a single MARKET order per
 * round (it has no use for limit orders or GTC persistence — it reacts once per event and holds).
 * `market.price` (the single pre-trade tradable price the old exchange exposed) no longer exists;
 * this bot uses `market.lastClose` (yesterday's realized close) for tracking the realized
 * event-to-event return, same role the old single price played across rounds, and the current
 * bid/ask midpoint (falling back to `lastClose` before any quotes exist) for sizing a trade against
 * what a market order will actually roughly cost right now.
 *
 * The old game exposed a `config.marketImpactFactor` scalar this bot used to cap its own trade
 * size against a formula-estimated impact; the new exchange has no such scalar (impact now comes
 * organically from walking a real, visible order book — see games/stock-market-2/src/types.ts's
 * `LiquidityProfile` doc). This version caps its own impact against the *actually observed*
 * top-of-book depth instead (`market.askSize`/`market.bidSize`) — a more direct, and more
 * realistic, self-impact guard than the old formula ever was.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

interface Observation {
  round: number;
  totalRounds: number;
  symbol: string;
  portfolio: {
    cash: number;
    shares: number;
    value: number;
    availableCash: number;
    availableShares: number;
  };
  market: {
    date: string;
    lastClose: number;
    bid: number | null;
    ask: number | null;
    bidSize: number;
    askSize: number;
    priceHistory: unknown[];
    lastRoundVolume: { sharesBought: number; sharesSold: number; netDemand: number } | null;
  };
  event: {
    type: string;
    description: string;
  };
}

type Action = { orders: Array<{ kind: 'MARKET'; side: 'BUY' | 'SELL'; quantity: number }> };

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

// Tuning constants — same roles as the original bot's (see its docstring for the full
// rationale); only BASE_MAGNITUDE_PRIOR split into an earnings/news pair, replacing the
// weight-derived prior this game's config has never had a way to express.
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
const MAX_EXPOSURE_FRACTION = 0.95;
/** Never try to take more than this fraction of the visible top-of-book depth in one round — a
 * direct, observable stand-in for the old formula-based self-impact cap. */
const MAX_SHARE_OF_VISIBLE_DEPTH = 0.5;

let initialized = false;
let lastClose: number | undefined;
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

function magnitudePriorFor(type: string): number {
  return clamp(
    EARNINGS_TYPES.has(type) ? BASE_MAGNITUDE_PRIOR_EARNINGS : BASE_MAGNITUDE_PRIOR_NEWS,
    MIN_MAGNITUDE_PRIOR,
    MAX_MAGNITUDE_PRIOR,
  );
}

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

/** What a market order would roughly cost/receive right now — the bid/ask midpoint once quotes
 * exist, falling back to the last realized close before round 0 has any. */
function currentPriceEstimate(market: Observation['market']): number {
  return market.bid !== null && market.ask !== null ? (market.bid + market.ask) / 2 : market.lastClose;
}

function decideAction(observation: Observation): Action {
  const hold: Action = { orders: [] };
  if (!initialized) {
    return hold;
  }

  const { portfolio, market, event } = observation;

  if (lastClose !== undefined && lastEventType !== undefined) {
    recordObservation(lastEventType, Math.log(market.lastClose / lastClose));
  }
  lastClose = market.lastClose;
  lastEventType = event.type;

  const sign = EVENT_SIGN[event.type];
  if (sign === undefined) {
    return hold;
  }

  const price = currentPriceEstimate(market);
  const magnitude = magnitudeFor(event.type);
  const tradeFraction = clamp(magnitude * SENSITIVITY, MIN_TRADE_FRACTION, MAX_TRADE_FRACTION_PER_EVENT);
  const visibleDepth = sign > 0 ? market.askSize : market.bidSize;
  const impactCapQuantity = Math.max(1, Math.round(visibleDepth * MAX_SHARE_OF_VISIBLE_DEPTH));
  const tradeShares = Math.max(1, Math.min(impactCapQuantity, Math.round((tradeFraction * portfolio.value) / price)));

  if (sign > 0) {
    const capShares = Math.floor((MAX_EXPOSURE_FRACTION * portfolio.value) / price);
    const maxAffordable = Math.floor((portfolio.availableCash * 0.99) / price);
    const quantity = Math.min(tradeShares, maxAffordable, Math.max(0, capShares - portfolio.shares));
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'BUY', quantity }] };
    }
  } else {
    const quantity = Math.min(tradeShares, portfolio.availableShares);
    if (quantity >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'SELL', quantity }] };
    }
  }

  return hold;
}

runBot<Observation, Action>({
  decideAction,
  onInit: () => {
    initialized = true;
  },
});
