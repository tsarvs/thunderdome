import type { Rng } from '@thunderdome/engine';
import type { LiquidityProfile, LiquiditySnapshot } from '../types.js';

const BEST_LEVEL_VOLUME_FRACTION = 0.02;
const SIZE_JITTER_MIN = 0.8;
const SIZE_JITTER_MAX = 1.2;

/**
 * Builds one round's simulated external order-book depth for one symbol, centered on
 * `referencePriceCents` — ported from games/stock-market-2's `exchange/liquidity.ts`, generalized
 * with independent bid/ask quantity multipliers so `market/externalParticipants.ts`'s directional
 * flow bias can make one side deeper than the other (dynamic liquidity, spec §33/§34) without
 * changing the underlying symmetric-book mechanics. `bidQuantityMultiplier === askQuantityMultiplier
 * === 1` reproduces the exact symmetric ladder V2 always used.
 */
export function generateLiquiditySnapshot(args: {
  referencePriceCents: number;
  expectedDailyVolume: number;
  volatilityHint: number;
  profile: LiquidityProfile;
  bidQuantityMultiplier: number;
  askQuantityMultiplier: number;
  rng: Rng;
}): LiquiditySnapshot {
  const { referencePriceCents, expectedDailyVolume, volatilityHint, profile, bidQuantityMultiplier, askQuantityMultiplier, rng } =
    args;

  const halfSpreadCents = Math.max(1, Math.round((referencePriceCents * profile.baseSpreadBps) / 10000 / 2));
  const volatilityScale = 1 + volatilityHint * 10;
  const stepCents = Math.max(1, Math.round((referencePriceCents * profile.levelPriceStepBps) / 10000 * volatilityScale));
  const baseLevelQuantity = Math.max(1, Math.round(expectedDailyVolume * BEST_LEVEL_VOLUME_FRACTION));

  function buildSide(direction: 1 | -1, quantityMultiplier: number): { priceCents: number; quantity: number }[] {
    const levels: { priceCents: number; quantity: number }[] = [];
    for (let level = 0; level < profile.bookLevels; level++) {
      const priceCents = referencePriceCents + direction * (halfSpreadCents + level * stepCents);
      const jitter = SIZE_JITTER_MIN + rng.nextFloat() * (SIZE_JITTER_MAX - SIZE_JITTER_MIN);
      const quantity = Math.max(
        1,
        Math.round(baseLevelQuantity * profile.levelSizeDecay ** level * jitter * quantityMultiplier),
      );
      levels.push({ priceCents: Math.max(1, priceCents), quantity });
    }
    return levels;
  }

  return {
    bids: buildSide(-1, bidQuantityMultiplier),
    asks: buildSide(1, askQuantityMultiplier),
  };
}
