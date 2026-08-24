import { runTournament, type MatchDescriptor, type RosterEntry } from '@thunderdome/engine';
import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import {
  SingleEliminationConfigSchema,
  singleEliminationFormat,
  type SingleEliminationFormatState,
  type SingleEliminationStandings,
} from '../src/single-elimination.js';

const rng = createRng(Buffer.alloc(16, 3));

function roster(...ids: string[]): RosterEntry[] {
  return ids.map((participantId) => ({ participantId }));
}

/** A decisive result: `winnerId` wins, the other participant in `match` loses. */
function decisiveRecord(match: MatchDescriptor, winnerId: string) {
  const [p1, p2] = match.participantIds;
  const loserId = winnerId === p1 ? p2 : p1;
  return {
    matchId: match.matchId,
    standingOutcomes: [
      { participantId: winnerId, rank: 1, outcome: 'win' as const },
      ...(loserId !== undefined
        ? [{ participantId: loserId, rank: 2, outcome: 'loss' as const }]
        : []),
    ],
  };
}

/** A drawn result: every participant in `match` ties. */
function drawnRecord(match: MatchDescriptor) {
  return {
    matchId: match.matchId,
    standingOutcomes: match.participantIds.map((participantId) => ({
      participantId,
      rank: 1,
      outcome: 'draw' as const,
    })),
  };
}

describe('SingleEliminationConfigSchema', () => {
  it('defaults bestOf to 1 when omitted', () => {
    const result = SingleEliminationConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data.bestOf).toBe(1);
  });

  it.each([{ bestOf: 2 }, { bestOf: 0 }, { bestOf: -1 }])('rejects invalid bestOf %j', (raw) => {
    expect(SingleEliminationConfigSchema.safeParse(raw).success).toBe(false);
  });
});

describe('singleEliminationFormat.parseConfig', () => {
  it('wraps the schema in a Result', () => {
    expect(singleEliminationFormat.parseConfig({ bestOf: 3 })).toEqual({
      ok: true,
      value: { bestOf: 3 },
    });
    expect(singleEliminationFormat.parseConfig({ bestOf: 2 }).ok).toBe(false);
  });
});

describe('singleEliminationFormat.initialize', () => {
  it('pairs a power-of-two roster into round 1 with no bye', () => {
    const { formatState, standings, readyMatches } = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { bestOf: 1 },
      rng,
    });

    expect(readyMatches).toHaveLength(2);
    expect(formatState.roundIndex).toBe(0);
    expect(formatState.totalMatchups).toBe(2);
    expect(formatState.decidedMatchups).toBe(0);
    expect(formatState.nextRoundParticipants).toEqual([undefined, undefined]);
    expect(Object.keys(standings).sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const entry of Object.values(standings)) {
      expect(entry).toMatchObject({ eliminatedInRound: null, matchupsWon: 0 });
    }
  });

  it('gives the odd participant out a bye instead of a match, and reports it as a notice', () => {
    const { formatState, readyMatches, notices } = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c'),
      config: { bestOf: 1 },
      rng,
    });

    expect(readyMatches).toHaveLength(1); // only one real matchup; the 3rd participant sits out
    expect(formatState.totalMatchups).toBe(1);
    // the bye slot is pre-filled at the end of nextRoundParticipants, ahead of any match deciding
    expect(formatState.nextRoundParticipants).toHaveLength(2);
    const byeId = formatState.nextRoundParticipants[1];
    if (byeId === undefined) {
      throw new Error('expected a bye participant');
    }
    expect(notices).toEqual([`${byeId} draws a bye in round 1`]);
  });

  it('reports no bye notice for a power-of-two roster', () => {
    const { notices } = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { bestOf: 1 },
      rng,
    });

    expect(notices).toEqual([]);
  });

  it('throws for a roster with fewer than 2 participants', () => {
    expect(() =>
      singleEliminationFormat.initialize({ roster: roster('a'), config: { bestOf: 1 }, rng }),
    ).toThrow('at least 2 participants');
  });
});

describe('singleEliminationFormat.recordResult', () => {
  it('bestOf 1: a 4-participant bracket plays exactly 2 rounds (2 + 1 matchups) to a champion', () => {
    const initial = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c', 'd'),
      config: { bestOf: 1 },
      rng,
    });

    let formatState = initial.formatState;
    let standings = initial.standings;
    const queue = [...initial.readyMatches];
    let matchesRun = 0;

    while (queue.length > 0 && !singleEliminationFormat.isComplete({ formatState, standings })) {
      const match = queue.shift();
      if (match === undefined) {
        break;
      }
      matchesRun += 1;
      const [winnerId] = match.participantIds; // first participant always wins, for a clean trace
      if (winnerId === undefined) {
        throw new Error('expected 2 participants');
      }
      const next = singleEliminationFormat.recordResult({
        formatState,
        standings,
        match,
        record: decisiveRecord(match, winnerId),
      });
      formatState = next.formatState;
      standings = next.standings;
      queue.push(...next.readyMatches);
    }

    expect(matchesRun).toBe(3); // 2 round-1 matchups + 1 final, never more
    expect(singleEliminationFormat.isComplete({ formatState, standings })).toBe(true);
    expect(formatState.champion).toBeDefined();
    const champion = formatState.champion;
    expect(champion).not.toBeUndefined();
    if (champion !== undefined) {
      expect(standings[champion]).toMatchObject({ eliminatedInRound: null, matchupsWon: 2 });
    }
    // every non-champion is eliminated in round 0 or round 1, never left dangling
    for (const [id, entry] of Object.entries(standings)) {
      if (id !== champion) {
        expect(entry.eliminatedInRound).not.toBeNull();
      }
    }
  });

  it('bestOf 3: stops early once a majority (2 wins) is reached, without playing a 3rd match', () => {
    const initial = singleEliminationFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    const match1 = initial.readyMatches[0];
    if (match1 === undefined) {
      throw new Error('expected a ready match');
    }

    const afterMatch1 = singleEliminationFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: match1,
      record: decisiveRecord(match1, 'a'),
    });
    expect(afterMatch1.readyMatches).toHaveLength(1); // 1-0, no majority yet
    expect(singleEliminationFormat.isComplete(afterMatch1)).toBe(false);

    const match2 = afterMatch1.readyMatches[0];
    if (match2 === undefined) {
      throw new Error('expected match 2');
    }
    const afterMatch2 = singleEliminationFormat.recordResult({
      formatState: afterMatch1.formatState,
      standings: afterMatch1.standings,
      match: match2,
      record: decisiveRecord(match2, 'a'), // a now has 2 wins — a majority of bestOf:3
    });

    expect(afterMatch2.readyMatches).toEqual([]); // decided early — never plays a 3rd match
    expect(singleEliminationFormat.isComplete(afterMatch2)).toBe(true);
    expect(afterMatch2.formatState.champion).toBe('a');
    expect(afterMatch2.standings.b).toMatchObject({ eliminatedInRound: 0 });
  });

  it('bestOf 3: each match within one series gets a distinct matchId', () => {
    // matchId feeds each match's own RNG seed derivation (apps/cli/src/lib/match-execution.ts)
    // — reusing one matchId across a series would silently reseed every game identically.
    const initial = singleEliminationFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    const match1 = initial.readyMatches[0];
    if (match1 === undefined) {
      throw new Error('expected a ready match');
    }

    const afterMatch1 = singleEliminationFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: match1,
      record: decisiveRecord(match1, 'a'), // 1-0, no majority yet — a 2nd match gets unlocked
    });
    const match2 = afterMatch1.readyMatches[0];

    expect(match2).toBeDefined();
    expect(match2?.matchId).not.toBe(match1.matchId);
  });

  it('never hangs: a matchup that draws every single match still decides after exactly bestOf matches', () => {
    // Mirrors round robin's own "never hangs" test — bestOf caps the series even if it never
    // produces a decisive match — but single elimination additionally has to pick who advances,
    // via the deterministic (lower participantId) tiebreak documented in single-elimination.ts.
    const state = singleEliminationFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    let match = state.readyMatches[0];
    let formatState = state.formatState;
    let standings = state.standings;
    let matchesPlayed = 0;

    while (match !== undefined && matchesPlayed < 10) {
      const next = singleEliminationFormat.recordResult({
        formatState,
        standings,
        match,
        record: drawnRecord(match),
      });
      formatState = next.formatState;
      standings = next.standings;
      match = next.readyMatches[0];
      matchesPlayed += 1;
    }

    expect(matchesPlayed).toBe(3); // exactly bestOf matches, never more
    expect(formatState.champion).toBe('a'); // 'a' < 'b' — the documented tiebreak rule
    expect(standings.a).toMatchObject({ eliminatedInRound: null, matchupsWon: 1 });
    expect(standings.b).toMatchObject({ eliminatedInRound: 0 });
  });

  it('a bye advances without ever appearing in readyMatches, and can still become champion', () => {
    // 3 participants: 'c' (the bye, since it pairs a,b and leaves c over) faces the round-1
    // winner directly in the final — it never plays a round-1 match of its own.
    const initial = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c'),
      config: { bestOf: 1 },
      rng,
    });
    let formatState = initial.formatState;
    let standings = initial.standings;
    const { readyMatches } = initial;
    const byeId = formatState.nextRoundParticipants[formatState.totalMatchups];
    if (byeId === undefined) {
      throw new Error('expected a bye participant');
    }
    expect(readyMatches.some((m) => m.participantIds.includes(byeId))).toBe(false);

    let match = readyMatches[0];
    while (match !== undefined && !singleEliminationFormat.isComplete({ formatState, standings })) {
      const [winnerId] = match.participantIds;
      if (winnerId === undefined) {
        throw new Error('expected 2 participants');
      }
      const next = singleEliminationFormat.recordResult({
        formatState,
        standings,
        match,
        record: decisiveRecord(match, winnerId),
      });
      formatState = next.formatState;
      standings = next.standings;
      match = next.readyMatches[0];
    }

    expect(formatState.champion).toBeDefined();
  });

  it('reports a fresh bye notice via recordResult each time a new round still has an odd count', () => {
    // 5 participants: round 1 has 2 matchups + 1 bye; round 2 (2 round-1 winners + the bye) is
    // still odd, so it draws a bye again; round 3 is the 2-participant final.
    const initial = singleEliminationFormat.initialize({
      roster: roster('a', 'b', 'c', 'd', 'e'),
      config: { bestOf: 1 },
      rng,
    });
    let formatState = initial.formatState;
    let standings = initial.standings;
    const queue = [...initial.readyMatches];
    const allNotices: string[] = [...(initial.notices ?? [])];

    while (queue.length > 0 && !singleEliminationFormat.isComplete({ formatState, standings })) {
      const match = queue.shift();
      if (match === undefined) {
        break;
      }
      const [winnerId] = match.participantIds;
      if (winnerId === undefined) {
        throw new Error('expected 2 participants');
      }
      const next = singleEliminationFormat.recordResult({
        formatState,
        standings,
        match,
        record: decisiveRecord(match, winnerId),
      });
      formatState = next.formatState;
      standings = next.standings;
      allNotices.push(...(next.notices ?? []));
      queue.push(...next.readyMatches);
    }

    // Exactly 2 byes total: one drawn in round 1, one drawn in round 2 — never a 3rd (round 3 is
    // the 2-participant final, which pairs evenly).
    expect(allNotices).toHaveLength(2);
    expect(allNotices[0]).toContain('draws a bye in round 1');
    expect(allNotices[1]).toContain('draws a bye in round 2');
  });
});

describe('singleEliminationFormat.isComplete', () => {
  it('is false until a champion is set, then true', () => {
    const noChampion: SingleEliminationFormatState = {
      bestOf: 1,
      roundIndex: 0,
      matchups: {},
      totalMatchups: 1,
      decidedMatchups: 0,
      nextRoundParticipants: [undefined],
    };
    const withChampion: SingleEliminationFormatState = { ...noChampion, champion: 'a' };
    expect(singleEliminationFormat.isComplete({ formatState: noChampion, standings: {} })).toBe(
      false,
    );
    expect(singleEliminationFormat.isComplete({ formatState: withChampion, standings: {} })).toBe(
      true,
    );
  });
});

describe('singleEliminationFormat.getPublicStandings', () => {
  it('ranks the champion first, then by how late each participant was eliminated', () => {
    const standings: SingleEliminationStandings = {
      b: { participantId: 'b', eliminatedInRound: 0, matchupsWon: 0 },
      a: { participantId: 'a', eliminatedInRound: null, matchupsWon: 2 }, // champion
      d: { participantId: 'd', eliminatedInRound: 1, matchupsWon: 1 }, // runner-up
      c: { participantId: 'c', eliminatedInRound: 0, matchupsWon: 0 },
    };

    expect(singleEliminationFormat.getPublicStandings(standings)).toEqual([
      standings.a,
      standings.d,
      standings.b,
      standings.c,
    ]);
  });
});

describe('singleEliminationFormat + runTournament (end to end)', () => {
  it('an 8-participant bracket always crowns the strongest seed as champion', async () => {
    // strength order: p1 beats everyone below it in this list, p2 beats everyone below p1
    // excepted, etc. — a total order, so the strongest participant present always wins its
    // matchup regardless of who it's paired against.
    const strength = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const rank = new Map(strength.map((id, index) => [id, index]));
    let matchesRun = 0;

    const outcome = await runTournament({
      format: singleEliminationFormat,
      config: { bestOf: 1 },
      roster: roster(...strength),
      rng,
      runMatch: (match) => {
        matchesRun += 1;
        const [p1, p2] = match.participantIds;
        if (p1 === undefined || p2 === undefined) {
          throw new Error('expected exactly 2 participants');
        }
        const r1 = rank.get(p1);
        const r2 = rank.get(p2);
        if (r1 === undefined || r2 === undefined) {
          throw new Error('unknown participant in fixture');
        }
        const winnerId = r1 < r2 ? p1 : p2;
        return Promise.resolve(decisiveRecord(match, winnerId));
      },
    });

    expect(matchesRun).toBe(7); // a clean 8-participant bracket: 4 + 2 + 1 matchups, no byes
    const standings = singleEliminationFormat.getPublicStandings(
      outcome.standings,
    ) as SingleEliminationStandings[keyof SingleEliminationStandings][];
    expect(standings[0]).toMatchObject({ participantId: 'p1', eliminatedInRound: null });
  });
});
