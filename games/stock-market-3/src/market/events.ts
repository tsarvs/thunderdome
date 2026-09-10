import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import { REGIME_PROFILES } from '../economy/regime.js';
import {
  ECONOMIC_RELEASE_INDICATORS,
  type CalendarEntry,
  type CompanyNewsEvent,
  type CompanyNewsType,
  type EconomicReleaseIndicator,
  type EquityDef,
  type MarketRegime,
  type ReportedFinancials,
} from '../types.js';

/** One round == one trading day (spec §26); one quarter's worth of trading days before a company's
 * next earnings report — a fixed, hidden simulator constant. */
export const QUARTER_LENGTH_ROUNDS = 63;
/** How often a macro data point is released, cycling round-robin through the 4 indicators. */
const RELEASE_CADENCE_ROUNDS = 21;

/**
 * Builds the full earnings/economic-release schedule once, at match init (spec §23) — purely a
 * function of the configured equity list and total round count, so it's safe to generate and
 * expose in full immediately: a scheduled round carries no outcome, only "something will be
 * reported here." Companies are staggered (offset by their index in the list) so they don't all
 * report on the same day; economic releases cycle through the 4 published indicators.
 */
export function buildCalendar(equities: readonly EquityDef[], totalRounds: number): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  equities.forEach((equity, index) => {
    const offset = 10 + index * 6;
    for (let round = offset; round < totalRounds; round += QUARTER_LENGTH_ROUNDS) {
      entries.push({ round, type: 'EARNINGS_REPORT', symbol: equity.symbol });
    }
  });

  let releaseIndex = 0;
  for (let round = 7; round < totalRounds; round += RELEASE_CADENCE_ROUNDS) {
    const indicator = ECONOMIC_RELEASE_INDICATORS[releaseIndex % ECONOMIC_RELEASE_INDICATORS.length] ?? ECONOMIC_RELEASE_INDICATORS[0];
    entries.push({ round, type: 'ECONOMIC_RELEASE', indicator });
    releaseIndex += 1;
  }

  entries.sort((a, b) => a.round - b.round);
  return entries;
}

export function quarterLabelFor(round: number): string {
  return `Q${String(Math.floor(round / QUARTER_LENGTH_ROUNDS) + 1)}`;
}

// ---------------------------------------------------------------------------
// Economic releases — a published reading is a noisy, partial window onto a hidden
// EconomicFactor, never the factor's raw value itself (spec §21/§22).
// ---------------------------------------------------------------------------

const INDICATOR_PROFILES: Record<EconomicReleaseIndicator, { baseline: number; scale: number; noise: number }> = {
  GDP_GROWTH: { baseline: 2.0, scale: 1.5, noise: 0.3 },
  INFLATION_RATE: { baseline: 2.5, scale: 1.3, noise: 0.25 },
  POLICY_RATE: { baseline: 3.0, scale: 1.0, noise: 0.1 },
  COMMODITY_INDEX: { baseline: 100, scale: 15, noise: 3 },
};

const INDICATOR_FACTOR: Record<EconomicReleaseIndicator, 'GROWTH' | 'INFLATION' | 'INTEREST_RATES' | 'COMMODITY_PRICES'> = {
  GDP_GROWTH: 'GROWTH',
  INFLATION_RATE: 'INFLATION',
  POLICY_RATE: 'INTEREST_RATES',
  COMMODITY_INDEX: 'COMMODITY_PRICES',
};

export function initialIndicatorReading(indicator: EconomicReleaseIndicator): number {
  return INDICATOR_PROFILES[indicator].baseline;
}

/** The "consensus" survey economists would have published ahead of this release — extrapolated
 * from the previous print, with its own independent guess noise (drawn BEFORE the actual reading
 * below, so it can never be informed by this round's true factor value). */
export function forecastIndicatorReading(indicator: EconomicReleaseIndicator, previousReading: number, rng: Rng): number {
  const profile = INDICATOR_PROFILES[indicator];
  return Math.round((previousReading + gaussian(rng) * profile.noise * 0.6) * 100) / 100;
}

export function deriveIndicatorReading(
  indicator: EconomicReleaseIndicator,
  economicFactorValue: number,
  rng: Rng,
): number {
  const profile = INDICATOR_PROFILES[indicator];
  return Math.round((profile.baseline + profile.scale * economicFactorValue + gaussian(rng) * profile.noise) * 100) / 100;
}

export function factorFor(indicator: EconomicReleaseIndicator): 'GROWTH' | 'INFLATION' | 'INTEREST_RATES' | 'COMMODITY_PRICES' {
  return INDICATOR_FACTOR[indicator];
}

/**
 * The simulator's own hidden mapping from a public earnings surprise to a price reaction — the
 * INPUTS (`reported`, `consensus`) are fully public (spec §22's whole point), but a real market
 * doesn't publish an official "surprise -> return" formula either, so this function's existence
 * and shape stay internal. A sophisticated bot is expected to approximate its own version of this
 * from historical event/return pairs during warmup, not read it here.
 */
export function earningsSurpriseImpact(reported: ReportedFinancials, consensus: ReportedFinancials): number {
  const epsSurprise = (reported.epsCents - consensus.epsCents) / Math.max(1, Math.abs(consensus.epsCents));
  const revenueSurprise = (reported.revenueCents - consensus.revenueCents) / Math.max(1, Math.abs(consensus.revenueCents));
  return Math.max(-0.15, Math.min(0.15, epsSurprise * 0.35 + revenueSurprise * 0.2));
}

// ---------------------------------------------------------------------------
// Unscheduled company news — a small headline taxonomy (spec §22), never a sentiment label. Hidden
// impact is returned alongside the public event so `market/priceModel.ts` can apply it without a
// bot ever seeing the number.
// ---------------------------------------------------------------------------

const NEWS_DESCRIPTIONS: Record<CompanyNewsType, string> = {
  PRODUCT_ANNOUNCEMENT: 'announced a new product.',
  REGULATORY_NOTICE: 'received a regulatory notice.',
  MANAGEMENT_CHANGE: 'announced a management change.',
  LEGAL_MATTER: 'disclosed a legal matter.',
};

const BASE_NEWS_PROBABILITY = 1 / 45;
const NEWS_IMPACT_RANGE: readonly [number, number] = [0.01, 0.05];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Deterministic given `rng`'s next few draws — always consumes exactly one bucket-selection draw
 * plus, only when it fires, one type-selection and one magnitude draw. Safe to call unconditionally
 * once per round per company. */
export function maybeUnscheduledNews(
  symbol: string,
  regime: MarketRegime,
  round: number,
  rng: Rng,
): { event: CompanyNewsEvent | null; impactReturn: number } {
  const profile = REGIME_PROFILES[regime];
  const probability = clamp01(BASE_NEWS_PROBABILITY * profile.newsFrequencyMultiplier);
  if (rng.nextFloat() >= probability) {
    return { event: null, impactReturn: 0 };
  }
  const types: CompanyNewsType[] = ['PRODUCT_ANNOUNCEMENT', 'REGULATORY_NOTICE', 'MANAGEMENT_CHANGE', 'LEGAL_MATTER'];
  const type = rng.pick(types);
  const isNegative = rng.nextFloat() < clamp01(0.5 + profile.negativeBias * 0.4);
  const [min, max] = NEWS_IMPACT_RANGE;
  const magnitude = min + rng.nextFloat() * (max - min);
  return {
    event: {
      type,
      observedAtRound: round,
      symbol,
      description: `${symbol} ${NEWS_DESCRIPTIONS[type]}`,
    },
    impactReturn: isNegative ? -magnitude : magnitude,
  };
}
