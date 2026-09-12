import type { ThesisGroupCapPolicy } from './portfolio/optimizer.js';
import type { PortfolioStrategyName } from './portfolio/select.js';
import type { ValuationSensitivities } from './valuation/companyValue.js';
import type { FusionValuationAssumptions, ScenarioValue } from './valuation/types.js';
import type { ResearchAblationMode } from './ablation.js';
import type { CorrelationBlendPolicy } from './correlation/blended.js';
import type { PortfolioConstructionPolicy } from './portfolio/types.js';
import type { RiskPolicy } from './risk/riskEngine.js';
import type { ExecutionCostPolicy } from './execution/costs.js';

export type { ThesisGroupCapPolicy } from './portfolio/optimizer.js';

/**
 * Every assumption for ONE tracked company — everything the alpha layer (`./alpha/*.ts`) needs to
 * run the delta -> effects -> valuation -> alpha pipeline independently of any other security in
 * the portfolio. Field-for-field identical to `fusion-fundamental-v7`'s own `SecurityConfig`
 * (same shape, same 11 real-price-anchored securities below) — this bot changes HOW alphas get
 * combined and sized into a portfolio, not the underlying per-security valuation inputs themselves.
 */
export interface SecurityConfig {
  ticker: string;
  /** research-core entity id for this company — e.g. `entity-elmt` in
   * `@thunderdome/research-fusion`'s fixture dataset. */
  targetEntityId: string;
  /** Public share count — NOT a research fact and NOT point-in-time sensitive information; used
   * only to convert the absolute-dollar valuation chain into a per-share figure comparable to
   * `DailyBar.close`. */
  sharesOutstanding: number;
  valuation: {
    /** Non-fusion, base-business value per share, before any research-driven adjustment — a
     * FALLBACK used only when a security has no trailing price history yet; `decision.ts` replaces
     * this with `valuation/rollingBaseValue.ts`'s trailing-window low/mean/high once at least one
     * bar of history exists. */
    baseBusinessValuePerShare: ScenarioValue;
    /** Fusion OPTION value per share, before any research-driven adjustment — deliberately small
     * and separate from `fusionDerivedValue`. */
    fusionOptionValueBaselinePerShare: ScenarioValue;
    fusion: FusionValuationAssumptions;
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
  /** Caps how many realized alpha samples `decision.ts` keeps in memory (oldest dropped first) —
   * bounds memory/CPU for a long-running forward-shadow match; large enough to comfortably exceed
   * `minSamplesForMeasuredIC` many times over. */
  maxAlphaHistorySamples: number;
}

/**
 * Every number in this file is an EXPERIMENTAL STRATEGY ASSUMPTION, not a researched fact — nothing
 * here is derived from `@thunderdome/research-fusion`'s dataset directly. This is the successor
 * config to `fusion-fundamental-v6`/`fusion-fundamental-v7`'s single `FusionFundamentalConfig`,
 * restructured around the plan's alpha/portfolio-construction/risk separation instead of one
 * combined signal-threshold-and-position-sizing block.
 */
export interface FusionQuantConfig {
  /** Every company this bot actively tracks and can trade — see `SecurityConfig`. */
  securities: SecurityConfig[];
  alphaEnsemble: AlphaEnsemblePolicy;
  correlationBlend: CorrelationBlendPolicy;
  portfolioConstruction: PortfolioConstructionPolicy & { strategy: PortfolioStrategyName };
  risk: RiskPolicy;
  execution: ExecutionCostPolicy;
  /** The null-research ablation switch (plan Phase 1, item 8) — see `./ablation.ts`. */
  ablationMode: ResearchAblationMode;
  /** How a final target weight becomes actual orders — see `./portfolio.ts`'s `buildOrders`
   * (unchanged from `fusion-fundamental-v7`, just with a smaller, dedicated policy type here
   * instead of the old combined `PortfolioPolicy`). */
  orderExecution: { minOrderNotionalCents: number; rebalanceToleranceWeight: number };
}

function constantScenario(value: number): ScenarioValue {
  return { bear: value, base: value, bull: value };
}

/**
 * ELMT's assumptions, anchored to its own real trading history (stockanalysis.com daily closes,
 * IPO 2026-06-30 through 2026-09-09): `base` is the last real close before the Schwabmünchen
 * acquisition became public (2026-09-04, $16.78), `bear`/`bull` are the lowest/highest real closes
 * seen in the stock's entire (short) public life so far (2026-07-29 low $12.74; 2026-08-21 high
 * $19.89) — narrower than the halving/doubling spread below since it's grounded in an actual
 * observed distribution, not a guess. `sharesOutstanding`: 30.46M, stockanalysis.com, as of
 * 2026-09-09.
 */
const ELMT_SECURITY: SecurityConfig = {
  ticker: 'ELMT',
  targetEntityId: 'entity-elmt',
  sharesOutstanding: 30_460_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 12.74, base: 16.78, bull: 19.89 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.5, bull: 1.5 },
    fusion: {
      reactorDeployments: { bear: 3, base: 8, bull: 20 },
      tungstenContentTonnes: { bear: 20, base: 40, bull: 60 },
      // Approximate tungsten-alloy market price; not a researched fact for this dataset.
      tungstenPriceUsdPerTonne: { bear: 35_000, base: 45_000, bull: 60_000 },
      // UNKNOWN in research whether ELMT will supply ARC or any other program at all — this is a
      // bear/base/bull ASSUMPTION about eventual capture, not a belief this bot has evidence for.
      // It must never be raised except by an explicit, evidenced research change.
      supplierCapture: { bear: 0, base: 0.05, bull: 0.15 },
      replacementDemand: { bear: 1, base: 1.3, bull: 1.8 },
      incrementalEbitMargin: { bear: 0.1, base: 0.18, bull: 0.25 },
      valuationMultiple: { bear: 4, base: 7, bull: 11 },
    },
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.5,
      manufacturingCapabilityToFusionOptionPerShare: 0.4,
      hypothesisConfidenceToFusionOptionPerShare: 0.25,
      // Illustrative starting ratio (2x the hypothesis sensitivity) — a qualification/contract-tier
      // change is treated as twice as consequential as a generic hypothesis shift; not swept/tuned.
      supplierCaptureToFusionOptionPerShare: 0.5,
    },
  },
};

/**
 * A ZERO fusion-revenue-chain: `computeFusionValue`'s formula (reactorDeployments *
 * tungstenContentTonnes * tungstenPriceUsdPerTonne * supplierCapture * replacementDemand) was
 * modeled specifically on ELMT — a tungsten-COMPONENT manufacturer. It does NOT mechanically fit
 * Furukawa (an HTS-WIRE supplier), Vitzro Nextech (aerospace/plasma COMPONENTS, not tungsten), or
 * Almonty (a tungsten CONCENTRATE miner selling into a broad industrial market fusion is a small
 * slice of, not a discrete component order). Force-fitting the same formula to a different business
 * model would be manufactured precision. Until each of those gets its own properly-shaped formula,
 * their fusion channel stays honestly at zero — their fair value comes from
 * `baseBusinessValuePerShare` (real, anchored) plus a small `fusionOptionValueBaselinePerShare` for
 * their evidenced-but-unquantified fusion involvement, nothing invented on top.
 */
const NO_FUSION_ASSUMPTIONS: FusionValuationAssumptions = {
  reactorDeployments: constantScenario(0),
  tungstenContentTonnes: constantScenario(0),
  tungstenPriceUsdPerTonne: constantScenario(0),
  supplierCapture: constantScenario(0),
  replacementDemand: constantScenario(0),
  incrementalEbitMargin: constantScenario(0),
  valuationMultiple: constantScenario(0),
};

/**
 * Furukawa Electric (TSE:5801) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from JPY at that day's USD/JPY spot rate (153.605) — see
 * `backtest/furukawaHistoricalPrices.ts`. `base` = most recent USD close (2026-09-09); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: 703.5M
 * (stockanalysis.com, 2026-09-09). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Furukawa
 * has a REAL, evidenced HTS-wire supply relationship with CFS/SPARC, but that's a wire business,
 * not a tungsten-component one; `fusionOptionValueBaselinePerShare` (~3%/9% of base, the same ratio
 * ELMT's own placeholder used) is the only channel that can move for it right now.
 */
const FURUKAWA_SECURITY: SecurityConfig = {
  ticker: 'FURUKAWA', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-furukawa',
  sharesOutstanding: 703_500_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 18.05, base: 26.88, bull: 30.79 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.81, bull: 2.42 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.39,
      manufacturingCapabilityToFusionOptionPerShare: 0.65,
      hypothesisConfidenceToFusionOptionPerShare: 0.4,
      supplierCaptureToFusionOptionPerShare: 0.8,
    },
  },
};

/**
 * Vitzro Nextech (KOSDAQ:488900) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from KRW at that day's USD/KRW spot rate (~1386.155, a 30-day average — no single
 * point-in-time quote was available) — see `backtest/vitzroNextechHistoricalPrices.ts`.
 * `sharesOutstanding`: 28.98M (stockanalysis.com, 2026-09-09). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — Vitzro Nextech's fusion involvement (KSTAR/ITER components) is
 * aerospace/plasma-component manufacturing, not the tungsten-component chain ELMT's formula models.
 */
const VITZRO_NEXTECH_SECURITY: SecurityConfig = {
  ticker: 'VITZRONEXTECH', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-vitzro-nextech',
  sharesOutstanding: 28_980_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 4.95, base: 7.26, bull: 8.42 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.22, bull: 0.65 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.65,
      manufacturingCapabilityToFusionOptionPerShare: 0.17,
      hypothesisConfidenceToFusionOptionPerShare: 0.11,
      supplierCaptureToFusionOptionPerShare: 0.22,
    },
  },
};

/**
 * Almonty Industries (NASDAQ:ALM) — real daily closes, stockanalysis.com, pulled 2026-09-09
 * (already USD). `sharesOutstanding`: 288,109,013 (stockanalysis.com, 2026-09-09). Fusion channel
 * is zero (see `NO_FUSION_ASSUMPTIONS`) — Almonty mines/sells tungsten CONCENTRATE into a broad
 * existing industrial market; fusion demand is a small, currently-unquantified slice of that
 * market, not a discrete component order like ELMT's or Freemelt's.
 */
const ALMONTY_SECURITY: SecurityConfig = {
  ticker: 'ALM',
  targetEntityId: 'entity-almonty',
  sharesOutstanding: 288_109_013,
  valuation: {
    baseBusinessValuePerShare: { bear: 10.95, base: 18.56, bull: 19.12 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.56, bull: 1.67 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.65,
      manufacturingCapabilityToFusionOptionPerShare: 0.45,
      hypothesisConfidenceToFusionOptionPerShare: 0.28,
      supplierCaptureToFusionOptionPerShare: 0.56,
    },
  },
};

/**
 * Freemelt Holding AB (STO:FREEM) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from SEK at that day's USD/SEK spot rate (9.5868) — see
 * `backtest/freemeltHistoricalPrices.ts`. `base`/`bear`/`bull` anchor to the last REAL close BEFORE
 * the Sept 9 order announcement (2026-09-08), not the most recent close. `sharesOutstanding`:
 * 227.7M (stockanalysis.com, 2026-09-09).
 *
 * Fusion channel is zero (`NO_FUSION_ASSUMPTIONS`) for the same reason as the others — but unlike
 * them, Freemelt's `fusionOptionValueBaselinePerShare` is grounded directly in the REAL order
 * Fusion for Energy awarded Freemelt for JT-60SA: base value SEK 55M / potential SEK 84M, converted
 * to USD at the same spot rate, times an assumed 15% margin and ELMT's own 7x multiple (both still
 * STRATEGY ASSUMPTIONS), divided by shares outstanding. `bear: 0` — the order could still fail to
 * convert into realized margin.
 */
const FREEMELT_SECURITY: SecurityConfig = {
  ticker: 'FREEM',
  targetEntityId: 'entity-freemelt',
  sharesOutstanding: 227_700_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 0.1262, base: 0.1356, bull: 0.2222 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.0265, bull: 0.0404 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.0121,
      manufacturingCapabilityToFusionOptionPerShare: 0.0033,
      hypothesisConfidenceToFusionOptionPerShare: 0.002,
      supplierCaptureToFusionOptionPerShare: 0.004,
    },
  },
};

/**
 * Syntec Optics (NASDAQ:OPTX) — real daily closes, stockanalysis.com, pulled 2026-09-10. `bear`/
 * `base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window (see
 * `backtest/optxHistoricalPrices.ts`). `sharesOutstanding`: ~40.28M (stockanalysis.com,
 * approximate, as of 2026-09-10). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Syntec
 * supplies specialized OPTICS, not the tungsten-component chain ELMT's formula models.
 */
const OPTX_SECURITY: SecurityConfig = {
  ticker: 'OPTX',
  targetEntityId: 'entity-syntec-optics',
  sharesOutstanding: 40_280_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 5.88, base: 8.19, bull: 12.17 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.25, bull: 0.74 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.73,
      manufacturingCapabilityToFusionOptionPerShare: 0.2,
      hypothesisConfidenceToFusionOptionPerShare: 0.12,
      supplierCaptureToFusionOptionPerShare: 0.24,
    },
  },
};

/**
 * General Fusion (NASDAQ:GFUZ) — real daily closes, stockanalysis.com, pulled 2026-09-10. `bear`/
 * `base`/`bull` = lowest/last/highest real close over its real trading window (2026-07-13, its IPO
 * date, through 2026-08-31 — see `backtest/gfuzHistoricalPrices.ts`). `sharesOutstanding`: ~73.84M
 * (stockanalysis.com, approximate, as of 2026-09-10). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — General Fusion is a pure-play pre-revenue REACTOR DEVELOPER, not a
 * component supplier, so ELMT's tungsten-component-order formula has no analog here at all.
 */
const GFUZ_SECURITY: SecurityConfig = {
  ticker: 'GFUZ',
  targetEntityId: 'entity-general-fusion',
  sharesOutstanding: 73_840_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 6.73, base: 8.1, bull: 13.76 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.24, bull: 0.73 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 0.72,
      manufacturingCapabilityToFusionOptionPerShare: 0.19,
      hypothesisConfidenceToFusionOptionPerShare: 0.12,
      supplierCaptureToFusionOptionPerShare: 0.24,
    },
  },
};

/**
 * Fujikura Ltd. (TSE:5803) — real daily closes, stockanalysis.com, pulled 2026-09-11, converted
 * from JPY at that day's USD/JPY spot rate (153.58, Reuters) — see
 * `backtest/fujikuraHistoricalPrices.ts`. `base` = most recent USD close (2026-08-31); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: 1,655,659,296
 * (Fujikura FY2026 financial disclosure, as of 2026-03-31, post 6-for-1 split). Fusion channel is
 * zero (see `NO_FUSION_ASSUMPTIONS`) — Fujikura has a REAL, evidenced HTS-wire supply relationship
 * with CFS, but that's a wire business, not the tungsten-component chain ELMT's formula models.
 */
const FUJIKURA_SECURITY: SecurityConfig = {
  ticker: 'FUJIKURA', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-fujikura',
  sharesOutstanding: 1_655_659_296,
  valuation: {
    baseBusinessValuePerShare: { bear: 24.22, base: 35.84, bull: 39.58 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 1.08, bull: 3.23 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 3.19,
      manufacturingCapabilityToFusionOptionPerShare: 0.86,
      hypothesisConfidenceToFusionOptionPerShare: 0.53,
      supplierCaptureToFusionOptionPerShare: 1.06,
    },
  },
};

/**
 * Sumitomo Electric Industries, Ltd. (TSE:5802) — real daily closes, stockanalysis.com, pulled
 * 2026-09-11, converted from JPY at that day's USD/JPY spot rate (153.58, Reuters) — see
 * `backtest/sumitomoHistoricalPrices.ts`. `base` = most recent USD close (2026-08-31); `bear`/
 * `bull` = lowest/highest USD close over the same real window. `sharesOutstanding`: ~3.12B (S&P
 * Global Market Intelligence, as of 2026-06-30, post 4-for-1 split effective 2026-07-01). Fusion
 * channel is zero (see `NO_FUSION_ASSUMPTIONS`) — Sumitomo (with A.L.M.T.) has a REAL, evidenced
 * ITER tungsten-monoblock production contract (~¥3.5B, dated 2021), but that revenue is already
 * fully absorbed into its real trading range.
 */
const SUMITOMO_SECURITY: SecurityConfig = {
  ticker: 'SUMITOMO', // no US-listed ticker; see backtest note on cross-exchange securities
  targetEntityId: 'entity-sumitomo',
  sharesOutstanding: 3_120_000_000,
  valuation: {
    baseBusinessValuePerShare: { bear: 13.43, base: 14.46, bull: 18.45 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.43, bull: 1.3 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.29,
      manufacturingCapabilityToFusionOptionPerShare: 0.34,
      hypothesisConfidenceToFusionOptionPerShare: 0.21,
      supplierCaptureToFusionOptionPerShare: 0.42,
    },
  },
};

/**
 * Kennametal Inc. (NYSE:KMT) — real daily closes, stockanalysis.com, pulled 2026-09-11. `bear`/
 * `base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window (see
 * `backtest/kmtHistoricalPrices.ts`). `sharesOutstanding`: 76,219,022 (Kennametal SEC filing, as of
 * 2026-07-31). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — the research dataset's own
 * `commodityTrap` assertion names Kennametal explicitly as a caution case: general tungsten
 * exposure through tooling and materials is not the same as capturing fusion economics.
 */
const KMT_SECURITY: SecurityConfig = {
  ticker: 'KMT',
  targetEntityId: 'entity-kennametal',
  sharesOutstanding: 76_219_022,
  valuation: {
    baseBusinessValuePerShare: { bear: 29.27, base: 29.34, bull: 36.06 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.88, bull: 2.64 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.61,
      manufacturingCapabilityToFusionOptionPerShare: 0.7,
      hypothesisConfidenceToFusionOptionPerShare: 0.43,
      supplierCaptureToFusionOptionPerShare: 0.86,
    },
  },
};

/**
 * American Superconductor Corporation (NASDAQ:AMSC) — real daily closes, stockanalysis.com, pulled
 * 2026-09-11. `bear`/`base`/`bull` = lowest/last/highest real close over the
 * 2026-07-01..2026-08-31 window (see `backtest/amscHistoricalPrices.ts`). `sharesOutstanding`:
 * 48,442,143 (AMSC Form 10-Q, as of 2026-07-31). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — the research dataset has no evidenced fusion-specific relationship for
 * AMSC yet (grid/power-electronics superconductor business, not a named fusion supplier).
 */
const AMSC_SECURITY: SecurityConfig = {
  ticker: 'AMSC',
  targetEntityId: 'entity-amsc',
  sharesOutstanding: 48_442_143,
  valuation: {
    baseBusinessValuePerShare: { bear: 26.64, base: 28.71, bull: 39.92 },
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.86, bull: 2.58 },
    fusion: NO_FUSION_ASSUMPTIONS,
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 2.56,
      manufacturingCapabilityToFusionOptionPerShare: 0.69,
      hypothesisConfidenceToFusionOptionPerShare: 0.42,
      supplierCaptureToFusionOptionPerShare: 0.84,
    },
  },
};

/** Same 11 real-price-anchored securities `fusion-fundamental-v7` tracks — this bot's whole
 * point is a different alpha-combination/portfolio-construction/risk architecture ON TOP of the
 * same per-security valuation inputs, not a different universe. */
const ALL_SECURITIES: SecurityConfig[] = [
  ELMT_SECURITY,
  FURUKAWA_SECURITY,
  VITZRO_NEXTECH_SECURITY,
  ALMONTY_SECURITY,
  FREEMELT_SECURITY,
  OPTX_SECURITY,
  GFUZ_SECURITY,
  FUJIKURA_SECURITY,
  SUMITOMO_SECURITY,
  KMT_SECURITY,
  AMSC_SECURITY,
];

export const DEFAULT_FUSION_QUANT_CONFIG: FusionQuantConfig = {
  securities: ALL_SECURITIES,
  alphaEnsemble: {
    rollingWindowDays: 20,
    // Shorter than rollingWindowDays on purpose — see AlphaEnsemblePolicy's own doc comment.
    momentumWindowDays: 10,
    // Same illustrative starting point fusion-fundamental-v7's ConfidenceCalibration used.
    rollingBlendWeight: 0.08,
    minSamplesForMeasuredIC: 10,
    maxAlphaHistorySamples: 2_000,
  },
  correlationBlend: {
    // Illustrative starting point (not fitted/swept) — see CorrelationBlendPolicy's own doc
    // comment for why causal overlap gets a meaningful, non-trivial share given how little real
    // price history exists to estimate statistical correlation from right now.
    causalWeight: 0.4,
  },
  portfolioConstruction: {
    strategy: 'inverse_volatility',
    // A security whose |expectedReturn*confidence| is below 1% is left at zero — illustrative,
    // not swept: small enough that a genuine, confidently-held alpha isn't filtered out, large
    // enough that pure noise mostly doesn't activate a position.
    activationThreshold: 0.01,
    // 60% of equity deployed gross across active positions — leaves real dry powder/cash buffer,
    // same order of magnitude as fusion-fundamental-v7's emergencyCashReservePct+dryPowderTargetPct
    // combined, without carrying over that bot's own separate reserve mechanism verbatim.
    totalGrossBudgetPct: 0.6,
    maxPositionWeight: 0.25,
  },
  risk: {
    maxPositionWeight: 0.25,
    thesisGroupCap: {
      // Same illustrative starting points fusion-fundamental-v7's ThesisGroupCapPolicy used.
      minSharedExposureIds: 1,
      maxGroupWeight: 0.25 * 1.5,
    },
    // Illustrative starting point (not researched) — a proxy for "how much of this name's real
    // average daily dollar volume this strategy is willing to assume it could trade without
    // meaningfully moving the price."
    defaultLiquidityCapUsd: 2_000_000,
  },
  execution: {
    // Illustrative, not calibrated against any real broker/venue.
    flatFeeUsd: 1,
    impactCoefficient: 0.1,
    averageDailyVolumeUsdByTicker: new Map(),
    defaultAverageDailyVolumeUsd: 2_000_000,
  },
  // 'full' — every alpha active. See ./ablation.ts for the other three modes and
  // backtest/walkForward.ts for where each gets exercised as part of the Full/Null/Research-only/
  // Price-only comparison the plan calls out as the key scientific test of this whole approach.
  ablationMode: 'full',
  orderExecution: {
    minOrderNotionalCents: 5_000,
    // Same illustrative starting point fusion-fundamental-v7's own rebalanceToleranceWeight used.
    rebalanceToleranceWeight: 0.03,
  },
};

export { constantScenario };
