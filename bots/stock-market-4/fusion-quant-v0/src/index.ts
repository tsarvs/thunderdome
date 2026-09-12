import { runBot } from '@thunderdome/bot-sdk-js';
import { DEFAULT_FUSION_QUANT_CONFIG, type FusionQuantConfig } from './config.js';
import {
  computeTradingDecisions,
  formatStrategyTrace,
  type PreviousQuantState,
  type TradingDecision,
} from './decision.js';
import type { RealizedAlphaSample } from './alpha/ic.js';
import type { OrderRequest, StockMarket4Action, StockMarket4Observation } from './marketTypes.js';
import { asResearchSnapshot, type ResearchState } from './research/types.js';

/**
 * Builds the bot's `decideAction` closure — the state retained between rounds is: the previous
 * research snapshot's `state` (shared — one research delivery covers every tracked security),
 * PER-SECURITY the previous fair value and PENDING alpha signals (awaiting this round's price to
 * become a realized sample — see `decision.ts`'s `computeTradingDecisions`), and the pooled
 * `realizedAlphaSamples` list every alpha factor's information coefficient is measured from. All
 * of this is exactly what the bot could legitimately know from its own prior decisions — nothing
 * from the future. Exported so tests can call it directly against hand-built observations, same
 * pattern `fusion-fundamental-v7`'s own `index.ts` used.
 */
export function createDecideAction(
  config: FusionQuantConfig = DEFAULT_FUSION_QUANT_CONFIG,
  onDecision?: (decision: TradingDecision) => void,
): (observation: StockMarket4Observation) => StockMarket4Action {
  let previousResearchState: ResearchState | undefined;
  const previousByTicker = new Map<string, PreviousQuantState>();
  let realizedAlphaSamples: RealizedAlphaSample[] = [];

  return function decideAction(observation: StockMarket4Observation): StockMarket4Action {
    const snapshot = asResearchSnapshot(observation.research);
    const currentResearchState = snapshot?.state;

    if (currentResearchState === undefined) {
      return { orders: [] };
    }

    const currentPricesByTicker = new Map<string, number>();
    const historyByTicker = new Map<string, typeof observation.securities[number]['history']>();
    for (const security of observation.securities) {
      if (security.bar !== null) currentPricesByTicker.set(security.ticker, security.bar.close);
      historyByTicker.set(security.ticker, security.history);
    }

    const { decisions, updatedRealizedAlphaSamples, updatedPreviousByTicker } = computeTradingDecisions({
      date: observation.date,
      config,
      previousResearchState,
      currentResearchState,
      currentPricesByTicker,
      historyByTicker,
      previousByTicker,
      realizedAlphaSamples,
      portfolio: observation.portfolio,
    });
    realizedAlphaSamples = updatedRealizedAlphaSamples;

    const orders: OrderRequest[] = [];
    for (const decision of decisions) {
      onDecision?.(decision);
      orders.push(...decision.orders);
    }
    for (const [ticker, state] of updatedPreviousByTicker) previousByTicker.set(ticker, state);

    previousResearchState = currentResearchState;
    return { orders };
  };
}

// Only run the actual bot process when this file is the process entry point — importing it from a
// test (to reach `createDecideAction` directly) must never start reading stdin.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runBot<StockMarket4Observation, StockMarket4Action>({
    decideAction: createDecideAction(DEFAULT_FUSION_QUANT_CONFIG, (decision) => {
      process.stderr.write(`${formatStrategyTrace(decision)}\n`);
    }),
  });
}
