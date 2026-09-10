import type { Rng } from '@thunderdome/engine';

/** Standard-normal draw via Box-Muller, built on the engine's own `Rng.nextFloat()` (which only
 * exposes uniform draws) — every stochastic process in this game (factors, idiosyncratic shocks,
 * analyst-estimate noise) needs Gaussian, not uniform, innovations. Deterministic given `rng`'s
 * next two draws; always consumes exactly two regardless of output, so it's safe to call
 * unconditionally without desynchronizing later draws across a code path that branches on the
 * result. */
export function gaussian(rng: Rng): number {
  const u1 = Math.max(rng.nextFloat(), Number.EPSILON);
  const u2 = rng.nextFloat();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** One step of a discrete Ornstein-Uhlenbeck (mean-reverting) process: pulls `current` toward
 * `mean` at `speed` (0 = never reverts, 1 = snaps to the mean every step), then adds a Gaussian
 * shock scaled by `volatility`. The shared building block behind every hidden economic factor,
 * company fundamental, and analyst estimate in this game — "reverts toward some anchor, with
 * noise on top" is the one stochastic idiom used everywhere. */
export function ouStep(args: { current: number; mean: number; speed: number; volatility: number; rng: Rng }): number {
  const { current, mean, speed, volatility, rng } = args;
  return current + speed * (mean - current) + volatility * gaussian(rng);
}

/** Deterministic given `rng`'s next draw. Picks one option from a Markov-style weighted
 * transition table (reused shape for both market regime and company lifecycle transitions). */
export function weightedTransition<T extends string>(
  options: readonly { to: T; weight: number }[],
  rng: Rng,
): T {
  const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
  let draw = rng.nextFloat() * totalWeight;
  for (const option of options) {
    draw -= option.weight;
    if (draw <= 0) {
      return option.to;
    }
  }
  const last = options[options.length - 1];
  if (last === undefined) {
    throw new Error('weightedTransition requires at least one option');
  }
  return last.to;
}
