import { describe, expect, it } from 'vitest';
import type { PortfolioPolicy } from '../src/config.js';
import { buildOrders, spendableCentsFor, targetWeightForSignal } from '../src/portfolio.js';
import { emptyPortfolio, portfolioWithPosition } from './support/fixtures.js';

// rebalanceToleranceWeight: 0 here so every existing test below keeps testing exactly what it
// says it does (exact-target math, minOrderNotionalCents) rather than incidentally being skipped
// by the tolerance — that feature gets its own dedicated tests further down.
const policy: PortfolioPolicy = {
  strongBuyTargetWeight: 0.2,
  buyTargetWeight: 0.08,
  reduceTargetWeight: 0.02,
  shortTargetWeight: 0.1,
  minShortConfidence: 0.7,
  maxPositionWeight: 0.25,
  minOrderNotionalCents: 5_000,
  rebalanceToleranceWeight: 0,
  emergencyCashReservePct: 0,
  dryPowderTargetPct: 0,
  globalShortBudgetPct: 1,
};

describe('targetWeightForSignal', () => {
  // confidence is irrelevant to every level except STRONG_SELL — 1 here just means "not the thing
  // under test" for these cases.
  it('maps every level to the configured target, clamped to maxPositionWeight', () => {
    expect(targetWeightForSignal('STRONG_BUY', 1, policy)).toBeCloseTo(0.2);
    expect(targetWeightForSignal('BUY', 1, policy)).toBeCloseTo(0.08);
    expect(targetWeightForSignal('HOLD', 1, policy)).toBeUndefined();
    expect(targetWeightForSignal('REDUCE', 1, policy)).toBeCloseTo(0.02);
    expect(targetWeightForSignal('SELL', 1, policy)).toBe(0);
  });

  it('clamps a target above maxPositionWeight', () => {
    const aggressive: PortfolioPolicy = { ...policy, strongBuyTargetWeight: 0.9 };
    expect(targetWeightForSignal('STRONG_BUY', 1, aggressive)).toBeCloseTo(0.25);
  });

  describe('STRONG_SELL (shorting — confidence-gated, spec: shorting is higher-risk than a long)', () => {
    it('returns a negative target (a short) once confidence clears minShortConfidence', () => {
      expect(targetWeightForSignal('STRONG_SELL', 0.7, policy)).toBeCloseTo(-0.1);
    });

    it('treats a STRONG_SELL below minShortConfidence as a plain flatten, not a short', () => {
      // A large valuation gap alone can push the score past strongSellThreshold even when THIS
      // round's confidence is low — shorting requires clearing an independent confidence floor,
      // not just the score threshold. Below it, express the bearish view via absence (flatten),
      // not via a bet against the security.
      expect(targetWeightForSignal('STRONG_SELL', 0.69, policy)).toBe(0);
      expect(targetWeightForSignal('STRONG_SELL', 0, policy)).toBe(0);
    });

    it('clamps the short size to maxPositionWeight, same as a long', () => {
      const aggressive: PortfolioPolicy = { ...policy, shortTargetWeight: 0.9 };
      expect(targetWeightForSignal('STRONG_SELL', 0.7, aggressive)).toBeCloseTo(-0.25);
    });
  });
});

describe('buildOrders', () => {
  it('produces no orders when targetWeight is undefined (HOLD)', () => {
    const orders = buildOrders({
      ticker: 'ELMT',
      targetWeight: undefined,
      priceDollars: 20,
      portfolio: emptyPortfolio(),
      policy,
    });
    expect(orders).toEqual([]);
  });

  it('buys shares to move from no position toward a positive target weight', () => {
    const portfolio = emptyPortfolio(10_000_000); // $100,000
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.1, priceDollars: 20, portfolio, policy });
    // target = $10,000 -> 500 shares at $20
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });

  it('never buys more than buyingPowerCents allows', () => {
    const portfolio = {
      ...emptyPortfolio(10_000_000),
      buyingPowerCents: 1_000_000, // only $10,000 available
    };
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.5, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });

  it('sells shares to move toward a smaller positive target', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 1000, averageEntryPriceCents: 1500, priceCents: 2000 });
    // equity = 5,000,000 cash + 1000*2000 = 7,000,000; target 0.02 -> 140,000 cents -> 70 shares
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.02, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 930 }]);
  });

  it('never sells more shares than are actually held', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 10, averageEntryPriceCents: 1500, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 10 }]);
  });

  it('a SELL (target weight 0) with no position produces no orders', () => {
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio: emptyPortfolio(), policy });
    expect(orders).toEqual([]);
  });

  it('skips a trade below minOrderNotionalCents', () => {
    const portfolio = emptyPortfolio(1_000_000);
    // target 0.001 of $10,000 equity = $10 -> below $50 minimum
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.001, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([]);
  });
});

describe('buildOrders shorting (v1: a negative targetWeight opens/extends a short)', () => {
  it('opens a fresh short from flat', () => {
    // no ELMT position; equity = 10,000,000 cents cash. target -0.1 -> -$10,000 -> 500 shares short.
    const portfolio = emptyPortfolio(10_000_000);
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: -0.1, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 500 }]);
  });

  it('extends an existing short toward a larger (more negative) target', () => {
    // shares=-100 @ $20 -> position value -200,000 cents; equity = 5,000,000 cash - 200,000 = 4,800,000.
    // target -0.1 -> -480,000 cents -> 24,000 more cents short beyond the existing 200,000 -> ... use
    // round numbers instead: target -> -400,000 cents total short -> 200,000 cents MORE short -> 100 more shares.
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: -100, averageEntryPriceCents: 1500, priceCents: 2000 });
    // equity = 4,800,000; target -400,000/4,800,000 ≈ -0.08333
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: -400_000 / 4_800_000, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 100 }]);
  });

  it('goes directly from a long to a short in one order (close the long, then open the short)', () => {
    // shares=50 @ $20 -> position value 100,000 cents; equity = 5,000,000 + 100,000 = 5,100,000.
    // target -0.1 -> -510,000 cents of target short exposure. Closing sells the 50 held shares
    // (100,000 cents), then opens an additional 510,000 cents of NEW short -> 255 more shares.
    // Total: 50 + 255 = 305 shares sold in one order.
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 50, averageEntryPriceCents: 1500, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: -0.1, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 305 }]);
  });

  it('partially covers an existing short via the ordinary BUY branch when the target is less negative than the current short', () => {
    // shares=-500 -> position value -1,000,000; equity = 5,000,000 - 1,000,000 = 4,000,000;
    // current weight = -0.25. Target -0.1 is a SMALLER short (closer to flat), so this is a cover,
    // not an extend — deltaCents comes out positive and falls through to the plain BUY branch,
    // same as covering a short back toward flat always has.
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: -500, averageEntryPriceCents: 1500, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: -0.1, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 300 }]);
  });

  it('a BUY toward a less-negative target covers part of an existing short via the ordinary BUY branch', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: -500, averageEntryPriceCents: 1500, priceCents: 2000 });
    // equity = 4,000,000; target 0 (fully cover) hits the dedicated targetWeight === 0 branch.
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });
});

describe('spendableCentsFor', () => {
  it('returns cashCents when buyingPowerCents is 0 (a plain cash account)', () => {
    const portfolio = emptyPortfolio(10_000_000);
    expect(portfolio.buyingPowerCents).toBe(0); // the real stock-market-4 cash-account default
    expect(spendableCentsFor(portfolio)).toBe(10_000_000);
  });

  it('returns buyingPowerCents itself when it is actually positive (a margin account with room)', () => {
    const portfolio = { ...emptyPortfolio(10_000_000), buyingPowerCents: 2_500_000 };
    expect(spendableCentsFor(portfolio)).toBe(2_500_000);
  });

  it('never returns a negative number, even against negative cash', () => {
    const portfolio = { ...emptyPortfolio(-500_000), buyingPowerCents: 0 };
    expect(spendableCentsFor(portfolio)).toBe(0);
  });
});

describe('buildOrders cash-account mode (regression)', () => {
  // Real bug this guards against: buildOrders/computeTradingDecisions used to size a BUY
  // directly off `portfolio.buyingPowerCents`, which is `0` by stock-market-4's own contract for
  // a plain cash account (games/stock-market-4/README.md's "Risk & financing" section) — meaning
  // this bot could reach a correct STRONG_BUY/BUY signal and still always emit `{ orders: [] }}`
  // against the real engine's default risk settings, silently, forever. Caught by running the
  // real bot against the real engine (games/stock-market-4/scripts/runFusionFundamentalV0.ts),
  // not by this bot's own test suite — because `emptyPortfolio`/`portfolioWithPosition` used to
  // default `buyingPowerCents` to `cashCents` too, masking exactly this. See
  // `src/portfolio.ts`'s `spendableCentsFor` for the fix.
  it('still buys correctly when buyingPowerCents is 0 but cashCents is real (no availableBuyingPowerCents override)', () => {
    const portfolio = emptyPortfolio(10_000_000); // buyingPowerCents: 0, cashCents: $100,000
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.1, priceDollars: 20, portfolio, policy });
    // target = $10,000 -> 500 shares at $20 — identical to the plain "buys shares..." test above,
    // proving cash-account mode (buyingPowerCents: 0) behaves exactly like the non-cash-mode
    // fixture used to, not like "no money at all."
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'BUY', quantity: 500 }]);
  });

  it('an explicit availableBuyingPowerCents of 0 still means "no room" — not a signal to fall back to cash', () => {
    // Distinguishes the two `0`s: `portfolio.buyingPowerCents === 0` (cash-account mode, meaning
    // "check cashCents instead") vs. `availableBuyingPowerCents === 0` (a multi-security round's
    // already-exhausted shrinking remainder, meaning "genuinely nothing left this round").
    const portfolio = emptyPortfolio(10_000_000);
    const orders = buildOrders({
      ticker: 'ELMT',
      targetWeight: 0.1,
      priceDollars: 20,
      portfolio,
      policy,
      availableBuyingPowerCents: 0,
    });
    expect(orders).toEqual([]);
  });
});

describe('buildOrders rebalance tolerance (spec follow-up)', () => {
  const tolerantPolicy: PortfolioPolicy = { ...policy, rebalanceToleranceWeight: 0.02 };

  it('skips a trade when the position is already within tolerance of the target, even though the target technically differs', () => {
    // shares=350 @ $20 -> $7,000 position; cash 5,000,000 cents -> equity 5,700,000 cents ->
    // current weight = 700,000 / 5,700,000 ≈ 0.1228; target 0.1 -> drift ≈ 0.0228... use a target
    // that lands drift comfortably under 0.02 instead:
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    // current weight = 700,000 / 5,700,000 ≈ 0.12281; target 0.11 -> drift ≈ 0.01281 < 0.02
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.11, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([]);
  });

  it('still trades once drift exceeds the tolerance', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    // current weight ≈ 0.12281; target 0.08 -> drift ≈ 0.04281 > 0.02
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0.08, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).not.toEqual([]);
  });

  it('a full exit (target weight 0) still fires once the held position exceeds tolerance', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 350, averageEntryPriceCents: 2000, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 350 }]);
  });

  it('a tiny existing position within tolerance of a zero target is left alone rather than force-closed', () => {
    // shares=5 @ $20 -> $100 position against 5,000,000 cents cash -> weight ≈ 0.0002, well
    // within a 0.02 tolerance of a target of 0.
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 5, averageEntryPriceCents: 2000, priceCents: 2000 });
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: 0, priceDollars: 20, portfolio, policy: tolerantPolicy });
    expect(orders).toEqual([]);
  });
});

describe('buildOrders global short capacity (v2)', () => {
  it('caps a fresh short at the available short capacity, not the full target', () => {
    // Same "opens a fresh short from flat" setup, but capacity only covers half the ask
    // ($5,000 of the $10,000 the -0.1 target would otherwise want).
    const portfolio = emptyPortfolio(10_000_000);
    const orders = buildOrders({
      ticker: 'ELMT',
      targetWeight: -0.1,
      priceDollars: 20,
      portfolio,
      policy,
      availableShortCapacityCents: 500_000,
    });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 250 }]);
  });

  it('an exhausted short capacity (0) blocks a NEW short but does not touch closing an existing long', () => {
    const portfolio = portfolioWithPosition({ ticker: 'ELMT', shares: 50, averageEntryPriceCents: 1500, priceCents: 2000 });
    const orders = buildOrders({
      ticker: 'ELMT',
      targetWeight: -0.1,
      priceDollars: 20,
      portfolio,
      policy,
      availableShortCapacityCents: 0,
    });
    // Closes the 50-share long (unaffected by the short-capacity cap) but opens no NEW short.
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 50 }]);
  });

  it('omitting availableShortCapacityCents reproduces the uncapped single-security behavior exactly', () => {
    const portfolio = emptyPortfolio(10_000_000);
    const orders = buildOrders({ ticker: 'ELMT', targetWeight: -0.1, priceDollars: 20, portfolio, policy });
    expect(orders).toEqual([{ kind: 'MARKET', ticker: 'ELMT', side: 'SELL', quantity: 500 }]);
  });
});
