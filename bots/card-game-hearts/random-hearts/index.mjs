/**
 * Random Hearts — a uniformly random legal action every turn: 3 random cards during the passing
 * phase, a random card from `legalPlays` during the playing phase.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. This file only needs to
 * decide each turn's action, and seed its own PRNG once the match's rngSeed arrives via `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk';

// ---------------------------------------------------------------------------
// Strategy — the only part that makes this bot different from any other bot in this repo.
// ---------------------------------------------------------------------------

/** 3 distinct cards drawn uniformly at random from `hand`, without replacement. */
function chooseRandomPass(hand) {
  const pool = [...hand];
  const chosen = [];
  for (let i = 0; i < 3 && pool.length > 0; i += 1) {
    const index = Math.floor(random() * pool.length);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function decideAction(observation) {
  if (observation.phase === 'passing') {
    return { type: 'pass', cards: chooseRandomPass(observation.hand) };
  }
  const legalPlays = observation.legalPlays;
  const index = Math.floor(random() * legalPlays.length);
  return { type: 'play', card: legalPlays[index] };
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deliberately NOT Math.random(). Identical to bots/connect-four/
// random-connect-four's own copy (docs/adr/0004-deterministic-randomness.md): a bot's own
// strategy randomness must be reproducible given the same seed, so a tournament can be replayed
// exactly. This bot never needs to match the platform's own PRNG bit-for-bit — only "same code +
// same seed => same output," which any seeded PRNG trivially satisfies.
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
