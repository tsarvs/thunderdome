#!/usr/bin/env node
// Drives this bot's real Docker container through a scripted exchange using the platform's own
// runtime primitives (docs/guides/rps-bot-author-guide.md, "Testing your bot locally"). There's
// no CLI wrapper for this specific kind of single-bot, scripted-opponent smoke test —
// `yarn thunderdome match run` is for real two-bot matches through the registry instead — so
// this script exercises the same DockerBotProcess + BotLifecycle pieces the platform itself uses.
//
// Usage:
//   docker build -t thunderdome-counter-bot-example .
//   node smoke-test.mjs
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-counter-bot-example';
const MATCH_ID = 'smoke-test-match';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

const botProcess = new DockerBotProcess({
  imageRef: IMAGE_TAG,
  matchId: MATCH_ID,
  participantId: 'counter-bot',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();

const lifecycle = new BotLifecycle({ process: botProcess, matchId: MATCH_ID });

const initOutcome = await lifecycle.initialize(
  {
    gameId: 'rock-paper-scissors',
    gameVersion: '1.0.0',
    participantId: 'counter-bot',
    roster: ['counter-bot', 'opponent'],
    rngSeed: 'deadbeef',
    config: { totalRounds: 3, onMissingAction: 'forfeitMatch' },
  },
  { initTimeoutMs: 10_000 },
);
assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

// Round 0: no history yet -> expect "rock".
lifecycle.sendObservation(0, {
  state: {
    round: 0,
    totalRounds: 3,
    yourWins: 0,
    opponentWins: 0,
    opponentId: 'opponent',
    history: [],
  },
  awaitingAction: true,
});
const round0 = await lifecycle.awaitAction(0, 10_000);
assertEqual(
  round0,
  { ok: true, action: { choice: 'rock' } },
  'round 0: plays rock with no history',
);

// Round 1: opponent played "paper" last round (and won) -> expect "scissors" (beats paper).
lifecycle.sendObservation(1, {
  state: {
    round: 1,
    totalRounds: 3,
    yourWins: 0,
    opponentWins: 1,
    opponentId: 'opponent',
    history: [{ round: 0, you: 'rock', opponent: 'paper', winner: 'opponent' }],
  },
  awaitingAction: true,
});
const round1 = await lifecycle.awaitAction(1, 10_000);
assertEqual(
  round1,
  { ok: true, action: { choice: 'scissors' } },
  'round 1: counters opponent\'s last "paper" with "scissors"',
);

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

console.log('\nAll checks passed.');
