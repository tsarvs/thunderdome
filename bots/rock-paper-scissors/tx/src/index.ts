import { runBot } from '@thunderdome/bot-sdk';

type RpsChoice = 'rock' | 'paper' | 'scissors';

interface RpsObservation {
  round: number;
  totalRounds: number;
  yourWins: number;
  opponentWins: number;
  opponentId: string;
  history: {
    round: number;
    you: RpsChoice | null;
    opponent: RpsChoice | null;
    winner: 'you' | 'opponent' | 'draw';
  }[];
}

type Mode = 'RED_HERRING' | 'RESEARCH' | 'EXPLOIT';
type Rng = { nextInt(upperExclusive: number): number };
type Throw = RpsChoice | null;

const RPS_CHOICES: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
const COUNTER: Record<RpsChoice, RpsChoice> = { rock: 'paper', paper: 'scissors', scissors: 'rock' }; // choice that beats the key

const CARDS_PER_MOVE = 33;
const DECK_WINDOW = 3 * CARDS_PER_MOVE;

const RED_HERRING_TURNS = 3;
const RED_HERRING_INTERVAL = 150;

const MIN_SAMPLES = 8; // minimum observations in a context bucket before trusting it
const Z_THRESHOLD = 2.0; // one-sided z-score cutoff vs. a uniform-1/3 null: "a signal exists at all"
const EXPLOIT_Z_THRESHOLD = 2.5; // stricter bar than Z_THRESHOLD, gating EXPLOIT specifically
const MIX_PERCENT = 90; // % chance we throw the predicted counter move outright once exploiting
const RESEARCH_WINDOW = 100; // sliding window for both opponent-pattern signals
const LEAD_WINDOW = 50; // trailing throws checked by the defensive-lead gate
const MIN_SIGNAL_HISTORY = DECK_WINDOW; // require one full deck-window of data before trusting the my-history-conditioned signal

function countThrows(history: Throw[]): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  for (const entry of history) {
    if (entry !== null) counts[entry] += 1;
  }
  return counts;
}

function chooseRandomMove(rng: Rng): RpsChoice {
  return RPS_CHOICES[rng.nextInt(RPS_CHOICES.length)];
}

function lastKThrows(history: Throw[], k: number): Throw[] | null {
  return history.length < k ? null : history.slice(history.length - k);
}

function trailingWindow(history: Throw[], window: number): Throw[] {
  return history.length <= window ? history : history.slice(history.length - window);
}

function sameSequence(a: Throw[], b: Throw[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// A self-correcting, perpetual "shuffleable deck": balances against a trailing DECK_WINDOW of
// our OWN recent throws, pulling more of whichever choice we've under-thrown recently. The
// `Math.max(1, ...)` floor matters: without it, an exactly-balanced window would compute zero
// remaining cards for every choice -- an empty deck, and a crash on the next rng.nextInt(0).
function buildBalancingDeck(myHistory: Throw[]): RpsChoice[] {
  const counts = countThrows(trailingWindow(myHistory, DECK_WINDOW));
  const deck: RpsChoice[] = [];

  for (const choice of RPS_CHOICES) {
    const remaining = Math.max(1, CARDS_PER_MOVE - counts[choice]);
    for (let i = 0; i < remaining; i += 1) deck.push(choice);
  }
  return deck;
}

function drawFromDeck(myHistory: Throw[], rng: Rng): RpsChoice {
  const deck = buildBalancingDeck(myHistory); // rebuilt fresh every call, from current history

  const topIndex = rng.nextInt(deck.length);
  [deck[0], deck[topIndex]] = [deck[topIndex], deck[0]];

  return deck[0];
}

function significantThrowWithScore(counts: Record<RpsChoice, number>): { choice: RpsChoice; z: number } | null {
  const total = counts.rock + counts.paper + counts.scissors;
  if (total < MIN_SAMPLES) return null;

  const max = Math.max(counts.rock, counts.paper, counts.scissors);
  const winners = RPS_CHOICES.filter((choice) => counts[choice] === max);
  if (winners.length !== 1) return null; // an exact tie is ambiguous, not a signal

  const z = (max - total / 3) / Math.sqrt(total * (2 / 9));
  return z > Z_THRESHOLD ? { choice: winners[0], z } : null;
}

function contextCounts(
  recentMy: Throw[],
  recentOpponent: Throw[],
  context: Throw[],
  k: number,
): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  const len = Math.min(recentMy.length, recentOpponent.length);

  for (let i = k; i < len; i += 1) {
    if (sameSequence(recentMy.slice(i - k, i), context)) {
      const response = recentOpponent[i];
      if (response !== null) counts[response] += 1;
    }
  }
  return counts;
}

function selfContextCounts(opponentHistory: Throw[], context: Throw[], k: number): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  for (let i = k; i < opponentHistory.length; i += 1) {
    if (sameSequence(opponentHistory.slice(i - k, i), context)) {
      const response = opponentHistory[i];
      if (response !== null) counts[response] += 1;
    }
  }
  return counts;
}

// Opponent's own throw autocorrelation -- catches a scripted or self-correlated pattern
// regardless of anything we throw. Bounded to a trailing window so a stale pre-shift tally can't
// outvote a real post-shift pattern later on.
function bestSelfPatternSignal(opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  const recent = trailingWindow(opponentHistory, RESEARCH_WINDOW);
  for (const k of [3, 2, 1]) {
    const context = lastKThrows(recent, k);
    if (context === null) continue;

    const candidate = significantThrowWithScore(selfContextCounts(recent, context, k));
    if (candidate) return candidate;
  }
  return null;
}

// Their reply conditioned on our recent throws. Gated behind MIN_SIGNAL_HISTORY so it never
// fires on a still-thin sample -- one full deck-window's worth of our own history first.
function bestHistorySignal(myHistory: Throw[], opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  if (Math.min(myHistory.length, opponentHistory.length) < MIN_SIGNAL_HISTORY) return null;

  const recentMy = trailingWindow(myHistory, RESEARCH_WINDOW);
  const recentOpponent = trailingWindow(opponentHistory, RESEARCH_WINDOW);

  for (const k of [3, 2, 1]) {
    const context = lastKThrows(myHistory, k);
    if (context === null) continue;

    const candidate = significantThrowWithScore(contextCounts(recentMy, recentOpponent, context, k));
    if (candidate) return candidate;
  }
  return significantThrowWithScore(countThrows(recentOpponent)); // fall back to overall opponent bias
}

// The stronger of the two independent signals, by z-score.
function bestOverallSignal(myHistory: Throw[], opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  const selfSignal = bestSelfPatternSignal(opponentHistory);
  const historySignal = bestHistorySignal(myHistory, opponentHistory);

  if (!selfSignal) return historySignal;
  if (!historySignal) return selfSignal;

  return selfSignal.z >= historySignal.z ? selfSignal : historySignal;
}

function throwWithMix(predicted: RpsChoice, rng: Rng): RpsChoice {
  const counter = COUNTER[predicted];
  if (rng.nextInt(100) < MIX_PERCENT) return counter;

  const others = RPS_CHOICES.filter((choice) => choice !== counter);
  return others[rng.nextInt(2)];
}

function chooseCalculatedMove(myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  const signal = bestOverallSignal(myHistory, opponentHistory);
  return signal ? throwWithMix(signal.choice, rng) : chooseRandomMove(rng);
}

// A lead worth protecting is a RECENT one, not a whole-match average that could take a long time
// to reflect a swing either way. Returns -Infinity (never "ahead enough") when there isn't yet
// enough data to trust, rather than assuming a lead that isn't backed by it.
function recentWinRateZ(myHistory: Throw[], opponentHistory: Throw[], window: number): number {
  const len = Math.min(myHistory.length, opponentHistory.length);
  const start = Math.max(0, len - window);
  let wins = 0;
  let total = 0;

  for (let i = start; i < len; i += 1) {
    const my = myHistory[i];
    const opp = opponentHistory[i];
    if (my === null || opp === null) continue;
    total += 1;
    if (COUNTER[opp] === my) wins += 1;
  }

  if (total < MIN_SAMPLES) return -Infinity;
  return (wins - total / 3) / Math.sqrt(total * (2 / 9));
}

// Defensive core of the design: a real recent lead sends us back to RESEARCH instead of letting
// a strong signal push us into EXPLOIT -- protecting Series/Standing Points already effectively
// in hand rather than risking them chasing more round-win margin.
function aheadEnoughToDefend(myHistory: Throw[], opponentHistory: Throw[]): boolean {
  return recentWinRateZ(myHistory, opponentHistory, LEAD_WINDOW) > Z_THRESHOLD;
}

// Picks the bait throw fresh, from the private rng, on the first turn of each burst, then
// repeats it for the rest of that burst by reading it back out of our own history -- stateless,
// and not a fixed, publicly-known tell the way a hardcoded bait throw would be.
function chooseRedHerringMove(turn: number, myHistory: Throw[], rng: Rng): RpsChoice {
  const burstStartTurn = turn - (turn % RED_HERRING_INTERVAL);
  if (turn === burstStartTurn) return chooseRandomMove(rng);

  return myHistory[burstStartTurn] ?? chooseRandomMove(rng);
}

// Recomputed fresh from (turn, myHistory, opponentHistory) every call -- no counters, no
// memoized "how did we get here". RESEARCH is the default outcome; EXPLOIT is the exception,
// carved out only when we're not already ahead AND the evidence clears a strict bar.
function currentMode(turn: number, myHistory: Throw[], opponentHistory: Throw[]): Mode {
  if (turn % RED_HERRING_INTERVAL < RED_HERRING_TURNS) return 'RED_HERRING';

  if (aheadEnoughToDefend(myHistory, opponentHistory)) return 'RESEARCH';

  const signal = bestOverallSignal(myHistory, opponentHistory);
  if (signal && signal.z > EXPLOIT_Z_THRESHOLD) return 'EXPLOIT';

  return 'RESEARCH';
}

function chooseMove(turn: number, myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  switch (currentMode(turn, myHistory, opponentHistory)) {
    case 'RED_HERRING':
      return chooseRedHerringMove(turn, myHistory, rng);
    case 'EXPLOIT':
      return chooseCalculatedMove(myHistory, opponentHistory, rng);
    case 'RESEARCH':
      return drawFromDeck(myHistory, rng);
  }
}

let random: (() => number) | undefined; // seeded once `init` arrives -- never falls back to Math.random()

function hashSeed(hex: string): number {
  let hash = 0;
  for (let i = 0; i < hex.length; i += 1) {
    hash = (Math.imul(hash, 31) + hex.charCodeAt(i)) | 0;
  }
  return hash;
}

/** mulberry32 -- a small, well-known deterministic PRNG. No dependency needed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decideAction(observation: RpsObservation): { choice: RpsChoice } {
  const rng: Rng = { nextInt: (upperExclusive) => Math.floor((random?.() ?? 0) * upperExclusive) };
  const myHistory = observation.history.map((round) => round.you);
  const opponentHistory = observation.history.map((round) => round.opponent);

  return { choice: chooseMove(observation.round, myHistory, opponentHistory, rng) };
}

runBot<RpsObservation, { choice: RpsChoice }>({
  decideAction,
  onInit: ({ rngSeed }) => {
    random = mulberry32(hashSeed(rngSeed));
  },
});
