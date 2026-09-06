import type { OrderSide, RiskConfig, StockMarket2Portfolio } from '../types.js';

/**
 * Applies one fill to a single participant's portfolio (spec §26). Handles every position
 * transition correctly, including the tricky ones: opening/adding to a long or short (weighted-
 * average cost basis, no P&L realized), fully or partially closing one (realizes P&L against the
 * existing average entry price), and a fill large enough to reverse straight through flat into
 * the opposite side in one trade (the closing portion realizes P&L as usual; the remainder opens
 * a brand-new position at this fill's own price).
 */
export function applyFill(
  portfolio: StockMarket2Portfolio,
  side: OrderSide,
  quantity: number,
  priceCents: number,
  feeCents: number,
): StockMarket2Portfolio {
  const signedDelta = side === 'BUY' ? quantity : -quantity;
  const oldShares = portfolio.shares;
  const newShares = oldShares + signedDelta;

  let realizedDeltaCents = 0;
  let averageEntryPriceCents = portfolio.averageEntryPriceCents;

  if (oldShares === 0 || Math.sign(oldShares) === Math.sign(signedDelta)) {
    // Opening from flat, or adding to an existing position in the same direction: weighted-
    // average cost basis, nothing realized yet.
    const oldNotionalCents = Math.abs(oldShares) * portfolio.averageEntryPriceCents;
    const addNotionalCents = quantity * priceCents;
    averageEntryPriceCents = Math.round((oldNotionalCents + addNotionalCents) / Math.abs(newShares));
  } else {
    // Reducing (or reversing straight through flat) an existing position: the portion up to
    // whichever of the two is smaller closes against the existing average entry price, realizing
    // P&L; a long realizes (exit - entry), a short realizes (entry - exit).
    const closingQuantity = Math.min(Math.abs(oldShares), quantity);
    const pnlPerShareCents =
      oldShares > 0 ? priceCents - portfolio.averageEntryPriceCents : portfolio.averageEntryPriceCents - priceCents;
    realizedDeltaCents = pnlPerShareCents * closingQuantity;

    if (newShares === 0) {
      averageEntryPriceCents = 0;
    } else if (Math.sign(newShares) !== Math.sign(oldShares)) {
      // Reversed straight through flat in one fill — the remainder beyond closingQuantity opens a
      // fresh position in the new direction, at this fill's own price.
      averageEntryPriceCents = priceCents;
    }
    // else: a partial close in the same direction — the remaining shares keep their existing
    // average entry price unchanged.
  }

  const cashDeltaCents = (side === 'BUY' ? -1 : 1) * quantity * priceCents - feeCents;

  return {
    cashCents: portfolio.cashCents + cashDeltaCents,
    shares: newShares,
    averageEntryPriceCents: newShares === 0 ? 0 : averageEntryPriceCents,
    realizedPnlCents: portfolio.realizedPnlCents + realizedDeltaCents,
    bankrupt: portfolio.bankrupt,
  };
}

/** Net liquidation value: cash plus the mark-to-market value of the position (negative for a
 * short, same formula either way). */
export function equityCents(portfolio: StockMarket2Portfolio, markPriceCents: number): number {
  return portfolio.cashCents + portfolio.shares * markPriceCents;
}

/** Absolute exposure, long or short — what margin requirements are sized against. */
export function grossPositionValueCents(portfolio: StockMarket2Portfolio, markPriceCents: number): number {
  return Math.abs(portfolio.shares) * markPriceCents;
}

/**
 * Total gross position value (long + short) this account may hold right now — Reg-T-style:
 * equity / initialMarginRatio. 0 when `risk.allowShortSelling` is off: margin buying power isn't
 * available without a margin account (see `RiskConfigSchema`'s doc — this repo bundles "shorting"
 * and "margin trading" as one toggle, same as a real brokerage requiring a margin account to
 * short at all).
 */
export function buyingPowerCents(portfolio: StockMarket2Portfolio, markPriceCents: number, risk: RiskConfig): number {
  if (!risk.allowShortSelling) {
    return 0;
  }
  return Math.max(0, equityCents(portfolio, markPriceCents) / risk.initialMarginRatio);
}

export function maintenanceRequirementCents(
  portfolio: StockMarket2Portfolio,
  markPriceCents: number,
  risk: RiskConfig,
): number {
  if (!risk.allowShortSelling) {
    return 0;
  }
  return risk.maintenanceMarginRatio * grossPositionValueCents(portfolio, markPriceCents);
}

export function isBelowMaintenance(
  portfolio: StockMarket2Portfolio,
  markPriceCents: number,
  risk: RiskConfig,
): boolean {
  if (!risk.allowShortSelling || portfolio.shares === 0) {
    return false;
  }
  return equityCents(portfolio, markPriceCents) < maintenanceRequirementCents(portfolio, markPriceCents, risk);
}

/**
 * The largest BUY quantity (covering a short and/or opening/adding to a long) this account's
 * current buying power supports at `priceCents`. Covering an existing short back toward flat is
 * always allowed regardless of margin (the position is shrinking); only the portion that would
 * push the position long *past* flat consumes buying power.
 */
export function maxBuyQuantityByMargin(currentShares: number, buyingPower: number, priceCents: number): number {
  if (priceCents <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (currentShares <= 0) {
    const coveringRoom = -currentShares;
    const longRoomAfterFlat = Math.floor(buyingPower / priceCents);
    return coveringRoom + Math.max(0, longRoomAfterFlat);
  }
  return Math.max(0, Math.floor(buyingPower / priceCents) - currentShares);
}

/**
 * The largest SELL quantity (reducing a long and/or opening/adding to a short) this account's
 * current buying power and remaining borrow headroom support at `priceCents`. Reducing an
 * existing long back toward flat is always allowed regardless of margin/borrow (the position is
 * shrinking); only the portion that would push the position short *past* flat consumes buying
 * power and counts against `borrowableShares`.
 */
export function maxSellQuantityByMargin(
  currentShares: number,
  buyingPower: number,
  priceCents: number,
  borrowableShares: number,
): number {
  if (priceCents <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (currentShares >= 0) {
    const reducingRoom = currentShares;
    const shortRoomByMargin = Math.floor(buyingPower / priceCents);
    return reducingRoom + Math.max(0, Math.min(shortRoomByMargin, borrowableShares));
  }
  const currentShortSize = -currentShares;
  const shortRoomByMargin = Math.max(0, Math.floor(buyingPower / priceCents) - currentShortSize);
  const shortRoomByBorrow = Math.max(0, borrowableShares - currentShortSize);
  return Math.min(shortRoomByMargin, shortRoomByBorrow);
}
