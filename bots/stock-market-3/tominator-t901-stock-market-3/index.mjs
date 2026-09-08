/**
 * Tominator T-901 — a reference bot for the "stock-market-3" game, built to beat
 * Tominator T-900 (tominator-t900-stock-market-3) and the two simpler momentum-only reference bots.
 *
 * T-900 already covers: an empirically-selected (not copied) momentum window, an empirically-
 * selected value/reversion window, analyst-revision-trend, a fixed-payout acquisition/delisting
 * arbitrage overlay, drawdown/volatility-scaled sizing, and liquidity-aware LIMIT orders. This
 * bot keeps all of that and adds four more things it left on the table:
 *
 *  1. An explicit earnings-surprise term that decays over the ~10 rounds after a report, reacting
 *     to a surprise immediately instead of waiting for the momentum window to slowly absorb it.
 *  2. A macro sector-tilt term, estimated honestly rather than known in advance: `security.sector`
 *     is public, but how much a given sector actually moves in response to a GDP/inflation/policy-
 *     rate/commodity surprise is NOT — games/stock-market-3/src/economy/sectors.ts's
 *     `SECTOR_FACTOR_LOADINGS` is explicitly documented as "hidden simulator configuration, never
 *     exposed to bots," and a bot has no business reading the simulator's own source for the
 *     answer. So this bot estimates each (sector, indicator) sensitivity itself, in-match, the same
 *     way a real quant would: every round a fresh `ECONOMIC_RELEASE` fires, it records one (that
 *     release's surprise, that security's own realized return) sample per active equity, and runs
 *     an incremental least-squares regression per sector per indicator — the same OLS idea
 *     market-neutral-stock-market-3 already uses for beta, just estimated online instead of from a
 *     stored return series. A sector/indicator pair contributes nothing until it has accumulated
 *     `MIN_MACRO_SAMPLES` real data points, so this signal starts at zero conviction and only
 *     firms up as the match actually provides evidence for it.
 *  3. Conviction-weighted position sizing within each leg (more dollars to the strongest-scoring
 *     names, a floor so no pick goes near zero) instead of splitting each leg equally.
 *  4. A modestly larger risk budget (both the momentum/value book and the arbitrage overlay),
 *     leaning further into the same drawdown/volatility-scaled safety net rather than a flat cap
 *     regardless of conviction.
 *
 * An earlier revision of this bot also sector-demeaned momentum and value (subtracting each
 * name's own sector average before ranking), on the theory that a cleaner, less-correlated book
 * would win out. Head-to-head testing against T-900 showed the opposite: this game deliberately
 * builds in real, exploitable sector-level co-movement (shared economic factors × each sector's
 * own hidden loadings) — and demeaning it away was discarding genuine signal, not noise, which is
 * why it isn't here anymore. A separate, earlier revision of the macro-tilt term above also
 * hardcoded a copy of `SECTOR_FACTOR_LOADINGS` straight out of the simulator's source instead of
 * estimating it — same mistake in spirit, fixed the same way: earn the signal, don't read it. And
 * a THIRD earlier revision hardcoded the momentum/value lookback windows themselves (10/40 rounds)
 * to match `MOMENTUM_WINDOW`/`VALUE_WINDOW` in games/stock-market-3/src/market/priceModel.ts —
 * those aren't documented "hidden, never exposed" the way `SECTOR_FACTOR_LOADINGS` is, and 10-day/
 * 40-day lookbacks are completely standard technical-analysis choices, but they were still copied
 * rather than earned. Now they're backtested in-match instead (see `selectMomentumWindow`/
 * `selectValueWindow`), for full consistency with the same principle.
 *
 * This is a stateful bot: `macroRegressionState` persists across every `decideAction` call for the
 * life of one match (the bot process itself lives for the whole match under this protocol), which
 * is exactly what makes the in-match learning above possible. The momentum/value window selection
 * needs no such cross-round memory — a single round's `priceHistory` already spans many historical
 * rounds, so it's backtested fresh from scratch every round instead.
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
const EARNINGS_SURPRISE_DECAY_ROUNDS = 10;
const MACRO_SURPRISE_DECAY_ROUNDS = 15;

const LONG_COUNT = 3;
const SHORT_COUNT = 3;
const LONG_HYSTERESIS_EXTRA = 2; // an already-held name inside top (LONG_COUNT + this) stays held
const SHORT_HYSTERESIS_EXTRA = 2;
const CONVICTION_FLOOR = 0.2; // in z-score units — keeps the weakest pick from going near-zero

const MOMENTUM_WEIGHT = 0.4;
const VALUE_WEIGHT = 0.12; // applied against the raw gap (being far above trend is penalized)
const REVISION_WEIGHT = 0.18;
const EARNINGS_WEIGHT = 0.18;
const MACRO_WEIGHT = 0.12;

const BASE_GROSS_FRACTION = 0.35;
const MIN_GROSS_FRACTION = 0.05;
const MAX_GROSS_FRACTION = 0.48;

const ARB_MAX_FRACTION_PER_NAME = 0.25;
const ARB_MAX_TOTAL_FRACTION = 0.5;
const ARB_DISCOUNT_THRESHOLD = 0.995; // only buy in when ask is at least 0.5% below the payout

const MAX_ORDERS_PER_ROUND = 10;

const MACRO_INDICATORS = ['GDP_GROWTH', 'INFLATION_RATE', 'POLICY_RATE', 'COMMODITY_INDEX'];
const MIN_MACRO_SAMPLES = 4; // don't trust a (sector, indicator) slope until it has this much evidence
const MACRO_SLOPE_CLAMP = 5; // sanity bound against one noisy early sample producing a wild slope

/** Accumulated (surprise, realized-return) evidence per "SECTOR|INDICATOR" key, built up over the
 * course of the match by `updateMacroRegression` — this bot's own in-match estimate of each
 * sector's macro sensitivity, since the simulator's real table is deliberately hidden from bots
 * (see the file header). Module-level so it persists across every `decideAction` call. */
const macroRegressionState = new Map();

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

/** A decaying reaction to this security's most recent earnings surprise (weighted like the
 * simulator's own hidden earnings-impact formula, ~65% EPS / ~35% revenue) — fades to 0 over
 * `EARNINGS_SURPRISE_DECAY_ROUNDS` rounds so it only matters right after a fresh report. */
function earningsSurpriseScore(security, currentRound) {
  const events = security.events;
  if (!Array.isArray(events)) {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== 'EARNINGS_REPORT') {
      continue;
    }
    const age = currentRound - event.observedAtRound;
    if (age < 0 || age > EARNINGS_SURPRISE_DECAY_ROUNDS) {
      return null;
    }
    const epsSurprise = (event.reported.eps - event.consensus.eps) / Math.max(Math.abs(event.consensus.eps), 0.01);
    const revenueSurprise = (event.reported.revenue - event.consensus.revenue) / Math.max(Math.abs(event.consensus.revenue), 1);
    const decay = 1 - age / EARNINGS_SURPRISE_DECAY_ROUNDS;
    return (epsSurprise * 0.65 + revenueSurprise * 0.35) * decay;
  }
  return null;
}

/** This security's own single-round realized return, straight off its public `priceHistory` —
 * `null` when there isn't yet a previous round to compare against. */
function lastRoundReturn(security) {
  const history = security.priceHistory;
  if (history.length < 2) {
    return null;
  }
  const previous = history[history.length - 2].close;
  const current = history[history.length - 1].close;
  if (previous <= 0 || current <= 0) {
    return null;
  }
  return Math.log(current / previous);
}

/** Feeds this bot's own in-match regression: every round a macro indicator publishes a fresh
 * reading, pairs that release's surprise with each active equity's own realized return that same
 * round (one sample per security, so a 3-member sector accumulates evidence 3x as fast as a
 * 1-member one) and folds it into the running per-(sector, indicator) least-squares accumulator.
 * This is the only honest way to learn "how rate-sensitive is FINANCIAL, really" — the simulator
 * won't tell us, so we have to find out from what actually happens after each surprise. */
function updateMacroRegression(activeEquities, marketEvents, round) {
  if (!Array.isArray(marketEvents)) {
    return;
  }
  for (const event of marketEvents) {
    if (event.observedAtRound !== round) {
      continue;
    }
    const surprise = (event.reported - event.consensus) / Math.max(Math.abs(event.consensus), 0.01);
    for (const security of activeEquities) {
      if (security.sector === null) {
        continue;
      }
      const realizedReturn = lastRoundReturn(security);
      if (realizedReturn === null) {
        continue;
      }
      const key = `${security.sector}|${event.indicator}`;
      const stats = macroRegressionState.get(key) ?? { n: 0, sumX: 0, sumY: 0, sumXY: 0, sumXX: 0 };
      stats.n += 1;
      stats.sumX += surprise;
      stats.sumY += realizedReturn;
      stats.sumXY += surprise * realizedReturn;
      stats.sumXX += surprise * surprise;
      macroRegressionState.set(key, stats);
    }
  }
}

/** The OLS slope of realized return on surprise for this (sector, indicator) pair, from evidence
 * accumulated so far this match — `null` until there's enough evidence (`MIN_MACRO_SAMPLES`) or
 * the observed surprises so far have had ~zero variance (an undefined slope, same guard
 * `estimateBeta` in market-neutral-stock-market-3 uses for a zero-variance regressor). */
function estimatedSectorLoading(sector, indicator) {
  const stats = macroRegressionState.get(`${sector}|${indicator}`);
  if (stats === undefined || stats.n < MIN_MACRO_SAMPLES) {
    return null;
  }
  const denominator = stats.n * stats.sumXX - stats.sumX * stats.sumX;
  if (Math.abs(denominator) < 1e-9) {
    return null;
  }
  const slope = (stats.n * stats.sumXY - stats.sumX * stats.sumY) / denominator;
  return Math.max(-MACRO_SLOPE_CLAMP, Math.min(MACRO_SLOPE_CLAMP, slope));
}

/** The most recent, still-relevant (decayed, not stale) surprise for each of the four published
 * macro indicators this round, keyed by indicator name. */
function macroSurprisesByIndicator(marketEvents, currentRound) {
  const surprises = new Map();
  for (const indicator of MACRO_INDICATORS) {
    let latest = null;
    for (let i = marketEvents.length - 1; i >= 0; i--) {
      if (marketEvents[i].indicator === indicator) {
        latest = marketEvents[i];
        break;
      }
    }
    if (latest === null) {
      continue;
    }
    const age = currentRound - latest.observedAtRound;
    if (age < 0 || age > MACRO_SURPRISE_DECAY_ROUNDS) {
      continue;
    }
    const surprise = (latest.reported - latest.consensus) / Math.max(Math.abs(latest.consensus), 0.01);
    surprises.set(indicator, surprise * (1 - age / MACRO_SURPRISE_DECAY_ROUNDS));
  }
  return surprises;
}

/** This security's sector-weighted exposure to the macro surprises observed so far this round,
 * using this bot's own estimated (not known-in-advance) sector sensitivities — `null` when its
 * sector has no live (undecayed) surprise, or no (sector, indicator) pair has enough accumulated
 * evidence yet to produce an estimate. */
function macroTiltScore(security, surprisesByIndicator) {
  if (surprisesByIndicator.size === 0 || security.sector === null) {
    return null;
  }
  let total = 0;
  let any = false;
  for (const [indicator, surprise] of surprisesByIndicator) {
    const loading = estimatedSectorLoading(security.sector, indicator);
    if (loading !== null) {
      total += loading * surprise;
      any = true;
    }
  }
  return any ? total : null;
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

/** Weights that increase with conviction (distance from the weakest member selected in this
 * direction) but never go near zero, so the weakest pick in a leg still gets a meaningful stake.
 * `favorHigh` is true for the long leg (higher combined score = more weight), false for the short
 * leg (more negative combined score = more weight). Always sums to 1 across `members`. */
function convictionWeights(members, scoreBySymbol, favorHigh) {
  const scores = members.map((symbol) => scoreBySymbol.get(symbol));
  const anchor = favorHigh ? Math.min(...scores) : Math.max(...scores);
  const raw = scores.map((score) => Math.max(favorHigh ? score - anchor : anchor - score, 0) + CONVICTION_FLOOR);
  const total = raw.reduce((sum, v) => sum + v, 0);
  const weights = new Map();
  members.forEach((symbol, i) => weights.set(symbol, raw[i] / total));
  return weights;
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
  // Learn from every round, warmup included — warmup is free evidence (no trading risk) and,
  // at the default 250 rounds, is actually longer than the competition phase itself, so skipping
  // it would throw away most of the match's evidence for the macro-sensitivity regression above.
  updateMacroRegression(
    observation.securities.filter((s) => s.kind === 'EQUITY' && s.active),
    observation.marketEvents,
    observation.round,
  );

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
  const macroSurprises = macroSurprisesByIndicator(observation.marketEvents, observation.round);
  const momentumWindow = selectMomentumWindow(activeEquities);
  const valueWindow = selectValueWindow(activeEquities);

  const rawMomentumBySymbol = new Map();
  const rawValueBySymbol = new Map();
  const revisionBySymbol = new Map();
  const earningsBySymbol = new Map();
  const macroBySymbol = new Map();
  for (const security of candidates) {
    const momentum = momentumScore(security, momentumWindow);
    if (momentum !== null) {
      rawMomentumBySymbol.set(security.symbol, momentum);
    }
    const value = valueGap(security, valueWindow);
    if (value !== null) {
      rawValueBySymbol.set(security.symbol, value);
    }
    const revision = revisionMomentum(security);
    if (revision !== null) {
      revisionBySymbol.set(security.symbol, revision);
    }
    const earnings = earningsSurpriseScore(security, observation.round);
    if (earnings !== null) {
      earningsBySymbol.set(security.symbol, earnings);
    }
    const macro = macroTiltScore(security, macroSurprises);
    if (macro !== null) {
      macroBySymbol.set(security.symbol, macro);
    }
  }

  const momentumZ = zscoreMap(rawMomentumBySymbol);
  const valueZ = zscoreMap(rawValueBySymbol);
  const revisionZ = zscoreMap(revisionBySymbol);
  const earningsZ = zscoreMap(earningsBySymbol);
  const macroZ = zscoreMap(macroBySymbol);

  const scored = candidates
    .filter((security) => momentumZ.has(security.symbol))
    .map((security) => {
      const symbol = security.symbol;
      let weightedSum = momentumZ.get(symbol) * MOMENTUM_WEIGHT;
      let weightTotal = MOMENTUM_WEIGHT;
      if (valueZ.has(symbol)) {
        weightedSum -= valueZ.get(symbol) * VALUE_WEIGHT;
        weightTotal += VALUE_WEIGHT;
      }
      if (revisionZ.has(symbol)) {
        weightedSum += revisionZ.get(symbol) * REVISION_WEIGHT;
        weightTotal += REVISION_WEIGHT;
      }
      if (earningsZ.has(symbol)) {
        weightedSum += earningsZ.get(symbol) * EARNINGS_WEIGHT;
        weightTotal += EARNINGS_WEIGHT;
      }
      if (macroZ.has(symbol)) {
        weightedSum += macroZ.get(symbol) * MACRO_WEIGHT;
        weightTotal += MACRO_WEIGHT;
      }
      return { security, score: weightedSum / weightTotal };
    })
    .sort((a, b) => b.score - a.score);

  const scoreBySymbol = new Map(scored.map((c) => [c.security.symbol, c.score]));
  const longHoldZone = new Set(scored.slice(0, LONG_COUNT + LONG_HYSTERESIS_EXTRA).map((c) => c.security.symbol));
  const selectedLong = new Set(scored.slice(0, LONG_COUNT).map((c) => c.security.symbol));
  const shortHoldZone = canShort ? new Set(scored.slice(-(SHORT_COUNT + SHORT_HYSTERESIS_EXTRA)).map((c) => c.security.symbol)) : new Set();
  const selectedShort = canShort ? new Set(scored.slice(-SHORT_COUNT).map((c) => c.security.symbol)) : new Set();

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
  const longWeights = selectedLong.size > 0 ? convictionWeights([...selectedLong], scoreBySymbol, true) : new Map();
  const shortWeights = selectedShort.size > 0 ? convictionWeights([...selectedShort], scoreBySymbol, false) : new Map();

  for (const security of candidates) {
    const symbol = security.symbol;
    const held = currentSharesOf(positionsBySymbol, symbol);
    if (selectedLong.has(symbol)) {
      const priceRef = security.quote.ask ?? security.quote.lastClose;
      const dollars = longLegDollars * longWeights.get(symbol);
      const targetShares = priceRef > 0 ? Math.floor(dollars / priceRef) : 0;
      rebalanceToTarget(orders, security, targetShares, held);
    } else if (selectedShort.has(symbol)) {
      const priceRef = security.quote.bid ?? security.quote.lastClose;
      const borrowCap = security.borrow?.availableShares ?? 0;
      const dollars = shortLegDollars * shortWeights.get(symbol);
      const desiredShares = priceRef > 0 ? Math.floor(dollars / priceRef) : 0;
      const targetShares = -Math.min(desiredShares, Math.max(0, borrowCap));
      rebalanceToTarget(orders, security, targetShares, held);
    } else if (held !== 0) {
      rebalanceToTarget(orders, security, 0, held);
    }
  }

  return { orders: orders.slice(0, MAX_ORDERS_PER_ROUND) };
}

runBot({ decideAction });
