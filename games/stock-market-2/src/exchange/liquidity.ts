import type { Rng } from '@thunderdome/engine';
import type { LiquidityProfile, LiquiditySnapshot } from '../types.js';

/** Fraction of `expectedDailyVolume` offered at the single best price level; deeper levels decay
 * from there by `profile.levelSizeDecay`. This is what guarantees a bot can generally transact
 * without another bot present (spec §15) even at the very first level. */
const BEST_LEVEL_VOLUME_FRACTION = 0.02;

/** Random per-level size jitter range, so two adjacent rounds' ladders aren't eerily identical in
 * shape even when the reference price barely moved. */
const SIZE_JITTER_MIN = 0.8;
const SIZE_JITTER_MAX = 1.2;

/**
 * Builds one round's simulated external order-book depth, centered on `referencePriceCents`.
 * Deterministic given the same `rng` draws — every level's price and size is a pure function of
 * `referencePriceCents`/`expectedDailyVolume`/`volatilityHint`/`profile` plus one `rng.nextFloat()`
 * draw per level (size jitter only; level prices are not randomized, since the bid/ask ladder's
 * shape itself is a real, observable thing a bot should be able to reason about).
 */
export function generateLiquiditySnapshot(args: {
  referencePriceCents: number;
  expectedDailyVolume: number;
  volatilityHint: number;
  profile: LiquidityProfile;
  rng: Rng;
}): LiquiditySnapshot {
  const { referencePriceCents, expectedDailyVolume, volatilityHint, profile, rng } = args;

  const halfSpreadCents = Math.max(1, Math.round((referencePriceCents * profile.baseSpreadBps) / 10000 / 2));
  // Volatility widens the step between successive levels — a choppier stock's book is naturally
  // thinner/wider at any given depth than a calm one, for the same nominal levelPriceStepBps.
  const volatilityScale = 1 + volatilityHint * 10;
  const stepCents = Math.max(1, Math.round((referencePriceCents * profile.levelPriceStepBps) / 10000 * volatilityScale));
  const baseLevelQuantity = Math.max(1, Math.round(expectedDailyVolume * BEST_LEVEL_VOLUME_FRACTION));

  function buildSide(direction: 1 | -1): { priceCents: number; quantity: number }[] {
    const levels: { priceCents: number; quantity: number }[] = [];
    for (let level = 0; level < profile.bookLevels; level++) {
      const priceCents = referencePriceCents + direction * (halfSpreadCents + level * stepCents);
      const jitter = SIZE_JITTER_MIN + rng.nextFloat() * (SIZE_JITTER_MAX - SIZE_JITTER_MIN);
      const quantity = Math.max(1, Math.round(baseLevelQuantity * profile.levelSizeDecay ** level * jitter));
      levels.push({ priceCents: Math.max(1, priceCents), quantity });
    }
    return levels;
  }

  return {
    bids: buildSide(-1),
    asks: buildSide(1),
  };
}
