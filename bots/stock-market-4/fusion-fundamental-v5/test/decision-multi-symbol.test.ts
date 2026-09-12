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
 * `fusionDerivedValue` is zero, and there are no research effects). `baseValue` is overridable
 * (default 1000, i.e. STRONG_BUY against a $20 market) so a test can dial in a milder valuation
 * gap instead — e.g. `22` against $20 is a 10% gap, BUY not STRONG_BUY, for testing conviction-
 * based execution order. */
function makeSecurity(ticker: string, targetEntityId: string, baseValue = 1000): SecurityConfig {
  return {
    ticker,
    targetEntityId,
    sharesOutstanding: 1,
    valuation: {
      baseBusinessValuePerShare: constant(baseValue),
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
  strongSellThreshold: -0.25,
  hysteresisBand: 0,
};

const confidenceCalibration = { rollingWindowDays: 20, calmDailyVolatility: 0.01, chaoticDailyVolatility: 0.05, confidenceFloor: 0.3, rollingBlendWeight: 0.3 };
// historyByTicker is empty in every test in this file, so computeTrailingReturn always returns
// undefined regardless of this value — the trend filter never actually fires here (that gets its
// own dedicated tests further down).
const trendFilter = { windowDays: 10, vetoThreshold: 0.08 };
const volatilitySizing = { referenceDailyVolatility: 0.02, minScaleFactor: 0.5, maxScaleFactor: 1.5 };
const stopLoss = { stopLossPct: 0.25 };

const portfolioPolicy: PortfolioPolicy = {
  strongBuyTargetWeight: 0.5,
  buyTargetWeight: 0.1,
  reduceTargetWeight: 0.02,
  shortTargetWeight: 0.25,
  minShortConfidence: 0.7,
  maxPositionWeight: 0.5,
  minOrderNotionalCents: 0,
  rebalanceToleranceWeight: 0,
  // Zeroed here so this file's existing tests keep testing exactly what they say they do
  // (shared-buying-power exhaustion by array order... now by conviction order) without the v2-only
  // reserves shrinking the budget on top of that — those get their own dedicated tests.
  emergencyCashReservePct: 0,
  dryPowderTargetPct: 0,
  // No shorting exercised by this file's own tests (all securities are STRONG_BUY/BUY), so an
  // unconstrained global short budget doesn't interfere with anything here either.
  globalShortBudgetPct: 1,
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
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
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
      historyByTicker: new Map(),
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
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: portfolioPolicy,
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([['AAA', 20]]), // no BBB price this round
      historyByTicker: new Map(),
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
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
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
      historyByTicker: new Map(),
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

  it('seeds the shared budget from real cash, not from buyingPowerCents (regression)', () => {
    // Real bug this guards against: `computeTradingDecisions` used to seed
    // `remainingBuyingPowerCents` directly from `portfolio.buyingPowerCents`, which is `0` for a
    // plain cash account (`emptyPortfolio`'s real default — see its own doc comment) — so EVERY
    // security in the round, starting with the very first, would see a budget of exactly `0` and
    // never buy anything, even with a fresh, fully-cash, no-position account. `buildOrders`'s own
    // fallback (`spendableCentsFor`) can't fix this on its own, because a multi-security round
    // always passes an EXPLICIT `availableBuyingPowerCents` (even when it's `0`), which
    // `buildOrders` correctly trusts as-is — see `src/decision.ts`'s own fix.
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a')],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: portfolioPolicy,
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([['AAA', 20]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000), // buyingPowerCents: 0, cashCents: $10,000
    });

    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 250 }]);
  });

  it('funds the higher-conviction STRONG_BUY before a lower-conviction BUY, even though BUY is listed first (v2)', () => {
    // WEAK (BUY, listed FIRST) and STRONG (STRONG_BUY, listed LAST) each independently want the
    // same 60% of equity — together more than the account has. Under v0/v1's `config.securities`
    // array order, WEAK would claim its full ask first purely by array position. v2 orders by
    // conviction instead, so STRONG should be funded in full first.
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('WEAK', 'entity-weak', 22), makeSecurity('STRONG', 'entity-strong')],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: { ...portfolioPolicy, buyTargetWeight: 0.6, strongBuyTargetWeight: 0.6, maxPositionWeight: 0.6 },
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([
        ['WEAK', 20],
        ['STRONG', 20],
      ]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000), // $10,000
    });

    expect(decisions.map((d) => d.security)).toEqual(['STRONG', 'WEAK']);
    expect(decisions[0]!.signalLevel).toBe('STRONG_BUY');
    // STRONG gets its full 60% ask ($6,000 -> 300 shares @ $20)...
    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'STRONG', side: 'BUY', quantity: 300 }]);
    // ...leaving only the remaining $4,000 for WEAK (200 shares), not its own full 300-share ask.
    expect(decisions[1]!.signalLevel).toBe('BUY');
    expect(decisions[1]!.orders).toEqual([{ kind: 'MARKET', ticker: 'WEAK', side: 'BUY', quantity: 200 }]);
  });
});

describe('computeTradingDecisions cash reserves (v2)', () => {
  it('shrinks the deployable budget by both the emergency reserve (off starting capital) and dry powder (off current equity)', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a')],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: {
        ...portfolioPolicy,
        strongBuyTargetWeight: 0.9,
        maxPositionWeight: 0.9,
        emergencyCashReservePct: 0.1,
        dryPowderTargetPct: 0.1,
      },
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([['AAA', 20]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000), // $10,000 equity, no equityHistory -> falls back to current equity
    });

    // Without reserves, a 90% ask against $10,000 would be $9,000 -> 450 shares. With 10% + 10%
    // reserved ($2,000 total), only $8,000 is actually deployable -> 400 shares, not 450.
    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 400 }]);
  });

  it('zero reserves (the default in this file\'s shared policy) reproduce the full-budget behavior exactly', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a')],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: { ...portfolioPolicy, strongBuyTargetWeight: 0.9, maxPositionWeight: 0.9 },
    };
    const decisions = computeTradingDecisions({
      date: '2026-09-10',
      config,
      previousResearchState: undefined,
      currentResearchState: emptyResearchState(),
      currentPricesByTicker: new Map([['AAA', 20]]),
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000),
    });

    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'BUY', quantity: 450 }]);
  });
});

describe('computeTradingDecisions global short budget (v2)', () => {
  it('caps aggregate NEW short exposure across securities, not just each one\'s own shortTargetWeight', () => {
    // Both AAA and BBB are wildly OVERVALUED (fair value $1 vs a $20 market) -> STRONG_SELL, full
    // confidence (no research effects, empty history) -> each independently wants a 25% short
    // ($2,500 of $10,000 equity, 125 shares). A 30%-of-equity global short budget ($3,000) can't
    // cover both asks ($5,000 combined) -> the second one must come up short (pun intended).
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a', 1), makeSecurity('BBB', 'entity-b', 1)],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: { ...portfolioPolicy, globalShortBudgetPct: 0.3 },
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
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000),
    });

    expect(decisions.every((d) => d.signalLevel === 'STRONG_SELL')).toBe(true);
    // AAA (first in config order; STRONG_SELL isn't buy-prioritized, so array order holds) gets
    // its full 125-share short ask...
    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'SELL', quantity: 125 }]);
    // ...leaving only $500 of the global budget for BBB -> 25 shares, not its own full 125-share ask.
    expect(decisions[1]!.orders).toEqual([{ kind: 'MARKET', ticker: 'BBB', side: 'SELL', quantity: 25 }]);
  });

  it('an unconstrained global short budget (the default in this file\'s shared policy) lets every security get its own full short', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a', 1), makeSecurity('BBB', 'entity-b', 1)],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
      portfolio: portfolioPolicy, // globalShortBudgetPct: 1 (see this file's shared policy)
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
      historyByTicker: new Map(),
      previousByTicker: new Map(),
      portfolio: emptyPortfolio(1_000_000),
    });

    expect(decisions[0]!.orders).toEqual([{ kind: 'MARKET', ticker: 'AAA', side: 'SELL', quantity: 125 }]);
    expect(decisions[1]!.orders).toEqual([{ kind: 'MARKET', ticker: 'BBB', side: 'SELL', quantity: 125 }]);
  });
});

describe('createDecideAction (multi-symbol integration)', () => {
  it('combines orders across securities into one action, and tracks previous state per ticker', () => {
    const config: FusionFundamentalConfig = {
      securities: [makeSecurity('AAA', 'entity-a'), makeSecurity('BBB', 'entity-b')],
      signal: signalThresholds,
      confidenceCalibration,
      trendFilter,
      volatilitySizing,
      stopLoss,
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
