// Swiss league (docs/adr/0006-tournament-format-abstraction.md's Swiss example, made concrete):
// unlike round robin and single elimination — both hardcoded to 2-participant matchups — this
// format plays N-participant tables (e.g. Hearts' 4-player hand), grouping participants into each
// round's tables by their current cumulative score, and ranks the whole tournament by cumulative
// score rather than a single win/loss/draw per match. That's the point: a single table's result
// (one Hearts hand's worth of variance — a forced Q♠ swallow, a bad deal) is too noisy to be a
// fair read on a bot on its own, so this format is built to average many tables together instead
// of deciding anything from one.
import {
  err,
  ok,
  type MatchDescriptor,
  type Result,
  type StandingOutcome,
  type TournamentFormat,
} from '@thunderdome/engine';
import { z } from 'zod';
import { shuffle } from './series.js';

export const SwissLeagueConfigSchema = z.object({
  /** Participants per table. No default — the caller (apps/cli/src/commands/tournament.ts)
   * defaults this from the resolved game's manifest (`minParticipants`) when it's unambiguous,
   * since a format itself never sees the game manifest — `TournamentFormatInitializeArgs` only
   * carries `roster`/`config`/`rng`. */
  tableSize: z.number().int().min(2),
  /** How many rounds to play. Required, not defaulted — unlike round-robin's `bestOf` (which
   * bounds one pairing's own series), this directly determines the whole tournament's total match
   * count, worth the caller stating explicitly rather than silently picking a number. */
  rounds: z.number().int().positive(),
});
export type SwissLeagueConfig = z.infer<typeof SwissLeagueConfigSchema>;

export interface SwissLeagueStandingsEntry {
  participantId: string;
  /** Sum of `StandingOutcome.score` across every table played — lower is better, matching Hearts'
   * own scoring. A table whose synthesized result carries no score (e.g. a forfeit) contributes 0
   * rather than inflating either side. */
  cumulativeScore: number;
  tablesPlayed: number;
  /** Count of tables where this participant finished `rank === 1` — not `outcome === 'win'`,
   * since a shared best score (a genuine Hearts tie, or every survivor of a forfeit) still counts
   * as "did well there," matching the ambiguity the engine itself already accepts for
   * more-than-2-participant results (see `synthesizeForfeitStandings`). */
  tablesWon: number;
}
export type SwissLeagueStandings = Record<string, SwissLeagueStandingsEntry>;

export interface SwissLeagueFormatState {
  tableSize: number;
  totalRounds: number;
  roundsCompleted: number;
  /** How many of the current round's tables haven't reported a result yet — the next round's
   * tables are only built (and emitted as `readyMatches`) once this reaches 0, matching ADR-0006's
   * description of Swiss "withholding `readyMatches` until a full round is in." */
  tablesRemainingInRound: number;
  /** Fixed full roster — needed every round to re-pair from current standings. */
  participantIds: string[];
  /** A random permutation index per participant, drawn once from `initialize`'s `rng` via
   * `shuffle`. `recordResult` gets no `rng` of its own (only `initialize` does), so this is what
   * lets every round's tiebreak — including round 1, where everyone is tied at 0 — stay
   * deterministic from the tournament seed without needing further randomness later. */
  tiebreakRank: Record<string, number>;
}

function initialStandingsEntry(participantId: string): SwissLeagueStandingsEntry {
  return { participantId, cumulativeScore: 0, tablesPlayed: 0, tablesWon: 0 };
}

/** Sorts the roster by (cumulative score ascending, tiebreak ascending) and chunks it into
 * consecutive `tableSize` groups — classic Swiss "score bracket" pairing. Used for every round,
 * including round 1 (where every score is 0, so the tiebreak alone decides the grouping). */
function buildRoundTables(args: {
  round: number;
  participantIds: readonly string[];
  standings: SwissLeagueStandings;
  tiebreakRank: Record<string, number>;
  tableSize: number;
}): MatchDescriptor[] {
  const { round, participantIds, standings, tiebreakRank, tableSize } = args;
  const sorted = [...participantIds].sort((a, b) => {
    const scoreDiff =
      (standings[a]?.cumulativeScore ?? 0) - (standings[b]?.cumulativeScore ?? 0);
    return scoreDiff !== 0 ? scoreDiff : (tiebreakRank[a] ?? 0) - (tiebreakRank[b] ?? 0);
  });

  const tables: MatchDescriptor[] = [];
  for (let i = 0; i < sorted.length; i += tableSize) {
    tables.push({
      matchId: `swiss-league-r${String(round)}-t${String(tables.length + 1)}`,
      participantIds: sorted.slice(i, i + tableSize),
      round,
    });
  }
  return tables;
}

function applyMatchStandings(
  standings: SwissLeagueStandings,
  outcomes: readonly StandingOutcome[],
): SwissLeagueStandings {
  let next = standings;
  for (const outcome of outcomes) {
    const existing = next[outcome.participantId] ?? initialStandingsEntry(outcome.participantId);
    next = {
      ...next,
      [outcome.participantId]: {
        ...existing,
        cumulativeScore: existing.cumulativeScore + (outcome.score ?? 0),
        tablesPlayed: existing.tablesPlayed + 1,
        tablesWon: existing.tablesWon + (outcome.rank === 1 ? 1 : 0),
      },
    };
  }
  return next;
}

export const swissLeagueFormat: TournamentFormat<
  SwissLeagueConfig,
  SwissLeagueFormatState,
  SwissLeagueStandings
> = {
  id: 'swiss-league',
  version: '1.0.0',

  parseConfig(raw: unknown): Result<SwissLeagueConfig> {
    const result = SwissLeagueConfigSchema.safeParse(raw);
    return result.success ? ok(result.data) : err(result.error.message);
  },

  initialize({ roster, config, rng }) {
    const participantIds = roster.map((entry) => entry.participantId);
    if (participantIds.length < config.tableSize) {
      throw new Error(
        `swiss-league requires at least ${String(config.tableSize)} participants (tableSize), got ${String(participantIds.length)}`,
      );
    }
    if (participantIds.length % config.tableSize !== 0) {
      throw new Error(
        `swiss-league requires a roster size that's an exact multiple of tableSize (${String(config.tableSize)}), got ${String(participantIds.length)}`,
      );
    }

    const tiebreakRank: Record<string, number> = {};
    shuffle(participantIds, rng).forEach((id, index) => {
      tiebreakRank[id] = index;
    });

    const standings: SwissLeagueStandings = {};
    for (const id of participantIds) {
      standings[id] = initialStandingsEntry(id);
    }

    const readyMatches = buildRoundTables({
      round: 1,
      participantIds,
      standings,
      tiebreakRank,
      tableSize: config.tableSize,
    });

    return {
      formatState: {
        tableSize: config.tableSize,
        totalRounds: config.rounds,
        roundsCompleted: 0,
        tablesRemainingInRound: readyMatches.length,
        participantIds,
        tiebreakRank,
      },
      standings,
      readyMatches,
      notices: [
        `swiss-league: ${String(config.rounds)} round(s), ${String(readyMatches.length)} table(s) of ${String(config.tableSize)} each round`,
      ],
    };
  },

  recordResult({ formatState, standings, record }) {
    const nextStandings = applyMatchStandings(standings, record.standingOutcomes);
    const tablesRemainingInRound = formatState.tablesRemainingInRound - 1;

    if (tablesRemainingInRound > 0) {
      return {
        formatState: { ...formatState, tablesRemainingInRound },
        standings: nextStandings,
        readyMatches: [],
      };
    }

    const roundsCompleted = formatState.roundsCompleted + 1;
    if (roundsCompleted >= formatState.totalRounds) {
      return {
        formatState: { ...formatState, roundsCompleted, tablesRemainingInRound: 0 },
        standings: nextStandings,
        readyMatches: [],
      };
    }

    const readyMatches = buildRoundTables({
      round: roundsCompleted + 1,
      participantIds: formatState.participantIds,
      standings: nextStandings,
      tiebreakRank: formatState.tiebreakRank,
      tableSize: formatState.tableSize,
    });

    return {
      formatState: {
        ...formatState,
        roundsCompleted,
        tablesRemainingInRound: readyMatches.length,
      },
      standings: nextStandings,
      readyMatches,
    };
  },

  isComplete({ formatState }) {
    return formatState.roundsCompleted >= formatState.totalRounds;
  },

  getPublicStandings(standings) {
    return Object.values(standings).sort(
      (a, b) =>
        a.cumulativeScore - b.cumulativeScore ||
        b.tablesWon - a.tablesWon ||
        a.participantId.localeCompare(b.participantId),
    );
  },
};
