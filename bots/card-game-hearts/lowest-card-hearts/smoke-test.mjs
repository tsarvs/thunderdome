// Verifies lowest-card-hearts against the real Docker runtime. Requires:
// docker build -t thunderdome-lowest-card-hearts .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-lowest-card-hearts';
const MATCH_ID = 'lowest-card-hearts-smoke-test';
const ROSTER = ['lowest-card-hearts', 'p2', 'p3', 'p4'];
const HAND_SIZES = { 'lowest-card-hearts': 4, p2: 4, p3: 4, p4: 4 };
const SCORES = { 'lowest-card-hearts': 0, p2: 0, p3: 0, p4: 0 };

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
  participantId: 'lowest-card-hearts',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
});
await botProcess.start();
const lifecycle = new BotLifecycle({ process: botProcess, matchId: MATCH_ID });

const initOutcome = await lifecycle.initialize(
  {
    gameId: 'card-game-hearts',
    gameVersion: '0.1.0',
    participantId: 'lowest-card-hearts',
    roster: ROSTER,
    rngSeed: 'deadbeef',
    config: { pointLimit: 100 },
  },
  { initTimeoutMs: 10_000 },
);
assertEqual(initOutcome, { ok: true }, 'bot completes init/ready handshake');

// Round 0: passing phase — expects the 3 highest-ranked cards (5H, TC, QS), not 2C/3D.
lifecycle.sendObservation(0, {
  state: {
    you: 'lowest-card-hearts',
    participantIds: ROSTER,
    phase: 'passing',
    handNumber: 0,
    passDirection: 'left',
    hand: [
      { suit: 'clubs', rank: 2 },
      { suit: 'diamonds', rank: 3 },
      { suit: 'hearts', rank: 5 },
      { suit: 'clubs', rank: 10 },
      { suit: 'spades', rank: 12 },
    ],
    handSizes: HAND_SIZES,
    heartsBroken: false,
    tricksCompleted: 0,
    isFirstTrick: true,
    currentTrick: null,
    scores: SCORES,
    pointLimit: 100,
    youMustAct: true,
  },
  awaitingAction: true,
});
const passOutcome = await lifecycle.awaitAction(0, 10_000);
assertEqual(
  passOutcome,
  {
    ok: true,
    action: {
      type: 'pass',
      cards: [
        { suit: 'hearts', rank: 5 },
        { suit: 'clubs', rank: 10 },
        { suit: 'spades', rank: 12 },
      ],
    },
  },
  'passes the 3 highest-ranked cards, ignoring suit/danger',
);

// Round 1: playing phase — legalPlays has multiple options; expects the lowest rank (4D).
lifecycle.sendObservation(1, {
  state: {
    you: 'lowest-card-hearts',
    participantIds: ROSTER,
    phase: 'playing',
    handNumber: 0,
    passDirection: 'left',
    hand: [
      { suit: 'diamonds', rank: 4 },
      { suit: 'diamonds', rank: 9 },
      { suit: 'diamonds', rank: 13 },
    ],
    handSizes: HAND_SIZES,
    heartsBroken: false,
    tricksCompleted: 1,
    isFirstTrick: false,
    currentTrick: { leaderId: 'lowest-card-hearts', plays: [] },
    scores: SCORES,
    pointLimit: 100,
    legalPlays: [
      { suit: 'diamonds', rank: 9 },
      { suit: 'diamonds', rank: 4 },
      { suit: 'diamonds', rank: 13 },
    ],
    youMustAct: true,
  },
  awaitingAction: true,
});
const playOutcome = await lifecycle.awaitAction(1, 10_000);
assertEqual(
  playOutcome,
  { ok: true, action: { type: 'play', card: { suit: 'diamonds', rank: 4 } } },
  'plays the lowest-ranked legal card, regardless of list order',
);

await lifecycle.finish({ result: { participantIds: ROSTER, scores: SCORES }, reason: 'completed' });
assertEqual(lifecycle.state, 'terminated', 'shuts down cleanly on match-end');
assertEqual(lifecycle.getTerminalFailure(), undefined, 'no fault recorded');

console.log('\nAll checks passed.');
