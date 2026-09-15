import { runBot } from '@thunderdome/bot-sdk-js';
import {
  asResearchSnapshot,
  computeTradingDecisions,
  formatStrategyTrace,
  mapScenario,
  type DomainAdapter,
  type OrderRequest,
  type PreviousQuantState,
  type RealizedAlphaSample,
  type ResearchState,
  type StockMarket4Action,
  type StockMarket4Observation,
  type TradingDecision,
} from '@thunderdome/quant-sdk-js';
import { DEFAULT_FUSION_QUANT_CONFIG, KNOWN_VALUATION_UNKNOWNS, type FusionQuantConfig } from './config.js';
import { computeFusionValue } from './valuation/fusionValue.js';
import type { FusionValuationAssumptions } from './valuation/fusionValue.js';
import { computeMarketImpliedExpectationsFromScenarios } from './valuation/marketImplied.js';

/** This bot's `@thunderdome/quant-sdk-js` `DomainAdapter` — the one seam that's genuinely
 * fusion-specific (see `valuation/fusionValue.ts`'s own doc comment). A future domain bot supplies
 * its own version of this object instead of copying `decision.ts`/`config.ts`/every other "bone"
 * this bot no longer has its own copy of. */
export const FUSION_DOMAIN_ADAPTER: DomainAdapter<FusionValuationAssumptions> = {
  computeDomainValue: ({ assumptions, sharesOutstanding }) =>
    mapScenario(computeFusionValue(assumptions).fusionValue, (companyTotal) => companyTotal / sharesOutstanding),
  computeMarketImpliedGap: (params) =>
    computeMarketImpliedExpectationsFromScenarios({
      marketPricePerShare: params.marketPricePerShare,
      baseBusinessValuePerShare: params.baseBusinessValuePerShare,
      domainOptionValuePerShare: params.domainOptionValuePerShare,
      fusion: params.domainAssumptions,
      sharesOutstanding: params.sharesOutstanding,
    }),
  knownValuationUnknowns: KNOWN_VALUATION_UNKNOWNS,
};

/**
 * Builds the bot's `decideAction` closure — the state retained between rounds is: the previous
 * research snapshot's `state` (shared — one research delivery covers every tracked security),
 * PER-SECURITY the previous fair value and PENDING alpha signals (awaiting this round's price to
 * become a realized sample — see `@thunderdome/quant-sdk-js`'s `computeTradingDecisions`), and the
 * pooled `realizedAlphaSamples` list every alpha factor's information coefficient is measured
 * from. All of this is exactly what the bot could legitimately know from its own prior decisions —
 * nothing from the future. Exported so tests can call it directly against hand-built observations.
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
      domain: FUSION_DOMAIN_ADAPTER,
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
      process.stderr.write(`${formatStrategyTrace(decision, 'fusion-quant-v0')}\n`);
    }),
  });
}
