// Shared by every format that plays a best-of-N series per matchup (round robin today, single
// elimination too) — the "majority of decisive wins, or bestOf matches played, whichever comes
// first" decision is identical regardless of what structure sits around the matchup (a flat
// pairing vs. a bracket slot), so it's factored out here instead of copy-pasted per format.
import type { Rng } from '@thunderdome/engine';
import { z } from 'zod';

/** Fisher-Yates, using the format's own seeded `rng` — reproducible given the same tournament seed. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) {
      continue; // unreachable: i and j are both < shuffled.length by construction
    }
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
}

export const BestOfSchema = z
  .number()
  .int()
  .positive()
  .default(1)
  .refine((n) => n % 2 === 1, 'bestOf must be odd');

export interface SeriesProgress {
  /** Decisive wins only, keyed by participantId — a drawn match increments neither. */
  wins: Record<string, number>;
  matchesPlayed: number;
}

/** True once either side has a majority of `bestOf`'s decisive wins, or `bestOf` matches have
 * been played (whichever comes first) — the latter is what guarantees a series can never hang
 * even if every match in it draws. */
export function isSeriesDecided(progress: SeriesProgress, bestOf: number): boolean {
  const majorityTarget = Math.ceil(bestOf / 2);
  const leaderWins = Math.max(0, ...Object.values(progress.wins));
  return leaderWins >= majorityTarget || progress.matchesPlayed >= bestOf;
}
