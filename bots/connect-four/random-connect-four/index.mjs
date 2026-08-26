/**
 * Random Connect Four — picks a uniformly random legal column each turn.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action, and seed its own PRNG once the match's rngSeed arrives via
 * `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk';

// ---------------------------------------------------------------------------
// Strategy — the only part that makes this bot different from any other bot in this repo.
// ---------------------------------------------------------------------------

/** Decide this turn's action: a uniform random draw over the columns still open. */
function decideAction(observation) {
  const index = Math.floor(random() * observation.legalColumns.length);
  return { column: observation.legalColumns[index] };
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deliberately NOT Math.random(). Identical to bots/rock-paper-scissors/
// random-rps's own copy (docs/adr/0004-deterministic-randomness.md): a bot's own strategy
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
