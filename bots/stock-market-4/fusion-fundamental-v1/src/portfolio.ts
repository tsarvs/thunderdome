import type { PortfolioPolicy, SignalLevel } from './config.js';
import type { OrderRequest, PortfolioObservation } from './marketTypes.js';

/**
 * Signal level -> target fraction of total equity (spec §14) — a plain lookup, not portfolio
 * optimization. `undefined` for `HOLD` means "no forced target": an existing position is left
 * alone rather than nudged toward some number, so a no-op signal never itself creates a trade
 * (spec §21).
 *
 * `confidence` (v1-only — `signal.confidence`, see `signal.ts`) only matters for `STRONG_SELL`:
 * shorting is a materially higher-risk move than sizing a long (theoretically unbounded downside
 * vs. capped-at-100% for a long), so it requires clearing `policy.minShortConfidence` — an
 * INDEPENDENT gate from `strongSellThreshold` already having been crossed (a score can be extreme
 * from a large valuation gap alone even when confidence in THIS round's change is low). Below that
 * bar, `STRONG_SELL` is treated exactly like a plain `SELL` — flatten to cash, express the bearish
 * view via absence rather than a bet against it.
 */
export function targetWeightForSignal(
  level: SignalLevel,
  confidence: number,
  policy: PortfolioPolicy,
): number | undefined {
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
    case 'STRONG_SELL':
      return confidence >= policy.minShortConfidence ? -Math.min(policy.shortTargetWeight, policy.maxPositionWeight) : 0;
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
    // v0 only ever needed to flatten a LONG here (currentShares > 0 -> SELL). v1 also has to cover
    // an existing SHORT (currentShares < 0 -> BUY back to flat) — falling through to the generic
    // `deltaCents > 0` branch below would technically work (buying power permitting) but "flatten
    // to exactly zero" is a fixed, known quantity (`-currentShares`) that deserves its own direct
    // path rather than being derived through `targetEquityCents`/rounding, same reasoning v0
    // already applied to the SELL-side flatten.
    if (currentShares === 0) return [];
    if (currentShares > 0) {
      return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity: currentShares }];
    }
    const buyingPowerCents = Math.max(0, params.availableBuyingPowerCents ?? spendableCentsFor(params.portfolio));
    const coverCents = Math.min(-currentPositionValueCents, buyingPowerCents);
    const quantity = Math.min(Math.floor(coverCents / priceCents), -currentShares);
    if (quantity <= 0) return [];
    return [{ kind: 'MARKET', ticker: params.ticker, side: 'BUY', quantity }];
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

  // deltaCents < 0: a SELL — v0 only ever reduced/closed a long here (capped at `currentShares`
  // actually held). v1 additionally allows this to go NEGATIVE (open, or add to, a short) once
  // the long is fully closed — `targetWeightForSignal` only ever hands this a negative
  // `targetWeight` for a confidence-gated `STRONG_SELL`, so by the time a negative target reaches
  // here, the "should we even be considering a short" decision has already been made; this
  // function stays generic about WHY a target is negative, same as it already was agnostic about
  // WHY a target was positive.
  //
  // Split into two independent pieces rather than one combined formula, so each stays as legible
  // as v0's own original single-purpose branch was:
  //   1. `closingQuantity` — reduce/close an EXISTING long, exactly like v0 (unchanged formula).
  //   2. `additionalShortQuantity` — how much MORE short exposure the target calls for, beyond
  //      fully flat (zero when the target isn't actually negative, or the existing short already
  //      meets/exceeds it).
  // The engine itself is the real safety net for whether a short can actually fill at all — a
  // plain cash-only match (the default) simply caps the resulting fill at `currentShares`, same
  // as v0's behavior, never actually opening one; see games/stock-market-4/README.md's "Risk &
  // financing" section. This bot does not model per-round cross-security short-margin budgeting
  // (only `spendableCentsFor`'s long-side buying-power tracking) — the same "no portfolio
  // optimizer, just correct bookkeeping over one constraint" simplification v0 already accepted,
  // extended rather than solved generally.
  const closingSellCents = Math.min(-deltaCents, Math.max(0, currentPositionValueCents));
  const closingQuantity = Math.min(Math.floor(closingSellCents / priceCents), Math.max(0, currentShares));

  const targetShortEquityCents = targetEquityCents < 0 ? -targetEquityCents : 0;
  const currentShortEquityCents = currentShares < 0 ? -currentPositionValueCents : 0;
  const additionalShortCents = Math.max(0, targetShortEquityCents - currentShortEquityCents);
  const additionalShortQuantity = Math.floor(additionalShortCents / priceCents);

  const quantity = closingQuantity + additionalShortQuantity;
  if (quantity <= 0) return [];
  return [{ kind: 'MARKET', ticker: params.ticker, side: 'SELL', quantity }];
}
