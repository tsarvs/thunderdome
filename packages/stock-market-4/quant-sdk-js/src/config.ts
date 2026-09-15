import type { PortfolioStrategyName } from './portfolio/select.js';
import type { ValuationSensitivities } from './valuation/companyValue.js';
import type { ScenarioValue } from './valuation/types.js';
import type { ResearchAblationMode } from './ablation.js';
import type { CorrelationBlendPolicy } from './correlation/blended.js';
import type { PortfolioConstructionPolicy } from './portfolio/types.js';
import type { RiskPolicy } from './risk/riskEngine.js';
import type { ExecutionCostPolicy } from './execution/costs.js';

/**
 * Every assumption for ONE tracked company — everything the alpha layer (`./alpha/*.ts`) needs to
 * run the delta -> effects -> valuation -> alpha pipeline independently of any other security in
 * the portfolio. Generic over `TDomainAssumptions` — a domain bot (e.g. fusion-quant-v0) supplies
 * its own shape for `valuation.domain` (that bot's `FusionValuationAssumptions`); this SDK has no
 * opinion on what's inside it, only that `decision.ts`'s `DomainAdapter.computeDomainValue` knows
 * how to turn it into a `ScenarioValue`.
 */
export interface SecurityConfig<TDomainAssumptions> {
  ticker: string;
  /** research-core entity id for this company — e.g. `entity-elmt` in a domain's own research
   * package fixture dataset. */
  targetEntityId: string;
  /** Public share count — NOT a research fact and NOT point-in-time sensitive information; used
   * only to convert an absolute-dollar valuation chain into a per-share figure comparable to
   * `DailyBar.close`. */
  sharesOutstanding: number;
  valuation: {
    /** Non-domain, base-business value per share, before any research-driven adjustment — a
     * FALLBACK used only when a security has no trailing price history yet; a decision loop
     * replaces this with `valuation/rollingBaseValue.ts`'s trailing-window low/mean/high once at
     * least one bar of history exists. */
    baseBusinessValuePerShare: ScenarioValue;
    /** Domain OPTION value per share, before any research-driven adjustment — deliberately small
     * and separate from the domain-derived value the adapter computes. */
    domainOptionValueBaselinePerShare: ScenarioValue;
    domain: TDomainAssumptions;
    sensitivities: ValuationSensitivities;
  };
}

/** How many trailing real trading days feed BOTH the rolling base-value calculation
 * (`valuation/rollingBaseValue.ts`) and every volatility-dependent alpha/portfolio calculation
 * (`momentum.ts`'s own window is separate — see `AlphaEnsemblePolicy.momentumWindowDays`). Same
 * "one 'how much recent history do we trust' knob" discipline `fusion-fundamental-v7`'s
 * `ConfidenceCalibration` used. */
export interface AlphaEnsemblePolicy {
  rollingWindowDays: number;
  /** Deliberately shorter than `rollingWindowDays` — a momentum/trend read should react to more
   * recent price action than the value/volatility anchor itself does (same reasoning
   * `fusion-fundamental-v7`'s `TrendFilterPolicy.windowDays` doc comment gives). */
  momentumWindowDays: number;
  /** The rolling base-value calculation's own share of the blended base value — see
   * `valuation/rollingBaseValue.ts`'s `computeBlendedBaseValuePerShare` doc comment. */
  rollingBlendWeight: number;
  /** Below this many realized (predicted, actual) samples, a factor's measured information
   * coefficient is treated as too noisy to trust as an ensemble weight — see `alpha/ic.ts`'s
   * `computeEnsembleWeights`. */
  minSamplesForMeasuredIC: number;
  /** Caps how many realized alpha samples a decision loop keeps in memory (oldest dropped first)
   * — bounds memory/CPU for a long-running forward-shadow match; large enough to comfortably
   * exceed `minSamplesForMeasuredIC` many times over. */
  maxAlphaHistorySamples: number;
}

/**
 * Every number in a domain bot's own config built against this type is an EXPERIMENTAL STRATEGY
 * ASSUMPTION, not a researched fact — nothing here is derived from a research dataset directly.
 * Generic over `TDomainAssumptions` (see `SecurityConfig`) so any domain can plug in its own
 * per-security valuation assumption shape while reusing the same
 * alpha/portfolio-construction/risk architecture.
 */
export interface QuantStrategyConfig<TDomainAssumptions> {
  /** Every company this bot actively tracks and can trade — see `SecurityConfig`. */
  securities: SecurityConfig<TDomainAssumptions>[];
  alphaEnsemble: AlphaEnsemblePolicy;
  correlationBlend: CorrelationBlendPolicy;
  portfolioConstruction: PortfolioConstructionPolicy & { strategy: PortfolioStrategyName };
  risk: RiskPolicy;
  execution: ExecutionCostPolicy;
  /** The null-research ablation switch (plan Phase 1, item 8) — see `./ablation.ts`. */
  ablationMode: ResearchAblationMode;
  /** How a final target weight becomes actual orders — see `./portfolio.ts`'s `buildOrders`. */
  orderExecution: { minOrderNotionalCents: number; rebalanceToleranceWeight: number };
}
