import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import { STYLE_FACTORS, type LifecycleStage, type StyleLoadings } from '../types.js';

/** Draws one company's fixed per-style loadings at init (spec §13) — hidden; a bot must estimate
 * these from behavior (return persistence for MOMENTUM, sensitivity to valuation gaps for VALUE,
 * relative volatility for VOLATILITY, and so on), never read them. Redrawn only if a company's
 * lifecycle stage changes (`applyLifecycleTilt` below), not every round. */
export function drawStyleLoadings(rng: Rng): StyleLoadings {
  const loadings = {} as StyleLoadings;
  for (const style of STYLE_FACTORS) {
    loadings[style] = gaussian(rng) * 0.5;
  }
  return loadings;
}

/** A lifecycle-stage transition (spec §41) nudges a company's latent style character rather than
 * replacing it outright — a HIGH_GROWTH company tilts toward MOMENTUM/SIZE (smaller, trendier);
 * MATURE tilts toward VALUE/QUALITY; DECLINE tilts toward VOLATILITY and away from QUALITY. */
const LIFECYCLE_TILT: Record<LifecycleStage, Partial<StyleLoadings>> = {
  HIGH_GROWTH: { MOMENTUM: 0.4, SIZE: -0.3, QUALITY: -0.1 },
  MATURE: { VALUE: 0.3, QUALITY: 0.3, SIZE: 0.2 },
  DECLINE: { VOLATILITY: 0.5, QUALITY: -0.4, VALUE: 0.2 },
};

export function applyLifecycleTilt(base: StyleLoadings, stage: LifecycleStage): StyleLoadings {
  const tilt = LIFECYCLE_TILT[stage];
  const result = { ...base };
  for (const style of STYLE_FACTORS) {
    result[style] += tilt[style] ?? 0;
  }
  return result;
}
