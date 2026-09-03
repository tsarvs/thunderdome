/**
 * Random Poker — picks uniformly among whatever `observation.legalActions` currently allows
 * (fold/check/call/raise/allIn), with a uniformly random raise-to amount when it raises. It has
 * no notion of hand strength or pot odds at all — the simplest possible reference bot, meant as a
 * baseline other poker bots can be measured against, exactly like random-hearts and
 * random-connect-four are for their own games.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs to
 * decide each turn's action, and seed its own PRNG once the match's rngSeed arrives via `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk';

// ---------------------------------------------------------------------------
// Strategy — the only part that makes this bot different from any other bot in this repo.
// ---------------------------------------------------------------------------

function decideAction(observation) {
  const { legalActions } = observation;
  const action = legalActions[Math.floor(random() * legalActions.length)];

  if (action === 'raise') {
    const min = observation.minRaiseTo ?? observation.maxRaiseTo;
    const max = observation.maxRaiseTo;
    const amount = min + Math.floor(random() * (max - min + 1));
    return { type: 'raise', amount };
  }
  return { type: action };
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deliberately NOT Math.random(). Identical to bots/card-game-hearts/
// random-hearts's own copy (docs/adr/0004-deterministic-randomness.md): a bot's own strategy
// randomness must be reproducible given the same seed, so a tournament can be replayed exactly.
// This bot never needs to match the platform's own PRNG bit-for-bit — only "same code + same
// seed => same output," which any seeded PRNG trivially satisfies.
// ---------------------------------------------------------------------------

let random; // seeded once `init` arrives — never falls back to Math.random()

function hashSeed(hex) {
  let hash = 0;
  for (let i = 0; i < hex.length; i += 1) {
    hash = (Math.imul(hash, 31) + hex.charCodeAt(i)) | 0;
  }
  return hash;
}

/** mulberry32 — a small, well-known deterministic PRNG. No dependency needed. */
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

runBot({
  decideAction,
  onInit: ({ rngSeed }) => {
    random = mulberry32(hashSeed(rngSeed));
  },
});
