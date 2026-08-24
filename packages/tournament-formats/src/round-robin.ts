// Round robin (docs/adr/0006-tournament-format-abstraction.md's "degenerate case" of the
// incremental pull model): every unique pairing plays a best-of-`bestOf` series of matches,
// stopping early once either side reaches a majority of that pairing's decisive wins.
//
// This is deliberately unlike the per-*round* "first to a majority" design RPS itself used to
// have (and was removed from — see games/rock-paper-scissors/src/types.ts and
// docs/adr/0003-docker-bot-isolation.md's match-timeout note): a *round* inside one RPS match can
// draw forever with no bound in sight, which is exactly what could hang. A *match* between two
// bots is never like that — every match is already bounded by the game's own rules (RPS plays
// exactly `totalRounds` hands, then stops, full stop) — so "play up to N matches, stop once
// someone's ahead" here can never hang: each of the (at most `bestOf`) matches it runs is itself
// guaranteed to finish.
import {
  err,
  ok,
  type MatchDescriptor,
  type MatchRecord,
  type Result,
  type TournamentFormat,
} from '@thunderdome/engine';
import { z } from 'zod';
import { BestOfSchema, isSeriesDecided, shuffle } from './series.js';

export const RoundRobinConfigSchema = z.object({
  /**
   * Best of N matches per pairing (must be odd) — the pairing stops as soon as either bot reaches
   * a majority of decisive match wins, or once N matches have been played, whichever comes
   * first. A match that itself ends in a genuine tie (a real RPS outcome, not a cop-out) counts
   * toward N but not toward either side's win tally — so it's possible for a pairing to still be
   * undecided (or even end tied) after all N matches, if enough of them drew. Defaults to 1 (a
   * single match per pairing), matching the simplest possible round robin.
   */
  bestOf: BestOfSchema,
});
export type RoundRobinConfig = z.infer<typeof RoundRobinConfigSchema>;

export interface RoundRobinStandingsEntry {
  participantId: string;
  wins: number;
  losses: number;
  draws: number;
  /** 1 point per win, 0.5 per draw, 0 per loss — the sort key `getPublicStandings` ranks by. */
  points: number;
  matchesPlayed: number;
}
export type RoundRobinStandings = Record<string, RoundRobinStandingsEntry>;

interface PairingState {
  /** Stable per-pairing index, used to keep this pairing's matchIds consistent across instances. */
  index: number;
  participantIds: [string, string];
  matchesPlayed: number;
  /** Decisive wins only, keyed by participantId — a drawn match increments neither. */
  wins: Record<string, number>;
}

export interface RoundRobinFormatState {
  bestOf: number;
  /** Keyed by a stable, order-independent pairing key (see `pairingKey`). */
  pairings: Record<string, PairingState>;
  totalPairings: number;
  decidedPairings: number;
}

function initialStandingsEntry(participantId: string): RoundRobinStandingsEntry {
  return { participantId, wins: 0, losses: 0, draws: 0, points: 0, matchesPlayed: 0 };
}

function pairingKey(participantIds: readonly string[]): string {
  return [...participantIds].sort().join('|');
}

/** Every unique 2-participant pairing, exactly once — e.g. for [a, b, c]: a-vs-b, a-vs-c, b-vs-c. */
function generatePairings(participantIds: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < participantIds.length; i += 1) {
    const a = participantIds[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < participantIds.length; j += 1) {
      const b = participantIds[j];
      if (b === undefined) {
        continue;
      }
      pairs.push([a, b]);
    }
  }
  return pairs;
}

function matchIdFor(pairing: PairingState): string {
  return `round-robin-${String(pairing.index + 1)}-${String(pairing.matchesPlayed + 1)}`;
}

/** Who (if anyone) decisively won this one match, from its already-generic `standingOutcomes`. */
function decisiveWinnerOf(record: MatchRecord): string | undefined {
  return record.standingOutcomes.find((outcome) => outcome.outcome === 'win')?.participantId;
}

function applyOutcome(
  standings: RoundRobinStandings,
  participantId: string,
  kind: 'win' | 'loss' | 'draw',
): RoundRobinStandings {
  const existing = standings[participantId] ?? initialStandingsEntry(participantId);
  return {
    ...standings,
    [participantId]: {
      ...existing,
      wins: existing.wins + (kind === 'win' ? 1 : 0),
      losses: existing.losses + (kind === 'loss' ? 1 : 0),
      draws: existing.draws + (kind === 'draw' ? 1 : 0),
      points: existing.points + (kind === 'win' ? 1 : kind === 'draw' ? 0.5 : 0),
      matchesPlayed: existing.matchesPlayed + 1,
    },
  };
}

/** Tallies one now-decided pairing's overall result into the tournament-wide standings, once. */
function applyPairingResult(
  standings: RoundRobinStandings,
  pairing: PairingState,
): RoundRobinStandings {
  const [a, b] = pairing.participantIds;
  const winsA = pairing.wins[a] ?? 0;
  const winsB = pairing.wins[b] ?? 0;
  if (winsA === winsB) {
    return applyOutcome(applyOutcome(standings, a, 'draw'), b, 'draw');
  }
  const winner = winsA > winsB ? a : b;
  const loser = winsA > winsB ? b : a;
  return applyOutcome(applyOutcome(standings, winner, 'win'), loser, 'loss');
}

export const roundRobinFormat: TournamentFormat<
  RoundRobinConfig,
  RoundRobinFormatState,
  RoundRobinStandings
> = {
  id: 'round-robin',
  version: '2.0.0',

  parseConfig(raw: unknown): Result<RoundRobinConfig> {
    const result = RoundRobinConfigSchema.safeParse(raw);
    return result.success ? ok(result.data) : err(result.error.message);
  },

  initialize({ roster, config, rng }) {
    const participantIds = roster.map((entry) => entry.participantId);
    if (participantIds.length < 2) {
      throw new Error('round-robin requires at least 2 participants');
    }

    const shuffledPairs = shuffle(generatePairings(participantIds), rng);
    const pairings: Record<string, PairingState> = {};
    const readyMatches: MatchDescriptor[] = [];

    shuffledPairs.forEach(([a, b], index) => {
      const pairing: PairingState = { index, participantIds: [a, b], matchesPlayed: 0, wins: {} };
      pairings[pairingKey([a, b])] = pairing;
      readyMatches.push({ matchId: matchIdFor(pairing), participantIds: [a, b], round: 1 });
    });

    const standings: RoundRobinStandings = {};
    for (const id of participantIds) {
      standings[id] = initialStandingsEntry(id);
    }

    return {
      formatState: {
        bestOf: config.bestOf,
        pairings,
        totalPairings: shuffledPairs.length,
        decidedPairings: 0,
      },
      standings,
      readyMatches,
    };
  },

  recordResult({ formatState, standings, match, record }) {
    const key = pairingKey(match.participantIds);
    const pairing = formatState.pairings[key];
    if (!pairing) {
      throw new Error(`unreachable: no pairing state for match "${match.matchId}"`);
    }

    const winnerId = decisiveWinnerOf(record);
    const nextWins = { ...pairing.wins };
    if (winnerId !== undefined) {
      nextWins[winnerId] = (nextWins[winnerId] ?? 0) + 1;
    }
    const nextPairing: PairingState = {
      ...pairing,
      matchesPlayed: pairing.matchesPlayed + 1,
      wins: nextWins,
    };

    const decided = isSeriesDecided(
      { wins: nextWins, matchesPlayed: nextPairing.matchesPlayed },
      formatState.bestOf,
    );

    const nextPairings = { ...formatState.pairings, [key]: nextPairing };
    const readyMatches: MatchDescriptor[] = decided
      ? []
      : [
          {
            matchId: matchIdFor(nextPairing),
            participantIds: nextPairing.participantIds,
            round: nextPairing.matchesPlayed + 1,
          },
        ];

    return {
      formatState: {
        ...formatState,
        pairings: nextPairings,
        decidedPairings: formatState.decidedPairings + (decided ? 1 : 0),
      },
      standings: decided ? applyPairingResult(standings, nextPairing) : standings,
      readyMatches,
    };
  },

  isComplete({ formatState }) {
    return formatState.decidedPairings >= formatState.totalPairings;
  },

  getPublicStandings(standings) {
    return Object.values(standings).sort(
      (a, b) =>
        b.points - a.points || b.wins - a.wins || a.participantId.localeCompare(b.participantId),
    );
  },
};
