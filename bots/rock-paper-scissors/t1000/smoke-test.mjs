#!/usr/bin/env node
// Verifies t1000 against the real Docker runtime: completes the handshake, always answers with a
// valid choice, is a deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md
// — not uncontrolled Math.random()), and shuts down cleanly. Requires:
// docker build -t thunderdome-t1000 .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-t1000';

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function playOneRound(matchId, rngSeed) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 't1000',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'rock-paper-scissors',
      gameVersion: '1.0.0',
      participantId: 't1000',
      roster: ['t1000', 'opponent'],
      rngSeed,
      config: { totalRounds: 3, onMissingAction: 'forfeitMatch' },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

  lifecycle.sendObservation(0, {
    state: { round: 0, totalRounds: 3, yourWins: 0, opponentWins: 0, opponentId: 'opponent', history: [] },
    awaitingAction: true,
  });
  const result = await lifecycle.awaitAction(0, 10_000);

  await lifecycle.finish({ result: { winnerId: 'opponent' }, reason: 'completed' });
  assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
  assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

  return result;
}

const VALID_CHOICES = new Set(['rock', 'paper', 'scissors']);

const first = await playOneRound('det-check-1', 'deadbeef');
if (!first.ok || !VALID_CHOICES.has(first.action?.choice)) {
  throw new Error(`bot did not produce a valid action: ${JSON.stringify(first)}`);
}
console.log(`ok - responds with a valid action: ${JSON.stringify(first.action)}`);

const second = await playOneRound('det-check-2', 'deadbeef');
assertEqual(second, first, 'same rngSeed produces the same choice (deterministic, not Math.random())');

const third = await playOneRound('det-check-3', 'cafef00d');
if (JSON.stringify(third) === JSON.stringify(first)) {
  console.log(
    'note - a different rngSeed happened to produce the same choice (possible by chance with 3 options); re-run to confirm it varies across seeds.',
  );
} else {
  console.log('ok - a different rngSeed produced a different choice');
}

console.log('\nAll checks passed.');
