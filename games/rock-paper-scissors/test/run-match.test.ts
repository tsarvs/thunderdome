import {
  runMatch,
  type ActionCollector,
  type CollectedAction,
  type RequestActionArgs,
} from '@thunderdome/engine';
import { createRng } from '@thunderdome/rng';
import { describe, expect, it } from 'vitest';
import { rockPaperScissors } from '../src/game.js';
import type { RpsChoice } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 2));

/**
 * Proves rock-paper-scissors is a genuine `GameDefinition` plugin, not just a standalone module
 * with a matching shape — it's driven end-to-end by the actual generic engine loop
 * (`@thunderdome/engine`'s `runMatch`), with the engine never once branching on which game this is.
 */
class ScriptCollector implements ActionCollector {
  readonly calls: RequestActionArgs[] = [];
  constructor(
    private readonly choices: (participantId: string, roundId: number) => RpsChoice | 'timeout',
  ) {}

  requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    this.calls.push(args);
    const choice = this.choices(args.participantId, args.roundId);
    return Promise.resolve(
      choice === 'timeout' ? { ok: false, reason: 'timeout' } : { ok: true, action: { choice } },
    );
  }
}

function parseConfigOrThrow(raw: unknown) {
  const result = rockPaperScissors.parseConfig(raw);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.value;
}

describe('rock-paper-scissors via the generic engine', () => {
  it('plays every configured hand, win or lose — not "first to a majority"', async () => {
    const collector = new ScriptCollector((participantId) =>
      participantId === 'alice' ? 'rock' : 'scissors',
    );

    const outcome = await runMatch({
      game: rockPaperScissors,
      config: parseConfigOrThrow({ totalRounds: 3 }),
      participantIds: ['alice', 'bob'],
      rng,
      collector,
      defaultDeadlineMs: 5000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed');
    // Alice wins every hand, but all 3 configured hands are still played (not stopped once a
    // majority is unreachable for bob) — the whole point of this design: bounded by
    // `totalRounds`, never by "is the outcome already decided."
    expect(outcome.result).toEqual({
      winnerId: 'alice',
      roundWins: { alice: 3, bob: 0 },
      totalRounds: 3,
    });
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'win', score: 3 },
      { participantId: 'bob', rank: 2, outcome: 'loss', score: 0 },
    ]);
    expect(outcome.events).toHaveLength(3);
    // Both participants were asked every round — a real simultaneous game, not a turn-taking one.
    expect(collector.calls.filter((c) => c.roundId === 0)).toHaveLength(2);
  });

  it('forfeits the match when a required participant never responds (engine default policy)', async () => {
    const collector = new ScriptCollector((participantId) =>
      participantId === 'bob' ? 'timeout' : 'rock',
    );
    const outcome = await runMatch({
      game: rockPaperScissors,
      config: parseConfigOrThrow({ totalRounds: 3 }), // forfeitMatch is the default
      participantIds: ['alice', 'bob'],
      rng,
      collector,
      defaultDeadlineMs: 5000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('forfeit');
    expect(outcome.forfeitedParticipantIds).toEqual(['bob']);
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'alice', rank: 1, outcome: 'win' },
      { participantId: 'bob', rank: 2, outcome: 'loss' },
    ]);
  });

  it('applies the game-configured leniency policy instead of forfeiting', async () => {
    // Round 0: bob times out -> loseRound leniency substitutes a forfeited round -> alice 1-0.
    // Rounds 1-2: alice rock vs bob scissors -> alice wins both -> 3-0 after all 3 hands.
    const collector = new ScriptCollector((participantId, roundId) => {
      if (participantId === 'bob') {
        return roundId === 0 ? 'timeout' : 'scissors';
      }
      return 'rock';
    });

    const outcome = await runMatch({
      game: rockPaperScissors,
      config: parseConfigOrThrow({ totalRounds: 3, onMissingAction: 'loseRound' }),
      participantIds: ['alice', 'bob'],
      rng,
      collector,
      defaultDeadlineMs: 5000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({
      winnerId: 'alice',
      roundWins: { alice: 3, bob: 0 },
      totalRounds: 3,
    });
  });

  it('the bug this design fixes: a pairing that would draw forever now finishes quickly with an honest result', async () => {
    // copycat-rps's real strategy: play the opponent's last move, or "rock" with no history yet.
    // Against a bot that always plays "rock", every hand from round 1 onward is a guaranteed
    // draw — before docs/adr/0003's totalRounds redesign, "first to a majority of decisive
    // rounds" meant this pairing could never terminate on its own.
    let copycatLastOpponentMove: RpsChoice | undefined;
    const collector = new ScriptCollector((participantId) => {
      if (participantId === 'fixed-rock') {
        return 'rock';
      }
      const choice = copycatLastOpponentMove ?? 'rock';
      copycatLastOpponentMove = 'rock'; // the opponent always plays rock
      return choice;
    });

    const outcome = await runMatch({
      game: rockPaperScissors,
      config: parseConfigOrThrow({ totalRounds: 5 }),
      participantIds: ['copycat', 'fixed-rock'],
      rng,
      collector,
      defaultDeadlineMs: 5000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed'); // never hits matchDeadlineMs
    expect(outcome.events).toHaveLength(5); // exactly totalRounds hands, no more, no less
    expect(outcome.result).toEqual({
      winnerId: null, // an honest tie — every hand was a real draw, not a cop-out
      roundWins: { copycat: 0, 'fixed-rock': 0 },
      totalRounds: 5,
    });
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'copycat', rank: 1, outcome: 'draw', score: 0 },
      { participantId: 'fixed-rock', rank: 1, outcome: 'draw', score: 0 },
    ]);
  });
});
