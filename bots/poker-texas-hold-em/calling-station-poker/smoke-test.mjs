// Verifies calling-station-poker against the real Docker runtime: it checks when it can, and
// calls (capped at its stack) otherwise — never folds, never raises. Requires:
// docker build -t thunderdome-calling-station-poker .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-calling-station-poker';
const ROSTER = ['calling-station-poker', 'opponent'];

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function withLifecycle(matchId, run) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'calling-station-poker',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'poker-texas-hold-em',
      gameVersion: '0.1.0',
      participantId: 'calling-station-poker',
      roster: ROSTER,
      rngSeed: 'deadbeef',
      config: { startingStack: 500, smallBlind: 10, bigBlind: 20 },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

  const result = await run(lifecycle);

  await lifecycle.finish({
    result: {
      participantIds: ROSTER,
      stacks: { 'calling-station-poker': 500, opponent: 500 },
      bustedOut: [],
      handsPlayed: 1,
    },
    reason: 'completed',
  });
  return result;
}

function observationFacing(toCall, overrides = {}) {
  return {
    you: 'calling-station-poker',
    handNumber: 0,
    street: 'flop',
    board: [
      { suit: 'clubs', rank: 9 },
      { suit: 'diamonds', rank: 4 },
      { suit: 'hearts', rank: 2 },
    ],
    holeCards: [
      { suit: 'spades', rank: 7 },
      { suit: 'spades', rank: 6 },
    ],
    pot: 100 + toCall,
    yourStack: 360,
    yourCommittedThisStreet: 0,
    toCall,
    minRaiseTo: toCall === 0 ? null : toCall + 20,
    maxRaiseTo: 360,
    smallBlind: 10,
    bigBlind: 20,
    buttonParticipantId: 'opponent',
    opponents: [
      {
        participantId: 'opponent',
        stack: 340,
        committed: toCall,
        committedThisStreet: toCall,
        folded: false,
        allIn: false,
        isButton: true,
      },
    ],
    legalActions: toCall === 0 ? ['fold', 'check', 'raise', 'allIn'] : ['fold', 'call', 'raise', 'allIn'],
    lastHandSummary: null,
    ...overrides,
  };
}

const checked = await withLifecycle('calling-station-check', async (lifecycle) => {
  lifecycle.sendObservation(0, { state: observationFacing(0), awaitingAction: true });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(checked, { ok: true, action: { type: 'check' } }, 'checks when there is nothing to call');

const called = await withLifecycle('calling-station-call', async (lifecycle) => {
  lifecycle.sendObservation(0, { state: observationFacing(40), awaitingAction: true });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(called, { ok: true, action: { type: 'call' } }, 'calls when facing a bet — never folds or raises');

console.log('\nAll checks passed.');
