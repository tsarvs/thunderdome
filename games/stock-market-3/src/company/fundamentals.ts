import type { Rng } from '@thunderdome/engine';
import { toCents } from '../money.js';
import { ouStep, weightedTransition } from '../rngUtil.js';
import type { CompanyFundamentals, LifecycleStage, ReportedFinancials } from '../types.js';

const LIFECYCLE_GROWTH_TARGET: Record<LifecycleStage, number> = {
  HIGH_GROWTH: 0.035,
  MATURE: 0.008,
  DECLINE: -0.015,
};

/** Target operating margin (bps) each lifecycle stage's `marginBps` mean-reverts toward —
 * high-growth companies reinvest at thinner margins, mature companies hold the widest margins,
 * and margins compress in decline. */
const LIFECYCLE_MARGIN_TARGET_BPS: Record<LifecycleStage, number> = {
  HIGH_GROWTH: 1400,
  MATURE: 1900,
  DECLINE: 1100,
};

const INITIAL_STAGE_WEIGHTS: readonly { to: LifecycleStage; weight: number }[] = [
  { to: 'HIGH_GROWTH', weight: 0.35 },
  { to: 'MATURE', weight: 0.5 },
  { to: 'DECLINE', weight: 0.15 },
];

/** Checked once per quarter, at that company's own earnings date (spec §41) — a company's stage
 * is deliberately sticky across a whole quarter, not re-rolled every round. */
const LIFECYCLE_TRANSITIONS: Record<LifecycleStage, readonly { to: LifecycleStage; weight: number }[]> = {
  HIGH_GROWTH: [
    { to: 'HIGH_GROWTH', weight: 0.9 },
    { to: 'MATURE', weight: 0.1 },
  ],
  MATURE: [
    { to: 'MATURE', weight: 0.92 },
    { to: 'HIGH_GROWTH', weight: 0.03 },
    { to: 'DECLINE', weight: 0.05 },
  ],
  DECLINE: [
    { to: 'DECLINE', weight: 0.85 },
    { to: 'MATURE', weight: 0.15 },
  ],
};

export function drawInitialLifecycleStage(rng: Rng): LifecycleStage {
  return weightedTransition(INITIAL_STAGE_WEIGHTS, rng);
}

export function drawInitialFundamentals(stage: LifecycleStage, rng: Rng): CompanyFundamentals {
  const revenueCents = toCents(150_000_000 + rng.nextFloat() * 750_000_000);
  const marginBps = 800 + Math.round(rng.nextFloat() * 2200);
  return {
    revenueCents,
    revenueGrowth: LIFECYCLE_GROWTH_TARGET[stage],
    earningsCents: Math.round((revenueCents * marginBps) / 10000),
    marginBps,
    lifecycleStage: stage,
  };
}

/**
 * Advances a company's hidden fundamentals by one quarter (spec §21/§41): revenue growth
 * mean-reverts toward its current lifecycle stage's target (nudged a little by the hidden GROWTH
 * economic factor, so a company's own trajectory is never fully independent of the broader
 * economy), margin wanders slowly, and the lifecycle stage itself may transition. This is the
 * hidden "truth" an upcoming `EarningsReportEvent.reported` will eventually reveal — never called
 * or exposed anywhere near report time itself, only at the START of the new quarter (see
 * `market/events.ts`), well before that quarter's analyst estimates even begin forming.
 */
export function stepFundamentalsForNextQuarter(
  current: CompanyFundamentals,
  growthFactorValue: number,
  rng: Rng,
): CompanyFundamentals {
  const target = LIFECYCLE_GROWTH_TARGET[current.lifecycleStage] + growthFactorValue * 0.01;
  const revenueGrowth = ouStep({ current: current.revenueGrowth, mean: target, speed: 0.2, volatility: 0.008, rng });
  const revenueCents = Math.max(1, Math.round(current.revenueCents * (1 + revenueGrowth)));
  const marginTarget = LIFECYCLE_MARGIN_TARGET_BPS[current.lifecycleStage];
  const marginBps = Math.min(
    5000,
    Math.max(-2000, ouStep({ current: current.marginBps, mean: marginTarget, speed: 0.05, volatility: 60, rng })),
  );
  const lifecycleStage = weightedTransition(LIFECYCLE_TRANSITIONS[current.lifecycleStage], rng);

  return {
    revenueCents,
    revenueGrowth,
    earningsCents: Math.round((revenueCents * marginBps) / 10000),
    marginBps,
    lifecycleStage,
  };
}

export function reportedFinancialsFor(fundamentals: CompanyFundamentals, sharesOutstanding: number): ReportedFinancials {
  return {
    epsCents: sharesOutstanding > 0 ? Math.round(fundamentals.earningsCents / sharesOutstanding) : 0,
    revenueCents: fundamentals.revenueCents,
    marginBps: fundamentals.marginBps,
  };
}
