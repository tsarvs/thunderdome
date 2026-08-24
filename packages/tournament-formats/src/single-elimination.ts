// Single elimination — the format docs/adr/0006-tournament-format-abstraction.md, tournament
// author guide, and docs/architecture.md have all long pointed to as the validation exercise for
// the incremental pull model: unlike round robin (whose whole schedule is knowable up front),
// round N+1's pairings depend on round N's actual winners, so `initialize` can only ever return
// round 1, and `recordResult` genuinely has to unlock more as the bracket plays out.
//
// Seeding is a single seeded shuffle of the roster at `initialize` (reproducible given the
// tournament seed, same as round robin's pairing-order shuffle) — winners of round N then pair
// up in bracket order (winner of matchup 0 vs. winner of matchup 1, and so on) for round N+1, no
// re-shuffling. A non-power-of-two participant count means someone draws a bye each round: the
// last participant in that round's order advances automatically, without playing.
//
// Each matchup is itself a best-of-`bestOf` series (packages/tournament-formats/src/series.ts) —
// exactly like round robin's pairings — so it's bounded even if every match in it draws. Unlike
// round robin, though, a bracket matchup *must* produce someone to advance: if the series itself
// ends tied (every match drew, or the wins split evenly), the lower participantId (a plain string
// comparison) advances. This is a small, deliberate bias — not a coin flip — chosen so the
// decision is obvious from the code and reproducible without needing rng access inside
// `recordResult` (the `TournamentFormat` interface only ever hands `rng` to `initialize`).
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

export const SingleEliminationConfigSchema = z.object({
  /** Best of N matches per bracket matchup — see the module doc comment for the tiebreak rule
   * that applies if a series itself ends tied. Defaults to 1 (a single match per matchup). */
  bestOf: BestOfSchema,
});
export type SingleEliminationConfig = z.infer<typeof SingleEliminationConfigSchema>;

export interface SingleEliminationStandingsEntry {
  participantId: string;
  /** Null while still active in the bracket (including the eventual champion); set to the
   * 0-based round index they lost their matchup in, once eliminated. */
  eliminatedInRound: number | null;
  /** How many bracket matchups they've won so far — how many rounds they've survived. */
  matchupsWon: number;
}
export type SingleEliminationStandings = Record<string, SingleEliminationStandingsEntry>;

interface MatchupState {
  matchIndex: number;
  participantIds: [string, string];
  /** Decisive wins only, keyed by participantId — a drawn match increments neither. */
  wins: Record<string, number>;
  matchesPlayed: number;
}

export interface SingleEliminationFormatState {
  bestOf: number;
  roundIndex: number;
  /** This round's matchups, keyed by matchIndex. */
  matchups: Record<number, MatchupState>;
  totalMatchups: number;
  decidedMatchups: number;
  /** Winners feeding round `roundIndex + 1`, in bracket order — filled in as this round's
   * matchups decide; a bye's participant is pre-filled at the end of this array immediately. */
  nextRoundParticipants: (string | undefined)[];
  /** Set once the final matchup of the final round decides. */
  champion?: string;
}

function initialStandingsEntry(participantId: string): SingleEliminationStandingsEntry {
  return { participantId, eliminatedInRound: null, matchupsWon: 0 };
}

function participantsKey(participantIds: readonly string[]): string {
  return [...participantIds].sort().join('|');
}

/**
 * `gameNumber` (1-based) distinguishes repeat matches within one bracket slot's best-of-`bestOf`
 * series — without it, every match in a series would share one matchId, and since matchId feeds
 * both the match's own RNG seed and each bot's per-match seed (apps/cli/src/lib/match-execution.ts),
 * every game in the series would be seeded identically instead of independently.
 */
function matchIdFor(roundIndex: number, matchIndex: number, gameNumber: number): string {
  return `single-elimination-r${String(roundIndex + 1)}-m${String(matchIndex + 1)}-g${String(gameNumber)}`;
}

/** Who (if anyone) decisively won this one match, from its already-generic `standingOutcomes`. */
function decisiveWinnerOf(record: MatchRecord): string | undefined {
  return record.standingOutcomes.find((outcome) => outcome.outcome === 'win')?.participantId;
}

/** Pairs up bracket order consecutively (0v1, 2v3, ...); an odd participant out draws a bye. */
function pairRound(orderedIds: readonly string[]): {
  pairings: [string, string][];
  byeParticipantId: string | undefined;
} {
  const pairings: [string, string][] = [];
  let i = 0;
  for (; i + 1 < orderedIds.length; i += 2) {
    const a = orderedIds[i];
    const b = orderedIds[i + 1];
    if (a === undefined || b === undefined) {
      continue; // unreachable: i and i+1 are both < orderedIds.length by construction
    }
    pairings.push([a, b]);
  }
  return { pairings, byeParticipantId: orderedIds[i] };
}

interface BuiltRound {
  matchups: Record<number, MatchupState>;
  totalMatchups: number;
  readyMatches: MatchDescriptor[];
  nextRoundParticipants: (string | undefined)[];
  notices: string[];
}

function buildRound(roundIndex: number, orderedIds: readonly string[]): BuiltRound {
  const { pairings, byeParticipantId } = pairRound(orderedIds);
  const matchups: Record<number, MatchupState> = {};
  const readyMatches: MatchDescriptor[] = [];

  pairings.forEach(([a, b], matchIndex) => {
    matchups[matchIndex] = { matchIndex, participantIds: [a, b], wins: {}, matchesPlayed: 0 };
    readyMatches.push({
      matchId: matchIdFor(roundIndex, matchIndex, 1),
      participantIds: [a, b],
      round: roundIndex + 1,
    });
  });

  const nextRoundParticipants: (string | undefined)[] = pairings.map(() => undefined);
  const notices: string[] = [];
  if (byeParticipantId !== undefined) {
    nextRoundParticipants.push(byeParticipantId);
    notices.push(`${byeParticipantId} draws a bye in round ${String(roundIndex + 1)}`);
  }

  return { matchups, totalMatchups: pairings.length, readyMatches, nextRoundParticipants, notices };
}

export const singleEliminationFormat: TournamentFormat<
  SingleEliminationConfig,
  SingleEliminationFormatState,
  SingleEliminationStandings
> = {
  id: 'single-elimination',
  version: '1.0.0',

  parseConfig(raw: unknown): Result<SingleEliminationConfig> {
    const result = SingleEliminationConfigSchema.safeParse(raw);
    return result.success ? ok(result.data) : err(result.error.message);
  },

  initialize({ roster, config, rng }) {
    const participantIds = roster.map((entry) => entry.participantId);
    if (participantIds.length < 2) {
      throw new Error('single-elimination requires at least 2 participants');
    }

    const seeded = shuffle(participantIds, rng);
    const round = buildRound(0, seeded);

    const standings: SingleEliminationStandings = {};
    for (const id of participantIds) {
      standings[id] = initialStandingsEntry(id);
    }

    return {
      formatState: {
        bestOf: config.bestOf,
        roundIndex: 0,
        matchups: round.matchups,
        totalMatchups: round.totalMatchups,
        decidedMatchups: 0,
        nextRoundParticipants: round.nextRoundParticipants,
      },
      standings,
      readyMatches: round.readyMatches,
      notices: round.notices,
    };
  },

  recordResult({ formatState, standings, match, record }) {
    const key = participantsKey(match.participantIds);
    const matchup = Object.values(formatState.matchups).find(
      (candidate) => participantsKey(candidate.participantIds) === key,
    );
    if (!matchup) {
      throw new Error(`unreachable: no matchup state for match "${match.matchId}"`);
    }

    const winnerId = decisiveWinnerOf(record);
    const nextWins = { ...matchup.wins };
    if (winnerId !== undefined) {
      nextWins[winnerId] = (nextWins[winnerId] ?? 0) + 1;
    }
    const nextMatchup: MatchupState = {
      ...matchup,
      matchesPlayed: matchup.matchesPlayed + 1,
      wins: nextWins,
    };
    const nextMatchups = { ...formatState.matchups, [nextMatchup.matchIndex]: nextMatchup };

    const decided = isSeriesDecided(
      { wins: nextWins, matchesPlayed: nextMatchup.matchesPlayed },
      formatState.bestOf,
    );

    if (!decided) {
      return {
        formatState: { ...formatState, matchups: nextMatchups },
        standings,
        readyMatches: [
          {
            matchId: matchIdFor(
              formatState.roundIndex,
              nextMatchup.matchIndex,
              nextMatchup.matchesPlayed + 1,
            ),
            participantIds: nextMatchup.participantIds,
            round: formatState.roundIndex + 1,
          },
        ],
      };
    }

    // Decided — someone must advance, even if the series itself ended tied (see the module doc
    // comment's tiebreak rule).
    const [p1, p2] = nextMatchup.participantIds;
    const winsP1 = nextWins[p1] ?? 0;
    const winsP2 = nextWins[p2] ?? 0;
    const advancing = winsP1 === winsP2 ? (p1 < p2 ? p1 : p2) : winsP1 > winsP2 ? p1 : p2;
    const eliminated = advancing === p1 ? p2 : p1;

    const nextStandings: SingleEliminationStandings = {
      ...standings,
      [advancing]: {
        ...(standings[advancing] ?? initialStandingsEntry(advancing)),
        matchupsWon: (standings[advancing]?.matchupsWon ?? 0) + 1,
      },
      [eliminated]: {
        ...(standings[eliminated] ?? initialStandingsEntry(eliminated)),
        eliminatedInRound: formatState.roundIndex,
      },
    };

    const nextRoundParticipants = [...formatState.nextRoundParticipants];
    nextRoundParticipants[nextMatchup.matchIndex] = advancing;
    const decidedMatchups = formatState.decidedMatchups + 1;

    if (decidedMatchups < formatState.totalMatchups) {
      // This round has other matchups still in flight — nothing more to unlock right now.
      return {
        formatState: {
          ...formatState,
          matchups: nextMatchups,
          decidedMatchups,
          nextRoundParticipants,
        },
        standings: nextStandings,
        readyMatches: [],
      };
    }

    // The whole round just finished.
    const advancingIds = nextRoundParticipants.filter((id): id is string => id !== undefined);
    const champion = advancingIds[0];
    if (advancingIds.length === 1 && champion !== undefined) {
      return {
        formatState: {
          ...formatState,
          matchups: nextMatchups,
          decidedMatchups,
          nextRoundParticipants,
          champion,
        },
        standings: nextStandings,
        readyMatches: [],
      };
    }

    const nextRound = buildRound(formatState.roundIndex + 1, advancingIds);
    return {
      formatState: {
        bestOf: formatState.bestOf,
        roundIndex: formatState.roundIndex + 1,
        matchups: nextRound.matchups,
        totalMatchups: nextRound.totalMatchups,
        decidedMatchups: 0,
        nextRoundParticipants: nextRound.nextRoundParticipants,
      },
      standings: nextStandings,
      readyMatches: nextRound.readyMatches,
      notices: nextRound.notices,
    };
  },

  isComplete({ formatState }) {
    return formatState.champion !== undefined;
  },

  getPublicStandings(standings) {
    return Object.values(standings).sort((a, b) => {
      // Still active (including the champion) ranks ahead of anyone eliminated; among the
      // eliminated, surviving to a later round means a better placement.
      const aRank = a.eliminatedInRound ?? Infinity;
      const bRank = b.eliminatedInRound ?? Infinity;
      return bRank - aRank || a.participantId.localeCompare(b.participantId);
    });
  },
};
