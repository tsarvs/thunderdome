import { err, ok, type GameDefinition, type Rng, type StandingOutcome } from '@thunderdome/engine';
import {
  STOCK_MARKET_EVENT_TYPES,
  StockMarketActionSchema,
  StockMarketConfigSchema,
  type StockMarketAction,
  type StockMarketConfig,
  type StockMarketEvent,
  type StockMarketEventType,
  type StockMarketEventsConfig,
  type StockMarketObservation,
  type StockMarketPortfolio,
  type StockMarketResult,
  type StockMarketState,
} from './types.js';

// ---------------------------------------------------------------------------
// Money — everything a bot can trade or hold is tracked in integer cents so BUY/SELL/fee
// arithmetic never drifts (docs section 20: "do not rely on floating-point equality for
// accounting"). Only the hidden, never-serialized fundamental value stays a plain dollar float.
// ---------------------------------------------------------------------------

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function toDollars(cents: number): number {
  return cents / 100;
}

/** Every fee/trade-value computation here is non-negative, so plain round-half-up is exact and
 * unambiguous — no need for a full banker's-rounding implementation. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function feeCentsFor(tradeValueCents: number, config: StockMarketConfig): number {
  return roundHalfUp(tradeValueCents * config.transactionFee);
}

// A wide-ish but still "reasonable stock price" range — centered on the old fixed $100 default,
// so a random draw doesn't swing so far that a bot's usual fixed-share-count sizing (most
// reference bots trade in a fixed ~10-20 share range regardless of price) stops making sense.
const RANDOM_STARTING_PRICE_MIN = 50;
const RANDOM_STARTING_PRICE_MAX = 200;

/** `config.startingStockPrice` given explicitly: use it as-is (already validated against
 * `minimumStockPrice` at parse time). Omitted: draw uniformly from a fixed range instead — and,
 * since that range can't be validated against a caller's own `minimumStockPrice` until now,
 * clamped up to it defensively so a high custom minimum can never be violated by the draw. */
function resolveStartingStockPrice(config: StockMarketConfig, rng: Rng): number {
  if (config.startingStockPrice !== undefined) {
    return config.startingStockPrice;
  }
  const range = RANDOM_STARTING_PRICE_MAX - RANDOM_STARTING_PRICE_MIN;
  const randomPrice = RANDOM_STARTING_PRICE_MIN + rng.nextFloat() * range;
  return Math.max(randomPrice, config.minimumStockPrice);
}

// ---------------------------------------------------------------------------
// Market events — a type's `weight` (its odds of being drawn) is the only part of
// `StockMarketEventsConfigSchema` (types.ts) a bot ever sees; `baselineMultiplier`/`volatility`
// stay organizer-only (`redactConfigForBots`, below) and the ACTUAL multiplier used for any given
// draw is never today's fixed baseline table — it's a per-match, per-type random value that keeps
// wandering for the rest of the match (`eventEffectRatios` below), precisely so no bot, including
// one that's read this very source file, can rely on a known fixed effect size. Descriptions stay
// fixed per-type — the news headline itself isn't something a match organizer tunes for balance.
// ---------------------------------------------------------------------------

const EVENT_DESCRIPTIONS: Record<StockMarketEventType, string> = {
  NO_NEWS: 'No significant news today.',
  POSITIVE_NEWS: 'General positive news about the company circulated today.',
  NEGATIVE_NEWS: 'General negative news about the company circulated today.',
  ANALYST_UPGRADE: 'An analyst upgraded their rating on the company.',
  ANALYST_DOWNGRADE: 'An analyst downgraded their rating on the company.',
  PRODUCT_SUCCESS: 'The company announced a successful new product.',
  PRODUCT_FAILURE: 'The company announced a failed product launch.',
  EARNINGS_BEAT: 'The company reported earnings significantly above expectations.',
  EARNINGS_MISS: 'The company reported earnings significantly below expectations.',
};

/** A per-occurrence drift step is this fraction of the type's own `volatility` at most — small
 * enough that a type drawn repeatedly wanders gradually within its corridor rather than jumping
 * straight between its extremes on consecutive draws. */
const EFFECT_RATIO_DRIFT_FRACTION = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The per-match starting point for every event type's effect ratio — one uniform draw per type,
 * within `[1 - volatility, 1 + volatility]`. `volatility: 0` collapses that range to exactly
 * `{1}`, which is what makes it a fully deterministic, backward-compatible mode. */
function initialEffectRatios(
  rng: Rng,
  eventsConfig: StockMarketEventsConfig,
): Record<StockMarketEventType, number> {
  const ratios = {} as Record<StockMarketEventType, number>;
  for (const type of STOCK_MARKET_EVENT_TYPES) {
    const { volatility } = eventsConfig[type];
    ratios[type] = 1 + (rng.nextFloat() * 2 - 1) * volatility;
  }
  return ratios;
}

/** One bounded random-walk step, reflected back into the corridor instead of hard-clamped at its
 * edge — so a ratio that wanders out to a boundary bounces back in rather than sticking there. */
function driftEffectRatio(currentRatio: number, volatility: number, rng: Rng): number {
  if (volatility === 0) {
    return 1;
  }
  const maxStep = volatility * EFFECT_RATIO_DRIFT_FRACTION;
  const stepped = currentRatio + (rng.nextFloat() * 2 - 1) * maxStep;
  const min = 1 - volatility;
  const max = 1 + volatility;
  const reflected =
    stepped < min ? min + (min - stepped) : stepped > max ? max - (stepped - max) : stepped;
  return clamp(reflected, min, max);
}

/** `baselineMultiplier - 1` is the event's baseline *effect*; scaling that effect itself by the
 * drifted ratio (rather than scaling the multiplier directly) is what makes `NO_NEWS` — whose
 * baseline effect is exactly 0 — mathematically unaffected by its ratio no matter what it is. */
function actualMultiplierFor(baselineMultiplier: number, effectRatio: number): number {
  return 1 + (baselineMultiplier - 1) * effectRatio;
}

interface DrawnEvent {
  type: StockMarketEventType;
  /** Multiplied directly into the hidden fundamental value — never exposed via the observation
   * (or, unlike the old fixed baseline table, via config either). */
  actualMultiplier: number;
  /** This type's post-drift ratio, to be persisted back into `StockMarketState.eventEffectRatios`. */
  nextEffectRatio: number;
}

function drawEvent(
  rng: Rng,
  eventsConfig: StockMarketEventsConfig,
  effectRatios: Record<StockMarketEventType, number>,
): DrawnEvent {
  const totalWeight = STOCK_MARKET_EVENT_TYPES.reduce(
    (sum, type) => sum + eventsConfig[type].weight,
    0,
  );
  let remaining = rng.nextFloat() * totalWeight;
  for (const type of STOCK_MARKET_EVENT_TYPES) {
    const definition = eventsConfig[type];
    remaining -= definition.weight;
    if (remaining < 0) {
      const nextEffectRatio = driftEffectRatio(effectRatios[type], definition.volatility, rng);
      return {
        type,
        actualMultiplier: actualMultiplierFor(definition.baselineMultiplier, nextEffectRatio),
        nextEffectRatio,
      };
    }
  }
  // Truly unreachable: rng.nextFloat() < 1, so `remaining` strictly decreases below 0 by the
  // time the loop has subtracted every weight (they sum to totalWeight), and
  // StockMarketEventsConfigSchema's own refine guarantees totalWeight > 0.
  throw new Error('drawEvent: exhausted the event table without a selection');
}

function publicEventOf(drawn: DrawnEvent): StockMarketEvent {
  return { type: drawn.type, description: EVENT_DESCRIPTIONS[drawn.type] };
}

// ---------------------------------------------------------------------------
// Observation / human interface helpers
// ---------------------------------------------------------------------------

function portfolioValueCents(portfolio: StockMarketPortfolio, priceCents: number): number {
  return portfolio.cashCents + portfolio.shares * priceCents;
}

function describeObservation(observation: StockMarketObservation): string {
  const { round, totalRounds, portfolio, market, event } = observation;
  const volume = market.lastRoundVolume;
  const volumeLine =
    volume === null
      ? ''
      : `Last round: ${String(volume.sharesBought)} bought, ${String(volume.sharesSold)} sold ` +
        `(net demand ${volume.netDemand >= 0 ? '+' : ''}${String(volume.netDemand)})\n`;

  return (
    `\nRound ${String(round + 1)}/${String(totalRounds)} — price $${market.price.toFixed(2)}\n` +
    `Portfolio: $${portfolio.cash.toFixed(2)} cash, ${String(portfolio.shares)} shares ` +
    `(value $${portfolio.value.toFixed(2)})\n` +
    volumeLine +
    (event.type === 'NO_NEWS' ? '' : `News: ${event.description}\n`) +
    'BUY <qty>, SELL <qty>, or HOLD? '
  );
}

/** Accepts "buy 10", "sell 5", "hold" (any case, extra whitespace) — anything else fails to
 * parse, so the CLI reprompts a human rather than forwarding a malformed action. */
function parseInput(raw: string): StockMarketAction | undefined {
  const parts = raw.trim().toLowerCase().split(/\s+/);
  const [word, quantityRaw] = parts;
  if (word === 'hold' && parts.length === 1) {
    return { action: 'HOLD' };
  }
  if ((word === 'buy' || word === 'sell') && quantityRaw !== undefined) {
    const quantity = Number(quantityRaw);
    if (Number.isInteger(quantity) && quantity > 0) {
      return { action: word === 'buy' ? 'BUY' : 'SELL', quantity };
    }
  }
  return undefined;
}

function describeAction(action: StockMarketAction): string {
  return action.action === 'HOLD' ? 'Held.' : `${action.action} ${String(action.quantity)} shares.`;
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export const stockMarket: GameDefinition<
  StockMarketConfig,
  StockMarketState,
  StockMarketObservation,
  StockMarketAction,
  StockMarketResult
> = {
  id: 'stock-market',
  version: '0.1.0',

  parseConfig(raw) {
    const result = StockMarketConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  redactConfigForBots(config) {
    const events = {} as Record<StockMarketEventType, { weight: number }>;
    for (const type of STOCK_MARKET_EVENT_TYPES) {
      events[type] = { weight: config.events[type].weight };
    }
    return { ...config, events };
  },

  initialize({ config, participantIds, rng }) {
    if (participantIds.length < 2) {
      throw new Error('stock-market requires at least 2 participants');
    }
    const startingCashCents = toCents(config.startingCash);
    const startingStockPrice = resolveStartingStockPrice(config, rng);
    const startingPriceCents = toCents(startingStockPrice);
    const portfolios = new Map(
      participantIds.map((id) => [id, { cashCents: startingCashCents, shares: 0 }]),
    );

    const eventEffectRatios = initialEffectRatios(rng, config.events);

    // The first round's event is drawn — and its effect on the fundamental value already
    // applied — before this state is ever handed to getObservation, so round 0 behaves exactly
    // like every other round (see resolve()'s matching look-ahead at the end of each round).
    const firstEvent = drawEvent(rng, config.events, eventEffectRatios);
    eventEffectRatios[firstEvent.type] = firstEvent.nextEffectRatio;

    return {
      participantIds: [...participantIds],
      config,
      round: 0,
      priceCents: startingPriceCents,
      startingStockPriceCents: startingPriceCents,
      fundamentalValue: startingStockPrice * firstEvent.actualMultiplier,
      priceHistoryCents: [startingPriceCents],
      currentEvent: publicEventOf(firstEvent),
      lastRoundVolume: null,
      portfolios,
      eventEffectRatios,
    };
  },

  getObservation(state, participantId) {
    const portfolio = state.portfolios.get(participantId);
    if (portfolio === undefined) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      portfolio: {
        cash: toDollars(portfolio.cashCents),
        shares: portfolio.shares,
        value: toDollars(portfolioValueCents(portfolio, state.priceCents)),
      },
      market: {
        price: toDollars(state.priceCents),
        priceHistory: state.priceHistoryCents.map(toDollars),
        lastRoundVolume: state.lastRoundVolume,
      },
      event: state.currentEvent,
    };
  },

  getPendingActions(state) {
    // Simultaneous, like Rock-Paper-Scissors: every participant acts every round, each blind to
    // the others' submissions (docs section 7's "no information advantage from turn order").
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  validateAction(state, participantId, raw) {
    const result = StockMarketActionSchema.safeParse(raw);
    if (!result.success) {
      return err(
        'action must be {"action":"BUY"|"SELL","quantity":<positive integer>} or {"action":"HOLD"}',
      );
    }
    const action = result.data;
    const portfolio = state.portfolios.get(participantId);
    if (portfolio === undefined) {
      return err(`unknown participant "${participantId}"`);
    }

    if (action.action === 'BUY') {
      const tradeValueCents = action.quantity * state.priceCents;
      const totalCostCents = tradeValueCents + feeCentsFor(tradeValueCents, state.config);
      if (totalCostCents > portfolio.cashCents) {
        return err(
          `insufficient cash: BUY ${String(action.quantity)} costs $${toDollars(totalCostCents).toFixed(2)}, have $${toDollars(portfolio.cashCents).toFixed(2)}`,
        );
      }
    } else if (action.action === 'SELL' && action.quantity > portfolio.shares) {
      return err(
        `insufficient shares: have ${String(portfolio.shares)}, tried to SELL ${String(action.quantity)}`,
      );
    }

    return ok(action);
  },

  resolve({ state, actions, rng }) {
    const nextPortfolios = new Map(state.portfolios);
    let sharesBought = 0;
    let sharesSold = 0;
    const resolvedActions: Record<string, StockMarketAction> = {};

    for (const participantId of state.participantIds) {
      // onMissingAction always substitutes a real HOLD (see below), so this default is only a
      // defensive fallback, never actually exercised in a real match.
      const action: StockMarketAction = actions.get(participantId) ?? { action: 'HOLD' };
      resolvedActions[participantId] = action;
      const portfolio = nextPortfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }

      if (action.action === 'BUY') {
        const tradeValueCents = action.quantity * state.priceCents;
        const totalCostCents = tradeValueCents + feeCentsFor(tradeValueCents, state.config);
        // Re-checked defensively — validateAction already guarantees this for anything that
        // reached here through the normal path, but a substituted action bypasses it.
        if (totalCostCents <= portfolio.cashCents) {
          nextPortfolios.set(participantId, {
            cashCents: portfolio.cashCents - totalCostCents,
            shares: portfolio.shares + action.quantity,
          });
          sharesBought += action.quantity;
        }
      } else if (action.action === 'SELL' && action.quantity <= portfolio.shares) {
        const tradeValueCents = action.quantity * state.priceCents;
        const feeCents = feeCentsFor(tradeValueCents, state.config);
        nextPortfolios.set(participantId, {
          cashCents: portfolio.cashCents + tradeValueCents - feeCents,
          shares: portfolio.shares - action.quantity,
        });
        sharesSold += action.quantity;
      }
    }

    // Square-root impact, not linear: real order-flow impact has diminishing marginal effect as
    // trade size grows (the standard "square-root law" practitioners use — see
    // StockMarketConfigSchema's `marketImpactFactor` doc for the calibration formula), unlike a
    // linear model where impact per share never tapers off, letting a run of same-direction
    // trades in a growing portfolio spiral into runaway price feedback.
    const netDemand = sharesBought - sharesSold;
    const marketPressure = Math.sign(netDemand) * state.config.marketImpactFactor * Math.sqrt(Math.abs(netDemand));

    const priceDollars = toDollars(state.priceCents);
    const fundamentalPressure =
      ((state.fundamentalValue - priceDollars) / priceDollars) * state.config.meanReversionFactor;

    const shockRange = state.config.randomShock.max - state.config.randomShock.min;
    const randomShock = state.config.randomShock.min + rng.nextFloat() * shockRange;

    const priceChange = randomShock + fundamentalPressure + marketPressure;
    const minimumPriceCents = toCents(state.config.minimumStockPrice);
    const newPriceCents = Math.max(
      minimumPriceCents,
      Math.round(priceDollars * (1 + priceChange) * 100),
    );

    const priceHistoryCents = [...state.priceHistoryCents, newPriceCents].slice(
      -state.config.priceHistoryLength,
    );

    // Next round's event, drawn now so it — and its already-applied effect on the fundamental
    // value — is ready the moment getObservation is next called (same look-ahead initialize()
    // does for round 0).
    const nextEvent = drawEvent(rng, state.config.events, state.eventEffectRatios);
    const nextFundamentalValue = state.fundamentalValue * nextEvent.actualMultiplier;
    const nextEventEffectRatios = {
      ...state.eventEffectRatios,
      [nextEvent.type]: nextEvent.nextEffectRatio,
    };

    const lastRoundVolume = { sharesBought, sharesSold, netDemand };

    const nextState: StockMarketState = {
      ...state,
      round: state.round + 1,
      priceCents: newPriceCents,
      fundamentalValue: nextFundamentalValue,
      priceHistoryCents,
      currentEvent: publicEventOf(nextEvent),
      lastRoundVolume,
      portfolios: nextPortfolios,
      eventEffectRatios: nextEventEffectRatios,
    };

    return {
      nextState,
      events: [
        {
          type: 'round-result',
          participantIds: state.participantIds,
          data: {
            round: state.round,
            startingPrice: priceDollars,
            event: state.currentEvent,
            actions: resolvedActions,
            market: {
              sharesBought,
              sharesSold,
              netDemand,
              randomShock,
              fundamentalPressure,
              marketPressure,
            },
            endingPrice: toDollars(newPriceCents),
          },
        },
      ],
    };
  },

  // Any missing, invalid, or timed-out submission simply resolves to HOLD — never a match
  // forfeit (docs section 19's explicit default; unconditional, unlike Rock-Paper-Scissors'
  // config-gated onMissingAction).
  onMissingAction() {
    return { policy: 'substitute', action: { action: 'HOLD' } };
  },

  isTerminal(state) {
    return state.round >= state.config.rounds;
  },

  getResult(state) {
    const scores: Record<string, number> = {};
    const cash: Record<string, number> = {};
    const shares: Record<string, number> = {};
    for (const participantId of state.participantIds) {
      const portfolio = state.portfolios.get(participantId);
      if (portfolio === undefined) {
        continue;
      }
      scores[participantId] = toDollars(portfolioValueCents(portfolio, state.priceCents));
      cash[participantId] = toDollars(portfolio.cashCents);
      shares[participantId] = portfolio.shares;
    }

    const bestScore = Math.max(...Object.values(scores));
    const leaders = state.participantIds.filter((id) => scores[id] === bestScore);

    return {
      participantIds: state.participantIds,
      scores,
      cash,
      shares,
      startingStockPrice: toDollars(state.startingStockPriceCents),
      finalStockPrice: toDollars(state.priceCents),
      roundsPlayed: state.round,
      winnerId: leaders.length === 1 ? (leaders[0] ?? null) : null,
    };
  },

  getStandingOutcomes(result) {
    const ids = result.participantIds;
    const scoreOf = (id: string): number => result.scores[id] ?? 0;
    const bestScore = Math.max(...ids.map(scoreOf));
    const bestIds = ids.filter((id) => scoreOf(id) === bestScore);

    return ids.map((id) => {
      const rank = 1 + ids.filter((other) => scoreOf(other) > scoreOf(id)).length;
      const outcome: NonNullable<StandingOutcome['outcome']> =
        bestIds.length > 1
          ? bestIds.includes(id)
            ? 'draw'
            : 'loss'
          : id === bestIds[0]
            ? 'win'
            : 'loss';
      return { participantId: id, rank, score: scoreOf(id), outcome };
    });
  },

  resourceLimits: {
    cpus: 0.5,
    memoryMb: 128,
    turnTimeoutMs: 5000,
  },

  humanInterface: { describeObservation, parseInput, describeAction },
};
