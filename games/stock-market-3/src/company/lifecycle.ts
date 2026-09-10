import type { Rng } from '@thunderdome/engine';
import { toDollars } from '../money.js';
import type { ScheduledCorporateAction, SecurityState } from '../types.js';

/** Lead time between an acquisition/delisting announcement and it actually taking effect (spec
 * §40/§42) — itself public the moment it's announced (see `CorporateActionEvent`/`ScheduledCorporateAction`
 * doc comments in types.ts), so a bot gets real advance notice, not just a surprise removal. */
const ANNOUNCEMENT_LEAD_ROUNDS = 5;

/** Deliberately rare — over a ~500-round match, roughly 1-2 of the 9 default equities might get
 * acquired. This is intentionally simple (spec §42 explicitly doesn't ask for sophisticated
 * mechanics): a single random per-round check per active equity, no market-cap/valuation model
 * behind it. */
const ACQUISITION_PROBABILITY_PER_ROUND = 1 / 3000;
/** Only rolled for a company already in DECLINE whose price has fallen a long way from where it
 * started — delisting is a consequence of sustained deterioration, not a bolt from nowhere. */
const DELISTING_PROBABILITY_PER_ROUND = 1 / 1500;
const DELISTING_PRICE_FLOOR_FRACTION = 0.3;

export function maybeAnnounceAcquisition(
  security: SecurityState,
  _startingPriceCents: number,
  round: number,
  rng: Rng,
): ScheduledCorporateAction | null {
  if (security.kind !== 'EQUITY' || !security.active) {
    return null;
  }
  if (rng.nextFloat() >= ACQUISITION_PROBABILITY_PER_ROUND) {
    return null;
  }
  const premium = 1.2 + rng.nextFloat() * 0.2;
  return {
    symbol: security.symbol,
    type: 'ACQUISITION',
    announcedRound: round,
    effectiveRound: round + ANNOUNCEMENT_LEAD_ROUNDS,
    cashPerShareCents: Math.round(security.referencePriceCents * premium),
    reason: `${security.symbol} agreed to be acquired at a ${String(Math.round((premium - 1) * 100))}% premium to the last close.`,
    applied: false,
  };
}

export function maybeAnnounceDelisting(
  security: SecurityState,
  startingPriceCents: number,
  round: number,
  rng: Rng,
): ScheduledCorporateAction | null {
  if (
    security.kind !== 'EQUITY' ||
    !security.active ||
    security.fundamentals?.lifecycleStage !== 'DECLINE' ||
    security.referencePriceCents >= startingPriceCents * DELISTING_PRICE_FLOOR_FRACTION
  ) {
    return null;
  }
  if (rng.nextFloat() >= DELISTING_PROBABILITY_PER_ROUND) {
    return null;
  }
  return {
    symbol: security.symbol,
    type: 'DELISTING',
    announcedRound: round,
    effectiveRound: round + ANNOUNCEMENT_LEAD_ROUNDS,
    cashPerShareCents: security.referencePriceCents,
    reason: `${security.symbol} will be delisted following sustained deterioration (last close $${toDollars(security.referencePriceCents).toFixed(2)}).`,
    applied: false,
  };
}
