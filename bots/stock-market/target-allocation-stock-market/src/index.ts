/**
 * Target Allocation Stock Market — rebalances toward keeping roughly half its portfolio value in
 * shares: buys when shares have drifted meaningfully below that target share of its portfolio,
 * sells when they've drifted meaningfully above it, holds inside a small tolerance band. Unlike
 * the other reference bots for this game, this one reacts to its own portfolio's composition
 * rather than to price trend or news.
 * The Observation/Action types below are copied from games/stock-market/src/types.ts, so
 * there's one thing left to do here: implement decideAction().
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

const TARGET_ALLOCATION = 0.5; // aim to keep roughly half of portfolio value in shares
const REBALANCE_BAND = 0.05; // don't bother trading for drift smaller than 5% of portfolio value
const MAX_TRADE_QUANTITY = 10;

function decideAction(observation: Observation): Action {
  const { portfolio, market } = observation;
  const currentShareValue = portfolio.shares * market.price;
  const targetShareValue = portfolio.value * TARGET_ALLOCATION;
  const driftValue = targetShareValue - currentShareValue;
  const band = portfolio.value * REBALANCE_BAND;

  if (driftValue > band) {
    const maxAffordable = Math.floor((portfolio.cash * 0.99) / market.price);
    const quantity = Math.min(
      maxAffordable,
      Math.floor(driftValue / market.price),
      MAX_TRADE_QUANTITY,
    );
    if (quantity >= 1) {
      return { action: 'BUY', quantity };
    }
  } else if (driftValue < -band) {
    const quantity = Math.min(
      portfolio.shares,
      Math.floor(-driftValue / market.price),
      MAX_TRADE_QUANTITY,
    );
    if (quantity >= 1) {
      return { action: 'SELL', quantity };
    }
  }

  return { action: 'HOLD' };
}

runBot<Observation, Action>({ decideAction });
