/**
 * Tominator T-900 — a reference bot for the "stock-market-3" game.
 *
 * Both other reference bots (cross-sectional-momentum, market-neutral) trade exclusively on raw
 * price momentum with a 20-round lookback, a static 10-round rebalance cadence, a fixed 0.25 NLV
 * gross fraction, and plain MARKET orders — and never read `analystRevisionHistory`, `events`,
 * or `calendar` at all. This bot targets exactly those blind spots:
 *
 *  1. A momentum lookback chosen in-match, not copied from the simulator's own source: it tests a
 *     handful of candidate windows against this match's own price history (does an N-round
 *     trailing return actually predict the next few rounds' return?) and uses whichever one has
 *     shown the strongest such evidence so far — the same idea a real quant tests empirically,
 *     never a number read out of games/stock-market-3/src/market/priceModel.ts.
 *  2. A "distance from its own trailing average price" term whose window is chosen the same
 *     empirical way — favors names that haven't over-extended, using whichever candidate window
 *     shows the strongest mean-reversion evidence so far, not a copied constant either.
 *  3. An analyst-revision-trend term: this quarter's consensus EPS estimate tends to converge
 *     toward the still-hidden truth round by round, so an improving trend is a genuine signal a
 *     pure price-momentum bot never sees.
 *  4. A dedicated fixed-payout arbitrage overlay: a pending ACQUISITION or DELISTING pays a FIXED
 *     cash price at a known future round regardless of what the market price does between now and
 *     then (see `company/lifecycle.ts`) — buying below that price and holding to maturity is a
 *     locked-in gain neither other bot ever looks for.
 *  5. Risk-scaled sizing: gross exposure shrinks under drawdown and under elevated realized
 *     volatility (a regime proxy), rather than a single static fraction regardless of conditions.
 *  6. Liquidity-aware LIMIT orders that walk the visible order book to a bounded worst price,
 *     instead of unbounded MARKET orders.
 *  7. Light hysteresis (hold a name a little past its strict rank cutoff) to cut fee/spread churn
 *     from continuous, every-round rebalancing.
 *
 * No randomness is needed, so `onInit`/`rngSeed` is unused here.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

// Candidate lookback windows this bot tests against its own accumulated price history rather
// than assuming — see `selectMomentumWindow`/`selectValueWindow` below.
const MOMENTUM_CANDIDATE_WINDOWS = [5, 10, 15, 20, 30];
const VALUE_CANDIDATE_WINDOWS = [20, 30, 40, 60, 80];
const IC_HOLDING_HORIZON_ROUNDS = 5; // how far forward a candidate window's signal is checked
const MIN_IC_SAMPLES = 30; // don't trust a candidate window's evidence below this many data points
const DEFAULT_MOMENTUM_WINDOW = 10; // used only before there's enough history to test any candidate
const DEFAULT_VALUE_WINDOW = 40; // same — a cold-start guess, not a belief about the true window
const VOL_LOOKBACK_ROUNDS = 10;
const BASELINE_INDEX_VOL = 0.015; // rough "calm regime" daily-return stdev to scale against

const LONG_COUNT = 3;
const SHORT_COUNT = 3;
const LONG_HYSTERESIS_EXTRA = 2; // an already-held name inside top (LONG_COUNT + this) stays held
const SHORT_HYSTERESIS_EXTRA = 2;

const MOMENTUM_WEIGHT = 0.6;
const REVISION_WEIGHT = 0.25;
const VALUE_WEIGHT = 0.15; // applied against the raw gap (being far above trend is penalized)

const BASE_GROSS_FRACTION = 0.3;
const MIN_GROSS_FRACTION = 0.05;
const MAX_GROSS_FRACTION = 0.42;

const ARB_MAX_FRACTION_PER_NAME = 0.2;
const ARB_MAX_TOTAL_FRACTION = 0.4;
const ARB_DISCOUNT_THRESHOLD = 0.995; // only buy in when ask is at least 0.5% below the payout

const MAX_ORDERS_PER_ROUND = 10;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdev(values) {
  if (values.length === 0) {
    return 0;
  }
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

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

function momentumScore(security, window) {
  const history = security.priceHistory;
  if (history.length <= window) {
    return null;
  }
  const recent = history[history.length - 1];
  const past = history[history.length - 1 - window];
  if (recent.close <= 0 || past.close <= 0) {
    return null;
  }
  return Math.log(recent.close / past.close);
}

/** Log-distance of the current close from its own trailing average close over `window` rounds.
 * Large and positive means "has run up far above its own recent trend," which we treat as a
 * headwind, not a tailwind. */
function valueGap(security, window) {
  const history = security.priceHistory;
  if (history.length <= window) {
    return null;
  }
  const recentWindow = history.slice(-window);
  const avgClose = mean(recentWindow.map((c) => c.close));
  const currentClose = history[history.length - 1].close;
  if (avgClose <= 0 || currentClose <= 0) {
    return null;
  }
  return Math.log(currentClose / avgClose);
}

/** The momentum signal `momentumScore` would have produced as of historical index `endIndex`,
 * using only candles at or before it — the building block `selectMomentumWindow` backtests with. */
function momentumSignalAt(history, endIndex, window) {
  const past = history[endIndex - window];
  const now = history[endIndex];
  if (past === undefined || past.close <= 0 || now.close <= 0) {
    return null;
  }
  return Math.log(now.close / past.close);
}

/** The value-gap signal `valueGap` would have produced as of historical index `endIndex`. */
function valueSignalAt(history, endIndex, window) {
  const start = endIndex - window + 1;
  if (start < 0) {
    return null;
  }
  let sum = 0;
  for (let i = start; i <= endIndex; i++) {
    sum += history[i].close;
  }
  const avgClose = sum / window;
  const currentClose = history[endIndex].close;
  if (avgClose <= 0 || currentClose <= 0) {
    return null;
  }
  return Math.log(currentClose / avgClose);
}

/** Pools (signal-as-of-that-round, realized-return-over-the-next-`horizon`-rounds) pairs across
 * every security's own public `priceHistory` — no cross-round memory needed, since a single
 * observation's trailing history already contains many historical rounds to backtest against. */
function signalOutcomePairs(securities, window, horizon, signalAt) {
  const signals = [];
  const outcomes = [];
  for (const security of securities) {
    const history = security.priceHistory;
    for (let endIndex = window; endIndex <= history.length - 1 - horizon; endIndex++) {
      const signal = signalAt(history, endIndex, window);
      if (signal === null) {
        continue;
      }
      const now = history[endIndex];
      const future = history[endIndex + horizon];
      if (now.close <= 0 || future.close <= 0) {
        continue;
      }
      signals.push(signal);
      outcomes.push(Math.log(future.close / now.close));
    }
  }
  return { signals, outcomes };
}

/** Pearson correlation, `null` below `MIN_IC_SAMPLES` or when either series has ~zero variance. */
function correlation(xs, ys) {
  if (xs.length < MIN_IC_SAMPLES) {
    return null;
  }
  const mx = mean(xs);
  const my = mean(ys);
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX < 1e-12 || varianceY < 1e-12) {
    return null;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Backtests each candidate momentum window against this match's own accumulated price history
 * and picks whichever has shown the strongest POSITIVE evidence of predicting the next
 * `IC_HOLDING_HORIZON_ROUNDS` rounds' return (i.e. real continuation, not a coin flip) — falling
 * back to `DEFAULT_MOMENTUM_WINDOW` only when no candidate yet has enough evidence to judge. */
function selectMomentumWindow(securities) {
  let best = null;
  for (const window of MOMENTUM_CANDIDATE_WINDOWS) {
    const { signals, outcomes } = signalOutcomePairs(securities, window, IC_HOLDING_HORIZON_ROUNDS, momentumSignalAt);
    const ic = correlation(signals, outcomes);
    if (ic === null) {
      continue;
    }
    if (best === null || ic > best.ic) {
      best = { window, ic };
    }
  }
  return best !== null ? best.window : DEFAULT_MOMENTUM_WINDOW;
}

/** Same idea for the value/reversion window, but picks the candidate with the strongest NEGATIVE
 * evidence (a large gap above trend predicting a subsequent pullback), since that's the
 * hypothesis this term trades on. */
function selectValueWindow(securities) {
  let best = null;
  for (const window of VALUE_CANDIDATE_WINDOWS) {
    const { signals, outcomes } = signalOutcomePairs(securities, window, IC_HOLDING_HORIZON_ROUNDS, valueSignalAt);
    const ic = correlation(signals, outcomes);
    if (ic === null) {
      continue;
    }
    if (best === null || ic < best.ic) {
      best = { window, ic };
    }
  }
  return best !== null ? best.window : DEFAULT_VALUE_WINDOW;
}

/** Trend of this quarter's consensus EPS estimate so far — the consensus converges toward the
 * still-hidden true figure round by round, so an improving trend is informative ahead of the
 * actual earnings report. `null` before at least two revisions have been observed this quarter. */
function revisionMomentum(security) {
  const history = security.analystRevisionHistory;
  if (!Array.isArray(history) || history.length < 2) {
    return null;
  }
  const first = history[0];
  const last = history[history.length - 1];
  const denom = Math.max(Math.abs(first.eps), 0.01);
  return (last.eps - first.eps) / denom;
}

/** z-scores a symbol -> value map across only the symbols that have a value at all. */
function zscoreMap(valuesBySymbol) {
  const entries = [...valuesBySymbol.entries()];
  const values = entries.map(([, v]) => v);
  const m = mean(values);
  const sd = stdev(values);
  const scored = new Map();
  for (const [symbol, v] of entries) {
    scored.set(symbol, sd > 1e-9 ? (v - m) / sd : 0);
  }
  return scored;
}

/** The most recently observed ACQUISITION/DELISTING payout for this security that hasn't matured
 * yet (`effectiveRound` still strictly in the future) — `null` if there is none, or the most
 * recent one has already matured (the engine force-closes the position at that price itself). */
function pendingPayoutPerShare(security, currentRound) {
  const events = security.events;
  if (!Array.isArray(events)) {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'ACQUISITION' && event.type !== 'DELISTING') {
      continue;
    }
    return event.details.effectiveRound > currentRound ? event.details.cashPerShare : null;
  }
  return null;
}

/** Walks a best-first order-book side to find how much of `desiredQty` is actually fillable and
 * the worst price needed to fill it — bounding execution price instead of trading blind at
 * whatever a MARKET order happens to clear at. Falls back to a single quote-level price (still
 * bounded, just not depth-checked) when no book levels are visible at all. */
function planOrder(book, desiredQty, fallbackPrice) {
  if (desiredQty <= 0) {
    return null;
  }
  if (!Array.isArray(book) || book.length === 0) {
    return fallbackPrice != null && fallbackPrice > 0 ? { quantity: desiredQty, limitPrice: fallbackPrice } : null;
  }
  let remaining = desiredQty;
  let limitPrice = book[0].price;
  for (const level of book) {
    limitPrice = level.price;
    remaining -= level.quantity;
    if (remaining <= 0) {
      break;
    }
  }
  const quantity = desiredQty - Math.max(remaining, 0);
  return quantity > 0 ? { quantity, limitPrice } : null;
}

function currentSharesOf(positionsBySymbol, symbol) {
  return positionsBySymbol.get(symbol)?.shares ?? 0;
}

function rebalanceToTarget(orders, security, targetShares, currentShares) {
  const delta = Math.round(targetShares) - currentShares;
  if (delta === 0) {
    return;
  }
  if (delta > 0) {
    const plan = planOrder(security.quote.orderBook.asks, delta, security.quote.ask ?? security.quote.lastClose);
    if (plan !== null) {
      orders.push({ kind: 'LIMIT', symbol: security.symbol, side: 'BUY', quantity: plan.quantity, limitPrice: round2(plan.limitPrice) });
    }
  } else {
    const plan = planOrder(security.quote.orderBook.bids, -delta, security.quote.bid ?? security.quote.lastClose);
    if (plan !== null) {
      orders.push({ kind: 'LIMIT', symbol: security.symbol, side: 'SELL', quantity: plan.quantity, limitPrice: round2(plan.limitPrice) });
    }
  }
}

/** Fixed-payout arbitrage: an announced ACQUISITION/DELISTING pays `cashPerShare` at a known
 * future round no matter what the market price does in the meantime. Buys in while the ask is
 * meaningfully below that price (capped per-name and in aggregate), and takes a same-round profit
 * if the market ever prices an existing holding above the guaranteed payout. Mutates `orders`;
 * returns the set of symbols it's managing so the momentum book leaves them alone. */
function runArbitrageOverlay(orders, activeEquities, positionsBySymbol, round, nlv) {
  const arbSymbols = new Set();
  const payoutBySymbol = new Map();
  for (const security of activeEquities) {
    const payout = pendingPayoutPerShare(security, round);
    if (payout !== null) {
      arbSymbols.add(security.symbol);
      payoutBySymbol.set(security.symbol, payout);
    }
  }

  let committedArbDollars = 0;
  for (const symbol of arbSymbols) {
    const held = currentSharesOf(positionsBySymbol, symbol);
    if (held > 0) {
      const security = activeEquities.find((s) => s.symbol === symbol);
      committedArbDollars += held * (security?.quote.lastClose ?? 0);
    }
  }

  for (const security of activeEquities) {
    const payout = payoutBySymbol.get(security.symbol);
    if (payout === undefined) {
      continue;
    }
    const held = currentSharesOf(positionsBySymbol, security.symbol);
    const bidPrice = security.quote.bid ?? security.quote.lastClose;
    const askPrice = security.quote.ask ?? security.quote.lastClose;

    if (held > 0 && bidPrice > 0 && bidPrice > payout) {
      // The market is already offering more than the guaranteed payout -> take it now.
      const plan = planOrder(security.quote.orderBook.bids, held, bidPrice);
      if (plan !== null) {
        orders.push({ kind: 'LIMIT', symbol: security.symbol, side: 'SELL', quantity: plan.quantity, limitPrice: round2(plan.limitPrice) });
      }
      continue;
    }
    if (askPrice <= 0 || askPrice >= payout * ARB_DISCOUNT_THRESHOLD) {
      continue;
    }
    const remainingCapacity = Math.max(0, nlv * ARB_MAX_TOTAL_FRACTION - committedArbDollars);
    const capDollars = Math.min(nlv * ARB_MAX_FRACTION_PER_NAME, remainingCapacity);
    const targetShares = Math.max(held, Math.floor(capDollars / askPrice));
    const delta = targetShares - held;
    if (delta <= 0) {
      continue;
    }
    const plan = planOrder(security.quote.orderBook.asks, delta, askPrice);
    if (plan === null) {
      continue;
    }
    const limitPrice = Math.min(plan.limitPrice, payout * 0.999);
    orders.push({ kind: 'LIMIT', symbol: security.symbol, side: 'BUY', quantity: plan.quantity, limitPrice: round2(limitPrice) });
    committedArbDollars += plan.quantity * askPrice;
  }

  return arbSymbols;
}

/** Drawdown and realized-volatility scaled gross fraction — shrinks size in a bad regime instead
 * of trading the same fixed fraction of NLV in every condition. */
function riskScaledGrossFraction(observation, indexSecurity) {
  const drawdown = observation.portfolio.drawdown;
  const drawdownScale = drawdown >= 0.25 ? 0.25 : drawdown >= 0.15 ? 0.5 : drawdown >= 0.08 ? 0.75 : 1;

  let volScale = 1;
  if (indexSecurity !== undefined) {
    const returns = logReturns(indexSecurity.priceHistory).slice(-VOL_LOOKBACK_ROUNDS);
    if (returns.length >= VOL_LOOKBACK_ROUNDS) {
      const recentVol = stdev(returns);
      if (recentVol > 1e-9) {
        volScale = Math.min(1.3, Math.max(0.4, BASELINE_INDEX_VOL / recentVol));
      }
    }
  }

  const fraction = BASE_GROSS_FRACTION * drawdownScale * volScale;
  return Math.min(MAX_GROSS_FRACTION, Math.max(MIN_GROSS_FRACTION, fraction));
}

function decideAction(observation) {
  if (observation.phase === 'WARMUP') {
    return { orders: [] };
  }

  const orders = [];
  const positionsBySymbol = new Map(observation.portfolio.positions.map((p) => [p.symbol, p]));
  const canShort = observation.portfolio.buyingPower > 0;
  const nlv = observation.portfolio.nlv;
  const indexSecurity = observation.securities.find((s) => s.symbol === observation.indexSymbol);
  const activeEquities = observation.securities.filter((s) => s.kind === 'EQUITY' && s.active);

  const arbSymbols = runArbitrageOverlay(orders, activeEquities, positionsBySymbol, observation.round, nlv);

  const candidates = activeEquities.filter((s) => !arbSymbols.has(s.symbol));
  const momentumWindow = selectMomentumWindow(activeEquities);
  const valueWindow = selectValueWindow(activeEquities);
  const momentumBySymbol = new Map();
  const valueBySymbol = new Map();
  const revisionBySymbol = new Map();
  for (const security of candidates) {
    const momentum = momentumScore(security, momentumWindow);
    if (momentum !== null) {
      momentumBySymbol.set(security.symbol, momentum);
    }
    const value = valueGap(security, valueWindow);
    if (value !== null) {
      valueBySymbol.set(security.symbol, value);
    }
    const revision = revisionMomentum(security);
    if (revision !== null) {
      revisionBySymbol.set(security.symbol, revision);
    }
  }

  const momentumZ = zscoreMap(momentumBySymbol);
  const valueZ = zscoreMap(valueBySymbol);
  const revisionZ = zscoreMap(revisionBySymbol);

  const scored = candidates
    .filter((security) => momentumZ.has(security.symbol))
    .map((security) => {
      const symbol = security.symbol;
      let weightedSum = momentumZ.get(symbol) * MOMENTUM_WEIGHT;
      let weightTotal = MOMENTUM_WEIGHT;
      if (revisionZ.has(symbol)) {
        weightedSum += revisionZ.get(symbol) * REVISION_WEIGHT;
        weightTotal += REVISION_WEIGHT;
      }
      if (valueZ.has(symbol)) {
        weightedSum -= valueZ.get(symbol) * VALUE_WEIGHT;
        weightTotal += VALUE_WEIGHT;
      }
      return { security, score: weightedSum / weightTotal };
    })
    .sort((a, b) => b.score - a.score);

  const longCore = scored.slice(0, LONG_COUNT).map((c) => c.security.symbol);
  const longHoldZone = new Set(scored.slice(0, LONG_COUNT + LONG_HYSTERESIS_EXTRA).map((c) => c.security.symbol));
  const selectedLong = new Set(longCore);
  const shortCore = canShort ? scored.slice(-SHORT_COUNT).map((c) => c.security.symbol) : [];
  const shortHoldZone = canShort ? new Set(scored.slice(-(SHORT_COUNT + SHORT_HYSTERESIS_EXTRA)).map((c) => c.security.symbol)) : new Set();
  const selectedShort = new Set(shortCore);

  for (const security of candidates) {
    const held = currentSharesOf(positionsBySymbol, security.symbol);
    if (held === 0) {
      continue;
    }
    if (held > 0 && longHoldZone.has(security.symbol) && !selectedShort.has(security.symbol)) {
      selectedLong.add(security.symbol);
    }
    if (held < 0 && shortHoldZone.has(security.symbol) && !selectedLong.has(security.symbol)) {
      selectedShort.add(security.symbol);
    }
  }
  for (const symbol of selectedShort) {
    selectedLong.delete(symbol); // a name can't be a simultaneous long and short pick
  }

  const grossFraction = riskScaledGrossFraction(observation, indexSecurity);
  const legCount = (selectedLong.size > 0 ? 1 : 0) + (selectedShort.size > 0 ? 1 : 0) || 1;
  const longLegDollars = selectedLong.size > 0 ? (nlv * grossFraction) / legCount : 0;
  const shortLegDollars = selectedShort.size > 0 ? (nlv * grossFraction) / legCount : 0;
  const perLongDollars = selectedLong.size > 0 ? longLegDollars / selectedLong.size : 0;
  const perShortDollars = selectedShort.size > 0 ? shortLegDollars / selectedShort.size : 0;

  for (const security of candidates) {
    const symbol = security.symbol;
    const held = currentSharesOf(positionsBySymbol, symbol);
    if (selectedLong.has(symbol)) {
      const priceRef = security.quote.ask ?? security.quote.lastClose;
      const targetShares = priceRef > 0 ? Math.floor(perLongDollars / priceRef) : 0;
      rebalanceToTarget(orders, security, targetShares, held);
    } else if (selectedShort.has(symbol)) {
      const priceRef = security.quote.bid ?? security.quote.lastClose;
      const borrowCap = security.borrow?.availableShares ?? 0;
      const desiredShares = priceRef > 0 ? Math.floor(perShortDollars / priceRef) : 0;
      const targetShares = -Math.min(desiredShares, Math.max(0, borrowCap));
      rebalanceToTarget(orders, security, targetShares, held);
    } else if (held !== 0) {
      rebalanceToTarget(orders, security, 0, held);
    }
  }

  return { orders: orders.slice(0, MAX_ORDERS_PER_ROUND) };
}

runBot({ decideAction });
