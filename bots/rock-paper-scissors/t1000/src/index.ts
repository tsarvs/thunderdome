/**
 * t1000 — ported from a standalone RPS-bot-tournament template ("T2"). Builds on the same
 * primitives as t800 ("T1") but adds a real state machine over the match (RED_HERRING, RESEARCH,
 * EXPLOIT, REEVALUATE, DEFENSE): a short repeated bait move at the top of every 100-turn block to
 * see whether a naive opponent detector locks on; exploiting whenever a signal or recent win rate
 * says it's working; falling back to RESEARCH (or, late and confidently ahead, DEFENSE) once a
 * losing streak says it isn't.
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

type Mode = 'RED_HERRING' | 'RESEARCH' | 'EXPLOIT' | 'REEVALUATE' | 'DEFENSE';
type Rng = { nextInt(upperExclusive: number): number };
/** A round either side forfeited (no `choice`) has no throw to record. */
type Throw = RpsChoice | null;
type TurnOutcome = 'win' | 'loss' | 'tie';

const RPS_CHOICES: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
const COUNTER: Record<RpsChoice, RpsChoice> = { rock: 'paper', paper: 'scissors', scissors: 'rock' }; // choice that beats the key

const CARDS_PER_MOVE = 33;
const EARLY_GAME_TURNS = 3 * CARDS_PER_MOVE; // turns 0-98 draw from the deck; the only window where our own throws are guaranteed decorrelated from the opponent

const RED_HERRING_TURNS = 3; // repeat one fixed move this long before real exploration starts, to bait naive opponent detectors into locking on early
const RED_HERRING_INTERVAL = 100; // repeat the bait at the top of every block this long, not just once at match start

const MIN_SAMPLES = 8; // minimum observations in a context bucket before trusting it
const Z_THRESHOLD = 1.75; // one-sided z-score cutoff vs. a uniform-1/3 null
const MIX_PERCENT = 85; // % chance we throw the predicted counter move outright
const PERFORMANCE_WINDOW = 50; // trailing throws checked by the exploit-confidence gate
const RESEARCH_WINDOW = 100; // trailing throws required before a losing streak triggers a reset; also the self-pattern signal's recency horizon
const DEFENSIVE_ELIGIBLE_TURN = 250; // DEFENSE only considered in the final 50 of 300 turns -- not enough match left there for a RESEARCH reset to pay off
const DEFENSIVE_Z_THRESHOLD = 2; // stricter than Z_THRESHOLD: coasting on a lead for the rest of the match needs stronger evidence than a routine mode switch

function countThrows(history: Throw[]): Record<RpsChoice, number> {
  const counts: Record<RpsChoice, number> = { rock: 0, paper: 0, scissors: 0 };
  for (const entry of history) {
    if (entry !== null) counts[entry] += 1;
  }
  return counts;
}

// A one-shot, no-replacement 33/33/33 deck -- exhausted exactly at EARLY_GAME_TURNS, so it's only
// ever drawn from during the early game (turn < EARLY_GAME_TURNS).
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

function trailingWindow(history: Throw[], window: number): Throw[] {
  return history.length <= window ? history : history.slice(history.length - window);
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

function bestHistorySignal(myHistory: Throw[], opponentHistory: Throw[]): { choice: RpsChoice; z: number } | null {
  if (Math.min(myHistory.length, opponentHistory.length) < EARLY_GAME_TURNS) return null;

  const recentMy = trailingWindow(myHistory.slice(RED_HERRING_TURNS), RESEARCH_WINDOW);
  const recentOpponent = trailingWindow(opponentHistory.slice(RED_HERRING_TURNS), RESEARCH_WINDOW);

  for (const k of [3, 2, 1]) {
    const context = lastKThrows(myHistory, k);
    if (context === null) continue;

    const candidate = significantThrowWithScore(contextCounts(recentMy, recentOpponent, context, k));
    if (candidate) return candidate;
  }
  return significantThrowWithScore(countThrows(recentOpponent)); // fall back to overall opponent bias
}

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

function recentWinRateZ(myHistory: Throw[], opponentHistory: Throw[], window: number): number {
  const len = Math.min(myHistory.length, opponentHistory.length);
  const start = Math.max(EARLY_GAME_TURNS, len - window);
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
  return recentWinRateZ(myHistory, opponentHistory, PERFORMANCE_WINDOW) > Z_THRESHOLD;
}

function sustainedlyLosing(myHistory: Throw[], opponentHistory: Throw[]): boolean {
  return recentWinRateZ(myHistory, opponentHistory, RESEARCH_WINDOW) < -Z_THRESHOLD;
}

function confidentlyAhead(myHistory: Throw[], opponentHistory: Throw[]): boolean {
  return recentWinRateZ(myHistory, opponentHistory, Infinity) > DEFENSIVE_Z_THRESHOLD;
}

function outcomeForOpponent(myMove: RpsChoice, oppMove: RpsChoice): TurnOutcome {
  if (myMove === oppMove) return 'tie';
  return COUNTER[myMove] === oppMove ? 'win' : 'loss'; // opponent's move beats mine -> opponent won
}

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

// Picks the bait move fresh, from the private rng, on the first turn of each burst, then repeats
// it for the rest of that burst by reading it back out of our own history -- stays pure/stateless
// while no longer being a fixed, publicly-known tell: an opponent who's read this file still
// knows WHEN a burst happens and THAT it repeats, but not WHICH move it'll be, since that's drawn
// from our private per-match seed rather than hardcoded.
function chooseRedHerringMove(turn: number, myHistory: Throw[], rng: Rng): RpsChoice {
  const burstStartTurn = turn - (turn % RED_HERRING_INTERVAL);
  if (turn === burstStartTurn) return chooseRandomMove(rng); // first turn of this burst: draw fresh

  return myHistory[burstStartTurn] ?? chooseRandomMove(rng);
}

function chooseResearchMove(turn: number, myHistory: Throw[], rng: Rng): RpsChoice {
  return turn < EARLY_GAME_TURNS ? drawFromDeck(myHistory, rng) : chooseRandomMove(rng);
}

function chooseReevaluateMove(myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  const predicted = predictOpponentMoveWSLS(myHistory, opponentHistory) ?? predictOpponentMove(myHistory, opponentHistory);
  return predicted ? throwWithMix(predicted, rng) : chooseRandomMove(rng);
}

function currentMode(turn: number, myHistory: Throw[], opponentHistory: Throw[]): Mode {
  if (turn % RED_HERRING_INTERVAL < RED_HERRING_TURNS) return 'RED_HERRING';

  if (turn < EARLY_GAME_TURNS) {
    return bestSelfPatternSignal(opponentHistory) ? 'EXPLOIT' : 'RESEARCH';
  }

  if (stillPerformingWell(myHistory, opponentHistory)) return 'EXPLOIT';

  if (sustainedlyLosing(myHistory, opponentHistory)) {
    if (turn >= DEFENSIVE_ELIGIBLE_TURN && confidentlyAhead(myHistory, opponentHistory)) {
      return 'DEFENSE';
    }
    return 'RESEARCH';
  }

  return 'REEVALUATE';
}

function chooseMove(turn: number, myHistory: Throw[], opponentHistory: Throw[], rng: Rng): RpsChoice {
  switch (currentMode(turn, myHistory, opponentHistory)) {
    case 'RED_HERRING':
      return chooseRedHerringMove(turn, myHistory, rng);
    case 'RESEARCH':
      return chooseResearchMove(turn, myHistory, rng);
    case 'EXPLOIT':
      return chooseCalculatedMove(myHistory, opponentHistory, rng);
    case 'REEVALUATE':
      return chooseReevaluateMove(myHistory, opponentHistory, rng);
    case 'DEFENSE':
      return chooseRandomMove(rng);
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
