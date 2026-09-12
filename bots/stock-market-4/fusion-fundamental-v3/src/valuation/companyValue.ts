import type { ModelEffect } from '../research/interpretEvents.js';
import { combineScenarios, constantScenario, mapScenario, sumScenarios } from './scenarios.js';
import type { CompanyValuation, FusionValueResult, ScenarioValue } from './types.js';

/**
 * How many dollars of value a unit of (`ModelEffect.magnitude * ModelEffect.confidence`) is worth,
 * per effect family — the explicit "sensitivity" knobs spec §11/§29 requires so this translation
 * from a qualitative research effect to a dollar value is a labeled strategy assumption, never
 * buried inside `computeCompanyValuation`'s arithmetic. Lives in `../config.ts` alongside every
 * other strategy assumption.
 */
export interface ValuationSensitivities {
  /** $/share of base-business value per unit of a `manufacturing_capability` effect (spec §8:
   * increased manufacturing breadth is itself base-business value, independent of fusion). */
  manufacturingCapabilityToBaseValuePerShare: number;
  /** $/share of fusion OPTION value (not fusion-derived value) per unit of a
   * `manufacturing_capability` effect — "potential fusion optionality," explicitly kept separate
   * from and much smaller than `fusionDerivedValue`, which comes only from `FusionValueResult`
   * (spec §8/§9). */
  manufacturingCapabilityToFusionOptionPerShare: number;
  /** $/share of fusion option value per unit of a `hypothesis:*` effect that relates to the target
   * entity — the only other channel that can move fusion option value. */
  hypothesisConfidenceToFusionOptionPerShare: number;
}

/**
 * Applies `effects` (from `../research/interpretEvents.ts`) to a valuation baseline, producing the
 * `CompanyValuation` spec §9 describes. Deliberately narrow: only `manufacturing_capability` and
 * `hypothesis:*` factors move anything, and `hypothesis:*` effects only ever touch fusion OPTION
 * value, never `fusionDerivedValue` (which stays whatever `fusionValueResult` says, driven purely
 * by `../config.ts`'s `FusionValuationAssumptions`) — so an ARC-supplier-relationship confidence
 * change can never masquerade as "ELMT's fusion revenue capture went up" (spec §5/§19). Any
 * `direction: 'neutral'` effect (the anti-inference confirmations from `interpretEvents.ts`)
 * contributes exactly nothing, by construction — it isn't matched by either branch below.
 */
export function computeCompanyValuation(params: {
  ticker: string;
  asOf: string;
  /** $/share, before any research-driven adjustment. */
  baseBusinessValue: ScenarioValue;
  /** Absolute company-level dollars, from `computeFusionValue` — the revenue-chain formula
   * (spec §11) has no natural per-share unit of its own, so it's converted to $/share here via
   * `sharesOutstanding`, the one explicit, inspectable unit-conversion step in this whole chain. */
  fusionValueResult: FusionValueResult;
  /** $/share, before any research-driven adjustment. */
  fusionOptionValueBaseline: ScenarioValue;
  effects: ModelEffect[];
  sensitivities: ValuationSensitivities;
  sharesOutstanding: number;
  unknowns: string[];
}): CompanyValuation {
  let baseBusinessValue = params.baseBusinessValue;
  let fusionOptionValue = params.fusionOptionValueBaseline;
  const fusionDerivedValuePerShare = mapScenario(
    params.fusionValueResult.fusionValue,
    (companyTotal) => companyTotal / params.sharesOutstanding,
  );

  for (const effect of params.effects) {
    const weight = effect.magnitude * effect.confidence;

    if (effect.factor === 'manufacturing_capability' && effect.direction === 'positive') {
      baseBusinessValue = combineScenarios(
        baseBusinessValue,
        constantScenario(weight * params.sensitivities.manufacturingCapabilityToBaseValuePerShare),
        (a, b) => a + b,
      );
      fusionOptionValue = combineScenarios(
        fusionOptionValue,
        constantScenario(weight * params.sensitivities.manufacturingCapabilityToFusionOptionPerShare),
        (a, b) => a + b,
      );
      continue;
    }

    if (effect.factor.startsWith('hypothesis:') && effect.direction === 'positive') {
      fusionOptionValue = combineScenarios(
        fusionOptionValue,
        constantScenario(weight * params.sensitivities.hypothesisConfidenceToFusionOptionPerShare),
        (a, b) => a + b,
      );
    }
    // direction 'neutral' (and any other factor) contributes nothing, intentionally.
  }

  const fairValue = sumScenarios([baseBusinessValue, fusionDerivedValuePerShare, fusionOptionValue]);

  return {
    ticker: params.ticker,
    asOf: params.asOf,
    baseBusinessValue,
    fusionDerivedValue: fusionDerivedValuePerShare,
    fusionOptionValue,
    fairValue,
    unknowns: params.unknowns,
  };
}
