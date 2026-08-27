// Verifies copycat-rps against the real Docker runtime. Requires:
// docker build -t thunderdome-copycat-rps .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-copycat-rps';
const MATCH_ID = 'copycat-smoke-test';

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
  participantId: 'copycat-rps',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();

const lifecycle = new BotLifecycle({ process: botProcess, matchId: MATCH_ID });

const initOutcome = await lifecycle.initialize(
  {
    gameId: 'rock-paper-scissors',
    gameVersion: '1.0.0',
    participantId: 'copycat-rps',
    roster: ['copycat-rps', 'opponent'],
    rngSeed: 'deadbeef',
    config: { totalRounds: 3, onMissingAction: 'forfeitMatch' },
  },
  { initTimeoutMs: 10_000 },
);
assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

// Round 0: no history yet -> expect "rock".
lifecycle.sendObservation(0, {
  state: { round: 0, totalRounds: 3, yourWins: 0, opponentWins: 0, opponentId: 'opponent', history: [] },
  awaitingAction: true,
});
const round0 = await lifecycle.awaitAction(0, 10_000);
assertEqual(round0, { ok: true, action: { choice: 'rock' } }, 'round 0: plays rock with no history');

// Round 1: opponent played "scissors" last round -> expect to copy it: "scissors".
lifecycle.sendObservation(1, {
  state: {
    round: 1,
    totalRounds: 3,
    yourWins: 1,
    opponentWins: 0,
    opponentId: 'opponent',
    history: [{ round: 0, you: 'rock', opponent: 'scissors', winner: 'you' }],
  },
  awaitingAction: true,
});
const round1 = await lifecycle.awaitAction(1, 10_000);
assertEqual(
  round1,
  { ok: true, action: { choice: 'scissors' } },
  'round 1: copies opponent\'s last "scissors"',
);

await lifecycle.finish({ result: { winnerId: 'copycat-rps' }, reason: 'completed' });
assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

console.log('\nAll checks passed.');
