/**
 * A Bear/Base/Bull scenario triple (spec §10) — never a single fake-precise forecast, and never
 * assigned probabilities the research doesn't support (spec §10, §28). Consumers that need a
 * single number pick `base` explicitly and say so in their own rationale; nothing here averages
 * or weights the three on its own.
 */
export interface ScenarioValue {
  bear: number;
  base: number;
  bull: number;
}

/**
 * The fusion revenue-chain assumptions (spec §11): Fusion Revenue = reactorDeployments *
 * tungstenContentTonnes * supplierCapture * replacementDemand; Fusion EBIT = Fusion Revenue *
 * incrementalEbitMargin; Fusion Value = Fusion EBIT * valuationMultiple. Every one of these is a
 * `ScenarioValue`, never a bare number — so no step of the chain can quietly collapse Bear/Base/
 * Bull into one path, and nothing here is "hidden inside arithmetic" (spec §11's own words).
 *
 * These are STRATEGY ASSUMPTIONS (see `../config.ts`), not researched facts — the research dataset
 * establishes none of: reactor deployment counts, tungsten content per reactor, ELMT's share of
 * that demand, replacement/consumable demand multiplier, incremental margin on fusion-derived
 * revenue, or the multiple the market would apply to it (spec §9, §28).
 */
export interface FusionValuationAssumptions {
  /** Expected number of fusion reactor deployments the addressable tungsten demand is based on. */
  reactorDeployments: ScenarioValue;
  /** Tonnes of tungsten content per reactor deployment. */
  tungstenContentTonnes: ScenarioValue;
  /** USD per tonne of tungsten content — an explicit price assumption. Not one of the fields the
   * spec's sketch of `FusionValuationAssumptions` names, but without SOME $/tonne figure,
   * "reactorDeployments * tungstenContentTonnes" is a quantity of tonnes, not dollars, and
   * "Fusion Revenue" would be nonsensical. Added rather than silently treating tonnes as if they
   * were already dollars — an assumption made explicit, never one hidden inside the arithmetic
   * (spec §11's own stated goal). */
  tungstenPriceUsdPerTonne: ScenarioValue;
  /** Fraction of that tungsten demand ELMT is assumed to capture — 0 to 1. This is explicitly an
   * ASSUMPTION, never a value the bot derives from `manufactures`/`has_capability` relationships;
   * see `../research/interpretEvents.ts` for why capability must never imply capture. */
  supplierCapture: ScenarioValue;
  /** Multiplier for replacement/consumable demand beyond the initial reactor build. */
  replacementDemand: ScenarioValue;
  /** Incremental EBIT margin on fusion-derived revenue — 0 to 1. */
  incrementalEbitMargin: ScenarioValue;
  /** EBIT valuation multiple applied to fusion-derived EBIT. */
  valuationMultiple: ScenarioValue;
}

/** Fusion Revenue -> Fusion EBIT -> Fusion Value, each kept as a `ScenarioValue` (spec §11). */
export interface FusionValueResult {
  fusionRevenue: ScenarioValue;
  fusionEbit: ScenarioValue;
  fusionValue: ScenarioValue;
}

/**
 * A company's fair value estimate, decomposed exactly as spec §9 requires: base business value
 * (from the company's non-fusion operations — an assumption this bot is configured with, not
 * something it derives), fusion-derived value (from `FusionValueResult.fusionValue` — revenue
 * fusion activity is assumed to already be producing), and fusion option value (a separate,
 * smaller assumption for optionality the research doesn't yet quantify — e.g. potential future
 * contracts research hasn't confirmed). `unknowns` names every quantity research does NOT
 * establish (acquired revenue, EBITDA, purchase consideration, capacity, utilization, exact
 * incremental margin, exact fusion customer revenue — spec §9) so nothing is silently invented.
 */
export interface CompanyValuation {
  ticker: string;
  asOf: string;
  baseBusinessValue: ScenarioValue;
  fusionDerivedValue: ScenarioValue;
  fusionOptionValue: ScenarioValue;
  fairValue: ScenarioValue;
  unknowns: string[];
}
