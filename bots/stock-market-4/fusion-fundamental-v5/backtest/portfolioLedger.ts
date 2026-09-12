import type { OrderRequest, PortfolioObservation, PositionObservation } from '../src/marketTypes.js';

/**
 * Applies fills the same simple way stock-market-4 itself would for a MARKET order (spec: the
 * game remains responsible for execution/accounting; this mirrors that bookkeeping so a
 * multi-round replay — in tests or in `runBacktest.ts` — sees a portfolio that actually reflects
 * earlier rounds' trades). Deliberately simplified versus the real engine: no fees, no margin, no
 * partial fills, no borrow costs — this is a strategy-logic backtest, not an execution-fidelity
 * one (see `runBacktest.ts`'s own doc comment for why a real-engine cross-check is still the
 * right final step before trusting any of this).
 */
export function applyOrders(
  portfolio: PortfolioObservation,
  ticker: string,
  priceCents: number,
  orders: OrderRequest[],
): PortfolioObservation {
  let cashCents = portfolio.cashCents;
  let shares = portfolio.positions.find((p) => p.ticker === ticker)?.shares ?? 0;

  for (const order of orders) {
    const notionalCents = order.quantity * priceCents;
    if (order.side === 'BUY') {
      cashCents -= notionalCents;
      shares += order.quantity;
    } else {
      cashCents += notionalCents;
      shares -= order.quantity;
    }
  }

  const marketValueCents = shares * priceCents;
  const equityCents = cashCents + marketValueCents;
  return {
    cashCents,
    equityCents,
    positions:
      shares === 0
        ? []
        : [
            {
              ticker,
              shares,
              averageEntryPriceCents: priceCents,
              realizedPnlCents: 0,
              marketValueCents,
              unrealizedPnlCents: 0,
            },
          ],
    equityHistory: portfolio.equityHistory,
    buyingPowerCents: cashCents,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };
}

/**
 * The multi-symbol counterpart to `applyOrders` (spec follow-up: "scale to a portfolio of
 * multiple symbols") — `orders` may span any number of different tickers in one round (exactly
 * what `computeTradingDecisions` can now produce), sharing one cash balance across all of them.
 * `pricesCentsByTicker` only needs entries for tickers actually traded or currently held; a held
 * position with no fresh price this round (its own series has no bar for this date) keeps its
 * previous market value and entry price rather than being revalued or dropped — a backtest-only
 * simplification, same spirit as `applyOrders`'s own doc comment.
 */
export function applyOrdersMultiTicker(
  portfolio: PortfolioObservation,
  pricesCentsByTicker: Map<string, number>,
  orders: OrderRequest[],
): PortfolioObservation {
  const sharesByTicker = new Map(portfolio.positions.map((position) => [position.ticker, position.shares]));
  const previousEntryPriceCentsByTicker = new Map(
    portfolio.positions.map((position) => [position.ticker, position.averageEntryPriceCents]),
  );
  const previousMarketValueCentsByTicker = new Map(
    portfolio.positions.map((position) => [position.ticker, position.marketValueCents]),
  );

  let cashCents = portfolio.cashCents;
  for (const order of orders) {
    const priceCents = pricesCentsByTicker.get(order.ticker);
    if (priceCents === undefined) continue; // buildOrders only ever trades a ticker it has a price for
    const notionalCents = order.quantity * priceCents;
    const currentShares = sharesByTicker.get(order.ticker) ?? 0;
    if (order.side === 'BUY') {
      cashCents -= notionalCents;
      sharesByTicker.set(order.ticker, currentShares + order.quantity);
    } else {
      cashCents += notionalCents;
      sharesByTicker.set(order.ticker, currentShares - order.quantity);
    }
  }

  const positions: PositionObservation[] = [];
  for (const [ticker, shares] of sharesByTicker) {
    if (shares === 0) continue;
    const priceCents = pricesCentsByTicker.get(ticker);
    const marketValueCents = priceCents !== undefined ? shares * priceCents : (previousMarketValueCentsByTicker.get(ticker) ?? 0);
    positions.push({
      ticker,
      shares,
      averageEntryPriceCents: priceCents ?? previousEntryPriceCentsByTicker.get(ticker) ?? 0,
      realizedPnlCents: 0,
      marketValueCents,
      unrealizedPnlCents: 0,
    });
  }

  const totalMarketValueCents = positions.reduce((sum, position) => sum + position.marketValueCents, 0);
  const equityCents = cashCents + totalMarketValueCents;

  return {
    cashCents,
    equityCents,
    positions,
    equityHistory: portfolio.equityHistory,
    buyingPowerCents: cashCents,
    maintenanceRequirementCents: 0,
    belowMaintenance: false,
    riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
  };
}
