import type { Rng } from '@thunderdome/rng';
import type { Card } from './cards.js';

/**
 * Fisher-Yates (Durstenfeld variant), using only `rng.nextInt(n)` — no shuffle helper exists
 * anywhere else in the repo. Standard algorithm: walk the array from the last index down to 1,
 * swapping element `i` with a uniformly random element in `[0, i]`. Never mutates the input —
 * returns a new array.
 */
export function shuffle(cards: readonly Card[], rng: Rng): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) {
      throw new Error('unreachable: shuffle index out of bounds');
    }
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/**
 * Splits `cards` into `numHands` even, contiguous groups. Contiguous slicing (rather than
 * one-card-at-a-time round-robin dealing) is statistically identical here — the input was already
 * uniformly permuted by `shuffle`, so *which* contiguous slice lands in which hand is itself
 * uniformly random. Throws if `cards.length` isn't evenly divisible by `numHands`; this is
 * game-agnostic and has no notion of participant ids — mapping a hand back to a player is the
 * calling game's job.
 */
export function dealHands(cards: readonly Card[], numHands: number): Card[][] {
  if (!Number.isInteger(numHands) || numHands <= 0) {
    throw new Error('dealHands requires a positive integer numHands');
  }
  if (cards.length % numHands !== 0) {
    throw new Error(
      `dealHands requires cards.length (${String(cards.length)}) to be evenly divisible by numHands (${String(numHands)})`,
    );
  }
  const handSize = cards.length / numHands;
  const hands: Card[][] = [];
  for (let i = 0; i < numHands; i += 1) {
    hands.push(cards.slice(i * handSize, (i + 1) * handSize));
  }
  return hands;
}
