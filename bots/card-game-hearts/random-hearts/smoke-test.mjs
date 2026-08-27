// Verifies random-hearts against the real Docker runtime, and specifically that its choices are
// a deterministic function of rngSeed (docs/adr/0004-deterministic-randomness.md) — not
// uncontrolled Math.random(). Requires:
// docker build -t thunderdome-random-hearts .
import { DockerBotProcess, BotLifecycle, DEFAULT_RESOURCE_LIMITS } from '@thunderdome/runtime';

const IMAGE_TAG = 'thunderdome-random-hearts';
const ROSTER = ['random-hearts', 'p2', 'p3', 'p4'];
const HAND_SIZES = { 'random-hearts': 4, p2: 4, p3: 4, p4: 4 };
const SCORES = { 'random-hearts': 0, p2: 0, p3: 0, p4: 0 };

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
    participantId: 'random-hearts',
    resourceLimits: DEFAULT_RESOURCE_LIMITS,
  });
  await botProcess.start();
  const lifecycle = new BotLifecycle({ process: botProcess, matchId });

  const initOutcome = await lifecycle.initialize(
    {
      gameId: 'card-game-hearts',
      gameVersion: '0.1.0',
      participantId: 'random-hearts',
      roster: ROSTER,
      rngSeed,
      config: { pointLimit: 100 },
    },
    { initTimeoutMs: 10_000 },
  );
  assertEqual(initOutcome, { ok: true }, `bot completes init/ready handshake (seed ${rngSeed})`);

  const result = await run(lifecycle);

  await lifecycle.finish({ result: { participantIds: ROSTER, scores: SCORES }, reason: 'completed' });
  return result;
}

async function playPassingRound(matchId, rngSeed) {
  return withLifecycle(matchId, rngSeed, async (lifecycle) => {
    lifecycle.sendObservation(0, {
      state: {
        you: 'random-hearts',
        participantIds: ROSTER,
        phase: 'passing',
        handNumber: 0,
        passDirection: 'left',
        hand: [
          { suit: 'clubs', rank: 2 },
          { suit: 'hearts', rank: 5 },
          { suit: 'spades', rank: 12 },
          { suit: 'diamonds', rank: 9 },
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
    return lifecycle.awaitAction(0, 10_000);
  });
}

async function playCard(matchId, rngSeed) {
  return withLifecycle(matchId, rngSeed, async (lifecycle) => {
    lifecycle.sendObservation(0, {
      state: {
        you: 'random-hearts',
        participantIds: ROSTER,
        phase: 'playing',
        handNumber: 0,
        passDirection: 'left',
        hand: [
          { suit: 'clubs', rank: 2 },
          { suit: 'clubs', rank: 9 },
          { suit: 'diamonds', rank: 4 },
        ],
        handSizes: HAND_SIZES,
        heartsBroken: false,
        tricksCompleted: 0,
        isFirstTrick: true,
        currentTrick: { leaderId: 'random-hearts', plays: [] },
        scores: SCORES,
        pointLimit: 100,
        legalPlays: [{ suit: 'clubs', rank: 2 }], // forced opening lead
        youMustAct: true,
      },
      awaitingAction: true,
    });
    return lifecycle.awaitAction(0, 10_000);
  });
}

const pass1 = await playPassingRound('random-hearts-pass-1', 'deadbeef');
if (!pass1.ok || pass1.action.type !== 'pass' || pass1.action.cards.length !== 3) {
  throw new Error(`expected a 3-card pass action, got ${JSON.stringify(pass1)}`);
}
const passedIds = pass1.action.cards.map((card) => `${card.rank}${card.suit}`);
if (new Set(passedIds).size !== 3) {
  throw new Error(`expected 3 distinct cards, got ${JSON.stringify(passedIds)}`);
}
console.log(`ok - passes exactly 3 distinct cards: ${JSON.stringify(pass1.action.cards)}`);

const pass2 = await playPassingRound('random-hearts-pass-2', 'deadbeef');
assertEqual(pass2, pass1, 'same rngSeed produces the same pass (deterministic, not Math.random())');

const forcedPlay = await playCard('random-hearts-play', 'deadbeef');
assertEqual(
  forcedPlay,
  { ok: true, action: { type: 'play', card: { suit: 'clubs', rank: 2 } } },
  'plays the only legal card when forced',
);

console.log('\nAll checks passed.');
