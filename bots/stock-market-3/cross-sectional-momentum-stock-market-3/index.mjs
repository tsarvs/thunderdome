/**
 * Cross-Sectional Momentum — a reference bot for the "stock-market-3" game.
 *
 * Ranks every active equity by its own trailing return and goes long the strongest performers
 * (shorting the weakest too, when the match config leaves margin/short-selling available) —
 * the classic cross-sectional momentum trade, computed only from `priceHistory`, which is the
 * same public information every bot in the match receives. Rebalances periodically rather than
 * every round, to keep turnover (and transaction fees) down.
 *
 * No randomness is needed, so `onInit`/`rngSeed` is unused here.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const LOOKBACK_ROUNDS = 20;
const REBALANCE_INTERVAL_ROUNDS = 10;
const LONG_COUNT = 2;
const SHORT_COUNT = 2;
/** Fraction of net liquidation value deployed per side (long or short) — deliberately modest
 * (well under 1x total gross even on both sides at once) so this reference bot's results read as
 * a realistic momentum strategy rather than a leveraged, concentrated bet. */
const TARGET_GROSS_FRACTION = 0.25;

function momentumScore(security) {
  const history = security.priceHistory;
  if (history.length <= LOOKBACK_ROUNDS) {
    return null; // not enough history yet to score this security
  }
  const recent = history[history.length - 1];
  const past = history[history.length - 1 - LOOKBACK_ROUNDS];
  if (recent.close <= 0 || past.close <= 0) {
    return null;
  }
  return Math.log(recent.close / past.close);
}

function currentShares(observation, symbol) {
  const position = observation.portfolio.positions.find((p) => p.symbol === symbol);
  return position ? position.shares : 0;
}

/** Emits at most one order moving `symbol` from its current position toward `targetShares` — a
 * MARKET order sized to the exact delta, so repeated calls across rounds converge on the target
 * rather than re-trading the full size every time. */
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

  const candidates = observation.securities
    .filter((security) => security.kind === 'EQUITY')
    .map((security) => ({ security, score: momentumScore(security) }))
    .filter((candidate) => candidate.score !== null)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { orders: [] };
  }

  // Buying power is only ever non-zero when this match's config has short selling/margin turned
  // on (spec: RiskConfig.allowShortSelling) — a bot can observe that indirectly through its own
  // portfolio rather than needing to know the config directly.
  const canShort = observation.portfolio.buyingPower > 0;
  const longs = candidates.slice(0, LONG_COUNT);
  const longSymbols = new Set(longs.map((c) => c.security.symbol));
  const shorts = canShort
    ? candidates
        .slice(-SHORT_COUNT)
        .reverse()
        .filter((c) => !longSymbols.has(c.security.symbol))
    : [];

  const selectedSymbols = new Set([...longs, ...shorts].map((c) => c.security.symbol));
  const orders = [];

  // Close out anything that fell out of both baskets since the last rebalance.
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
  const perLongDollars = longs.length > 0 ? (nlv * TARGET_GROSS_FRACTION) / longs.length : 0;
  const perShortDollars = shorts.length > 0 ? (nlv * TARGET_GROSS_FRACTION) / shorts.length : 0;

  for (const { security } of longs) {
    const price = security.quote.ask ?? security.quote.lastClose;
    if (price > 0) {
      rebalanceTo(orders, observation, security.symbol, Math.floor(perLongDollars / price));
    }
  }
  for (const { security } of shorts) {
    const price = security.quote.bid ?? security.quote.lastClose;
    if (price > 0) {
      rebalanceTo(orders, observation, security.symbol, -Math.floor(perShortDollars / price));
    }
  }

  return { orders };
}

runBot({ decideAction });
