import type { Rng } from '@thunderdome/engine';
import { gaussian } from '../rngUtil.js';
import type { ReportedFinancials } from '../types.js';

/** How much of the gap between the current consensus and the (hidden) true outcome closes each
 * round — deliberately small, so consensus drifts toward the truth over a whole quarter rather
 * than snapping to it (spec §21's worked example: 1.10 -> 1.08 -> 1.03 -> guidance 0.98 -> actual
 * 1.01). Noise on top means the walk isn't monotonic and doesn't even have to end up close. */
const CONVERGENCE_RATE = 0.06;

/** The Street's first guess for a quarter that just started (spec §21) — meaningfully off from the
 * hidden true outcome, biased in a random direction each time, not just noisy around zero error. */
export function initialConsensusEstimate(actual: ReportedFinancials, rng: Rng): ReportedFinancials {
  return {
    epsCents: Math.round(actual.epsCents * (1 + gaussian(rng) * 0.18)),
    revenueCents: Math.round(actual.revenueCents * (1 + gaussian(rng) * 0.1)),
    marginBps: Math.round(actual.marginBps + gaussian(rng) * 200),
  };
}

/** One round's consensus revision, pulled partway toward the hidden actual with noise on top —
 * called every round of an open quarter, appended to that security's `analystRevisions` history
 * (spec §21). Never called with, or allowed to leak, the actual itself beyond this pull — a bot
 * only ever sees the resulting consensus value, never `actual`. */
export function reviseConsensus(current: ReportedFinancials, actual: ReportedFinancials, rng: Rng): ReportedFinancials {
  function moveField(currentValue: number, actualValue: number, noiseScale: number): number {
    const pulled = currentValue + CONVERGENCE_RATE * (actualValue - currentValue);
    return Math.round(pulled + gaussian(rng) * noiseScale);
  }
  return {
    epsCents: moveField(current.epsCents, actual.epsCents, Math.max(1, Math.abs(actual.epsCents) * 0.03)),
    revenueCents: moveField(current.revenueCents, actual.revenueCents, Math.max(1, Math.abs(actual.revenueCents) * 0.01)),
    marginBps: moveField(current.marginBps, actual.marginBps, 20),
  };
}
