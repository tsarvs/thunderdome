// Verifies tight-poker against the real Docker runtime: it raises with a premium preflop hand,
// folds a weak hand facing an expensive bet, and calls a weak hand facing a cheap one. Requires:
// docker build -t thunderdome-tight-poker .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-tight-poker';
const ROSTER = ['tight-poker', 'opponent'];

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
    participantId: 'tight-poker',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'poker-texas-hold-em',
      gameVersion: '0.1.0',
      participantId: 'tight-poker',
      roster: ROSTER,
      rngSeed: 'deadbeef',
      config: { startingStack: 500, smallBlind: 10, bigBlind: 20 },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

  const result = await run(lifecycle);

  await lifecycle.finish({
    result: { participantIds: ROSTER, stacks: { 'tight-poker': 500, opponent: 500 }, bustedOut: [], handsPlayed: 1 },
    reason: 'completed',
  });
  return result;
}

function baseObservation(overrides) {
  return {
    you: 'tight-poker',
    handNumber: 0,
    street: 'preflop',
    board: [],
    holeCards: [
      { suit: 'clubs', rank: 2 },
      { suit: 'diamonds', rank: 7 },
    ],
    pot: 30,
    yourStack: 480,
    yourCommittedThisStreet: 0,
    toCall: 20,
    minRaiseTo: 40,
    maxRaiseTo: 500,
    smallBlind: 10,
    bigBlind: 20,
    buttonParticipantId: 'opponent',
    opponents: [
      {
        participantId: 'opponent',
        stack: 480,
        committed: 20,
        committedThisStreet: 20,
        folded: false,
        allIn: false,
        isButton: true,
      },
    ],
    legalActions: ['fold', 'call', 'raise', 'allIn'],
    lastHandSummary: null,
    ...overrides,
  };
}

const premium = await withLifecycle('tight-poker-premium', async (lifecycle) => {
  lifecycle.sendObservation(0, {
    state: baseObservation({ holeCards: [{ suit: 'spades', rank: 14 }, { suit: 'hearts', rank: 14 }] }),
    awaitingAction: true,
  });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(
  premium,
  { ok: true, action: { type: 'raise', amount: 40 } },
  'raises to the minimum legal amount with pocket aces',
);

const weakFacingBigBet = await withLifecycle('tight-poker-fold', async (lifecycle) => {
  lifecycle.sendObservation(0, { state: baseObservation({ toCall: 40 }), awaitingAction: true });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(weakFacingBigBet, { ok: true, action: { type: 'fold' } }, 'folds a weak hand facing a bet bigger than the big blind');

const weakFacingCheapBet = await withLifecycle('tight-poker-call', async (lifecycle) => {
  lifecycle.sendObservation(0, { state: baseObservation({ toCall: 20, bigBlind: 20 }), awaitingAction: true });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(weakFacingCheapBet, { ok: true, action: { type: 'call' } }, 'calls a weak hand when toCall is no more than the big blind');

const weakCanCheck = await withLifecycle('tight-poker-check', async (lifecycle) => {
  lifecycle.sendObservation(0, {
    state: baseObservation({ toCall: 0, legalActions: ['fold', 'check', 'raise', 'allIn'] }),
    awaitingAction: true,
  });
  return lifecycle.awaitAction(0, 10_000);
});
assertEqual(weakCanCheck, { ok: true, action: { type: 'check' } }, 'checks a weak hand when nothing is owed');

console.log('\nAll checks passed.');
