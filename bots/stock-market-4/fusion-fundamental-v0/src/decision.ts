import type { FusionFundamentalConfig, PortfolioPolicy, SecurityConfig, SignalLevel, SignalThresholds } from './config.js';
import type { OrderRequest, PortfolioObservation } from './marketTypes.js';
import { buildOrders, targetWeightForSignal } from './portfolio.js';
import { computeResearchDelta, type ResearchDelta } from './research/delta.js';
import { interpretResearchDelta, type ModelEffect } from './research/interpretEvents.js';
import type { ResearchState } from './research/types.js';
import { computeInformationGap, computeSignal } from './signal.js';
import { computeCompanyValuation } from './valuation/companyValue.js';
import { computeFusionValue } from './valuation/fusionValue.js';
import type { CompanyValuation } from './valuation/types.js';

/**
 * The full, structured record spec §16 requires for every decision (not only non-empty trades —
 * a `HOLD` with `orders: []` is still recorded and still explainable, which is what the no-
 * information test in `test/decision.test.ts` checks). Every field is derived from this round's
 * actual model inputs — nothing here is free-form.
 */
export interface TradingDecision {
  date: string | null;
  security: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  signalLevel: SignalLevel;
  /** True when `signalLevel` only held because of `SignalThresholds.hysteresisBand` — see
   * `signal.ts`'s `Signal.heldByHysteresis`. Threaded through so `../index.ts` doesn't need its
   * own copy of this, and so a reader can tell "the position size logically changed" apart from
   * "the model, if it recomputed fresh with no memory, would already have reverted this level." */
  heldByHysteresis: boolean;
  targetWeight: number | undefined;
  researchChanges: string[];
  modelEffects: string[];
  valuationBefore: number | undefined;
  valuationAfter: number;
  /** The full base/fusion-derived/fusion-option breakdown behind `valuationAfter` (spec §9/§16) —
   * exposed so a reader (or a test) can confirm which channel actually moved, not just the total. */
  valuationBreakdown: CompanyValuation;
  marketReaction: number | null;
  valuationGap: number;
  confidence: number;
  rationale: string;
  falsifiers: string[];
  orders: OrderRequest[];
}

/** What research does NOT establish for ELMT/Schwabmünchen (spec §9) — reported on every
 * decision so a reader never mistakes this model's fair value for a fully-known figure. */
export const KNOWN_VALUATION_UNKNOWNS: readonly string[] = [
  'acquired historical revenue of the Schwabmünchen operation',
  'acquired historical EBITDA/profitability of the Schwabmünchen operation',
  'final purchase consideration for the acquisition',
  'exact tungsten/molybdenum production capacity and current utilization',
  'exact incremental EBIT margin ELMT will realize on the acquired operation',
  'exact fusion-program customer revenue, if any, ELMT will ever realize',
];

function describeResearchChanges(delta: ResearchDelta): string[] {
  const lines: string[] = [];
  for (const event of delta.newEvents) {
    lines.push(`New research event "${event.type}" (${event.id}) at ${event.timestamp}.`);
  }
  for (const relationship of delta.changedRelationships) {
    lines.push(
      `Relationship ${relationship.relationshipId} (${relationship.type}) status: ` +
        `${relationship.previousStatus ?? '(none)'} -> ${relationship.currentStatus}.`,
    );
  }
  for (const hypothesis of delta.changedHypotheses) {
    lines.push(
      `Hypothesis "${hypothesis.name}" confidence: ` +
        `${hypothesis.previousConfidence ?? '(none)'} -> ${hypothesis.currentConfidence}.`,
    );
  }
  for (const evidence of delta.newEvidence) {
    lines.push(`New evidence (${evidence.id}): ${evidence.description}`);
  }
  return lines;
}

function collectFalsifiers(effects: ModelEffect[], currentState: ResearchState): string[] {
  const falsifiers = new Set<string>();
  for (const effect of effects) {
    if (effect.factor === 'manufacturing_capability') {
      falsifiers.add(
        'If no fusion program relationship for the acquired operation ever moves off UNKNOWN ' +
          'status, the fusion-option component of this valuation should be reduced toward zero.',
      );
    }
    if (effect.sourceHypothesisId !== undefined) {
      const hypothesis = currentState.hypotheses.find((h) => h.id === effect.sourceHypothesisId);
      for (const falsifier of hypothesis?.falsifiers ?? []) {
        falsifiers.add(falsifier.description);
      }
    }
  }
  return Array.from(falsifiers);
}

/**
 * The full pipeline from spec's guiding principle: point-in-time snapshot -> delta -> event
 * interpretation -> valuation -> signal -> portfolio target -> orders, wired together into one
 * explainable `TradingDecision` FOR ONE SECURITY. Pure function of its inputs (spec §23
 * determinism) — no clock, no randomness, no I/O. `signalThresholds`/`portfolioPolicy` are
 * shared across every security in a multi-symbol portfolio (spec follow-up) — only `security`
 * itself varies per call; see `computeTradingDecisions` below for the per-round, multi-security
 * orchestration.
 */
export function computeTradingDecision(params: {
  date: string | null;
  security: SecurityConfig;
  signalThresholds: SignalThresholds;
  portfolioPolicy: PortfolioPolicy;
  previousResearchState: ResearchState | undefined;
  currentResearchState: ResearchState;
  currentPriceDollars: number;
  previousPriceDollars: number | undefined;
  previousFairValuePerShare: number | undefined;
  /** The `signal.level` this bot returned on ITS OWN previous decision for THIS security (spec
   * §17: only legitimately-knowable state) — omit (or `undefined`) on this security's first-ever
   * decision. Drives `signal.ts`'s hysteresis; never anything about the game's own history. */
  previousSignalLevel?: SignalLevel;
  portfolio: PortfolioObservation;
  /** Remaining buying power for THIS ROUND after any earlier securities in the same round have
   * already claimed some (spec follow-up: multi-security portfolios) — defaults to
   * `portfolio.buyingPowerCents` (the account's actual total) when omitted, which reproduces the
   * original single-security behavior exactly. See `computeTradingDecisions`. */
  availableBuyingPowerCents?: number;
}): TradingDecision {
  const delta = computeResearchDelta(params.previousResearchState, params.currentResearchState);
  const effects = interpretResearchDelta(delta, params.currentResearchState, params.security.targetEntityId);

  const fusionValueResult = computeFusionValue(params.security.valuation.fusion);
  const valuation = computeCompanyValuation({
    ticker: params.security.ticker,
    asOf: params.currentResearchState.timestamp,
    baseBusinessValue: params.security.valuation.baseBusinessValuePerShare,
    fusionValueResult,
    fusionOptionValueBaseline: params.security.valuation.fusionOptionValueBaselinePerShare,
    effects,
    sensitivities: params.security.valuation.sensitivities,
    sharesOutstanding: params.security.sharesOutstanding,
    unknowns: [...KNOWN_VALUATION_UNKNOWNS],
  });

  const signal = computeSignal({
    ticker: params.security.ticker,
    fairValuePerShare: valuation.fairValue.base,
    marketPrice: params.currentPriceDollars,
    effects,
    thresholds: params.signalThresholds,
    previousLevel: params.previousSignalLevel,
  });

  const informationGap = computeInformationGap({
    currentFairValuePerShare: valuation.fairValue.base,
    previousFairValuePerShare: params.previousFairValuePerShare,
    currentPrice: params.currentPriceDollars,
    previousPrice: params.previousPriceDollars,
  });

  const targetWeight = targetWeightForSignal(signal.level, params.portfolioPolicy);
  const orders = buildOrders({
    ticker: params.security.ticker,
    targetWeight,
    priceDollars: params.currentPriceDollars,
    portfolio: params.portfolio,
    policy: params.portfolioPolicy,
    availableBuyingPowerCents: params.availableBuyingPowerCents,
  });

  const action: TradingDecision['action'] =
    orders.length === 0 ? 'HOLD' : orders[0]!.side === 'BUY' ? 'BUY' : 'SELL';

  const researchChanges = describeResearchChanges(delta);
  const modelEffects = effects.map((effect) => effect.rationale);
  const falsifiers = collectFalsifiers(effects, params.currentResearchState);

  const reactionText =
    informationGap.marketChange === null
      ? 'no prior observation to compare market reaction against'
      : `market moved ${(informationGap.marketChange * 100).toFixed(1)}% vs. our model's ` +
        `${((informationGap.modelChange ?? 0) * 100).toFixed(1)}% fair-value change ` +
        `(information gap ${((informationGap.informationGap ?? 0) * 100).toFixed(1)}%)`;

  const rationale =
    (delta.isEmpty
      ? 'No research change since the previous decision. '
      : `Research changed: ${researchChanges.join(' ')} `) +
    (modelEffects.length > 0 ? `Modeled effects: ${modelEffects.join(' ')} ` : '') +
    `${signal.rationale} ` +
    `${reactionText}. ` +
    (orders.length === 0
      ? 'No trade: either no target-weight change was warranted or the resulting trade was below the minimum order size.'
      : `Action: ${action} to move toward a ${((targetWeight ?? 0) * 100).toFixed(1)}% target weight.`);

  return {
    date: params.date,
    security: params.security.ticker,
    action,
    signalLevel: signal.level,
    heldByHysteresis: signal.heldByHysteresis,
    targetWeight,
    researchChanges,
    modelEffects,
    valuationBefore: params.previousFairValuePerShare,
    valuationAfter: valuation.fairValue.base,
    valuationBreakdown: valuation,
    marketReaction: informationGap.marketChange,
    valuationGap: signal.valuationGap,
    confidence: signal.confidence,
    rationale,
    falsifiers,
    orders,
  };
}

/** Per-security state a multi-symbol portfolio needs to remember between rounds (spec §17) —
 * exactly the same three things `computeTradingDecision` always needed, just keyed by ticker now
 * instead of held as bare closure variables. See `../index.ts`'s `createDecideAction`. */
export interface PreviousSecurityState {
  fairValuePerShare?: number;
  priceDollars?: number;
  signalLevel?: SignalLevel;
}

/**
 * The multi-security, per-round orchestration (spec follow-up: "scale to a portfolio of multiple
 * symbols"): runs `computeTradingDecision` once per `config.securities` entry against the SAME
 * shared research snapshot, in `config.securities` order, threading a single shrinking
 * `availableBuyingPowerCents` budget through all of them so simultaneous BUY signals across
 * different companies can never jointly overspend one account (spec §14: still no portfolio
 * optimizer — just correct, sequential bookkeeping over one real constraint the game itself
 * enforces). A security with no price in this round's observation is skipped entirely (no
 * decision recorded for it) rather than treated as an error — the same way a single-security bot
 * always tolerated a round with no research/price.
 *
 * Only debits the running budget for BUY orders; SELL proceeds are deliberately NOT credited back
 * into the same round's budget (conservative — avoids assuming a same-round sell fills in time to
 * fund a same-round buy).
 */
export function computeTradingDecisions(params: {
  date: string | null;
  config: FusionFundamentalConfig;
  previousResearchState: ResearchState | undefined;
  currentResearchState: ResearchState;
  /** Current price per share, keyed by ticker — securities with no entry here are skipped. */
  currentPricesByTicker: Map<string, number>;
  previousByTicker: Map<string, PreviousSecurityState>;
  portfolio: PortfolioObservation;
}): TradingDecision[] {
  const decisions: TradingDecision[] = [];
  let remainingBuyingPowerCents = params.portfolio.buyingPowerCents;

  for (const security of params.config.securities) {
    const currentPriceDollars = params.currentPricesByTicker.get(security.ticker);
    if (currentPriceDollars === undefined) continue;

    const previous = params.previousByTicker.get(security.ticker);
    const decision = computeTradingDecision({
      date: params.date,
      security,
      signalThresholds: params.config.signal,
      portfolioPolicy: params.config.portfolio,
      previousResearchState: params.previousResearchState,
      currentResearchState: params.currentResearchState,
      currentPriceDollars,
      previousPriceDollars: previous?.priceDollars,
      previousFairValuePerShare: previous?.fairValuePerShare,
      previousSignalLevel: previous?.signalLevel,
      portfolio: params.portfolio,
      availableBuyingPowerCents: remainingBuyingPowerCents,
    });

    decisions.push(decision);

    const priceCents = Math.round(currentPriceDollars * 100);
    for (const order of decision.orders) {
      if (order.side === 'BUY') {
        remainingBuyingPowerCents = Math.max(0, remainingBuyingPowerCents - order.quantity * priceCents);
      }
    }
  }

  return decisions;
}

/** Human-readable, multi-line trace for dev/testing (spec §31) — callers decide where this goes
 * (stderr, a log file); production `decideAction` behavior never depends on this being read. */
export function formatStrategyTrace(decision: TradingDecision): string {
  const lines = [
    `[fusion-fundamental-v0] ${decision.date ?? '(no date)'} ${decision.security}`,
    `  research changes: ${decision.researchChanges.length === 0 ? '(none)' : ''}`,
    ...decision.researchChanges.map((line) => `    - ${line}`),
    `  model effects: ${decision.modelEffects.length === 0 ? '(none)' : ''}`,
    ...decision.modelEffects.map((line) => `    - ${line}`),
    `  fair value: ${decision.valuationBefore?.toFixed(4) ?? '(none)'} -> ${decision.valuationAfter.toFixed(4)}`,
    `  market reaction: ${decision.marketReaction === null ? '(none)' : `${(decision.marketReaction * 100).toFixed(2)}%`}`,
    `  valuation gap: ${(decision.valuationGap * 100).toFixed(2)}%  confidence: ${(decision.confidence * 100).toFixed(0)}%`,
    `  signal level: ${decision.signalLevel}${decision.heldByHysteresis ? ' (held by hysteresis)' : ''}`,
    `  action: ${decision.action}${decision.targetWeight !== undefined ? ` (target weight ${(decision.targetWeight * 100).toFixed(1)}%)` : ''}`,
    `  rationale: ${decision.rationale}`,
    `  falsifiers: ${decision.falsifiers.length === 0 ? '(none)' : ''}`,
    ...decision.falsifiers.map((line) => `    - ${line}`),
  ];
  return lines.join('\n');
}
