/**
 * Market Neutral — a reference bot for the "stock-market-3" game.
 *
 * Picks the strongest recent performers among the active equities, then hedges away the market-
 * wide (index) exposure those picks carry by shorting SYNTH_INDEX in proportion to each pick's
 * own estimated beta — a beta-weighted long book plus an index short sized to net that book's
 * exposure to roughly zero, so P&L should mostly reflect stock-specific performance rather than
 * "the whole market went up or down today" (spec §19's market-neutral trading example).
 *
 * Beta is estimated the way a real trader would: the slope of each equity's own trailing returns
 * regressed against the index's trailing returns, both computed only from public `priceHistory` —
 * never anything the simulator considers hidden. When this match's config doesn't allow short
 * selling (so there's no way to actually short the index), the bot falls back to holding the
 * same long picks unhedged rather than failing outright.
 *
 * No randomness is needed, so `onInit`/`rngSeed` is unused here.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const BETA_LOOKBACK_ROUNDS = 60;
const MOMENTUM_LOOKBACK_ROUNDS = 20;
const LONG_COUNT = 3;
const REBALANCE_INTERVAL_ROUNDS = 10;
/** Fraction of net liquidation value deployed across the long book — modest on purpose (the index
 * hedge is sized off this, so keeping the long book small keeps both legs realistic). */
const TARGET_GROSS_FRACTION = 0.25;

function logReturns(history) {
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1].close;
    const current = history[i].close;
    if (previous > 0 && current > 0) {
      returns.push(Math.log(current / previous));
    }
  }
  return returns;
}

function momentumScore(security) {
  const history = security.priceHistory;
  if (history.length <= MOMENTUM_LOOKBACK_ROUNDS) {
    return null;
  }
  const recent = history[history.length - 1];
  const past = history[history.length - 1 - MOMENTUM_LOOKBACK_ROUNDS];
  if (recent.close <= 0 || past.close <= 0) {
    return null;
  }
  return Math.log(recent.close / past.close);
}

/** Ordinary-least-squares slope of `equityReturns` on `indexReturns` over their common trailing
 * window — the textbook definition of beta. `null` when there isn't enough shared history yet, or
 * the index itself hasn't moved at all in that window (a zero-variance regressor). */
function estimateBeta(equityReturns, indexReturns) {
  const n = Math.min(equityReturns.length, indexReturns.length);
  if (n < BETA_LOOKBACK_ROUNDS) {
    return null;
  }
  const eq = equityReturns.slice(-n);
  const idx = indexReturns.slice(-n);
  const meanEq = eq.reduce((sum, v) => sum + v, 0) / n;
  const meanIdx = idx.reduce((sum, v) => sum + v, 0) / n;
  let covariance = 0;
  let indexVariance = 0;
  for (let i = 0; i < n; i++) {
    const de = eq[i] - meanEq;
    const di = idx[i] - meanIdx;
    covariance += de * di;
    indexVariance += di * di;
  }
  return indexVariance === 0 ? null : covariance / indexVariance;
}

function currentShares(observation, symbol) {
  const position = observation.portfolio.positions.find((p) => p.symbol === symbol);
  return position ? position.shares : 0;
}

function rebalanceTo(orders, observation, symbol, targetShares) {
  const delta = Math.round(targetShares - currentShares(observation, symbol));
  if (delta === 0) {
    return;
  }
  orders.push({ kind: 'MARKET', symbol, side: delta > 0 ? 'BUY' : 'SELL', quantity: Math.abs(delta) });
}

function decideAction(observation) {
  if (observation.phase === 'WARMUP' || observation.round % REBALANCE_INTERVAL_ROUNDS !== 0) {
    return { orders: [] };
  }

  const indexSecurity = observation.securities.find((security) => security.symbol === observation.indexSymbol);
  if (indexSecurity === undefined) {
    return { orders: [] };
  }
  const indexReturns = logReturns(indexSecurity.priceHistory);

  const picks = observation.securities
    .filter((security) => security.kind === 'EQUITY')
    .map((security) => ({
      security,
      beta: estimateBeta(logReturns(security.priceHistory), indexReturns),
      momentum: momentumScore(security),
    }))
    .filter((candidate) => candidate.beta !== null && candidate.momentum !== null)
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, LONG_COUNT);

  const selectedSymbols = new Set(picks.map((p) => p.security.symbol));
  selectedSymbols.add(observation.indexSymbol);
  const orders = [];

  for (const position of observation.portfolio.positions) {
    if (selectedSymbols.has(position.symbol) || position.shares === 0) {
      continue;
    }
    orders.push({
      kind: 'MARKET',
      symbol: position.symbol,
      side: position.shares > 0 ? 'SELL' : 'BUY',
      quantity: Math.abs(position.shares),
    });
  }

  const nlv = observation.portfolio.nlv;
  const perNameDollars = picks.length > 0 ? (nlv * TARGET_GROSS_FRACTION) / picks.length : 0;
  let weightedBetaDollars = 0;

  for (const { security, beta } of picks) {
    const price = security.quote.ask ?? security.quote.lastClose;
    if (price <= 0) {
      continue;
    }
    const targetShares = Math.floor(perNameDollars / price);
    weightedBetaDollars += beta * targetShares * price;
    rebalanceTo(orders, observation, security.symbol, targetShares);
  }

  const canShort = observation.portfolio.buyingPower > 0;
  if (canShort) {
    const indexPrice = indexSecurity.quote.bid ?? indexSecurity.quote.lastClose;
    const hedgeShares = indexPrice > 0 ? -Math.floor(weightedBetaDollars / indexPrice) : 0;
    rebalanceTo(orders, observation, observation.indexSymbol, hedgeShares);
  } else {
    // No margin account available in this match's config -> can't short the index to hedge.
    // Stay long-only rather than failing: close out any stale index hedge from an earlier round.
    rebalanceTo(orders, observation, observation.indexSymbol, 0);
  }

  return { orders };
}

runBot({ decideAction });
