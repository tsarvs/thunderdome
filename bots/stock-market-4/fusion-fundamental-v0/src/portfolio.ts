import type { PortfolioPolicy, SignalLevel } from './config.js';
import type { OrderRequest, PortfolioObservation } from './marketTypes.js';

/**
 * Signal level -> target fraction of total equity (spec §14) — a plain lookup, not portfolio
 * optimization. `undefined` for `HOLD` means "no forced target": an existing position is left
 * alone rather than nudged toward some number, so a no-op signal never itself creates a trade
 * (spec §21).
 */
export function targetWeightForSignal(level: SignalLevel, policy: PortfolioPolicy): number | undefined {
  switch (level) {
    case 'STRONG_BUY':
      return Math.min(policy.strongBuyTargetWeight, policy.maxPositionWeight);
    case 'BUY':
      return Math.min(policy.buyTargetWeight, policy.maxPositionWeight);
    case 'HOLD':
      return undefined;
    case 'REDUCE':
      return Math.min(policy.reduceTargetWeight, policy.maxPositionWeight);
    case 'SELL':
      return 0;
  }
}

/**
 * The real spendable limit for a NEW buy, in either account mode. stock-market-4's own contract
 * (see games/stock-market-4/README.md's "Risk & financing" section) reports `buyingPowerCents` as
 * exactly `0` whenever margin/short-selling is off — a plain cash account's real limit is
 * `cashCents` itself, not buying power (a margin-only concept). Trusting `buyingPowerCents`
 * unconditionally would leave this bot permanently unable to buy anything under the engine's
 * default (cash-only) risk settings, even with a perfectly correct signal — this is exactly the
 * bug this function exists to prevent regressing; see `test/portfolio.test.ts`'s dedicated
 * "cash-account mode" tests.
 */
export function spendableCentsFor(portfolio: PortfolioObservation): number {
  return portfolio.buyingPowerCents > 0 ? portfolio.buyingPowerCents : Math.max(0, portfolio.cashCents);
}

/**
 * Translates a target weight into ordinary stock-market-4 `OrderRequest`s (spec §15) — no second
 * execution system, just "how many shares to buy or sell to move toward the target," clamped to
 * what the observation itself reports is actually available (`spendableCentsFor`, current shares
 * held). The game remains responsible for fees/margin/accounting; this only decides direction and
 * quantity. Returns `[]` whenever there's nothing worth doing: no forced target, the position is
 * already within `rebalanceToleranceWeight` of the target (spec follow-up: on a genuinely
 * volatile real stock, a fixed target re-executed every round churns on ordinary daily price
 * drift even once `signal.ts`'s hysteresis has stopped the LEVEL itself from flip-flopping — this
 * is the second, separate mechanism that actually needed), or the resulting trade is below
 * `minOrderNotionalCents` (spec §15's `{ orders: [] }` case).
 *
 * `availableBuyingPowerCents` (spec follow-up: multi-security portfolios) defaults to
 * `spendableCentsFor(portfolio)` when omitted, which reproduces the original single-security
 * behavior exactly — but a caller processing several securities in one round should pass a
 * shrinking remainder instead (itself SEEDED from `spendableCentsFor`, not raw
 * `buyingPowerCents` — see `decision.ts`'s `computeTradingDecisions`), so two securities that both
 * want to buy can never jointly commit more cash than the account actually has.
 */
export function buildOrders(params: {
  ticker: string;
  targetWeight: number | undefined;
  priceDollars: number;
  portfolio: PortfolioObservation;
  policy: PortfolioPolicy;
  availableBuyingPowerCents?: number | undefined;
}): OrderRequest[] {
  if (params.targetWeight === undefined) return [];
  if (params.priceDollars <= 0) return [];
  if (params.portfolio.equityCents <= 0) return [];

  const priceCents = Math.round(params.priceDollars * 100);
  const position = params.portfolio.positions.find((p) => p.ticker === params.ticker);
  const currentShares = position?.shares ?? 0;
  const currentPositionValueCents = currentShares * priceCents;
  const currentWeight = currentPositionValueCents / params.portfolio.equityCents;

  // The drift check comes FIRST, before any dollar-amount math: it's the thing that stops a
  // position from being re-traded back to an exact target every single round just because price
  // moved and nudged today's weight-of-equity slightly off yesterday's. `minOrderNotionalCents`
  // below is a separate, absolute dollar floor — kept as a backstop for small accounts where even
  // a drift past this tolerance is still a trivial number of dollars.
  const weightDrift = Math.abs(params.targetWeight - currentWeight);
  if (weightDrift < params.policy.rebalanceToleranceWeight) return [];

  const targetEquityCents = params.targetWeight * params.portfolio.equityCents;
  const deltaCents = targetEquityCents - currentPositionValueCents;

  if (Math.abs(deltaCents) < params.policy.minOrderNotionalCents) return [];

  if (params.targetWeight === 0) {
    if (currentShares <= 0) return [];
    return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity: currentShares }];
  }

  if (deltaCents > 0) {
    // An explicit `availableBuyingPowerCents` (the shrinking multi-security remainder —
    // `computeTradingDecisions` in decision.ts) is trusted as-is, including `0` ("no margin/cash
    // room left THIS round"). Only when it's omitted entirely (a direct, single-security caller)
    // does this fall back to `spendableCentsFor`, which is the cash-account-aware fix itself —
    // see that function's own doc comment for why `portfolio.buyingPowerCents` alone isn't safe
    // to trust here.
    const buyingPowerCents = Math.max(0, params.availableBuyingPowerCents ?? spendableCentsFor(params.portfolio));
    const buyCents = Math.min(deltaCents, buyingPowerCents);
    const quantity = Math.floor(buyCents / priceCents);
    if (quantity <= 0) return [];
    return [{ kind: 'MARKET', ticker: params.ticker, side: 'BUY', quantity }];
  }

  const sellCents = Math.min(-deltaCents, currentPositionValueCents);
  const quantity = Math.min(Math.floor(sellCents / priceCents), currentShares);
  if (quantity <= 0) return [];
  return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity }];
}
