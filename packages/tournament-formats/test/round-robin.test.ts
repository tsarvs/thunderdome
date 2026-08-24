import { runTournament, type MatchDescriptor, type RosterEntry } from '@thunderdome/engine';
import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { RoundRobinConfigSchema, roundRobinFormat } from '../src/round-robin.js';

const rng = createRng(Buffer.alloc(16, 3));

function roster(...ids: string[]): RosterEntry[] {
  return ids.map((participantId) => ({ participantId }));
}

function pairKey(match: MatchDescriptor): string {
  return [...match.participantIds].sort().join('-vs-');
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

describe('RoundRobinConfigSchema', () => {
  it('defaults bestOf to 1 when omitted', () => {
    const result = RoundRobinConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && result.data.bestOf).toBe(1);
  });

  it('accepts an explicit odd bestOf', () => {
    expect(RoundRobinConfigSchema.safeParse({ bestOf: 3 }).success).toBe(true);
    expect(RoundRobinConfigSchema.safeParse({ bestOf: 5 }).success).toBe(true);
  });

  it.each([{ bestOf: 2 }, { bestOf: 4 }, { bestOf: 0 }, { bestOf: -1 }, { bestOf: 1.5 }])(
    'rejects invalid bestOf %j',
    (raw) => {
      expect(RoundRobinConfigSchema.safeParse(raw).success).toBe(false);
    },
  );
});

describe('roundRobinFormat.parseConfig', () => {
  it('wraps the schema in a Result', () => {
    expect(roundRobinFormat.parseConfig({ bestOf: 3 })).toEqual({ ok: true, value: { bestOf: 3 } });
    expect(roundRobinFormat.parseConfig({ bestOf: 2 }).ok).toBe(false);
  });
});

describe('roundRobinFormat.initialize', () => {
  it('generates exactly one match per unique pairing up front, regardless of bestOf', () => {
    const { formatState, standings, readyMatches } = roundRobinFormat.initialize({
      roster: roster('a', 'b', 'c'),
      config: { bestOf: 5 },
      rng,
    });

    expect(readyMatches).toHaveLength(3);
    expect(new Set(readyMatches.map(pairKey))).toEqual(new Set(['a-vs-b', 'a-vs-c', 'b-vs-c']));
    expect(formatState.bestOf).toBe(5);
    expect(formatState.totalPairings).toBe(3);
    expect(formatState.decidedPairings).toBe(0);
    expect(standings).toEqual({
      a: { participantId: 'a', wins: 0, losses: 0, draws: 0, points: 0, matchesPlayed: 0 },
      b: { participantId: 'b', wins: 0, losses: 0, draws: 0, points: 0, matchesPlayed: 0 },
      c: { participantId: 'c', wins: 0, losses: 0, draws: 0, points: 0, matchesPlayed: 0 },
    });
  });

  it('throws for a roster with fewer than 2 participants', () => {
    expect(() =>
      roundRobinFormat.initialize({ roster: roster('a'), config: { bestOf: 1 }, rng }),
    ).toThrow('at least 2 participants');
  });
});

describe('roundRobinFormat.recordResult', () => {
  it('bestOf 1: a single decisive match immediately decides the pairing', () => {
    const initial = roundRobinFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 1 },
      rng,
    });
    const match = initial.readyMatches[0];
    if (match === undefined) {
      throw new Error('expected a ready match');
    }

    const next = roundRobinFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match,
      record: decisiveRecord(match, 'a'),
    });

    expect(next.readyMatches).toEqual([]);
    expect(next.formatState.decidedPairings).toBe(1);
    expect(next.standings.a).toMatchObject({ wins: 1, losses: 0, points: 1, matchesPlayed: 1 });
    expect(next.standings.b).toMatchObject({ wins: 0, losses: 1, points: 0, matchesPlayed: 1 });
  });

  it('bestOf 3: stops early once a majority (2 wins) is reached, without playing a 3rd match', () => {
    const initial = roundRobinFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    const match1 = initial.readyMatches[0];
    if (match1 === undefined) {
      throw new Error('expected a ready match');
    }

    const afterMatch1 = roundRobinFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: match1,
      record: decisiveRecord(match1, 'a'),
    });
    expect(afterMatch1.readyMatches).toHaveLength(1); // 1-0, no majority yet — plays match 2
    expect(afterMatch1.formatState.decidedPairings).toBe(0);

    const match2 = afterMatch1.readyMatches[0];
    if (match2 === undefined) {
      throw new Error('expected match 2 to be unlocked');
    }
    expect(match2.matchId).not.toBe(match1.matchId);

    const afterMatch2 = roundRobinFormat.recordResult({
      formatState: afterMatch1.formatState,
      standings: afterMatch1.standings,
      match: match2,
      record: decisiveRecord(match2, 'a'), // a now has 2 wins — a majority of bestOf:3
    });

    expect(afterMatch2.readyMatches).toEqual([]); // decided early — never plays a 3rd match
    expect(afterMatch2.formatState.decidedPairings).toBe(1);
    expect(afterMatch2.standings.a).toMatchObject({ wins: 1, losses: 0, points: 1 });
    expect(afterMatch2.standings.b).toMatchObject({ losses: 1, wins: 0, points: 0 });
  });

  it('bestOf 3: an even 1-1 split after 2 matches unlocks the deciding 3rd match', () => {
    const initial = roundRobinFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    const match1 = initial.readyMatches[0];
    if (match1 === undefined) {
      throw new Error('expected a ready match');
    }
    const afterMatch1 = roundRobinFormat.recordResult({
      formatState: initial.formatState,
      standings: initial.standings,
      match: match1,
      record: decisiveRecord(match1, 'a'),
    });
    const match2 = afterMatch1.readyMatches[0];
    if (match2 === undefined) {
      throw new Error('expected match 2');
    }
    const afterMatch2 = roundRobinFormat.recordResult({
      formatState: afterMatch1.formatState,
      standings: afterMatch1.standings,
      match: match2,
      record: decisiveRecord(match2, 'b'), // now 1-1 — no majority
    });

    expect(afterMatch2.readyMatches).toHaveLength(1); // the deciding 3rd match is unlocked
    expect(afterMatch2.formatState.decidedPairings).toBe(0);
  });

  it('never hangs: a pairing that draws every single match still decides after exactly bestOf matches', () => {
    // This is the whole point of building bestOf at this level instead of RPS's own rounds
    // (docs/adr/0003-docker-bot-isolation.md's match-timeout note): each match is independently
    // bounded (RPS itself never hangs), so even a pairing that draws 100% of the time — like a
    // real copycat-rps vs a fixed-throw bot — still finishes in exactly `bestOf` matches, tied.
    const state = roundRobinFormat.initialize({
      roster: roster('a', 'b'),
      config: { bestOf: 3 },
      rng,
    });
    let match = state.readyMatches[0];
    let formatState = state.formatState;
    let standings = state.standings;
    let matchesPlayed = 0;

    while (match !== undefined && matchesPlayed < 10) {
      // safety cap for the test itself, not the format
      const next = roundRobinFormat.recordResult({
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
    expect(formatState.decidedPairings).toBe(1);
    expect(standings.a).toMatchObject({ draws: 1, wins: 0, losses: 0, points: 0.5 });
    expect(standings.b).toMatchObject({ draws: 1, wins: 0, losses: 0, points: 0.5 });
  });
});

describe('roundRobinFormat.isComplete', () => {
  it('is false until every pairing has been decided, then true', () => {
    expect(
      roundRobinFormat.isComplete({
        formatState: { bestOf: 1, pairings: {}, totalPairings: 2, decidedPairings: 1 },
        standings: {},
      }),
    ).toBe(false);
    expect(
      roundRobinFormat.isComplete({
        formatState: { bestOf: 1, pairings: {}, totalPairings: 2, decidedPairings: 2 },
        standings: {},
      }),
    ).toBe(true);
  });
});

describe('roundRobinFormat.getPublicStandings', () => {
  it('sorts by points desc, then wins desc, then participantId asc', () => {
    const standings = {
      b: { participantId: 'b', wins: 1, losses: 1, draws: 0, points: 1, matchesPlayed: 2 },
      a: { participantId: 'a', wins: 2, losses: 0, draws: 0, points: 2, matchesPlayed: 2 },
      d: { participantId: 'd', wins: 1, losses: 1, draws: 0, points: 1, matchesPlayed: 2 },
      c: { participantId: 'c', wins: 0, losses: 2, draws: 0, points: 0, matchesPlayed: 2 },
    };

    expect(roundRobinFormat.getPublicStandings(standings)).toEqual([
      standings.a,
      standings.b,
      standings.d,
      standings.c,
    ]);
  });
});

describe('roundRobinFormat + runTournament (end to end)', () => {
  it('produces a rock-paper-scissors three-way tie, deciding each pairing early at bestOf 3', async () => {
    // rock beats scissors, paper beats rock, scissors beats paper — a real, deterministic cycle.
    // Every pairing here is fully decisive every time, so bestOf:3 always resolves in exactly 2
    // matches per pairing (2-0), never the 3rd.
    const BEATS: Record<string, string> = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
    const choiceByBot: Record<string, string> = {
      'only-rock': 'rock',
      'only-paper': 'paper',
      'only-scissors': 'scissors',
    };
    let matchesRun = 0;

    const outcome = await runTournament({
      format: roundRobinFormat,
      config: { bestOf: 3 },
      roster: roster('only-rock', 'only-paper', 'only-scissors'),
      rng,
      runMatch: (match) => {
        matchesRun += 1;
        const [p1, p2] = match.participantIds;
        if (p1 === undefined || p2 === undefined) {
          throw new Error('expected exactly 2 participants');
        }
        const c1 = choiceByBot[p1];
        const c2 = choiceByBot[p2];
        if (c1 === undefined || c2 === undefined) {
          throw new Error('unknown bot in fixture');
        }
        const winnerId = BEATS[c1] === c2 ? p1 : p2;
        return Promise.resolve(decisiveRecord(match, winnerId));
      },
    });

    expect(matchesRun).toBe(6); // 3 pairings x 2 matches each (early-decided, never the 3rd)
    for (const entry of Object.values(outcome.standings)) {
      expect(entry).toMatchObject({ wins: 1, losses: 1, draws: 0, points: 1, matchesPlayed: 2 });
    }
  });
});
