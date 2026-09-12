import type { ConfidenceCalibration, FusionFundamentalConfig, PortfolioPolicy, SecurityConfig, SignalLevel, SignalThresholds } from './config.js';
import type { DailyBar, OrderRequest, PortfolioObservation } from './marketTypes.js';
import { buildOrders, spendableCentsFor, targetWeightForSignal } from './portfolio.js';
import { computeResearchDelta, type ResearchDelta } from './research/delta.js';
import { interpretResearchDelta, type ModelEffect } from './research/interpretEvents.js';
import type { ResearchState } from './research/types.js';
import { computeInformationGap, computePriceStabilityConfidence, computeSignal } from './signal.js';
import { computeCompanyValuation } from './valuation/companyValue.js';
import { computeFusionValue } from './valuation/fusionValue.js';
import { computeBlendedBaseValuePerShare } from './valuation/rollingBaseValue.js';
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
  previousSignalLevel?: SignalLevel | undefined;
  portfolio: PortfolioObservation;
  /** v2-only: this security's own trailing real price history (`observation.securities[].history`
   * — oldest first, NOT including today's own bar), used for two things: (1) recomputing
   * `baseBusinessValuePerShare` from a rolling window instead of a frozen config constant (see
   * `valuation/rollingBaseValue.ts`), and (2) `computePriceStabilityConfidence` (see
   * `signal.ts`). An empty array (a security's first-ever round) means both fall back to their
   * own "not enough data yet" defaults — the static config value, and full confidence
   * respectively — never an invented number. */
  priceHistory: DailyBar[];
  /** v2-only: how far back / how sensitive the rolling valuation and price-stability confidence
   * are — see `config.ts`'s `ConfidenceCalibration` doc comment. Configurable per-call (rather
   * than a hardcoded default) specifically so a parameter sweep can vary it in-process. */
  confidenceCalibration: ConfidenceCalibration;
  /** Remaining buying power for THIS ROUND after any earlier securities in the same round have
   * already claimed some (spec follow-up: multi-security portfolios) — defaults to
   * `spendableCentsFor(portfolio)` (the account's actual total, cash-account-aware — see that
   * function's own doc comment) when omitted, which reproduces the original single-security
   * behavior exactly. See `computeTradingDecisions`. */
  availableBuyingPowerCents?: number | undefined;
  /** v2-only: the shrinking global short-exposure remainder for this round — see
   * `portfolio.ts`'s `buildOrders` and `PortfolioPolicy.globalShortBudgetPct`. Omitted means
   * uncapped (single-security callers). */
  availableShortCapacityCents?: number | undefined;
}): TradingDecision {
  const delta = computeResearchDelta(params.previousResearchState, params.currentResearchState);
  const effects = interpretResearchDelta(delta, params.currentResearchState, params.security.targetEntityId);

  // v2: a BLEND of the static config assumption and a rolling trailing-window value — see
  // `valuation/rollingBaseValue.ts`'s `computeBlendedBaseValuePerShare` doc comment for why a
  // full replacement (v2's first cut) turned out to be a mean-reversion strategy in disguise.
  const baseBusinessValue = computeBlendedBaseValuePerShare(
    params.security.valuation.baseBusinessValuePerShare,
    params.priceHistory,
    params.confidenceCalibration.rollingWindowDays,
    params.confidenceCalibration.rollingBlendWeight,
  );

  const fusionValueResult = computeFusionValue(params.security.valuation.fusion);
  const valuation = computeCompanyValuation({
    ticker: params.security.ticker,
    asOf: params.currentResearchState.timestamp,
    baseBusinessValue,
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

  // v2: `signal.confidence` alone (research-effect-based) sits at 1.0 on the overwhelming
  // majority of rounds — see `computePriceStabilityConfidence`'s own doc comment for why that
  // left the shorting gate never actually gating anything. Multiplying in a SECOND, independent,
  // market-behavior-based factor means confidence can genuinely vary even when no research fired.
  const priceStabilityConfidence = computePriceStabilityConfidence(
    params.priceHistory,
    params.confidenceCalibration.rollingWindowDays,
    params.confidenceCalibration.calmDailyVolatility,
    params.confidenceCalibration.chaoticDailyVolatility,
    params.confidenceCalibration.confidenceFloor,
  );
  const confidence = signal.confidence * priceStabilityConfidence;

  const informationGap = computeInformationGap({
    currentFairValuePerShare: valuation.fairValue.base,
    previousFairValuePerShare: params.previousFairValuePerShare,
    currentPrice: params.currentPriceDollars,
    previousPrice: params.previousPriceDollars,
  });

  const targetWeight = targetWeightForSignal(signal.level, confidence, params.portfolioPolicy);
  const orders = buildOrders({
    ticker: params.security.ticker,
    targetWeight,
    priceDollars: params.currentPriceDollars,
    portfolio: params.portfolio,
    policy: params.portfolioPolicy,
    availableBuyingPowerCents: params.availableBuyingPowerCents,
    availableShortCapacityCents: params.availableShortCapacityCents,
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
    `Price-stability confidence: ${(priceStabilityConfidence * 100).toFixed(0)}% -> combined confidence ${(confidence * 100).toFixed(0)}%. ` +
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
    confidence,
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
  priceDollars?: number | undefined;
  signalLevel?: SignalLevel;
}

/** v2-only: how much a signal level competes for the round's shared cash — STRONG_BUY first, then
 * BUY, everything else (HOLD/REDUCE/SELL/STRONG_SELL) last since none of those debit the budget
 * below (a REDUCE/SELL/short either frees cash or spends none at all). Ties within a tier break by
 * `Math.abs(valuationGap)` — see `computeTradingDecisions`. */
function buyPriorityRank(level: SignalLevel): number {
  if (level === 'STRONG_BUY') return 2;
  if (level === 'BUY') return 1;
  return 0;
}

/**
 * The multi-security, per-round orchestration (spec follow-up: "scale to a portfolio of multiple
 * symbols"): runs `computeTradingDecision` once per priced security against the SAME shared
 * research snapshot, threading a single shrinking `availableBuyingPowerCents` budget through all
 * of them so simultaneous BUY signals across different companies can never jointly overspend one
 * account (spec §14: still no portfolio optimizer — just correct, sequential bookkeeping over one
 * real constraint the game itself enforces). A security with no price in this round's observation
 * is skipped entirely (no decision recorded for it) rather than treated as an error — the same way
 * a single-security bot always tolerated a round with no research/price.
 *
 * v2, unlike v0/v1: execution order is NOT `config.securities` order — see `buyPriorityRank`. A
 * fixed config-array order meant a mild BUY sitting earlier in the list could claim the round's
 * cash before a STRONG_BUY sitting later in the list was even evaluated, purely by array position,
 * not conviction — free money left on the table for no risk reduction. Fixing that means knowing
 * every security's signal BEFORE deciding execution order, which means computing each one's
 * decision TWICE: once with a throwaway `availableBuyingPowerCents: 0` purely to read its
 * `signalLevel`/`valuationGap` (its `.orders`/`.action` from this call are meaningless and
 * discarded), then once for real, in priority order, with the actual shrinking budget. This
 * pipeline is pure, deterministic, cheap math (no I/O) — accepting one redundant pass here is a
 * far smaller cost than threading a signal cache through two call sites for a backtest that's
 * never going to be a hot loop.
 *
 * v2, unlike v0/v1: the starting budget itself is also smaller on purpose — see
 * `PortfolioPolicy.emergencyCashReservePct`/`dryPowderTargetPct`'s own doc comments. Two DIFFERENT
 * reserves, computed off two DIFFERENT bases (starting capital vs. current equity), both
 * subtracted before anything is available to spend.
 *
 * Only debits the running budget for BUY orders; SELL proceeds are deliberately NOT credited back
 * into the same round's budget (conservative — avoids assuming a same-round sell fills in time to
 * fund a same-round buy). A SELL that opens/extends a short isn't debited from this budget either
 * — this budget models long-side buying power only; short-margin consumption is left to the
 * engine's own enforcement, same "no portfolio optimizer, just correct bookkeeping over one
 * constraint" simplification `portfolio.ts`'s `buildOrders` already documents for itself.
 */
export function computeTradingDecisions(params: {
  date: string | null;
  config: FusionFundamentalConfig;
  previousResearchState: ResearchState | undefined;
  currentResearchState: ResearchState;
  /** Current price per share, keyed by ticker — securities with no entry here are skipped. */
  currentPricesByTicker: Map<string, number>;
  /** v2-only: each security's own trailing real price history, keyed by ticker — see
   * `computeTradingDecision`'s own `priceHistory` doc comment. A ticker with no entry is treated
   * as no history yet (same as an explicit empty array). */
  historyByTicker: Map<string, DailyBar[]>;
  previousByTicker: Map<string, PreviousSecurityState>;
  portfolio: PortfolioObservation;
}): TradingDecision[] {
  const pricedSecurities = params.config.securities.filter((security) =>
    params.currentPricesByTicker.has(security.ticker),
  );

  const previewsByTicker = new Map(
    pricedSecurities.map((security) => {
      const previous = params.previousByTicker.get(security.ticker);
      const preview = computeTradingDecision({
        date: params.date,
        security,
        signalThresholds: params.config.signal,
        portfolioPolicy: params.config.portfolio,
        previousResearchState: params.previousResearchState,
        currentResearchState: params.currentResearchState,
        currentPriceDollars: params.currentPricesByTicker.get(security.ticker)!,
        priceHistory: params.historyByTicker.get(security.ticker) ?? [],
        confidenceCalibration: params.config.confidenceCalibration,
        previousPriceDollars: previous?.priceDollars,
        previousFairValuePerShare: previous?.fairValuePerShare,
        previousSignalLevel: previous?.signalLevel,
        portfolio: params.portfolio,
        availableBuyingPowerCents: 0,
        availableShortCapacityCents: 0,
      });
      return [security.ticker, preview] as const;
    }),
  );

  const orderedSecurities = [...pricedSecurities].sort((a, b) => {
    const previewA = previewsByTicker.get(a.ticker)!;
    const previewB = previewsByTicker.get(b.ticker)!;
    const rankDiff = buyPriorityRank(previewB.signalLevel) - buyPriorityRank(previewA.signalLevel);
    if (rankDiff !== 0) return rankDiff;
    return Math.abs(previewB.valuationGap) - Math.abs(previewA.valuationGap);
  });

  // Seeded from `spendableCentsFor`, NOT raw `portfolio.buyingPowerCents` — a plain cash account
  // reports that as `0` (see that function's own doc comment), which would otherwise leave every
  // security in the round thinking there's no budget at all, right from the first one. Then two
  // v2-only reserves come off the top before anything else can claim it.
  const startingCapitalCents = params.portfolio.equityHistory[0]?.equityCents ?? params.portfolio.equityCents;
  const emergencyReserveCents = startingCapitalCents * params.config.portfolio.emergencyCashReservePct;
  const dryPowderCents = params.portfolio.equityCents * params.config.portfolio.dryPowderTargetPct;
  let remainingBuyingPowerCents = Math.max(
    0,
    spendableCentsFor(params.portfolio) - emergencyReserveCents - dryPowderCents,
  );
  // v2-only: the shared aggregate short budget — see `PortfolioPolicy.globalShortBudgetPct`'s own
  // doc comment. Tracked the same shrinking-remainder way as the buy budget above.
  let remainingShortCapacityCents = params.portfolio.equityCents * params.config.portfolio.globalShortBudgetPct;

  const decisions: TradingDecision[] = [];
  for (const security of orderedSecurities) {
    const currentPriceDollars = params.currentPricesByTicker.get(security.ticker)!;
    const previous = params.previousByTicker.get(security.ticker);
    const decision = computeTradingDecision({
      date: params.date,
      security,
      signalThresholds: params.config.signal,
      portfolioPolicy: params.config.portfolio,
      previousResearchState: params.previousResearchState,
      currentResearchState: params.currentResearchState,
      currentPriceDollars,
      priceHistory: params.historyByTicker.get(security.ticker) ?? [],
        confidenceCalibration: params.config.confidenceCalibration,
      previousPriceDollars: previous?.priceDollars,
      previousFairValuePerShare: previous?.fairValuePerShare,
      previousSignalLevel: previous?.signalLevel,
      portfolio: params.portfolio,
      availableBuyingPowerCents: remainingBuyingPowerCents,
      availableShortCapacityCents: remainingShortCapacityCents,
    });

    decisions.push(decision);

    const priceCents = Math.round(currentPriceDollars * 100);
    const positionBefore = params.portfolio.positions.find((p) => p.ticker === security.ticker);
    const sharesBefore = positionBefore?.shares ?? 0;

    for (const order of decision.orders) {
      if (order.side === 'BUY') {
        remainingBuyingPowerCents = Math.max(0, remainingBuyingPowerCents - order.quantity * priceCents);
      } else {
        // v2: how much of THIS SELL is genuinely NEW short exposure (as opposed to closing an
        // existing long) — recomputed here from shares-before/after rather than exposed by
        // `buildOrders` itself, so its return type (`OrderRequest[]`, the same shape every other
        // caller/test expects) never had to change. A cover (shares moving toward zero) or a plain
        // long-trim never counts here; only the portion that makes the short deeper than it
        // already was does.
        const sharesAfter = sharesBefore - order.quantity;
        const shortBefore = Math.max(0, -sharesBefore);
        const shortAfter = Math.max(0, -sharesAfter);
        const newShortShares = Math.max(0, shortAfter - shortBefore);
        if (newShortShares > 0) {
          remainingShortCapacityCents = Math.max(0, remainingShortCapacityCents - newShortShares * priceCents);
        }
      }
    }
  }

  return decisions;
}

/** Human-readable, multi-line trace for dev/testing (spec §31) — callers decide where this goes
 * (stderr, a log file); production `decideAction` behavior never depends on this being read. */
export function formatStrategyTrace(decision: TradingDecision): string {
  const lines = [
    `[fusion-fundamental-v2] ${decision.date ?? '(no date)'} ${decision.security}`,
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
