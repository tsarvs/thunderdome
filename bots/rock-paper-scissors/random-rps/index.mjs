#!/usr/bin/env node
/**
 * Random RPS — picks a uniformly random choice each round.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md for the full protocol walkthrough. This file only needs to
 * decide each round's action, and seed its own PRNG once the match's rngSeed arrives via `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk';

// ---------------------------------------------------------------------------
// Strategy — the only part that makes this bot different from any other bot in this repo.
// ---------------------------------------------------------------------------

const CHOICES = ['rock', 'paper', 'scissors'];

/**
 * Decide this round's action. Ignores the observation entirely — every round is an independent
 * uniform draw from `random` (seeded below, once, from this match's rngSeed).
 */
function decideAction(_observation) {
  return { choice: CHOICES[Math.floor(random() * CHOICES.length)] };
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deliberately NOT Math.random().
//
// docs/adr/0004-deterministic-randomness.md: a bot's own strategy randomness must be
// reproducible given the same seed, so the same tournament can be replayed exactly. This bot
// never needs to match the platform's own PRNG bit-for-bit — only "same code + same seed =>
// same output," which any seeded PRNG trivially satisfies. `random` below is assigned once by
// `onInit` (called by runBot when "init" arrives) and never falls back to Math.random().
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
