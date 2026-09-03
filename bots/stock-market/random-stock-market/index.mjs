/**
 * Random Stock Market — each round, picks uniformly at random among whatever's currently legal
 * (HOLD always; BUY only if at least 1 share is affordable; SELL only if shares are owned), then
 * a uniformly random quantity (capped at 10 shares, for variety without wild single-round swings).
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action, and seed its own PRNG once the match's rngSeed arrives via
 * `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

// ---------------------------------------------------------------------------
// Strategy — the only part that makes this bot different from any other bot in this repo.
// ---------------------------------------------------------------------------

/**
 * Decide this turn's action. `transactionFee` is never exposed to a bot, so `maxAffordable`
 * leaves a 1% cash buffer as margin for whatever fee rate is actually configured — the default
 * (0.10%) is well within it.
 */
function decideAction(observation) {
  const { portfolio, market } = observation;
  const maxAffordable = Math.floor((portfolio.cash * 0.99) / market.price);
  const canBuy = maxAffordable >= 1;
  const canSell = portfolio.shares >= 1;

  const options = ['HOLD'];
  if (canBuy) options.push('BUY');
  if (canSell) options.push('SELL');

  const choice = options[Math.floor(random() * options.length)];

  if (choice === 'BUY') {
    return { action: 'BUY', quantity: 1 + Math.floor(random() * Math.min(maxAffordable, 10)) };
  }
  if (choice === 'SELL') {
    return { action: 'SELL', quantity: 1 + Math.floor(random() * Math.min(portfolio.shares, 10)) };
  }
  return { action: 'HOLD' };
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
