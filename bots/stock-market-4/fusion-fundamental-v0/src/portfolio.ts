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
 * Translates a target weight into ordinary stock-market-4 `OrderRequest`s (spec §15) — no second
 * execution system, just "how many shares to buy or sell to move toward the target," clamped to
 * what the observation itself reports is actually available (`buyingPowerCents`, current shares
 * held). The game remains responsible for fees/margin/accounting; this only decides direction and
 * quantity. Returns `[]` whenever there's nothing worth doing: no forced target, the position is
 * already within `rebalanceToleranceWeight` of the target (spec follow-up: on a genuinely
 * volatile real stock, a fixed target re-executed every round churns on ordinary daily price
 * drift even once `signal.ts`'s hysteresis has stopped the LEVEL itself from flip-flopping — this
 * is the second, separate mechanism that actually needed), or the resulting trade is below
 * `minOrderNotionalCents` (spec §15's `{ orders: [] }` case).
 *
 * `availableBuyingPowerCents` (spec follow-up: multi-security portfolios) defaults to
 * `portfolio.buyingPowerCents` — the account's actual total buying power — but a caller
 * processing several securities in one round should pass a shrinking remainder instead, so two
 * securities that both want to buy can never jointly commit more cash than the account actually
 * has. See `decision.ts`'s `computeTradingDecisions` for where that's threaded through.
 */
export function buildOrders(params: {
  ticker: string;
  targetWeight: number | undefined;
  priceDollars: number;
  portfolio: PortfolioObservation;
  policy: PortfolioPolicy;
  availableBuyingPowerCents?: number;
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
    const buyingPowerCents = Math.max(0, params.availableBuyingPowerCents ?? params.portfolio.buyingPowerCents);
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
