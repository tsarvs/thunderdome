// Verifies only-scissors against the real Docker runtime. Requires:
// docker build -t thunderdome-only-scissors .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-only-scissors';
const MATCH_ID = 'only-scissors-smoke-test';

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
  participantId: 'only-scissors',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();

const lifecycle = new BotLifecycle({ process: botProcess, matchId: MATCH_ID });

const initOutcome = await lifecycle.initialize(
  {
    gameId: 'rock-paper-scissors',
    gameVersion: '1.0.0',
    participantId: 'only-scissors',
    roster: ['only-scissors', 'opponent'],
    rngSeed: 'deadbeef',
    config: { totalRounds: 3, onMissingAction: 'forfeitMatch' },
  },
  { initTimeoutMs: 10_000 },
);
assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

for (const [roundId, opponentLastChoice] of [
  [0, null],
  [1, 'paper'],
  [2, 'rock'],
]) {
  const history =
    opponentLastChoice === null
      ? []
      : [{ round: roundId - 1, you: 'scissors', opponent: opponentLastChoice, winner: 'draw' }];
  lifecycle.sendObservation(roundId, {
    state: { round: roundId, totalRounds: 3, yourWins: 0, opponentWins: 0, opponentId: 'opponent', history },
    awaitingAction: true,
  });
  const outcome = await lifecycle.awaitAction(roundId, 10_000);
  assertEqual(
    outcome,
    { ok: true, action: { choice: 'scissors' } },
    `round ${roundId}: always plays scissors`,
  );
}

await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

console.log('\nAll checks passed.');
