import { describe, expect, it } from 'vitest';
import {
  applyFill,
  buyingPowerCents,
  equityCents,
  grossPositionValueCents,
  isBelowMaintenance,
  maintenanceRequirementCents,
  maxBuyQuantityByMargin,
  maxSellQuantityByMargin,
} from '../src/portfolio/accounting.js';
import { RiskConfigSchema, type RiskConfig, type StockMarket2Portfolio } from '../src/types.js';

const MARGIN_RISK: RiskConfig = RiskConfigSchema.parse({ allowShortSelling: true });
const NO_MARGIN_RISK: RiskConfig = RiskConfigSchema.parse({});

function flat(cashCents = 1_000_000): StockMarket2Portfolio {
  return { cashCents, shares: 0, averageEntryPriceCents: 0, realizedPnlCents: 0, bankrupt: false };
}

describe('applyFill — opening and adding to a position', () => {
  it('opens a long from flat: debits cash, credits shares, sets average entry, realizes nothing', () => {
    const result = applyFill(flat(), 'BUY', 10, 10000, 100);
    expect(result).toEqual({
      cashCents: 1_000_000 - 10 * 10000 - 100,
      shares: 10,
      averageEntryPriceCents: 10000,
      realizedPnlCents: 0,
      bankrupt: false,
    });
  });

  it('adding to a long at a new price updates the weighted-average entry price', () => {
    const afterFirst = applyFill(flat(), 'BUY', 10, 10000, 0); // 10 @ $100.00
    const afterSecond = applyFill(afterFirst, 'BUY', 10, 12000, 0); // +10 @ $120.00
    expect(afterSecond.shares).toBe(20);
    expect(afterSecond.averageEntryPriceCents).toBe(11000); // (10*10000 + 10*12000) / 20
    expect(afterSecond.realizedPnlCents).toBe(0);
  });

  it('opens a short from flat: credits cash, debits shares negative, sets average entry', () => {
    const result = applyFill(flat(), 'SELL', 10, 10000, 100);
    expect(result).toEqual({
      cashCents: 1_000_000 + 10 * 10000 - 100,
      shares: -10,
      averageEntryPriceCents: 10000,
      realizedPnlCents: 0,
      bankrupt: false,
    });
  });

  it('adding to a short at a new price updates the weighted-average entry price', () => {
    const afterFirst = applyFill(flat(), 'SELL', 10, 10000, 0); // -10 @ $100.00
    const afterSecond = applyFill(afterFirst, 'SELL', 10, 8000, 0); // -10 more @ $80.00
    expect(afterSecond.shares).toBe(-20);
    expect(afterSecond.averageEntryPriceCents).toBe(9000);
    expect(afterSecond.realizedPnlCents).toBe(0);
  });
});

describe('applyFill — closing a long', () => {
  it('fully closing a long realizes (exit - entry) * quantity and clears the average entry price', () => {
    const long = applyFill(flat(), 'BUY', 10, 10000, 0); // entry $100.00
    const closed = applyFill(long, 'SELL', 10, 11000, 0); // exit $110.00 — $10 profit/share
    expect(closed.shares).toBe(0);
    expect(closed.averageEntryPriceCents).toBe(0);
    expect(closed.realizedPnlCents).toBe(10 * (11000 - 10000));
  });

  it('a losing close realizes a negative P&L', () => {
    const long = applyFill(flat(), 'BUY', 10, 10000, 0);
    const closed = applyFill(long, 'SELL', 10, 9000, 0);
    expect(closed.realizedPnlCents).toBe(10 * (9000 - 10000));
  });

  it('partially closing a long realizes P&L on the closed portion only, keeping the same average entry for the rest', () => {
    const long = applyFill(flat(), 'BUY', 10, 10000, 0);
    const partial = applyFill(long, 'SELL', 4, 11000, 0);
    expect(partial.shares).toBe(6);
    expect(partial.averageEntryPriceCents).toBe(10000); // unchanged for the remaining shares
    expect(partial.realizedPnlCents).toBe(4 * (11000 - 10000));
  });
});

describe('applyFill — closing a short', () => {
  it('fully covering a short realizes (entry - exit) * quantity', () => {
    const short = applyFill(flat(), 'SELL', 10, 10000, 0); // sold short @ $100.00
    const covered = applyFill(short, 'BUY', 10, 9000, 0); // covered @ $90.00 — profit
    expect(covered.shares).toBe(0);
    expect(covered.averageEntryPriceCents).toBe(0);
    expect(covered.realizedPnlCents).toBe(10 * (10000 - 9000));
  });

  it('covering at a higher price than the short entry realizes a loss', () => {
    const short = applyFill(flat(), 'SELL', 10, 10000, 0);
    const covered = applyFill(short, 'BUY', 10, 11000, 0);
    expect(covered.realizedPnlCents).toBe(10 * (10000 - 11000));
  });

  it('partially covering a short realizes P&L on the covered portion, keeping the same average entry for the rest', () => {
    const short = applyFill(flat(), 'SELL', 10, 10000, 0);
    const partial = applyFill(short, 'BUY', 4, 9000, 0);
    expect(partial.shares).toBe(-6);
    expect(partial.averageEntryPriceCents).toBe(10000);
    expect(partial.realizedPnlCents).toBe(4 * (10000 - 9000));
  });
});

describe('applyFill — reversing straight through flat in one fill', () => {
  it('a long reversed into a short realizes P&L on the closing portion and opens the remainder at the new price', () => {
    const long = applyFill(flat(), 'BUY', 10, 10000, 0); // +10 @ $100.00
    const reversed = applyFill(long, 'SELL', 15, 11000, 0); // sell 15: closes 10, opens -5 @ $110.00
    expect(reversed.shares).toBe(-5);
    expect(reversed.averageEntryPriceCents).toBe(11000);
    expect(reversed.realizedPnlCents).toBe(10 * (11000 - 10000));
  });

  it('a short reversed into a long realizes P&L on the closing portion and opens the remainder at the new price', () => {
    const short = applyFill(flat(), 'SELL', 10, 10000, 0); // -10 @ $100.00
    const reversed = applyFill(short, 'BUY', 15, 9000, 0); // buy 15: covers 10, opens +5 @ $90.00
    expect(reversed.shares).toBe(5);
    expect(reversed.averageEntryPriceCents).toBe(9000);
    expect(reversed.realizedPnlCents).toBe(10 * (10000 - 9000));
  });
});

describe('applyFill — fees', () => {
  it('charges the fee on both a BUY and a SELL, regardless of position direction', () => {
    const afterBuy = applyFill(flat(), 'BUY', 10, 10000, 50);
    expect(afterBuy.cashCents).toBe(1_000_000 - 10 * 10000 - 50);
    const afterSell = applyFill(flat(), 'SELL', 10, 10000, 50);
    expect(afterSell.cashCents).toBe(1_000_000 + 10 * 10000 - 50);
  });
});

describe('equity / gross position value / margin requirements', () => {
  it('equity is cash plus mark-to-market position value, negative shares included correctly', () => {
    const long = { ...flat(), shares: 10, cashCents: 900_000 };
    expect(equityCents(long, 10000)).toBe(900_000 + 10 * 10000);
    const short = { ...flat(), shares: -10, cashCents: 1_100_000 };
    expect(equityCents(short, 10000)).toBe(1_100_000 - 10 * 10000);
  });

  it('gross position value is always non-negative, symmetric for long/short', () => {
    expect(grossPositionValueCents({ ...flat(), shares: 10 }, 10000)).toBe(100000);
    expect(grossPositionValueCents({ ...flat(), shares: -10 }, 10000)).toBe(100000);
  });

  it('buying power is 0 when shorting/margin is disabled, regardless of equity', () => {
    expect(buyingPowerCents(flat(), 10000, NO_MARGIN_RISK)).toBe(0);
  });

  it('buying power is equity / initialMarginRatio when margin is enabled', () => {
    const risk = RiskConfigSchema.parse({ allowShortSelling: true, initialMarginRatio: 0.5 });
    expect(buyingPowerCents(flat(1_000_000), 10000, risk)).toBe(1_000_000 / 0.5);
  });

  it('maintenance requirement is 0 when margin is disabled or the account is flat', () => {
    expect(maintenanceRequirementCents(flat(), 10000, NO_MARGIN_RISK)).toBe(0);
    expect(maintenanceRequirementCents(flat(), 10000, MARGIN_RISK)).toBe(0);
  });

  it('isBelowMaintenance is true once equity falls under maintenanceMarginRatio * gross exposure', () => {
    const risk = RiskConfigSchema.parse({ allowShortSelling: true, maintenanceMarginRatio: 0.3 });
    // Short 100 shares @ $100 => gross exposure $10,000; maintenance requirement = $3,000.
    // equity = cash - 100 * markPrice, so cash = 1,310,000 puts equity at $3,100 (safely above).
    const healthy = { ...flat(1_310_000), shares: -100 };
    expect(isBelowMaintenance(healthy, 10000, risk)).toBe(false);
    // cash = 1,290,000 puts equity at $2,900 — below the $3,000 requirement.
    const distressed = { ...healthy, cashCents: 1_290_000 };
    expect(isBelowMaintenance(distressed, 10000, risk)).toBe(true);
  });

  it('never flags a long-only, non-margin account, no matter how far underwater', () => {
    const brokeLong = { ...flat(0), shares: 100 };
    expect(isBelowMaintenance(brokeLong, 1, NO_MARGIN_RISK)).toBe(false);
  });
});

describe('maxBuyQuantityByMargin', () => {
  it('covering an existing short is always allowed, unconstrained by buying power', () => {
    expect(maxBuyQuantityByMargin(-50, 0, 10000)).toBe(50);
  });

  it('covering plus opening a new long is bounded by buying power beyond flat', () => {
    expect(maxBuyQuantityByMargin(-50, 200_000, 10000)).toBe(50 + 20);
  });

  it('adding to an existing long is bounded by buying power against the new total size', () => {
    expect(maxBuyQuantityByMargin(30, 500_000, 10000)).toBe(50 - 30);
  });
});

describe('maxSellQuantityByMargin', () => {
  it('reducing an existing long is always allowed, unconstrained by buying power or borrow', () => {
    expect(maxSellQuantityByMargin(50, 0, 10000, 0)).toBe(50);
  });

  it('reducing plus opening a new short is bounded by both buying power and borrowable shares', () => {
    expect(maxSellQuantityByMargin(50, 200_000, 10000, 15)).toBe(50 + 15); // borrow caps it below margin room (20)
    expect(maxSellQuantityByMargin(50, 100_000, 10000, 100)).toBe(50 + 10); // margin caps it below borrow room
  });

  it('adding to an existing short is bounded by remaining margin AND remaining borrow headroom', () => {
    // Already short 10; buying power supports a total short of 20 (room for 10 more); borrow
    // allows only 5 more (15 total) — the tighter of the two (5) wins.
    expect(maxSellQuantityByMargin(-10, 200_000, 10000, 15)).toBe(5);
  });
});
