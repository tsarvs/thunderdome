/**
 * Point Dodger Hearts — a simple heuristic that actually tries to avoid taking points:
 *   - Passing: sheds its 3 most dangerous cards (the queen of spades first, then high spades,
 *     then high hearts, then whatever's left).
 *   - Leading: opens with the lowest non-point card it can, since leading a point card just
 *     hands someone else free points for nothing.
 *   - Following, still holding the led suit: "ducks" under the trick's current winner with the
 *     highest card that still loses (burns a safe card while keeping its low cards in reserve).
 *   - Following, void in the led suit: the safest possible moment to dump its most dangerous
 *     card, since discarding never risks winning the trick.
 *   - Forced to win (holds the led suit but every card beats the current winner): takes the
 *     trick as cheaply as possible.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs to
 * answer one question: decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk-js';

function isPointCard(card) {
  return card.suit === 'hearts' || (card.suit === 'spades' && card.rank === 12);
}

/** Higher = more dangerous to be caught holding. The queen of spades tops the list; a high
 * spade is the next-riskiest thing to hold (it can force you into leading toward the queen), then
 * high hearts, then everything else by plain rank. */
function dangerScore(card) {
  if (card.suit === 'spades' && card.rank === 12) {
    return 1000;
  }
  if (card.suit === 'spades') {
    return 500 + card.rank;
  }
  if (card.suit === 'hearts') {
    return 100 + card.rank;
  }
  return card.rank;
}

function lowestOf(cards) {
  return cards.reduce((lowest, card) => (card.rank < lowest.rank ? card : lowest));
}

function highestOf(cards) {
  return cards.reduce((highest, card) => (card.rank > highest.rank ? card : highest));
}

function mostDangerousOf(cards) {
  return cards.reduce((worst, card) => (dangerScore(card) > dangerScore(worst) ? card : worst));
}

function choosePass(hand) {
  return [...hand].sort((a, b) => dangerScore(b) - dangerScore(a)).slice(0, 3);
}

function choosePlay(observation) {
  const legal = observation.legalPlays;
  const trick = observation.currentTrick;

  // Leading a fresh trick: avoid handing out points if there's any alternative.
  if (trick === null || trick.plays.length === 0) {
    const safe = legal.filter((card) => !isPointCard(card));
    return lowestOf(safe.length > 0 ? safe : legal);
  }

  const ledSuit = trick.plays[0].card.suit;
  const currentBest = trick.plays
    .filter((play) => play.card.suit === ledSuit)
    .reduce((best, play) => (play.card.rank > best.rank ? play.card : best), trick.plays[0].card);

  const followingLedSuit = legal.filter((card) => card.suit === ledSuit);

  // Void in the led suit — the one moment discarding is entirely free of risk. Dump the most
  // dangerous card in hand rather than saving it for later.
  if (followingLedSuit.length === 0) {
    return mostDangerousOf(legal);
  }

  // Can duck under the current winner: burn the highest card that still loses, so low cards
  // stay in reserve for future ducking.
  const canDuck = followingLedSuit.filter((card) => card.rank < currentBest.rank);
  if (canDuck.length > 0) {
    return highestOf(canDuck);
  }

  // Forced to win this trick one way or another — take it as cheaply as possible.
  return lowestOf(followingLedSuit);
}

function decideAction(observation) {
  if (observation.phase === 'passing') {
    return { type: 'pass', cards: choosePass(observation.hand) };
  }
  return { type: 'play', card: choosePlay(observation) };
}

runBot({ decideAction });
