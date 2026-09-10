import type { Rng } from '@thunderdome/engine';
import type { CorporateActionDetails, DailyCandle, Position, SecurityState } from '../types.js';

// ---------------------------------------------------------------------------
// Triggers — dividends/splits/buybacks are announced and applied the SAME round (spec §40); only
// acquisitions/delistings (company/lifecycle.ts) get advance notice, since those change who's
// even tradable.
// ---------------------------------------------------------------------------

const DIVIDEND_PROBABILITY_PER_ROUND = 1 / 90;
const BUYBACK_PROBABILITY_PER_ROUND = 1 / 200;
const SPLIT_PRICE_MULTIPLE = 4;
const REVERSE_SPLIT_PRICE_FRACTION = 0.15;

export function maybeTriggerDividend(security: SecurityState, rng: Rng): CorporateActionDetails | null {
  if (security.kind !== 'EQUITY' || security.fundamentals === null || security.fundamentals.lifecycleStage === 'HIGH_GROWTH') {
    return null; // high-growth companies plow cash back into growth rather than paying dividends
  }
  if (rng.nextFloat() >= DIVIDEND_PROBABILITY_PER_ROUND) {
    return null;
  }
  const yieldFraction = 0.001 + rng.nextFloat() * 0.004;
  return { type: 'CASH_DIVIDEND', perShareCents: Math.max(1, Math.round(security.referencePriceCents * yieldFraction)) };
}

export function maybeTriggerBuyback(security: SecurityState, rng: Rng): CorporateActionDetails | null {
  if (security.kind !== 'EQUITY' || security.fundamentals?.lifecycleStage !== 'MATURE') {
    return null;
  }
  if (rng.nextFloat() >= BUYBACK_PROBABILITY_PER_ROUND) {
    return null;
  }
  const sharesRepurchased = Math.max(1, Math.round(security.sharesOutstanding * 0.01));
  return { type: 'BUYBACK', sharesRepurchased, priceCents: security.referencePriceCents };
}

/** Rule-based, not random: a security whose price ran up 4x (or fell to 15% of) its starting price
 * splits (or reverse-splits) — a bot that only watches raw price can reason about why (spec §40). */
export function maybeTriggerSplit(security: SecurityState, startingPriceCents: number): CorporateActionDetails | null {
  if (security.referencePriceCents >= startingPriceCents * SPLIT_PRICE_MULTIPLE) {
    return { type: 'STOCK_SPLIT', fromShares: 1, toShares: 2 };
  }
  if (security.referencePriceCents <= startingPriceCents * REVERSE_SPLIT_PRICE_FRACTION) {
    return { type: 'REVERSE_SPLIT', fromShares: 5, toShares: 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Application — mechanical effects on the security itself, its price history, and any
// participant's position (spec §40's worked example: a 2-for-1 split must not look like a 50% loss).
// ---------------------------------------------------------------------------

function splitRatio(details: CorporateActionDetails): { from: number; to: number } | null {
  if (details.type === 'STOCK_SPLIT') {
    return { from: details.fromShares, to: details.toShares };
  }
  if (details.type === 'REVERSE_SPLIT') {
    return { from: details.fromShares, to: details.toShares };
  }
  return null;
}

function adjustCandle(candle: DailyCandle, from: number, to: number): DailyCandle {
  const factor = from / to;
  return { ...candle, open: candle.open * factor, high: candle.high * factor, low: candle.low * factor, close: candle.close * factor };
}

/** Applies a dividend/split/reverse-split/buyback to the security itself — price, share count, and
 * (for splits) retroactively-adjusted price history, so technical/momentum bots never see a fake
 * cliff on the split day (real "adjusted close" data does the same). Open orders for this symbol
 * are cancelled on a split (a stale pre-split limit price/quantity would otherwise misprice the
 * book) — a documented simplification, not a general order-adjustment engine. */
export function applyCorporateActionToSecurity(security: SecurityState, details: CorporateActionDetails): SecurityState {
  const ratio = splitRatio(details);
  if (ratio !== null) {
    const factor = ratio.to / ratio.from;
    return {
      ...security,
      sharesOutstanding: Math.round(security.sharesOutstanding * factor),
      referencePriceCents: Math.max(1, Math.round(security.referencePriceCents / factor)),
      fundamentalValueCents: Math.max(1, Math.round(security.fundamentalValueCents / factor)),
      // Deliberately NOT rescaled: `initialReferencePriceCents` is the fixed price this security
      // started the match at. A split already divides `referencePriceCents` by the same factor,
      // so leaving the baseline untouched is what makes "price relative to where this security
      // started" mean something different immediately after the split (as it should — a stock
      // that just 4x'd and split 2-for-1 is now back around 2x its start, not still 4x). Rescaling
      // both sides by the same factor would leave the ratio (and therefore the trigger condition)
      // completely unchanged by the split, causing it to fire again on the very next check.
      priceHistory: security.priceHistory.map((candle) => adjustCandle(candle, ratio.from, ratio.to)),
      openOrders: [],
    };
  }
  if (details.type === 'BUYBACK') {
    const remainingFraction = security.sharesOutstanding / Math.max(1, security.sharesOutstanding - details.sharesRepurchased);
    return {
      ...security,
      sharesOutstanding: Math.max(1, security.sharesOutstanding - details.sharesRepurchased),
      fundamentalValueCents: Math.round(security.fundamentalValueCents * remainingFraction),
    };
  }
  return security; // CASH_DIVIDEND affects only participant cash (below), not the security itself
}

/** Applies the same action to one participant's position. Returns the cash delta separately since
 * a `Position` has no `cashCents` field of its own (that lives on the owning `PortfolioAccount`). */
export function adjustPositionForCorporateAction(
  position: Position,
  details: CorporateActionDetails,
): { position: Position; cashDeltaCents: number } {
  const ratio = splitRatio(details);
  if (ratio !== null) {
    const factor = ratio.to / ratio.from;
    return {
      position: {
        ...position,
        shares: Math.round(position.shares * factor),
        averageEntryPriceCents: position.shares === 0 ? 0 : Math.round(position.averageEntryPriceCents / factor),
      },
      cashDeltaCents: 0,
    };
  }
  if (details.type === 'CASH_DIVIDEND') {
    // Positive for a long (receives it), negative for a short (owes it to the lender) — one
    // formula covers both signs of `position.shares`.
    return { position, cashDeltaCents: position.shares * details.perShareCents };
  }
  return { position, cashDeltaCents: 0 }; // BUYBACK doesn't directly touch an individual position
}
