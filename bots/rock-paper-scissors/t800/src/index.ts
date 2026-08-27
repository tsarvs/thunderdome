/**
 * t800 — ported from a standalone RPS-bot-tournament template ("T1"). Three fixed phases over a
 * 300-round match: early game (turns 0-98) explores via a no-replacement 33/33/33 deck while
 * watching for an obvious opponent self-pattern worth exploiting immediately; mid game exploits
 * whatever pattern the early-game window taught it; late game either keeps coasting on a
 * still-winning read or re-evaluates (win-stay/lose-shift, then the general pattern signal) once
 * its edge erodes.
 *
 * All NDJSON wire-protocol handling lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/rps-bot-author-guide.md.
 */
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

type Rng = { nextInt(upperExclusive: number): number };
/** A round either side forfeited (no `choice`) has no throw to record. */
type Throw = RpsChoice | null;
type TurnOutcome = 'win' | 'loss' | 'tie';

const RPS_CHOICES: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
const COUNTER: Record<RpsChoice, RpsChoice> = { rock: 'paper', paper: 'scissors', scissors: 'rock' }; // choice that beats the key

const EARLY_GAME_TURNS = 99; // turns 0-98 draw from the deck
const LATE_GAME_TURNS = 100; // last 100 turns (of a 300-turn match) are "late game"
const LATE_GAME_START = 300 - LATE_GAME_TURNS; // 200
const CARDS_PER_MOVE = 33; // 33 * 3 = EARLY_GAME_TURNS

const MIN_SAMPLES = 8; // minimum observations in a context bucket before trusting it
const Z_THRESHOLD = 1.75; // one-sided z-score cutoff vs. a uniform-1/3 null
const MIX_PERCENT = 85; // % chance we throw the predicted counter move outright
const PERFORMANCE_WINDOW = 50; // trailing throws checked by the late-game performance gate

function countThrows(history: Throw[]): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  for (const entry of history) {
    if (entry !== null) counts[entry] += 1;
  }
  return counts;
}

// A one-shot, no-replacement 33/33/33 deck -- exhausted exactly at EARLY_GAME_TURNS, so it's only
// ever drawn from during the early game (turn < EARLY_GAME_TURNS), never rebuilt as "perpetual."
function buildRemainingDeck(myHistory: Throw[]): RpsChoice[] {
  const counts = countThrows(myHistory);
  const deck: RpsChoice[] = [];

  for (const choice of RPS_CHOICES) {
    const remaining = CARDS_PER_MOVE - counts[choice];
    for (let i = 0; i < remaining; i += 1) deck.push(choice);
  }
  return deck;
}

function drawFromDeck(myHistory: Throw[], rng: Rng): RpsChoice {
  const deck = buildRemainingDeck(myHistory); // rebuilt fresh every call, from current history

  const topIndex = rng.nextInt(deck.length);
  [deck[0], deck[topIndex]] = [deck[topIndex], deck[0]];

  return deck[0];
}

function chooseRandomMove(rng: Rng): RpsChoice {
  return RPS_CHOICES[rng.nextInt(RPS_CHOICES.length)];
}

function lastKThrows(history: Throw[], k: number): Throw[] | null {
  return history.length < k ? null : history.slice(history.length - k);
}

function sameSequence(a: Throw[], b: Throw[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
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

function significantThrow(counts: Record<RpsChoice, number>): RpsChoice | null {
  return significantThrowWithScore(counts)?.choice ?? null;
}

// Tallies the opponent's early-game reply every time our own last-k throws matched context.
function contextCounts(
  earlyMy: Throw[],
  earlyOpponent: Throw[],
  context: Throw[],
  k: number,
): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  const len = Math.min(earlyMy.length, earlyOpponent.length);

  for (let i = k; i < len; i += 1) {
    if (sameSequence(earlyMy.slice(i - k, i), context)) {
      const response = earlyOpponent[i];
      if (response !== null) counts[response] += 1;
    }
  }
  return counts;
}

// Pure self-pattern signal: never looks at what we threw, so a scripted or turn-driven sequence
// (e.g. a fixed rock -> paper -> scissors cycle) shows up even though it has nothing to do with us.
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

// n-gram backoff over the opponent's own throw sequence: order-3 -> order-2 -> order-1. Uses the
// whole running history (not just the early-game window), so it can be trusted as soon as it
// clears the significance bar, including mid-exploration.
function bestSelfPatternSignal(opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  for (const k of [3, 2, 1]) {
    const context = lastKThrows(opponentHistory, k);
    if (context === null) continue;

    const candidate = significantThrowWithScore(selfContextCounts(opponentHistory, context, k));
    if (candidate) return candidate;
  }
  return null;
}

function predictOpponentSelfPattern(opponentHistory: Throw[]): RpsChoice | null {
  return bestSelfPatternSignal(opponentHistory)?.choice ?? null;
}

// n-gram backoff over the early-game training window: order-3 -> order-2 -> order-1 -> marginal.
function bestHistorySignal(myHistory: Throw[], opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  const earlyMy = myHistory.slice(0, EARLY_GAME_TURNS); // training data: only the early-game window
  const earlyOpponent = opponentHistory.slice(0, EARLY_GAME_TURNS);

  for (const k of [3, 2, 1]) {
    const context = lastKThrows(myHistory, k);
    if (context === null) continue;

    const candidate = significantThrowWithScore(contextCounts(earlyMy, earlyOpponent, context, k));
    if (candidate) return candidate;
  }
  return significantThrowWithScore(countThrows(earlyOpponent)); // fall back to overall opponent bias
}

// The stronger of two independent signals wins: a pattern in the opponent's own sequence (self
// signal) vs. their reply conditioned on our recent throws (history signal). Both scores come
// from the same one-proportion z-test, so comparing them directly ranks evidence strength instead
// of favoring one signal type by fixed priority.
function predictOpponentMove(myHistory: Throw[], opponentHistory: Throw[]): RpsChoice | null {
  const selfSignal = bestSelfPatternSignal(opponentHistory);
  const historySignal = bestHistorySignal(myHistory, opponentHistory);

  if (!selfSignal) return historySignal?.choice ?? null;
  if (!historySignal) return selfSignal.choice;

  return (selfSignal.z >= historySignal.z ? selfSignal : historySignal).choice;
}

function throwWithMix(predicted: RpsChoice, rng: Rng): RpsChoice {
  const counter = COUNTER[predicted];
  if (rng.nextInt(100) < MIX_PERCENT) return counter;

  const others = RPS_CHOICES.filter((choice) => choice !== counter);
  return others[rng.nextInt(2)];
}

function chooseCalculatedMove(myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  const predicted = predictOpponentMove(myHistory, opponentHistory);
  return predicted ? throwWithMix(predicted, rng) : chooseRandomMove(rng);
}

// z-score of our recent win rate vs. a uniform-1/3 null, over the trailing window (floored at
// EARLY_GAME_TURNS so early-game exploration never counts). Infinity when there's not enough
// recent data yet, so we default to "still fine."
function recentWinRateZ(myHistory: Throw[], opponentHistory: Throw[]): number {
  const len = Math.min(myHistory.length, opponentHistory.length);
  const start = Math.max(EARLY_GAME_TURNS, len - PERFORMANCE_WINDOW);
  let wins = 0;
  let total = 0;

  for (let i = start; i < len; i += 1) {
    const my = myHistory[i];
    const opp = opponentHistory[i];
    if (my === null || opp === null) continue;
    total += 1;
    if (COUNTER[opp] === my) wins += 1;
  }

  if (total < MIN_SAMPLES) return Infinity; // not enough recent data to judge -- assume it's fine
  return (wins - total / 3) / Math.sqrt(total * (2 / 9));
}

function stillPerformingWell(myHistory: Throw[], opponentHistory: Throw[]): boolean {
  return recentWinRateZ(myHistory, opponentHistory) > Z_THRESHOLD;
}

// Was the given round a win, loss, or tie from the OPPONENT's point of view?
function outcomeForOpponent(myMove: RpsChoice, oppMove: RpsChoice): TurnOutcome {
  if (myMove === oppMove) return 'tie';
  return COUNTER[myMove] === oppMove ? 'win' : 'loss'; // opponent's move beats mine -> opponent won
}

// Tallies the opponent's reply, over the WHOLE match so far, every time the PREVIOUS round's
// outcome (for the opponent) matched `outcome`.
function contextCountsByOutcome(
  myHistory: Throw[],
  opponentHistory: Throw[],
  outcome: TurnOutcome,
): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  const len = Math.min(myHistory.length, opponentHistory.length);

  for (let i = 1; i < len; i += 1) {
    const prevMy = myHistory[i - 1];
    const prevOpp = opponentHistory[i - 1];
    const response = opponentHistory[i];
    if (prevMy === null || prevOpp === null || response === null) continue;
    if (outcomeForOpponent(prevMy, prevOpp) === outcome) counts[response] += 1;
  }
  return counts;
}

function predictOpponentMoveWSLS(myHistory: Throw[], opponentHistory: Throw[]): RpsChoice | null {
  const len = Math.min(myHistory.length, opponentHistory.length);
  if (len < 1) return null; // need at least one completed round to know the last outcome

  const prevMy = myHistory[len - 1];
  const prevOpp = opponentHistory[len - 1];
  if (prevMy === null || prevOpp === null) return null;

  // look up how the opponent has historically responded after this exact outcome
  return significantThrow(contextCountsByOutcome(myHistory, opponentHistory, outcomeForOpponent(prevMy, prevOpp)));
}

function chooseLateGameMove(myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  if (stillPerformingWell(myHistory, opponentHistory)) {
    return chooseCalculatedMove(myHistory, opponentHistory, rng); // keep coasting
  }

  // re-evaluate: try the win-stay/lose-shift signal first, then fall back to the move-sequence chain
  const predicted = predictOpponentMoveWSLS(myHistory, opponentHistory) ?? predictOpponentMove(myHistory, opponentHistory);
  return predicted ? throwWithMix(predicted, rng) : chooseRandomMove(rng);
}

function chooseMove(turn: number, myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  if (turn < EARLY_GAME_TURNS) {
    const selfPattern = predictOpponentSelfPattern(opponentHistory);
    if (selfPattern) return throwWithMix(selfPattern, rng); // an obvious opponent pattern is worth exploiting even mid-exploration
    return drawFromDeck(myHistory, rng); // otherwise keep exploring via the no-replacement deck
  }

  if (turn < LATE_GAME_START) {
    return chooseCalculatedMove(myHistory, opponentHistory, rng); // mid game: exploit early-game patterns
  }

  return chooseLateGameMove(myHistory, opponentHistory, rng); // late game: keep coasting or re-evaluate
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
