import { describe, expect, it } from 'vitest';
import type { FusionFundamentalConfig, PortfolioPolicy, SecurityConfig, SignalThresholds } from '../src/config.js';
import { computeTradingDecisions } from '../src/decision.js';
import { createDecideAction } from '../src/index.js';
import type { ResearchState } from '../src/research/types.js';
import { buildObservation, emptyPortfolio } from './support/fixtures.js';

function constant(value: number) {
  return { bear: value, base: value, bull: value };
}

/** Three identical securities, each modeled as wildly undervalued (fair value 1000/share vs a
 * $20 market) so every one of them independently earns STRONG_BUY — isolates the thing this test
 * actually checks: the SHARED buying-power budget across securities within one round, not
 * anything about the valuation math itself (fusion assumptions are all zero so
 * `fusionDerivedValue` is zero, and there are no research effects). */
function makeSecurity(ticker: string, targetEntityId: string): SecurityConfig {
  return {
    ticker,
    targetEntityId,
    sharesOutstanding: 1,
    valuation: {
      baseBusinessValuePerShare: constant(1000),
      fusionOptionValueBaselinePerShare: constant(0),
      fusion: {
        reactorDeployments: constant(0),
        tungstenContentTonnes: constant(0),
        tungstenPriceUsdPerTonne: constant(0),
        supplierCapture: constant(0),
        replacementDemand: constant(0),
        incrementalEbitMargin: constant(0),
        valuationMultiple: constant(0),
      },
      sensitivities: {
        manufacturingCapabilityToBaseValuePerShare: 0,
        manufacturingCapabilityToFusionOptionPerShare: 0,
        hypothesisConfidenceToFusionOptionPerShare: 0,
      },
    },
  };
}

const signalThresholds: SignalThresholds = {
  strongBuyThreshold: 0.15,
  buyThreshold: 0.05,
  reduceThreshold: -0.05,
  sellThreshold: -0.15,
  hysteresisBand: 0,
};

const portfolioPolicy: PortfolioPolicy = {
  strongBuyTargetWeight: 0.5,
  buyTargetWeight: 0.1,
  reduceTargetWeight: 0.02,
  maxPositionWeight: 0.5,
  minOrderNotionalCents: 0,
  rebalanceToleranceWeight: 0,
};

function emptyResearchState(): ResearchState {
  return {
    timestamp: 't1',
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    events: [],
    questions: [],
  };
}

describe('computeTradingDecisions (multi-symbol)', () => {
  it('produces one decision per security that has a price this round', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a'), makeSecurity('BBB', 'entity-b')],
      signal: signalThresholds,
      portfolio: portfolioPolicy,
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([
        ['AAA', 20],
        ['BBB', 20],
      ]),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000),
    });
    expect(decisions.map((d) => d.security)).toEqual(['AAA', 'BBB']);
    expect(decisions.every((d) => d.signalLevel === 'STRONG_BUY')).toBe(true);
  });

  it('skips a security with no price this round rather than erroring', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a'), makeSecurity('BBB', 'entity-b')],
      signal: signalThresholds,
      portfolio: portfolioPolicy,
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([['AAA', 20]]), // no BBB price this round
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000),
    });
    expect(decisions.map((d) => d.security)).toEqual(['AAA']);
  });

  it('never lets simultaneous BUY signals across securities jointly overspend the account (spec follow-up)', () => {
    // Three securities each independently want 50% of equity (150% combined) against a 100%-cash
    // account with no existing positions — the third one must come up short.
    const config: FusionFundamentalConfig = {
      securities: [
        makeSecurity('AAA', 'entity-a'),
        makeSecurity('BBB', 'entity-b'),
        makeSecurity('CCC', 'entity-c'),
      ],
      signal: signalThresholds,
      portfolio: portfolioPolicy,
    };
    const startingCashCents = 1_000_000;
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([
        ['AAA', 20],
        ['BBB', 20],
        ['CCC', 20],
      ]),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(startingCashCents),
    });

    const totalSpentCents = decisions
      .flatMap((d) => d.orders)
      .filter((o) => o.side === 'BUY')
      .reduce((sum, o) => sum + o.quantity * 2000, 0);

    expect(totalSpentCents).toBeLessThanOrEqual(startingCashCents);
    // AAA and BBB (processed first, per `config.securities` order) each get their full 50% ask...
    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 250 }]);
    expect(decisions[1]!.orders).toEqual([{ kind: 'MARKET', ticker: 'BBB', side: 'BUY', quantity: 250 }]);
    // ...leaving nothing for CCC.
    expect(decisions[2]!.orders).toEqual([]);
  });
});

describe('createDecideAction (multi-symbol integration)', () => {
  it('combines orders across securities into one action, and tracks previous state per ticker', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a'), makeSecurity('BBB', 'entity-b')],
      signal: signalThresholds,
      portfolio: portfolioPolicy,
    };
    const decisions: { security: string }[] = [];
    const decideAction = createDecideAction(config, (decision) => decisions.push(decision));

    const portfolio = emptyPortfolio(1_000_000);
    const observation = buildObservation({
      round: 1,
      date: '2026-09-10',
      ticker: 'AAA',
      priceDollars: 20,
      portfolio,
      researchSnapshot: {
        datasetId: 'dataset-test',
        datasetVersion: '1',
        timestamp: '2026-09-10T00:00:00Z',
        state: emptyResearchState(),
      },
    });
    // buildObservation only sets up one security — add the second directly.
    observation.securities.push({
      ticker: 'BBB',
      bar: { date: '2026-09-10', open: 20, high: 20, low: 20, close: 20, volume: 1000 },
      history: [],
    });

    const action = decideAction(observation);
    expect(decisions.map((d) => d.security)).toEqual(['AAA', 'BBB']);
    expect(action.orders.map((o) => o.ticker).sort()).toEqual(['AAA', 'BBB']);
  });
});
