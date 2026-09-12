import type { DailyBar } from './marketTypes.js';
import type { ModelEffect } from './research/interpretEvents.js';
import type { SignalLevel, SignalThresholds } from './config.js';
import { ROLLING_BASE_VALUE_WINDOW_DAYS } from './valuation/rollingBaseValue.js';

/**
 * A transparent, deterministic trade signal (spec §13) — not a scoring system. The formula:
 *
 *   valuationGap  = fairValuePerShare / marketPrice - 1
 *   confidence    = mean confidence of this round's non-neutral ModelEffects (1 if there are none
 *                   — nothing changed, so there's nothing new to be uncertain about; the prior
 *                   valuation stands at full confidence in itself)
 *   signalScore   = valuationGap * confidence
 *
 * `signalScore` is compared against `SignalThresholds` (configuration, not inlined constants —
 * spec §29) to produce a `SignalLevel`. Deliberately does NOT read direction-of-news (a positive
 * research event) as automatically bullish (spec §12): `valuationGap` is computed from the fair
 * value estimate AFTER any research-driven update against the market price AFTER any reaction, so
 * a market that already over-reacted shows up as a small or negative gap, and a market that
 * under-reacted shows up as a large positive gap, without any separate "reaction" logic.
 */
export interface Signal {
  security: string;
  level: SignalLevel;
  signalScore: number;
  valuationGap: number;
  confidence: number;
  /** True when `level` only held (didn't fall back toward HOLD) because of
   * `SignalThresholds.hysteresisBand` — i.e. the raw score alone would have reclassified to
   * something less extreme this round. Surfaced for explainability (spec §16) rather than left
   * implicit in the level alone. */
  heldByHysteresis: boolean;
  rationale: string;
}

/** Mean confidence across this round's non-`'neutral'` effects — neutral effects (the
 * anti-inference confirmations from `interpretEvents.ts`) don't carry uncertainty of their own,
 * since they assert nothing changed. An empty list means no research change this round: full
 * confidence in the already-established valuation, not zero confidence in a new one. */
export function computeSignalConfidence(effects: ModelEffect[]): number {
  const nonNeutral = effects.filter((effect) => effect.direction !== 'neutral');
  if (nonNeutral.length === 0) return 1;
  return nonNeutral.reduce((sum, effect) => sum + effect.confidence, 0) / nonNeutral.length;
}

/** v2-only: DEFAULT calibration points for `computePriceStabilityConfidence`, used only when a
 * caller doesn't pass its own (see `config.ts`'s `ConfidenceCalibration`, which is what
 * `decision.ts` actually threads through in production — these defaults exist so direct callers,
 * e.g. tests, don't have to restate them). A trailing daily-return volatility at or below CALM
 * maps to full confidence; at or above CHAOTIC maps to the floor; linear in between. */
const CALM_DAILY_VOLATILITY = 0.01;
const CHAOTIC_DAILY_VOLATILITY = 0.05;
const PRICE_STABILITY_CONFIDENCE_FLOOR = 0.3;

/**
 * v2-only: a SECOND, independent confidence factor — see `decision.ts`, which multiplies this
 * together with `computeSignalConfidence`'s research-effect-based one to get the confidence
 * actually used everywhere (including `PortfolioPolicy.minShortConfidence`'s shorting gate).
 * Added because `computeSignalConfidence` alone sits at 1.0 on the overwhelming majority of
 * rounds — most research this bot ingests doesn't match either pattern
 * `interpretResearchDelta` recognizes — which left that shorting gate never actually gating
 * anything (a confidence check that's always satisfied isn't a check). This factor is derived
 * from something genuinely observable instead: how choppy the security's own recent trading has
 * been. A wide, erratic recent range makes a given day's valuation gap less trustworthy as a real
 * signal (more likely to just be noise); a calm, tight range makes the same gap more likely to
 * reflect something real. Computed as the trailing window's daily-return volatility (population
 * standard deviation of day-over-day returns), linearly mapped between the two calibration points
 * above. Uses the SAME trailing window as `valuation/rollingBaseValue.ts`'s rolling base-value
 * calculation, deliberately — one "how much recent history do we trust" knob, not two separately
 * tuned ones.
 *
 * Returns `1` (full confidence — no basis to doubt it yet) when there are fewer than 2 bars of
 * history to compute even a single day-over-day return from.
 */
/**
 * v4-only: trailing daily-return volatility (population standard deviation of day-over-day
 * returns over the trailing window) — extracted out of `computePriceStabilityConfidence` so
 * `portfolio.ts`'s volatility-scaled position sizing (a SEPARATE real risk-management technique,
 * see `PortfolioPolicy`'s `VolatilitySizingPolicy`) can reuse the exact same real number instead
 * of recomputing it. Returns `undefined` when there are fewer than 2 bars of history to compute
 * even a single return from.
 */
export function computeDailyVolatility(history: DailyBar[], windowDays: number = ROLLING_BASE_VALUE_WINDOW_DAYS): number | undefined {
  const closes = history.slice(-windowDays).map((bar) => bar.close);
  if (closes.length < 2) return undefined;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(closes[i]! / closes[i - 1]! - 1);
  }
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

export function computePriceStabilityConfidence(
  history: DailyBar[],
  windowDays: number = ROLLING_BASE_VALUE_WINDOW_DAYS,
  calmDailyVolatility: number = CALM_DAILY_VOLATILITY,
  chaoticDailyVolatility: number = CHAOTIC_DAILY_VOLATILITY,
  confidenceFloor: number = PRICE_STABILITY_CONFIDENCE_FLOOR,
): number {
  const dailyVolatility = computeDailyVolatility(history, windowDays);
  if (dailyVolatility === undefined) return 1;

  const t = Math.min(1, Math.max(0, (dailyVolatility - calmDailyVolatility) / (chaoticDailyVolatility - calmDailyVolatility)));
  return 1 - t * (1 - confidenceFloor);
}

export function computeValuationGap(fairValuePerShare: number, marketPrice: number): number {
  return fairValuePerShare / marketPrice - 1;
}

/**
 * The market-implied-value comparison from spec §12: distinguishes "fusion fundamentals improved"
 * from "the stock is undervalued because fusion fundamentals improved." Returns `null` fields on
 * a bot's first decision (no previous valuation/price to compare against yet) rather than
 * fabricating a baseline.
 */
export function computeInformationGap(params: {
  currentFairValuePerShare: number;
  previousFairValuePerShare: number | undefined;
  currentPrice: number;
  previousPrice: number | undefined;
}): { modelChange: number | null; marketChange: number | null; informationGap: number | null } {
  if (params.previousFairValuePerShare === undefined || params.previousPrice === undefined) {
    return { modelChange: null, marketChange: null, informationGap: null };
  }
  const modelChange = params.currentFairValuePerShare / params.previousFairValuePerShare - 1;
  const marketChange = params.currentPrice / params.previousPrice - 1;
  return { modelChange, marketChange, informationGap: modelChange - marketChange };
}

/** Stateless: what `score` implies with no memory of any previously-held level — the plain
 * `SignalThresholds` boundaries, nothing else. Used both for a bot's first-ever decision and as
 * the fallback once `classifySignal` below decides a previously-held level has actually been
 * given up. */
function classifyWithoutHysteresis(score: number, thresholds: SignalThresholds): SignalLevel {
  if (score <= thresholds.strongSellThreshold) return 'STRONG_SELL';
  if (score <= thresholds.sellThreshold) return 'SELL';
  if (score <= thresholds.reduceThreshold) return 'REDUCE';
  if (score >= thresholds.strongBuyThreshold) return 'STRONG_BUY';
  if (score >= thresholds.buyThreshold) return 'BUY';
  return 'HOLD';
}

/**
 * Classifies `score` into a `SignalLevel`, with hysteresis around whatever level was already held
 * (spec follow-up: the real-price backtest showed the bot whipsawing BUY/HOLD/SELL/REDUCE on
 * ordinary daily price noise near a threshold boundary, trading on noise rather than on an actual
 * change of view). `previousLevel` is the level `computeSignal` returned on the PREVIOUS round —
 * `undefined` on a bot's first-ever decision, treated the same as `'HOLD'` (no level to resist
 * leaving yet).
 *
 * Entering a level always uses the plain configured threshold — hysteresis never makes the bot
 * MORE eager to trade, only less eager to immediately reverse. Leaving a held level requires the
 * score to fall back past that level's own entry threshold by `hysteresisBand` first (an
 * "exit threshold" pulled toward zero from the entry one) — e.g. with `buyThreshold: 0.05` and
 * `hysteresisBand: 0.03`, a score that already earned BUY keeps BUY until it drops below 0.02, not
 * merely below 0.05 again. `hysteresisBand: 0` reproduces the old always-reclassify-fresh
 * behavior exactly.
 */
function classifySignal(
  score: number,
  thresholds: SignalThresholds,
  previousLevel: SignalLevel | undefined,
): { level: SignalLevel; heldByHysteresis: boolean } {
  const { strongBuyThreshold, buyThreshold, reduceThreshold, sellThreshold, strongSellThreshold, hysteresisBand } =
    thresholds;
  const freshLevel = classifyWithoutHysteresis(score, thresholds);

  switch (previousLevel) {
    case 'STRONG_BUY':
      if (score >= strongBuyThreshold - hysteresisBand) {
        return { level: 'STRONG_BUY', heldByHysteresis: freshLevel !== 'STRONG_BUY' };
      }
      if (score >= buyThreshold) return { level: 'BUY', heldByHysteresis: false };
      break;
    case 'BUY':
      if (score >= strongBuyThreshold) return { level: 'STRONG_BUY', heldByHysteresis: false };
      if (score >= buyThreshold - hysteresisBand) {
        return { level: 'BUY', heldByHysteresis: freshLevel !== 'BUY' };
      }
      break;
    case 'REDUCE':
      if (score <= sellThreshold) return { level: 'SELL', heldByHysteresis: false };
      if (score <= reduceThreshold + hysteresisBand) {
        return { level: 'REDUCE', heldByHysteresis: freshLevel !== 'REDUCE' };
      }
      break;
    case 'SELL':
      if (score <= strongSellThreshold) return { level: 'STRONG_SELL', heldByHysteresis: false };
      if (score <= sellThreshold + hysteresisBand) {
        return { level: 'SELL', heldByHysteresis: freshLevel !== 'SELL' };
      }
      if (score <= reduceThreshold) return { level: 'REDUCE', heldByHysteresis: false };
      break;
    // v1-only: symmetric with STRONG_BUY's own case above — entering a MORE extreme level (here,
    // giving up STRONG_SELL for something less extreme) always uses the plain threshold; only
    // giving up STRONG_SELL itself resists via hysteresisBand.
    case 'STRONG_SELL':
      if (score <= strongSellThreshold + hysteresisBand) {
        return { level: 'STRONG_SELL', heldByHysteresis: freshLevel !== 'STRONG_SELL' };
      }
      if (score <= sellThreshold) return { level: 'SELL', heldByHysteresis: false };
      break;
    case 'HOLD':
    case undefined:
      break;
  }

  return { level: freshLevel, heldByHysteresis: false };
}

export function computeSignal(params: {
  ticker: string;
  fairValuePerShare: number;
  marketPrice: number;
  effects: ModelEffect[];
  thresholds: SignalThresholds;
  /** Omit (or pass `undefined`) for no hysteresis — a bot's first-ever decision, or any caller
   * that just wants the plain, stateless threshold classification. */
  previousLevel?: SignalLevel | undefined;
}): Signal {
  const valuationGap = computeValuationGap(params.fairValuePerShare, params.marketPrice);
  const confidence = computeSignalConfidence(params.effects);
  const signalScore = valuationGap * confidence;
  const { level, heldByHysteresis } = classifySignal(signalScore, params.thresholds, params.previousLevel);

  return {
    security: params.ticker,
    level,
    signalScore,
    valuationGap,
    confidence,
    heldByHysteresis,
    rationale:
      `Fair value $${params.fairValuePerShare.toFixed(2)}/share vs market $${params.marketPrice.toFixed(2)}/share ` +
      `-> valuation gap ${(valuationGap * 100).toFixed(1)}%; confidence ${(confidence * 100).toFixed(0)}% ` +
      `-> signal score ${(signalScore * 100).toFixed(1)}% -> ${level}` +
      `${heldByHysteresis ? ' (held by hysteresis — the raw score alone would have reverted)' : ''}.`,
  };
}

/**
 * v3-only: the trailing simple return over `windowDays` real trading days —
 * `currentPrice / (close windowDays ago) - 1` — feeding `decision.ts`'s trend-confirmation filter
 * (see `TrendFilterPolicy`'s own doc comment in `config.ts` for the full rationale). Uses only
 * past/current price data a real trader would actually have — no look-ahead, nothing derived from
 * this round's own future resolution.
 *
 * Returns `undefined` when there aren't at least `windowDays` bars of history yet (a security's
 * early rounds in a match) — the caller treats that as "no basis to veto anything," never as "flat."
 */
export function computeTrailingReturn(
  history: DailyBar[],
  currentPrice: number,
  windowDays: number,
): number | undefined {
  if (history.length < windowDays) return undefined;
  const referenceClose = history[history.length - windowDays]!.close;
  if (referenceClose <= 0) return undefined;
  return currentPrice / referenceClose - 1;
}
