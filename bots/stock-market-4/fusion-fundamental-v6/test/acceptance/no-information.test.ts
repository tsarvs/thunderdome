import { describe, expect, it } from 'vitest';
import { applyOrders } from '../../backtest/portfolioLedger.js';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG } from '../../src/config.js';
import { createDecideAction } from '../../src/index.js';
import type { OrderRequest, PortfolioObservation } from '../../src/marketTypes.js';
import { buildObservation, DAY_BEFORE_ACQUISITION, fusionSnapshotAt } from '../support/fixtures.js';

/**
 * Spec §21: an empty `ResearchDelta` must not, by itself, keep generating new trades just because
 * a portfolio exists. Simulates fills round-over-round (as a real match would) with unchanged
 * research and price throughout: once the position converges to the model's target weight, every
 * further round with nothing new to react to must produce zero orders.
 */
describe('no-information rounds produce no new trades once target weight is reached (spec §21)', () => {
  it('stops trading as soon as the position matches the target weight, and stays stopped', () => {
    const decideAction = createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG);
    const snapshot = fusionSnapshotAt(DAY_BEFORE_ACQUISITION);
    const ticker = 'ELMT';
    const priceDollars = 20;
    const priceCents = priceDollars * 100;

    let portfolio: PortfolioObservation = {
      cashCents: 10_000_000,
      equityCents: 10_000_000,
      positions: [],
      equityHistory: [],
      buyingPowerCents: 10_000_000,
      maintenanceRequirementCents: 0,
      belowMaintenance: false,
      riskStats: { borrowFeesPaidCents: 0, marginCalls: 0, forcedLiquidations: 0 },
    };

    const ordersByRound: OrderRequest[][] = [];
    for (let round = 1; round <= 5; round += 1) {
      const observation = buildObservation({
        round,
        date: `2026-09-0${round}`,
        ticker,
        priceDollars,
        portfolio,
        researchSnapshot: snapshot,
      });
      const action = decideAction(observation);
      ordersByRound.push(action.orders);
      portfolio = applyOrders(portfolio, ticker, priceCents, action.orders);
    }

    // Once the position has converged (by round 3, generously), research and price are still
    // unchanged, so no further orders should ever be generated.
    for (const orders of ordersByRound.slice(2)) {
      expect(orders).toEqual([]);
    }
  });
});
