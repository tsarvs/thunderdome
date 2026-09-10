import { runBot } from '@thunderdome/bot-sdk-js';
import { DEFAULT_FUSION_FUNDAMENTAL_CONFIG, type FusionFundamentalConfig } from './config.js';
import {
  computeTradingDecisions,
  formatStrategyTrace,
  type PreviousSecurityState,
  type TradingDecision,
} from './decision.js';
import type { OrderRequest, StockMarket4Action, StockMarket4Observation } from './marketTypes.js';
import { asResearchSnapshot, type ResearchState } from './research/types.js';

/**
 * Builds the bot's `decideAction` closure (spec §17): the only state retained between rounds is
 * the previous research snapshot's `state` (shared — one research delivery covers every tracked
 * security) plus, PER SECURITY, the previous fair-value estimate, previous price, and previous
 * signal level (for `signal.ts`'s hysteresis) — exactly what a bot could legitimately know from
 * its own prior decisions, nothing from the future. Exported (rather than only wired into
 * `runBot` below) so tests can call it directly against hand-built observations without going
 * through the NDJSON transport at all — see `test/decision.test.ts` and the acceptance tests in
 * `test/acceptance/`.
 */
export function createDecideAction(
  config: FusionFundamentalConfig = DEFAULT_FUSION_FUNDAMENTAL_CONFIG,
  onDecision?: (decision: TradingDecision) => void,
): (observation: StockMarket4Observation) => StockMarket4Action {
  let previousResearchState: ResearchState | undefined;
  const previousByTicker = new Map<string, PreviousSecurityState>();

  return function decideAction(observation: StockMarket4Observation): StockMarket4Action {
    const snapshot = asResearchSnapshot(observation.research);
    const currentResearchState = snapshot?.state;

    // No research snapshot yet this round at all: nothing to reason about for ANY security. Hold
    // across the board, and leave previously-known state untouched for next round rather than
    // overwriting it with an absence — research delivery is a match-level event, not a
    // per-security one.
    if (currentResearchState === undefined) {
      return { orders: [] };
    }

    const currentPricesByTicker = new Map<string, number>();
    for (const security of observation.securities) {
      if (security.bar !== null) {
        currentPricesByTicker.set(security.ticker, security.bar.close);
      }
    }

    const decisions = computeTradingDecisions({
      date: observation.date,
      config,
      previousResearchState,
      currentResearchState,
      currentPricesByTicker,
      previousByTicker,
      portfolio: observation.portfolio,
    });

    const orders: OrderRequest[] = [];
    for (const decision of decisions) {
      onDecision?.(decision);
      previousByTicker.set(decision.security, {
        fairValuePerShare: decision.valuationAfter,
        priceDollars: currentPricesByTicker.get(decision.security),
        signalLevel: decision.signalLevel,
      });
      orders.push(...decision.orders);
    }

    previousResearchState = currentResearchState;

    return { orders };
  };
}

// Only run the actual bot process when this file is the process entry point — importing it from
// a test (to reach `createDecideAction` directly) must never start reading stdin.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runBot<StockMarket4Observation, StockMarket4Action>({
    decideAction: createDecideAction(DEFAULT_FUSION_FUNDAMENTAL_CONFIG, (decision) => {
      // Strategy trace goes to stderr only (spec §31) — stdout is protocol-only.
      process.stderr.write(`${formatStrategyTrace(decision)}\n`);
    }),
  });
}
