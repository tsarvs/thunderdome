#!/usr/bin/env node
// Verifies point-dodger-hearts against the real Docker runtime. Requires:
// docker build -t thunderdome-point-dodger-hearts .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-point-dodger-hearts';
const ROSTER = ['point-dodger-hearts', 'p2', 'p3', 'p4'];
const HAND_SIZES = { 'point-dodger-hearts': 4, p2: 4, p3: 4, p4: 4 };
const SCORES = { 'point-dodger-hearts': 0, p2: 0, p3: 0, p4: 0 };

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
  console.log(`ok - ${label}`);
}

async function askOnce(matchId, state) {
  const botProcess = new DockerBotProcess({
    imageRef: IMAGE_TAG,
    matchId,
    participantId: 'point-dodger-hearts',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'card-game-hearts',
      gameVersion: '0.1.0',
      participantId: 'point-dodger-hearts',
      roster: ROSTER,
      rngSeed: 'deadbeef',
      config: { pointLimit: 100 },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, `bot completes init/ready handshake (${matchId})`);

  lifecycle.sendObservation(0, { state, awaitingAction: true });
  const outcome = await lifecycle.awaitAction(0, 10_000);

  await lifecycle.finish({ result: { participantIds: ROSTER, scores: SCORES }, reason: 'completed' });
  return outcome;
}

function baseState(overrides) {
  return {
    you: 'point-dodger-hearts',
    participantIds: ROSTER,
    phase: 'playing',
    handNumber: 0,
    passDirection: 'left',
    handSizes: HAND_SIZES,
    heartsBroken: false,
    tricksCompleted: 1,
    isFirstTrick: false,
    scores: SCORES,
    pointLimit: 100,
    youMustAct: true,
    ...overrides,
  };
}

// 1. Passing: sheds the queen of spades over a higher-ranked but safer diamond/club.
const passOutcome = await askOnce(
  'point-dodger-pass',
  baseState({
    phase: 'passing',
    hand: [
      { suit: 'clubs', rank: 2 },
      { suit: 'diamonds', rank: 14 }, // ace of diamonds: high rank, but not dangerous
      { suit: 'hearts', rank: 5 },
      { suit: 'spades', rank: 12 }, // the queen — must be shed first
    ],
    currentTrick: null,
  }),
);
const passedIds = passOutcome.ok
  ? passOutcome.action.cards.map((c) => `${c.rank}${c.suit}`)
  : [];
if (!passedIds.includes('12spades')) {
  throw new Error(`expected the queen of spades among the passed cards, got ${JSON.stringify(passOutcome)}`);
}
console.log(`ok - sheds the queen of spades when passing: ${JSON.stringify(passOutcome.action.cards)}`);

// 2. Leading: avoids a point card (5H) in favor of a safe low club, even though 5H is legal.
const leadOutcome = await askOnce(
  'point-dodger-lead',
  baseState({
    hand: [
      { suit: 'hearts', rank: 5 },
      { suit: 'clubs', rank: 9 },
    ],
    currentTrick: { leaderId: 'point-dodger-hearts', plays: [] },
    legalPlays: [
      { suit: 'hearts', rank: 5 },
      { suit: 'clubs', rank: 9 },
    ],
  }),
);
assertEqual(
  leadOutcome,
  { ok: true, action: { type: 'play', card: { suit: 'clubs', rank: 9 } } },
  'leads a safe non-point card over a legal heart',
);

// 3. Following, can duck: burns the highest card that still loses (9C), keeping 2C in reserve.
const duckOutcome = await askOnce(
  'point-dodger-duck',
  baseState({
    hand: [
      { suit: 'clubs', rank: 2 },
      { suit: 'clubs', rank: 9 },
    ],
    currentTrick: { leaderId: 'p2', plays: [{ participantId: 'p2', card: { suit: 'clubs', rank: 10 } }] },
    legalPlays: [
      { suit: 'clubs', rank: 2 },
      { suit: 'clubs', rank: 9 },
    ],
  }),
);
assertEqual(
  duckOutcome,
  { ok: true, action: { type: 'play', card: { suit: 'clubs', rank: 9 } } },
  'ducks with the highest card that still loses the trick',
);

// 4. Void in the led suit: dumps the queen of spades rather than a harmless diamond.
const dumpOutcome = await askOnce(
  'point-dodger-dump',
  baseState({
    hand: [
      { suit: 'diamonds', rank: 4 },
      { suit: 'spades', rank: 12 },
    ],
    currentTrick: { leaderId: 'p2', plays: [{ participantId: 'p2', card: { suit: 'clubs', rank: 10 } }] },
    legalPlays: [
      { suit: 'diamonds', rank: 4 },
      { suit: 'spades', rank: 12 },
    ],
  }),
);
assertEqual(
  dumpOutcome,
  { ok: true, action: { type: 'play', card: { suit: 'spades', rank: 12 } } },
  'dumps the queen of spades when void in the led suit, instead of saving it',
);

// 5. Forced to win: every legal card beats the current winner — takes it as cheaply as possible.
const forcedWinOutcome = await askOnce(
  'point-dodger-forced-win',
  baseState({
    hand: [
      { suit: 'clubs', rank: 11 },
      { suit: 'clubs', rank: 13 },
    ],
    currentTrick: { leaderId: 'p2', plays: [{ participantId: 'p2', card: { suit: 'clubs', rank: 3 } }] },
    legalPlays: [
      { suit: 'clubs', rank: 11 },
      { suit: 'clubs', rank: 13 },
    ],
  }),
);
assertEqual(
  forcedWinOutcome,
  { ok: true, action: { type: 'play', card: { suit: 'clubs', rank: 11 } } },
  'takes an unavoidable trick as cheaply as possible',
);

console.log('\nAll checks passed.');
