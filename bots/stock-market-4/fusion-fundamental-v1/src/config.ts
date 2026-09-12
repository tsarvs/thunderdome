import type { ValuationSensitivities } from './valuation/companyValue.js';
import type { FusionValuationAssumptions, ScenarioValue } from './valuation/types.js';

/** `STRONG_SELL` is v1-only (see this file's own module doc comment): a deliberately RARER,
 * stricter level than plain `SELL` — reserved for when the bot is confident enough to actually bet
 * against a security (a short), not merely flatten out of it. See `signal.ts`'s `classifySignal`
 * for how it's entered/held, and `portfolio.ts`'s `targetWeightForSignal` for the additional
 * confidence gate beyond the score threshold alone. */
export type SignalLevel = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'REDUCE' | 'SELL' | 'STRONG_SELL';

/** Signal-score thresholds (spec §13) — configuration, never magic constants inlined in
 * `signal.ts`. All thresholds are on the SAME scale as `signalScore = valuationGap * confidence`
 * (a fraction, e.g. 0.15 = "model implies fair value is 15% above market, confidence-weighted").
 * Shared across every security in `FusionFundamentalConfig.securities` — per-symbol thresholds
 * would be portfolio optimization this bot deliberately doesn't do (spec §27). */
export interface SignalThresholds {
  strongBuyThreshold: number;
  buyThreshold: number;
  reduceThreshold: number;
  sellThreshold: number;
  /** v1-only: below this (more negative than `sellThreshold`), the bot considers the security
   * confidently overvalued enough to be WORTH shorting, not just avoiding — see `PortfolioPolicy`'s
   * `minShortConfidence` for the second, independent gate this still has to clear. Symmetric with
   * `strongBuyThreshold`'s own role on the bullish side. */
  strongSellThreshold: number;
  /** Hysteresis width, same units as the thresholds above (spec follow-up: a real-price backtest
   * showed daily price noise near a threshold boundary whipsawing the level, and therefore
   * trading, day after day with no new research). Once a level is held, the score must fall back
   * past its own entry threshold by this much before the bot gives it up — see
   * `signal.ts`'s `classifySignal` for the exact rule. `0` reproduces the old
   * always-reclassify-fresh behavior. */
  hysteresisBand: number;
}

/** Target-weight policy (spec §14) — no portfolio optimization, just a lookup from signal level to
 * a target fraction of EQUITY PER SECURITY, always clamped to `maxPositionWeight`. Shared across
 * every security — with N securities all at STRONG_BUY, gross target exposure could sum past
 * 100% of equity; this bot deliberately doesn't solve that with an allocator (spec §27) and
 * instead relies on `buyingPowerCents` running out (see `decision.ts`'s
 * `computeTradingDecisions` for exactly how that's kept correct across a multi-security round). */
export interface PortfolioPolicy {
  strongBuyTargetWeight: number;
  buyTargetWeight: number;
  reduceTargetWeight: number;
  maxPositionWeight: number;
  /** v1-only: magnitude of the target short exposure when `STRONG_SELL` clears
   * `minShortConfidence` (the actual target weight used is `-shortTargetWeight`, clamped the same
   * way every other target is — see `targetWeightForSignal`). Deliberately smaller than
   * `strongBuyTargetWeight`: a short's downside is theoretically unbounded (a stock can rise
   * without limit) where a long's is capped at losing 100%, so betting the same fraction of
   * equity against a security is a materially bigger risk than betting it FOR one, even at equal
   * model confidence. */
  shortTargetWeight: number;
  /** v1-only: `signal.confidence` (see `signal.ts`) must clear THIS, independently of
   * `strongSellThreshold` already being crossed, before a `STRONG_SELL` actually opens/adds to a
   * short — otherwise it's treated exactly like a plain `SELL` (flatten to cash only). Two
   * independent gates (an extreme score AND high confidence) rather than one, because a score can
   * be extreme from a large valuation gap alone even when the confidence behind THIS round's
   * research change is low — exactly the case where shorting would be the least justified. */
  minShortConfidence: number;
  /** Below this notional (cents), a rebalancing trade isn't worth generating — avoids
   * dust-sized orders churning fees on rounding noise. */
  minOrderNotionalCents: number;
  /** Fraction of equity (spec follow-up): a position within this much of its target weight isn't
   * rebalanced at all, even if the target technically differs — the tolerance that stops ordinary
   * daily price drift on a genuinely volatile stock from re-trading back to an exact target every
   * round. See `portfolio.ts`'s `buildOrders` for exactly where this applies. */
  rebalanceToleranceWeight: number;
}

/**
 * Every assumption for ONE tracked company (spec §9/§11) — everything a `SecurityConfig` needs to
 * run the full delta -> effects -> valuation -> signal pipeline independently of any other
 * security in the portfolio. Adding a new symbol means adding one of these, nothing else, as long
 * as its entity already exists in `@thunderdome/research-fusion`'s dataset.
 */
export interface SecurityConfig {
  ticker: string;
  /** research-core entity id for this company — e.g. `entity-elmt` in
   * `@thunderdome/research-fusion`'s fixture dataset. */
  targetEntityId: string;
  /** Public share count — NOT a research fact and NOT point-in-time sensitive information; used
   * only to convert the absolute-dollar valuation chain (spec §11) into a per-share figure
   * comparable to `DailyBar.close` (which stock-market-4 reports as dollars per share). Drifts
   * over time and isn't tracked by the research timeline, so needs periodic refreshing, not just
   * a one-time lookup. */
  sharesOutstanding: number;
  valuation: {
    /** Non-fusion, base-business value per share, before any research-driven adjustment. This is
     * NOT an independent fundamentals estimate (no DCF, no comp set — this bot has no basis for
     * one, and inventing one would be exactly the "manufactured precision" spec §28 forbids).
     * The discipline used for ELMT (see `DEFAULT_FUSION_FUNDAMENTAL_CONFIG` below): anchor to the
     * security's own real trading range rather than a guess, and say so — "absent any modeled
     * reason to think otherwise, assume the base business is worth about what the market has
     * actually shown for it," never "this is the true intrinsic value." Apply the same discipline
     * to every new security added here. */
    baseBusinessValuePerShare: ScenarioValue;
    /** Fusion OPTION value per share, before any research-driven adjustment — deliberately small
     * and separate from `fusionDerivedValue` (spec §9's "fusion option value" bucket). */
    fusionOptionValueBaselinePerShare: ScenarioValue;
    fusion: FusionValuationAssumptions;
    sensitivities: ValuationSensitivities;
  };
}

/**
 * Every number in this file is an EXPERIMENTAL STRATEGY ASSUMPTION for `fusion-fundamental-v1`,
 * not a researched fact (spec §28/§29) — nothing here is derived from
 * `@thunderdome/research-fusion`'s dataset directly; each security's own valuation assumptions
 * document what they're anchored to (or not) individually. A real strategy would tune or replace
 * every value below through backtesting; v0.1 ships one clearly-labeled starting point.
 */
export interface FusionFundamentalConfig {
  /** Every company this bot actively tracks and can trade — see `SecurityConfig`. Order matters:
   * within one round, securities are evaluated in this order and later ones see whatever buying
   * power earlier ones didn't spend (spec follow-up: see `decision.ts`). */
  securities: SecurityConfig[];
  signal: SignalThresholds;
  portfolio: PortfolioPolicy;
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
      // UNKNOWN in research whether ELMT will supply ARC or any other program at all (spec §5) —
      // this is a bear/base/bull ASSUMPTION about eventual capture, not a belief this bot has
      // evidence for. It must never be raised except by an explicit, evidenced research change.
      supplierCapture: { bear: 0, base: 0.05, bull: 0.15 },
      replacementDemand: { bear: 1, base: 1.3, bull: 1.8 },
      incrementalEbitMargin: { bear: 0.1, base: 0.18, bull: 0.25 },
      valuationMultiple: { bear: 4, base: 7, bull: 11 },
    },
    sensitivities: {
      manufacturingCapabilityToBaseValuePerShare: 1.5,
      manufacturingCapabilityToFusionOptionPerShare: 0.4,
      hypothesisConfidenceToFusionOptionPerShare: 0.25,
    },
  },
};

/**
 * A ZERO fusion-revenue-chain (spec follow-up, Sept 10, 2026): `computeFusionValue`'s formula
 * (reactorDeployments * tungstenContentTonnes * tungstenPriceUsdPerTonne * supplierCapture *
 * replacementDemand) was modeled specifically on ELMT — a tungsten-COMPONENT manufacturer. It
 * does NOT mechanically fit Furukawa (an HTS-WIRE supplier), Vitzro Nextech (aerospace/plasma
 * COMPONENTS, not tungsten), or Almonty (a tungsten CONCENTRATE miner selling into a broad
 * industrial market fusion is a small slice of, not a discrete component order). Force-fitting
 * the same formula to a different business model would be exactly the "manufactured precision"
 * spec §28 forbids. Until each of those gets its own properly-shaped formula, their fusion
 * channel stays honestly at zero — their fair value comes from `baseBusinessValuePerShare` (real,
 * anchored) plus a small `fusionOptionValueBaselinePerShare` for their evidenced-but-unquantified
 * fusion involvement, nothing invented on top.
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
 * not a tungsten-component one; `fusionOptionValueBaselinePerShare` (~3%/9% of base, the same
 * ratio ELMT's own placeholder used) is the only channel that can move for it right now.
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
    },
  },
};

/**
 * Vitzro Nextech (KOSDAQ:488900) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from KRW at that day's USD/KRW spot rate (~1386.155, a 30-day average — no single
 * point-in-time quote was available) — see `backtest/vitzroNextechHistoricalPrices.ts`.
 * `sharesOutstanding`: 28.98M (stockanalysis.com, 2026-09-09). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — Vitzro Nextech's fusion involvement (KSTAR/ITER components) is
 * aerospace/plasma-component manufacturing, not the tungsten-component chain ELMT's formula
 * models.
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
    },
  },
};

/**
 * Freemelt Holding AB (STO:FREEM) — real daily closes, stockanalysis.com, pulled 2026-09-09,
 * converted from SEK at that day's USD/SEK spot rate (9.5868) — see
 * `backtest/freemeltHistoricalPrices.ts`. `base`/`bear`/`bull` anchor to the last REAL close
 * BEFORE the Sept 9 order announcement (2026-09-08), not the most recent close — same discipline
 * as ELMT's own Sept-7/8 anchoring, so this security's own acceptance case (does the bot react
 * correctly to its own real, evidenced order) isn't given away by anchoring to the post-event
 * price. `sharesOutstanding`: 227.7M (stockanalysis.com, 2026-09-09).
 *
 * Fusion channel is zero (`NO_FUSION_ASSUMPTIONS`) for the same reason as the others — but unlike
 * them, Freemelt's `fusionOptionValueBaselinePerShare` is NOT the generic ~3%/9%-of-base
 * placeholder: it's grounded directly in the REAL order Fusion for Energy awarded Freemelt for
 * JT-60SA (spec follow-up research update, 2026-09-09): base value SEK 55M / potential SEK 84M,
 * converted to USD at the same spot rate, times an assumed 15% margin and ELMT's own 7x multiple
 * (both still STRATEGY ASSUMPTIONS — the order's revenue figures are real, the margin/multiple
 * applied to them are not), divided by shares outstanding. `bear: 0` — the order could still fail
 * to convert into realized margin.
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
    },
  },
};

/**
 * Syntec Optics (NASDAQ:OPTX) — real daily closes, stockanalysis.com, pulled 2026-09-10.
 * `bear`/`base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window
 * (see `backtest/optxHistoricalPrices.ts`). `sharesOutstanding`: ~40.28M (stockanalysis.com,
 * approximate, as of 2026-09-10 — not a July/August-specific figure). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — Syntec supplies specialized OPTICS, not the tungsten-component chain
 * ELMT's formula models; it has disclosed fusion-reactor optics orders but no named customer/
 * program, so that shows up only as `fusionOptionValueBaselinePerShare` (the same ~3%/9%-of-base
 * ratio every non-ELMT security uses), never a quantified fusion revenue line.
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
    },
  },
};

/**
 * General Fusion (NASDAQ:GFUZ) — real daily closes, stockanalysis.com, pulled 2026-09-10.
 * `bear`/`base`/`bull` = lowest/last/highest real close over its real trading window
 * (2026-07-13, its IPO date, through 2026-08-31 — see `backtest/gfuzHistoricalPrices.ts`).
 * `sharesOutstanding`: ~73.84M (stockanalysis.com, approximate, as of 2026-09-10). Fusion channel
 * is zero (see `NO_FUSION_ASSUMPTIONS`) — unlike ELMT/Furukawa/etc., General Fusion is a pure-play
 * pre-revenue REACTOR DEVELOPER, not a component supplier, so ELMT's tungsten-component-order
 * formula has no analog here at all; its entire real trading range already reflects the market's
 * own fusion-inclusive view, which is exactly what `baseBusinessValuePerShare` captures. The same
 * small `fusionOptionValueBaselinePerShare` bucket is kept anyway, for structural consistency with
 * every other tracked security, not because there's a distinct unquantified upside on top.
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
 * with CFS (same evidence class as `FURUKAWA_SECURITY`'s), but that's a wire business, not the
 * tungsten-component chain ELMT's formula models; `fusionOptionValueBaselinePerShare` (~3%/9% of
 * base, the same ratio every non-ELMT security uses) is the only channel that can move for it
 * right now.
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
 * fully absorbed into its real trading range; `fusionOptionValueBaselinePerShare` is the only
 * channel that can move for it right now.
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
    },
  },
};

/**
 * Kennametal Inc. (NYSE:KMT) — real daily closes, stockanalysis.com, pulled 2026-09-11. `bear`/
 * `base`/`bull` = lowest/last/highest real close over the 2026-07-01..2026-08-31 window (see
 * `backtest/kmtHistoricalPrices.ts`). `sharesOutstanding`: 76,219,022 (Kennametal SEC filing, as
 * of 2026-07-31). Fusion channel is zero (see `NO_FUSION_ASSUMPTIONS`) — the research dataset's
 * own `commodityTrap` assertion names Kennametal explicitly as a caution case: general tungsten
 * exposure through tooling and materials is not the same as capturing fusion economics, so this
 * bot treats it exactly like every other non-ELMT security rather than inventing a fusion channel
 * the evidence doesn't support.
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
    },
  },
};

/**
 * American Superconductor Corporation (NASDAQ:AMSC) — real daily closes, stockanalysis.com,
 * pulled 2026-09-11. `bear`/`base`/`bull` = lowest/last/highest real close over the
 * 2026-07-01..2026-08-31 window (see `backtest/amscHistoricalPrices.ts`). `sharesOutstanding`:
 * 48,442,143 (AMSC Form 10-Q, as of 2026-07-31). Fusion channel is zero (see
 * `NO_FUSION_ASSUMPTIONS`) — the research dataset has no evidenced fusion-specific relationship
 * for AMSC yet (grid/power-electronics superconductor business, not a named fusion supplier), so
 * `fusionOptionValueBaselinePerShare` carries only the same small structural placeholder every
 * other tracked security gets, not a quantified opportunity.
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
    },
  },
};

/**
 * v0's portfolio: ELMT, Furukawa, Vitzro Nextech, Almonty, and Freemelt — each a real, currently-
 * traded ticker with its own anchored valuation assumptions (spec follow-up: "scale to a
 * portfolio of multiple symbols"). Add more `SecurityConfig` entries to `securities` as new
 * companies get the same real-price-anchored treatment. Most scenario-shaped assumptions spread
 * Bear/Base/Bull by roughly halving/doubling the base case rather than asserting false precision — there is
 * no research basis for tighter bounds (spec §10, §28); `baseBusinessValuePerShare` is the one
 * exception per security, anchored to that security's own real trading range instead.
 */
export const DEFAULT_FUSION_FUNDAMENTAL_CONFIG: FusionFundamentalConfig = {
  securities: [ELMT_SECURITY, FURUKAWA_SECURITY, VITZRO_NEXTECH_SECURITY, ALMONTY_SECURITY, FREEMELT_SECURITY, OPTX_SECURITY, GFUZ_SECURITY, FUJIKURA_SECURITY, SUMITOMO_SECURITY, KMT_SECURITY, AMSC_SECURITY],
  signal: {
    strongBuyThreshold: 0.15,
    buyThreshold: 0.05,
    reduceThreshold: -0.05,
    sellThreshold: -0.15,
    // v1-only: a full 10 points past sellThreshold (the same spacing buyThreshold->
    // strongBuyThreshold already uses on the bullish side) — confidently-overvalued-enough-to-
    // short is meant to be RARER than merely "worth avoiding," not a hair-trigger past -0.15.
    strongSellThreshold: -0.25,
    // v1: 0, not v0's 0.03 — see games/stock-market-4/scripts/sweepFusionFundamentalV0Thresholds.ts
    // and its own real-engine grid search over the real July-August 2026 window: hysteresis
    // contributed nothing useful there once rebalanceToleranceWeight (below) was doing the actual
    // churn-reduction work — the best Sharpe/return/drawdown combination found had hysteresisBand
    // at 0. Tuned to ONE historical window, not cross-validated — revisit if a wider real dataset
    // ever becomes available.
    hysteresisBand: 0,
  },
  portfolio: {
    strongBuyTargetWeight: 0.2,
    buyTargetWeight: 0.08,
    reduceTargetWeight: 0.02,
    // v1-only: half of strongBuyTargetWeight, deliberately — see this field's own doc comment in
    // PortfolioPolicy for why an equally-confident short should still be sized smaller than an
    // equally-confident long (unbounded downside vs. capped-at-100% downside).
    shortTargetWeight: 0.1,
    // v1-only: 70% — "fairly confident," not merely "past the score threshold." See
    // PortfolioPolicy's own doc comment for why this is a SECOND, independent gate rather than
    // folded into strongSellThreshold alone.
    minShortConfidence: 0.7,
    maxPositionWeight: 0.25,
    minOrderNotionalCents: 5_000,
    // v1: 0.03, not v0's 0.02 — same sweep as hysteresisBand above; this was the knob actually
    // doing the churn-reduction work in that grid search, and 0.03 gave the best Sharpe/return/
    // drawdown combination found (still comfortably below maxPositionWeight/well above
    // reduceTargetWeight, so it doesn't swallow either).
    rebalanceToleranceWeight: 0.03,
  },
};

export { constantScenario };
