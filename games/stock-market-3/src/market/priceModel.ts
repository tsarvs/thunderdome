import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import { REGIME_PROFILES } from '../economy/regime.js';
import type { DailyCandle, EconomicFactorValues, MarketRegime, SecurityState } from '../types.js';
import { QUARTER_LENGTH_ROUNDS } from './events.js';

const IDIOSYNCRATIC_VOLATILITY = 0.018;
const MOMENTUM_WINDOW = 10;
const VALUE_WINDOW = 40;
const MOMENTUM_DAMPING = 0.06;
const VALUE_DAMPING = 0.05;
/** Spreads a company's QUARTERLY revenue growth rate (set once per quarter, company/fundamentals.ts)
 * evenly across every ROUND of that quarter — dividing by `QUARTER_LENGTH_ROUNDS` first is what
 * keeps this a small daily nudge instead of applying a whole quarter's growth every single round
 * (which compounds to a runaway blowup within a few rounds). */
const FUNDAMENTAL_DRIFT_SCALE = 0.4;

function trailingLogReturn(history: readonly DailyCandle[], window: number): number {
  if (history.length < window + 1) {
    return 0;
  }
  const recent = history[history.length - 1];
  const past = history[history.length - 1 - window];
  if (recent === undefined || past === undefined || past.close <= 0 || recent.close <= 0) {
    return 0;
  }
  return Math.log(recent.close / past.close) / window;
}

function trailingAverageLogGap(history: readonly DailyCandle[], window: number): number {
  const span = history.slice(-window);
  if (span.length < window) {
    return 0;
  }
  const average = span.reduce((sum, candle) => sum + candle.close, 0) / span.length;
  const last = span[span.length - 1];
  if (last === undefined || last.close <= 0 || average <= 0) {
    return 0;
  }
  return Math.log(average / last.close);
}

/**
 * One round's log-return for a single equity's hidden fundamental value (spec §9's conceptual
 * `Security Return = Market + Economic Factors + Sector + Fundamental + Event + Company Shock`
 * decomposition — MOMENTUM/VALUE are deliberately NOT here, see `computeStyleTechnicalReturn`
 * below). This produces the new hidden "true value"; `market/referencePriceModel.ts` (ported
 * near-verbatim from games/stock-market-2) is the separate, shared step that turns a fundamental
 * value into an actual pre-open reference price, same two-stage design as V2.
 *
 * Every term below is either shared across many securities (the market shock, the economic-factor
 * deltas) or a hidden per-security constant (factor loadings, market beta) — no fixed pairwise
 * correlation matrix appears anywhere; whatever correlation shows up between two securities is a
 * consequence of how much of this formula they happen to share (spec §15). Crucially, nothing
 * here depends on this security's OWN past price — a "fundamental value" that partly chased its
 * own trailing return would be a genuine positive-feedback loop with no stabilizing force, which
 * is exactly what caused an early runaway-to-zero/infinity bug during development (kept as an
 * internal lesson, not spec text): momentum/value belong on the TRADABLE price, which already has
 * a mean-reversion pull back toward this (now trend-independent) fundamental value every round.
 */
export function stepEquityFundamentalValue(args: {
  security: SecurityState;
  factorDeltas: EconomicFactorValues;
  marketShock: number;
  regime: MarketRegime;
  eventImpactReturn: number;
  crossSectorTerm: number;
  rng: Rng;
}): number {
  const { security, factorDeltas, marketShock, regime, eventImpactReturn, crossSectorTerm, rng } = args;
  const fundamentals = security.fundamentals;
  if (fundamentals === null) {
    throw new Error(`stepEquityFundamentalValue requires fundamentals (symbol "${security.symbol}")`);
  }
  const regimeProfile = REGIME_PROFILES[regime];

  const marketTerm = security.marketBeta * marketShock;

  let factorTerm = 0;
  for (const exposure of security.factorLoadings) {
    factorTerm += exposure.loading * factorDeltas[exposure.factor];
  }

  const fundamentalDriftTerm = (fundamentals.revenueGrowth / QUARTER_LENGTH_ROUNDS) * FUNDAMENTAL_DRIFT_SCALE;

  // SIZE and QUALITY dampen idiosyncratic noise (bigger/higher-quality => steadier); VOLATILITY
  // amplifies it. Floored well above zero so no combination of loadings can ever zero out a
  // security's noise entirely.
  const idiosyncraticVolScale = Math.max(
    0.25,
    1 - 0.25 * security.styleLoadings.SIZE - 0.25 * security.styleLoadings.QUALITY + 0.4 * security.styleLoadings.VOLATILITY,
  );
  const idiosyncraticTerm = gaussian(rng) * IDIOSYNCRATIC_VOLATILITY * idiosyncraticVolScale * regimeProfile.volatilityMultiplier;

  const rawLogReturn = marketTerm + factorTerm + fundamentalDriftTerm + eventImpactReturn + crossSectorTerm + idiosyncraticTerm;
  // A hard per-round circuit breaker: even with momentum/value moved off this trend-independent
  // path, a run of unlucky shared shocks (market/factor/event) could otherwise compound further
  // than any real security would in one day. Real exchanges cap single-day moves for the same
  // reason.
  const logReturn = Math.max(-0.2, Math.min(0.2, rawLogReturn));

  return Math.max(1, Math.round(security.fundamentalValueCents * Math.exp(logReturn)));
}

/**
 * The TRADABLE price's own technical drift — momentum (continuing a recent trend) and value
 * (pulling back toward a slower trailing average) — applied on top of `referencePriceModel.ts`'s
 * existing pull toward the (trend-independent) fundamental value above. This is what actually
 * creates discoverable momentum/mean-reversion patterns in the generated price series (spec §13)
 * without letting them become a self-sustaining runaway: the fundamental-value anchor underneath
 * this can't itself be dragged along, so every round pulls the price back toward something stable.
 */
export function computeStyleTechnicalReturn(security: SecurityState): number {
  const momentumTerm =
    security.styleLoadings.MOMENTUM * MOMENTUM_DAMPING * trailingLogReturn(security.priceHistory, MOMENTUM_WINDOW);
  const valueTerm = security.styleLoadings.VALUE * VALUE_DAMPING * trailingAverageLogGap(security.priceHistory, VALUE_WINDOW);
  return Math.max(-0.08, Math.min(0.08, momentumTerm + valueTerm));
}
