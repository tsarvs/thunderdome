import type { FactorExposure, Sector } from '../types.js';

/** Fixed per-sector economic-factor loadings (spec §10/§6) — hidden simulator configuration, never
 * exposed to bots. This is the *only* place a security's sector-level exposure is declared; a
 * security's own hidden `factorLoadings` (economy/company setup) is this table plus a small
 * idiosyncratic per-company jitter, so sector peers are meaningfully correlated without being
 * identical (spec §15's "sometimes more, sometimes less correlated" emerges from the jitter plus
 * each company's own independent idiosyncratic shock and style tilts, not from this table alone). */
const SECTOR_FACTOR_LOADINGS: Record<Sector, FactorExposure[]> = {
  TECHNOLOGY: [
    { factor: 'GROWTH', loading: 1.2 },
    { factor: 'INTEREST_RATES', loading: -0.8 },
    { factor: 'RISK_APPETITE', loading: 0.9 },
    { factor: 'INFLATION', loading: -0.3 },
    { factor: 'LIQUIDITY', loading: 0.5 },
  ],
  CONSUMER: [
    { factor: 'GROWTH', loading: 0.8 },
    { factor: 'COMMODITY_PRICES', loading: -0.6 },
    { factor: 'INFLATION', loading: -0.4 },
    { factor: 'RISK_APPETITE', loading: 0.4 },
    { factor: 'INTEREST_RATES', loading: -0.3 },
  ],
  INDUSTRIAL: [
    { factor: 'GROWTH', loading: 1.0 },
    { factor: 'COMMODITY_PRICES', loading: 0.4 },
    { factor: 'INTEREST_RATES', loading: -0.5 },
    { factor: 'RISK_APPETITE', loading: 0.5 },
    { factor: 'INFLATION', loading: -0.2 },
  ],
  FINANCIAL: [
    { factor: 'INTEREST_RATES', loading: 0.9 },
    { factor: 'GROWTH', loading: 0.6 },
    { factor: 'RISK_APPETITE', loading: 0.5 },
    { factor: 'LIQUIDITY', loading: 0.6 },
  ],
  HEALTHCARE: [
    { factor: 'GROWTH', loading: 0.4 },
    { factor: 'INTEREST_RATES', loading: -0.2 },
    { factor: 'RISK_APPETITE', loading: 0.2 },
    { factor: 'INFLATION', loading: -0.1 },
    { factor: 'LIQUIDITY', loading: 0.2 },
  ],
};

export function sectorFactorLoadings(sector: Sector): FactorExposure[] {
  return SECTOR_FACTOR_LOADINGS[sector];
}

/** A small number of EXPLICIT sector-to-sector dependencies, used sparingly (spec §12/§13) for
 * relationships shared economic factors don't capture well on their own: consumer-goods input
 * costs move with industrial/manufacturing conditions (a supply-chain dependency), so a fraction
 * of INDUSTRIAL's realized sector-wide shock this round bleeds into CONSUMER as an additional
 * term (see `market/priceModel.ts`). Most cross-sector relationship structure should keep coming
 * from shared `EconomicFactor` loadings above, not from links like this one. */
export const EXPLICIT_SECTOR_LINKS: readonly { from: Sector; to: Sector; weight: number }[] = [
  { from: 'INDUSTRIAL', to: 'CONSUMER', weight: -0.15 },
];
