// Verifies random-poker against the real Docker runtime, and specifically that its choices are a
// deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md) — not
// uncontrolled Math.random(). Requires:
// docker build -t thunderdome-random-poker .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-poker';
const ROSTER = ['random-poker', 'opponent'];

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function withLifecycle(matchId, rngSeed, run) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'random-poker',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'poker-texas-hold-em',
      gameVersion: '0.1.0',
      participantId: 'random-poker',
      roster: ROSTER,
      rngSeed,
      config: { startingStack: 500, smallBlind: 10, bigBlind: 20 },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, `bot completes init/ready handshake (seed ${rngSeed})`);

  const result = await run(lifecycle);

  await lifecycle.finish({
    result: { participantIds: ROSTER, stacks: { 'random-poker': 500, opponent: 500 }, bustedOut: [], handsPlayed: 1 },
    reason: 'completed',
  });
  return result;
}

/** An observation facing a bet with a wide legal range — exercises fold/check/call/raise/allIn
 * all at once, since every one of them is legal here. */
function facingABetObservation() {
  return {
    you: 'random-poker',
    handNumber: 0,
    street: 'flop',
    board: [
      { suit: 'clubs', rank: 9 },
      { suit: 'diamonds', rank: 4 },
      { suit: 'hearts', rank: 2 },
    ],
    holeCards: [
      { suit: 'spades', rank: 14 },
      { suit: 'spades', rank: 13 },
    ],
    pot: 140,
    yourStack: 400,
    yourCommittedThisStreet: 0,
    toCall: 40,
    minRaiseTo: 80,
    maxRaiseTo: 440,
    smallBlind: 10,
    bigBlind: 20,
    buttonParticipantId: 'opponent',
    opponents: [
      {
        participantId: 'opponent',
        stack: 360,
        committed: 40,
        committedThisStreet: 40,
        folded: false,
        allIn: false,
        isButton: true,
      },
    ],
    legalActions: ['fold', 'call', 'raise', 'allIn'],
    lastHandSummary: null,
  };
}

async function decide(matchId, rngSeed) {
  return withLifecycle(matchId, rngSeed, async (lifecycle) => {
    lifecycle.sendObservation(0, { state: facingABetObservation(), awaitingAction: true });
    return lifecycle.awaitAction(0, 10_000);
  });
}

const decision1 = await decide('random-poker-1', 'deadbeef');
if (!decision1.ok) {
  throw new Error(`expected a successful decision, got ${JSON.stringify(decision1)}`);
}
const legal = ['fold', 'call', 'raise', 'allIn'];
if (!legal.includes(decision1.action.type)) {
  throw new Error(`action type "${decision1.action.type}" is not one of the observation's legalActions`);
}
if (decision1.action.type === 'raise') {
  const { amount } = decision1.action;
  if (!Number.isInteger(amount) || amount < 80 || amount > 440) {
    throw new Error(`raise amount ${String(amount)} is outside [minRaiseTo, maxRaiseTo] = [80, 440]`);
  }
}
console.log(`ok - picks a legal action facing a bet: ${JSON.stringify(decision1.action)}`);

const decision2 = await decide('random-poker-2', 'deadbeef');
assertEqual(decision2, decision1, 'same rngSeed produces the same decision (deterministic, not Math.random())');

const decision3 = await decide('random-poker-3', 'cafebabe');
console.log(
  decision3.ok && JSON.stringify(decision3) !== JSON.stringify(decision1)
    ? 'ok - a different rngSeed can produce a different decision'
    : 'note - different seed happened to land on the same decision (not a failure, just bad luck of the draw)',
);

console.log('\nAll checks passed.');
