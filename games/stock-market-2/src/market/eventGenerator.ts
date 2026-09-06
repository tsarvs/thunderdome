import type { Rng } from '@thunderdome/engine';
import type { MarketRegime, StockMarket2Event, StockMarket2EventType } from '../types.js';
import { REGIME_PROFILES } from './regime.js';

/** SYNTHETIC mode's regime-aware public-event process (spec §9). HISTORICAL mode never uses
 * this — its events (and their real impact, already fully baked into the real close data) come
 * from `src/data/events.ts` instead; fabricating a *synthetic* impact on top of real data would
 * violate this game's whole "don't invent things about a real company" design (see
 * games/stock-market-2/README.md).
 */
export interface GeneratedEvent {
  event: StockMarket2Event;
  /** Hidden signed log-return contribution — never shown to bots. Zero for NO_NEWS. */
  impactReturn: number;
}

const EVENT_DESCRIPTIONS: Record<StockMarket2EventType, string> = {
  NO_NEWS: 'No news today.',
  POSITIVE_NEWS: 'The company issued positive news today.',
  NEGATIVE_NEWS: 'The company issued negative news today.',
  EARNINGS_BEAT: 'The company reported quarterly earnings above expectations today.',
  EARNINGS_MISS: 'The company reported quarterly earnings below expectations today.',
};

// Base per-round probabilities in a neutral (SIDEWAYS) regime, before that regime's own
// eventFrequencyMultiplier. Earnings: roughly quarterly (~1-in-63 trading days). "News": a single
// bucket covering positive-or-negative material news, sign decided separately once the bucket
// fires.
const BASE_EARNINGS_PROBABILITY = 1 / 63;
const BASE_NEWS_PROBABILITY = 1 / 40;

const EARNINGS_IMPACT_RANGE: readonly [number, number] = [0.03, 0.09];
const NEWS_IMPACT_RANGE: readonly [number, number] = [0.01, 0.05];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sampleMagnitude(rng: Rng, [min, max]: readonly [number, number]): number {
  return min + rng.nextFloat() * (max - min);
}

/** Deterministic given `rng`'s next few draws — always consumes the same fixed number of draws
 * regardless of outcome (one bucket-selection draw, plus a sign draw and a magnitude draw only
 * when a non-NO_NEWS bucket fires), so this is safe to call once per round unconditionally. */
export function generateSyntheticEvent(regime: MarketRegime, rng: Rng): GeneratedEvent {
  const profile = REGIME_PROFILES[regime];
  const earningsProbability = clamp01(BASE_EARNINGS_PROBABILITY * profile.eventFrequencyMultiplier);
  const newsProbability = clamp01(BASE_NEWS_PROBABILITY * profile.eventFrequencyMultiplier);
  // A regime's negativeBias in [-1, 1] shifts the coin-flip for which side of an event fires —
  // e.g. CRISIS's +0.8 bias makes a fired event much more likely to be the negative outcome.
  const negativeProbability = clamp01(0.5 + profile.negativeBias * 0.4);

  const bucketDraw = rng.nextFloat();
  if (bucketDraw < earningsProbability) {
    const isMiss = rng.nextFloat() < negativeProbability;
    const magnitude = sampleMagnitude(rng, EARNINGS_IMPACT_RANGE);
    const type: StockMarket2EventType = isMiss ? 'EARNINGS_MISS' : 'EARNINGS_BEAT';
    return { event: { type, description: EVENT_DESCRIPTIONS[type] }, impactReturn: isMiss ? -magnitude : magnitude };
  }
  if (bucketDraw < earningsProbability + newsProbability) {
    const isNegative = rng.nextFloat() < negativeProbability;
    const magnitude = sampleMagnitude(rng, NEWS_IMPACT_RANGE);
    const type: StockMarket2EventType = isNegative ? 'NEGATIVE_NEWS' : 'POSITIVE_NEWS';
    return { event: { type, description: EVENT_DESCRIPTIONS[type] }, impactReturn: isNegative ? -magnitude : magnitude };
  }
  return { event: { type: 'NO_NEWS', description: EVENT_DESCRIPTIONS.NO_NEWS }, impactReturn: 0 };
}
