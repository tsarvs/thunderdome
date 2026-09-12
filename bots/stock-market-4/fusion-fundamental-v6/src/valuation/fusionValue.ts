import { combineScenarios } from './scenarios.js';
import type { FusionValuationAssumptions, FusionValueResult } from './types.js';

/**
 * The fusion revenue-chain formula from spec §11, applied leg-by-leg across Bear/Base/Bull
 * (`combineScenarios` — never cross-multiplies a bear leg of one assumption with a bull leg of
 * another):
 *
 *   Fusion Revenue = reactorDeployments * tungstenContentTonnes * tungstenPriceUsdPerTonne
 *                    * supplierCapture * replacementDemand
 *   Fusion EBIT     = Fusion Revenue * incrementalEbitMargin
 *   Fusion Value    = Fusion EBIT * valuationMultiple
 *
 * (`tungstenPriceUsdPerTonne` is the one addition beyond the spec's literal field sketch — see
 * `./types.ts`'s doc comment on `FusionValuationAssumptions` for why a $/tonne figure has to be
 * explicit somewhere in this chain.)
 *
 * Every input is a labeled `FusionValuationAssumptions` field (see that type's own doc comment for
 * why each one is a strategy assumption, not a researched fact) — nothing here invents or
 * defaults a missing number; a caller with no basis for an assumption must not construct this
 * input in the first place (see `../signal.ts`'s handling of "insufficient evidence").
 *
 * Result is company-level ABSOLUTE dollars (reactorDeployments/tungstenContentTonnes are
 * whole-company quantities, not per-share) — see `./companyValue.ts` for the one place this gets
 * divided by shares outstanding.
 */
export function computeFusionValue(assumptions: FusionValuationAssumptions): FusionValueResult {
  const tungstenRevenue = combineScenarios(
    combineScenarios(assumptions.reactorDeployments, assumptions.tungstenContentTonnes, (a, b) => a * b),
    assumptions.tungstenPriceUsdPerTonne,
    (a, b) => a * b,
  );
  const fusionRevenue = combineScenarios(
    combineScenarios(tungstenRevenue, assumptions.supplierCapture, (a, b) => a * b),
    assumptions.replacementDemand,
    (a, b) => a * b,
  );

  const fusionEbit = combineScenarios(fusionRevenue, assumptions.incrementalEbitMargin, (a, b) => a * b);
  const fusionValue = combineScenarios(fusionEbit, assumptions.valuationMultiple, (a, b) => a * b);

  return { fusionRevenue, fusionEbit, fusionValue };
}
