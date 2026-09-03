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

/** What `getPublicStandings` actually projects — `averageScore` only makes sense as a ranking
 * key once sit-outs can make `tablesPlayed` vary across participants (see its own doc below), so
 * it's computed here rather than stored on the internal `SwissLeagueStandingsEntry`. */
export interface SwissLeaguePublicStandingsEntry extends SwissLeagueStandingsEntry {
  averageScore: number;
}

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
  /** How many rounds each participant has sat out so far — when the roster doesn't divide evenly
   * into tables, `roster.length % tableSize` participants sit out each round, chosen by fewest
   * sit-outs so far (ties broken by `tiebreakRank`). Always 0 for everyone when the roster does
   * divide evenly. */
  sitOutCount: Record<string, number>;
}

function initialStandingsEntry(participantId: string): SwissLeagueStandingsEntry {
  return { participantId, cumulativeScore: 0, tablesPlayed: 0, tablesWon: 0 };
}

/** The `count` participants who've sat out the fewest rounds so far (ties broken by
 * `tiebreakRank`) — repeated every round, this converges to a perfectly even rotation: with N=5,
 * tableSize=4 (1 sit-out/round), sit-outs cycle every participant exactly once every 5 rounds. */
function chooseSitOuts(
  participantIds: readonly string[],
  sitOutCount: Record<string, number>,
  tiebreakRank: Record<string, number>,
  count: number,
): string[] {
  if (count <= 0) {
    return [];
  }
  return [...participantIds]
    .sort((a, b) => {
      const sitOutDiff = (sitOutCount[a] ?? 0) - (sitOutCount[b] ?? 0);
      return sitOutDiff !== 0 ? sitOutDiff : (tiebreakRank[a] ?? 0) - (tiebreakRank[b] ?? 0);
    })
    .slice(0, count);
}

/** Sits out however many participants don't divide evenly into `tableSize` (fewest sit-outs so
 * far first), then sorts the rest by (cumulative score ascending, tiebreak ascending) and chunks
 * them into consecutive `tableSize` groups — classic Swiss "score bracket" pairing. Used for
 * every round, including round 1 (where every score is 0, so the tiebreak alone decides both the
 * sit-out choice and the grouping). */
function buildRoundTables(args: {
  round: number;
  participantIds: readonly string[];
  standings: SwissLeagueStandings;
  tiebreakRank: Record<string, number>;
  sitOutCount: Record<string, number>;
  tableSize: number;
}): { tables: MatchDescriptor[]; sitOuts: string[] } {
  const { round, participantIds, standings, tiebreakRank, sitOutCount, tableSize } = args;

  const sitOuts = chooseSitOuts(
    participantIds,
    sitOutCount,
    tiebreakRank,
    participantIds.length % tableSize,
  );
  const sitOutSet = new Set(sitOuts);
  const active = participantIds.filter((id) => !sitOutSet.has(id));

  const sorted = active.sort((a, b) => {
    const scoreDiff = (standings[a]?.cumulativeScore ?? 0) - (standings[b]?.cumulativeScore ?? 0);
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
  return { tables, sitOuts };
}

function nextSitOutCount(
  current: Record<string, number>,
  sitOuts: readonly string[],
): Record<string, number> {
  const next = { ...current };
  for (const id of sitOuts) {
    next[id] = (next[id] ?? 0) + 1;
  }
  return next;
}

function sitOutNotice(round: number, sitOuts: readonly string[]): string[] {
  return sitOuts.length > 0 ? [`Round ${String(round)}: ${sitOuts.join(', ')} sits out`] : [];
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
  version: '1.1.0',

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

    const tiebreakRank: Record<string, number> = {};
    shuffle(participantIds, rng).forEach((id, index) => {
      tiebreakRank[id] = index;
    });

    const standings: SwissLeagueStandings = {};
    for (const id of participantIds) {
      standings[id] = initialStandingsEntry(id);
    }

    const sitOutCount: Record<string, number> = {};
    const { tables: readyMatches, sitOuts } = buildRoundTables({
      round: 1,
      participantIds,
      standings,
      tiebreakRank,
      sitOutCount,
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
        sitOutCount: nextSitOutCount(sitOutCount, sitOuts),
      },
      standings,
      readyMatches,
      notices: [
        `swiss-league: ${String(config.rounds)} round(s), ${String(readyMatches.length)} table(s) of ${String(config.tableSize)} each round`,
        ...sitOutNotice(1, sitOuts),
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

    const nextRound = roundsCompleted + 1;
    const { tables: readyMatches, sitOuts } = buildRoundTables({
      round: nextRound,
      participantIds: formatState.participantIds,
      standings: nextStandings,
      tiebreakRank: formatState.tiebreakRank,
      sitOutCount: formatState.sitOutCount,
      tableSize: formatState.tableSize,
    });

    return {
      formatState: {
        ...formatState,
        roundsCompleted,
        tablesRemainingInRound: readyMatches.length,
        sitOutCount: nextSitOutCount(formatState.sitOutCount, sitOuts),
      },
      standings: nextStandings,
      readyMatches,
      notices: sitOutNotice(nextRound, sitOuts),
    };
  },

  isComplete({ formatState }) {
    return formatState.roundsCompleted >= formatState.totalRounds;
  },

  getPublicStandings(standings) {
    return Object.values(standings)
      .map((entry): SwissLeaguePublicStandingsEntry => ({
        ...entry,
        // A participant who never got seated (only possible with a very short tournament) sorts
        // last, not tied-for-best-at-0 — Infinity is never actually "the best average."
        averageScore:
          entry.tablesPlayed > 0 ? entry.cumulativeScore / entry.tablesPlayed : Infinity,
      }))
      .sort(
        (a, b) =>
          a.averageScore - b.averageScore ||
          b.tablesWon - a.tablesWon ||
          a.participantId.localeCompare(b.participantId),
      );
  },
};
