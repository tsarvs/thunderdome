/**
 * Random Trader — Stock Market 2 — each round, picks uniformly at random among whatever's
 * currently legal (HOLD always; BUY only if at least 1 share is affordable; SELL only if shares
 * are held, or a short can be opened when the game has margin enabled), a uniformly random
 * quantity (capped at 10 shares, for variety without wild single-round swings), and a coin flip
 * between a MARKET order and a LIMIT order quoted a small random distance from the visible
 * bid/ask.
 *
 * Ported from bots/stock-market/random-stock-market onto stock-market-2's rebuilt exchange: that
 * bot only ever had one order type to pick from (BUY/SELL/HOLD, no price); this version also
 * exercises LIMIT orders and (when `portfolio.buyingPower > 0`, i.e. the game enabled shorting)
 * short selling — `portfolio.buyingPower` is 0 whenever shorting is off, so `maxSellable` below
 * naturally degrades back to "only sell what's held" without this bot ever needing to read
 * `config.risk` directly.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each turn's action, and seed its own PRNG once the match's rngSeed arrives via
 * `onInit`.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

const MAX_TRADE_QUANTITY = 10;
const LIMIT_PRICE_OFFSET = 0.02; // quote up to 2% away from the reference price

function decideAction(observation) {
  const { portfolio, market } = observation;
  const buyReference = market.ask ?? market.lastClose;
  const sellReference = market.bid ?? market.lastClose;

  const maxAffordable = Math.floor((portfolio.availableCash * 0.99) / buyReference);
  const shortRoom = portfolio.buyingPower > 0 ? Math.floor(portfolio.buyingPower / sellReference) : 0;
  const maxSellable = portfolio.availableShares + shortRoom;

  const options = ['HOLD'];
  if (maxAffordable >= 1) options.push('BUY');
  if (maxSellable >= 1) options.push('SELL');
  const choice = options[Math.floor(random() * options.length)];

  if (choice === 'BUY') {
    const quantity = 1 + Math.floor(random() * Math.min(maxAffordable, MAX_TRADE_QUANTITY));
    return { orders: [buildOrder('BUY', quantity, buyReference, -1)] };
  }
  if (choice === 'SELL') {
    const quantity = 1 + Math.floor(random() * Math.min(maxSellable, MAX_TRADE_QUANTITY));
    return { orders: [buildOrder('SELL', quantity, sellReference, 1)] };
  }
  return { orders: [] };
}

/** `direction`: -1 quotes a BUY limit below the reference, +1 quotes a SELL limit above it. */
function buildOrder(side, quantity, referencePrice, direction) {
  if (random() < 0.5) {
    return { kind: 'MARKET', side, quantity };
  }
  const offset = direction * random() * LIMIT_PRICE_OFFSET;
  const limitPrice = Math.max(0.01, Number((referencePrice * (1 + offset)).toFixed(2)));
  const timeInForce = random() < 0.5 ? 'GTC' : 'DAY';
  return { kind: 'LIMIT', side, quantity, limitPrice, timeInForce };
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
