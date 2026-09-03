import { err, ok, type GameDefinition, type Rng, type StandingOutcome } from '@thunderdome/engine';
import {
  StockMarketActionSchema,
  StockMarketConfigSchema,
  type StockMarketAction,
  type StockMarketConfig,
  type StockMarketEvent,
  type StockMarketEventType,
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

// ---------------------------------------------------------------------------
// Market events — the fundamental-value effect of each event type, and the (fixed, not
// config-driven) probability of it being drawn any given round. Weights sum to 100; NO_NEWS
// dominates so an event-driven strategy actually has to wait for a real signal.
// ---------------------------------------------------------------------------

interface EventDefinition {
  type: StockMarketEventType;
  description: string;
  /** Multiplied directly into the hidden fundamental value — never exposed to a bot. */
  fundamentalMultiplier: number;
  weight: number;
}

const EVENT_TABLE: readonly EventDefinition[] = [
  {
    type: 'NO_NEWS',
    description: 'No significant news today.',
    fundamentalMultiplier: 1.0,
    weight: 60,
  },
  {
    type: 'POSITIVE_NEWS',
    description: 'General positive news about the company circulated today.',
    fundamentalMultiplier: 1.02,
    weight: 8,
  },
  {
    type: 'NEGATIVE_NEWS',
    description: 'General negative news about the company circulated today.',
    fundamentalMultiplier: 0.98,
    weight: 8,
  },
  {
    type: 'ANALYST_UPGRADE',
    description: 'An analyst upgraded their rating on the company.',
    fundamentalMultiplier: 1.03,
    weight: 6,
  },
  {
    type: 'ANALYST_DOWNGRADE',
    description: 'An analyst downgraded their rating on the company.',
    fundamentalMultiplier: 0.97,
    weight: 6,
  },
  {
    type: 'PRODUCT_SUCCESS',
    description: 'The company announced a successful new product.',
    fundamentalMultiplier: 1.04,
    weight: 5,
  },
  {
    type: 'PRODUCT_FAILURE',
    description: 'The company announced a failed product launch.',
    fundamentalMultiplier: 0.96,
    weight: 5,
  },
  {
    type: 'EARNINGS_BEAT',
    description: 'The company reported earnings significantly above expectations.',
    fundamentalMultiplier: 1.05,
    weight: 1,
  },
  {
    type: 'EARNINGS_MISS',
    description: 'The company reported earnings significantly below expectations.',
    fundamentalMultiplier: 0.95,
    weight: 1,
  },
];

const TOTAL_EVENT_WEIGHT = EVENT_TABLE.reduce((sum, event) => sum + event.weight, 0);

function drawEvent(rng: Rng): EventDefinition {
  let remaining = rng.nextFloat() * TOTAL_EVENT_WEIGHT;
  for (const event of EVENT_TABLE) {
    remaining -= event.weight;
    if (remaining < 0) {
      return event;
    }
  }
  // Truly unreachable: rng.nextFloat() < 1, so `remaining` strictly decreases below 0 by the
  // time the loop has subtracted every weight (they sum to TOTAL_EVENT_WEIGHT).
  throw new Error('drawEvent: exhausted EVENT_TABLE without a selection');
}

function publicEventOf(event: EventDefinition): StockMarketEvent {
  return { type: event.type, description: event.description };
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

  initialize({ config, participantIds, rng }) {
    if (participantIds.length < 2) {
      throw new Error('stock-market requires at least 2 participants');
    }
    const startingCashCents = toCents(config.startingCash);
    const startingPriceCents = toCents(config.startingStockPrice);
    const portfolios = new Map(
      participantIds.map((id) => [id, { cashCents: startingCashCents, shares: 0 }]),
    );

    // The first round's event is drawn — and its effect on the fundamental value already
    // applied — before this state is ever handed to getObservation, so round 0 behaves exactly
    // like every other round (see resolve()'s matching look-ahead at the end of each round).
    const firstEvent = drawEvent(rng);

    return {
      participantIds: [...participantIds],
      config,
      round: 0,
      priceCents: startingPriceCents,
      fundamentalValue: config.startingStockPrice * firstEvent.fundamentalMultiplier,
      priceHistoryCents: [startingPriceCents],
      currentEvent: publicEventOf(firstEvent),
      lastRoundVolume: null,
      portfolios,
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

    const netDemand = sharesBought - sharesSold;
    const marketPressure = netDemand * state.config.marketImpactFactor;

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
    const nextEvent = drawEvent(rng);
    const nextFundamentalValue = state.fundamentalValue * nextEvent.fundamentalMultiplier;

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
      startingStockPrice: state.config.startingStockPrice,
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
