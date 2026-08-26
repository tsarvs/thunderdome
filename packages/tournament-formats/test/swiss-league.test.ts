import { runTournament, type MatchDescriptor, type MatchRecord, type RosterEntry } from '@thunderdome/engine';
import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { SwissLeagueConfigSchema, swissLeagueFormat } from '../src/swiss-league.js';

const rng = createRng(Buffer.alloc(16, 3));

function roster(...ids: string[]): RosterEntry[] {
  return ids.map((participantId) => ({ participantId }));
}

/** A full table result, Hearts-shaped: lower `score` is better, `rank` derived the same way
 * `card-game-hearts`'s own `getStandingOutcomes` computes it (1 + how many others scored lower). */
function tableRecord(match: MatchDescriptor, scoreByParticipant: Record<string, number>): MatchRecord {
  const scoreOf = (id: string) => scoreByParticipant[id] ?? 0;
  return {
    matchId: match.matchId,
    standingOutcomes: match.participantIds.map((participantId) => ({
      participantId,
      score: scoreOf(participantId),
      rank:
        1 +
        match.participantIds.filter((other) => scoreOf(other) < scoreOf(participantId)).length,
    })),
  };
}

describe('SwissLeagueConfigSchema', () => {
  it('accepts a valid config', () => {
    expect(SwissLeagueConfigSchema.safeParse({ tableSize: 4, rounds: 3 }).success).toBe(true);
  });

  it('rejects tableSize below 2', () => {
    expect(SwissLeagueConfigSchema.safeParse({ tableSize: 1, rounds: 3 }).success).toBe(false);
  });

  it.each([{ rounds: 0 }, { rounds: -1 }, { rounds: 1.5 }, {}])(
    'rejects invalid/missing rounds %j',
    (raw) => {
      expect(SwissLeagueConfigSchema.safeParse({ tableSize: 4, ...raw }).success).toBe(false);
    },
  );
});

describe('swissLeagueFormat.parseConfig', () => {
  it('wraps the schema in a Result', () => {
    expect(swissLeagueFormat.parseConfig({ tableSize: 4, rounds: 2 })).toEqual({
      ok: true,
      value: { tableSize: 4, rounds: 2 },
    });
    expect(swissLeagueFormat.parseConfig({ tableSize: 1, rounds: 2 }).ok).toBe(false);
  });
});

describe('swissLeagueFormat.initialize', () => {
  it('throws when the roster is smaller than tableSize', () => {
    expect(() =>
      swissLeagueFormat.initialize({ roster: roster('a', 'b'), config: { tableSize: 4, rounds: 1 }, rng }),
    ).toThrow('at least 4 participants');
  });

  it("throws when the roster isn't an exact multiple of tableSize", () => {
    expect(() =>
      swissLeagueFormat.initialize({
        roster: roster('a', 'b', 'c', 'd', 'e'),
        config: { tableSize: 4, rounds: 1 },
        rng,
      }),
    ).toThrow('exact multiple of tableSize');
  });

  it('builds one table per tableSize-sized group, covering every participant exactly once', () => {
    const { formatState, standings, readyMatches, notices } = swissLeagueFormat.initialize({
      roster: roster('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'),
      config: { tableSize: 4, rounds: 3 },
      rng,
    });

    expect(readyMatches).toHaveLength(2);
    const allSeated = readyMatches.flatMap((match) => match.participantIds);
    expect(new Set(allSeated)).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']));
    expect(allSeated).toHaveLength(8); // no duplicates, no omissions
    readyMatches.forEach((match) => {
      expect(match.participantIds).toHaveLength(4);
    });

    expect(formatState.tableSize).toBe(4);
    expect(formatState.totalRounds).toBe(3);
    expect(formatState.roundsCompleted).toBe(0);
    expect(formatState.tablesRemainingInRound).toBe(2);
    expect(Object.keys(formatState.tiebreakRank).sort()).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].sort(),
    );
    expect(new Set(Object.values(formatState.tiebreakRank))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));

    for (const id of allSeated) {
      expect(standings[id]).toEqual({ participantId: id, cumulativeScore: 0, tablesPlayed: 0, tablesWon: 0 });
    }
    expect(notices).toHaveLength(1);
  });
});

describe('swissLeagueFormat.recordResult', () => {
  it('withholds the next round until every table in the current round has reported', () => {
    const initial = swissLeagueFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { tableSize: 2, rounds: 2 },
      rng,
    });
    expect(initial.readyMatches).toHaveLength(2); // 2 tables of 2 in round 1

    const [table1, table2] = initial.readyMatches;
    if (table1 === undefined || table2 === undefined) {
      throw new Error('expected 2 ready tables');
    }

    const afterTable1 = swissLeagueFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: table1,
      record: tableRecord(table1, Object.fromEntries(table1.participantIds.map((id, i) => [id, i]))),
    });
    expect(afterTable1.readyMatches).toEqual([]); // table2 hasn't reported yet
    expect(afterTable1.formatState.tablesRemainingInRound).toBe(1);
    expect(afterTable1.formatState.roundsCompleted).toBe(0);

    const afterTable2 = swissLeagueFormat.recordResult({
      formatState: afterTable1.formatState,
      standings: afterTable1.standings,
      match: table2,
      record: tableRecord(table2, Object.fromEntries(table2.participantIds.map((id, i) => [id, i]))),
    });
    expect(afterTable2.readyMatches).toHaveLength(2); // round 2's tables unlocked
    expect(afterTable2.formatState.roundsCompleted).toBe(1);
    expect(afterTable2.formatState.tablesRemainingInRound).toBe(2);
    expect(new Set(afterTable2.readyMatches.flatMap((m) => m.participantIds))).toEqual(
      new Set(['a', 'b', 'c', 'd']),
    );
  });

  it('re-pairs the next round by ascending cumulative score (best scores grouped together)', () => {
    const initial = swissLeagueFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { tableSize: 2, rounds: 2 },
      rng,
    });
    const [table1, table2] = initial.readyMatches;
    if (table1 === undefined || table2 === undefined) {
      throw new Error('expected 2 ready tables');
    }

    // Every participant across both round-1 tables gets a distinct score, so round 2 pairing is
    // unambiguous: the 2 lowest scores must share a table, and the 2 highest must share the other.
    const globalScore: Record<string, number> = {};
    [...table1.participantIds, ...table2.participantIds].forEach((id, index) => {
      globalScore[id] = index * 10;
    });

    const afterTable1 = swissLeagueFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: table1,
      record: tableRecord(table1, globalScore),
    });
    const afterTable2 = swissLeagueFormat.recordResult({
      formatState: afterTable1.formatState,
      standings: afterTable1.standings,
      match: table2,
      record: tableRecord(table2, globalScore),
    });

    const scoreOf = (id: string) => globalScore[id] ?? 0;
    const sortedByScore = Object.keys(globalScore).sort((a, b) => scoreOf(a) - scoreOf(b));
    const bestTwo = new Set(sortedByScore.slice(0, 2));
    const worstTwo = new Set(sortedByScore.slice(2, 4));

    const round2Tables = afterTable2.readyMatches;
    expect(round2Tables).toHaveLength(2);
    const groupings = round2Tables.map((match) => new Set(match.participantIds));
    expect(groupings).toContainEqual(bestTwo);
    expect(groupings).toContainEqual(worstTwo);
  });

  it('is complete only once the configured round count has been played', () => {
    const initial = swissLeagueFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { tableSize: 4, rounds: 2 },
      rng,
    });
    const [table1] = initial.readyMatches;
    if (table1 === undefined) {
      throw new Error('expected a ready table');
    }

    const afterRound1 = swissLeagueFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: table1,
      record: tableRecord(table1, {}),
    });
    expect(swissLeagueFormat.isComplete(afterRound1)).toBe(false);
    expect(afterRound1.readyMatches).toHaveLength(1); // round 2's single table

    const [table2] = afterRound1.readyMatches;
    if (table2 === undefined) {
      throw new Error('expected round 2 table');
    }
    const afterRound2 = swissLeagueFormat.recordResult({
      formatState: afterRound1.formatState,
      standings: afterRound1.standings,
      match: table2,
      record: tableRecord(table2, {}),
    });
    expect(swissLeagueFormat.isComplete(afterRound2)).toBe(true);
    expect(afterRound2.readyMatches).toEqual([]);
  });
});

describe('swissLeagueFormat.getPublicStandings', () => {
  it('sorts by cumulative score asc, then tablesWon desc, then participantId asc', () => {
    const standings = {
      b: { participantId: 'b', cumulativeScore: 10, tablesPlayed: 2, tablesWon: 1 },
      a: { participantId: 'a', cumulativeScore: 5, tablesPlayed: 2, tablesWon: 2 },
      d: { participantId: 'd', cumulativeScore: 10, tablesPlayed: 2, tablesWon: 0 },
      c: { participantId: 'c', cumulativeScore: 20, tablesPlayed: 2, tablesWon: 0 },
    };

    expect(swissLeagueFormat.getPublicStandings(standings)).toEqual([
      standings.a,
      standings.b,
      standings.d,
      standings.c,
    ]);
  });
});

describe('swissLeagueFormat + runTournament (end to end)', () => {
  it('plays every round for every table and produces cumulative-score-ordered standings', async () => {
    const participantIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    // A fixed per-participant "how many points they take at any table" — deterministic and
    // participant-specific, so cumulative score after N rounds is directly n * rounds and the
    // final ordering is fully predictable regardless of how tables get shuffled/re-paired.
    const pointsTaken: Record<string, number> = Object.fromEntries(
      participantIds.map((id, index) => [id, index]),
    );
    let matchesRun = 0;

    const outcome = await runTournament({
      format: swissLeagueFormat,
      config: { tableSize: 4, rounds: 3 },
      roster: roster(...participantIds),
      rng,
      runMatch: (match) => {
        matchesRun += 1;
        return Promise.resolve(
          tableRecord(
            match,
            Object.fromEntries(match.participantIds.map((id) => [id, pointsTaken[id] ?? 0])),
          ),
        );
      },
    });

    expect(matchesRun).toBe(6); // 3 rounds x 2 tables of 4

    const publicStandings = swissLeagueFormat.getPublicStandings(outcome.standings) as {
      participantId: string;
      cumulativeScore: number;
    }[];
    expect(publicStandings.map((entry) => entry.participantId)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);
    for (const entry of publicStandings) {
      expect(entry.cumulativeScore).toBe((pointsTaken[entry.participantId] ?? 0) * 3);
    }
  });
});
