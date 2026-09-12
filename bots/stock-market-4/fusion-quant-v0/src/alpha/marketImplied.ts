import type { MarketImpliedExpectations } from '../valuation/types.js';
import type { AlphaSignal } from './types.js';

/** Scales `MarketImpliedExpectations.captureGap` (a 0-1-unit "capture fraction" difference, see
 * `../valuation/marketImplied.ts`) into an expected-return-fraction unit — illustrative, not
 * swept/tuned, same discipline as every other alpha's own scale constant. */
export const MARKET_IMPLIED_SCALE = 0.3;

/**
 * Reverse-engineers what the CURRENT price already assumes (`valuation/marketImplied.ts`,
 * unchanged from `fusion-fundamental-v7`) into its own alpha: a positive `captureGap` means the
 * market prices in LESS fusion success than this strategy's own base-case assumption (a bullish
 * asymmetric-upside case); negative means the market already prices in MORE. `undefined`
 * (no modeled fusion revenue chain to invert — most of the 11-security universe) means this alpha
 * is silent, not zero-confidently bearish or bullish.
 */
export function computeMarketImpliedAlpha(params: {
  ticker: string;
  date: string | null;
  marketImplied: MarketImpliedExpectations | undefined;
}): AlphaSignal {
  if (params.marketImplied === undefined) {
    return { factor: 'market_implied', ticker: params.ticker, date: params.date, value: 0, confidence: 0 };
  }
  const value = params.marketImplied.captureGap * MARKET_IMPLIED_SCALE;
  // A finding OUTSIDE this strategy's own modeled bear/bull range is a stronger, more surprising
  // signal than one merely inside it (spec §39's "valuation blindness" case, carried over from
  // fusion-fundamental-v7) — reflected here as higher confidence, not a different sign/magnitude.
  const confidence = params.marketImplied.impliedCaptureVsRange === 'within_range' ? 0.4 : 0.8;
  return { factor: 'market_implied', ticker: params.ticker, date: params.date, value, confidence };
}
