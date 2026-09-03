import { runBot } from '@thunderdome/bot-sdk';

/**
 * The T-1 — a standard bot for the "card-game-hearts" game.
 */

type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
/** 2..10, then 11=J, 12=Q, 13=K, 14=A — numeric so "highest of suit" is a plain `>`. */
type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
interface Card {
  suit: Suit;
  rank: Rank;
}

interface HeartsTrick {
  leaderId: string;
  plays: { participantId: string; card: Card }[];
}

interface CompletedTrick {
  plays: { participantId: string; card: Card }[];
  winnerId: string;
}

interface Observation {
  you: string;
  participantIds: [string, string, string, string];
  phase: 'passing' | 'playing';
  handNumber: number;
  passDirection: 'left' | 'right' | 'across' | 'hold';
  /** Your full hand, sorted. */
  hand: Card[];
  /** Every participant including yourself — no other player's actual cards. */
  handSizes: Record<string, number>;
  heartsBroken: boolean;
  tricksCompleted: number;
  isFirstTrick: boolean;
  /** `null` while passing. */
  currentTrick: HeartsTrick | null;
  /** The most recently completed trick this hand — `null` before the first trick of the current
   * hand has completed. */
  lastTrick: CompletedTrick | null;
  scores: Record<string, number>;
  pointLimit: number;
  /** Present only when it's your turn to play a card. */
  legalPlays?: Card[];
  youMustAct: boolean;
}

/** Passing happens once at the start of each hand (except every 4th, which holds); playing a
 * card happens on every other turn. */
type Action = { type: 'pass'; cards: [Card, Card, Card] } | { type: 'play'; card: Card };

// Things to consider when passing:
// 1. Do I have the queen of spades?
// - If so: do i have enough spades that I should hold onto the queen? Yes -> keep the queen. No -> pass it.
// - If not: pass any card that is "above" the queen of spades: ie either the king or ace of spades.
// 2. Am I almost out of any suit? If so, include those 1-2 cards in the pass, both cards must be above a 6.
// 3. If I still have space to pass, then include the highest cards in my hand. If there is a tie between two high cards, like two kings in my hand, then pass the king that has less cards in their given suit, if that is also the same, then pass either.
const choosePass = (hand: Card[]): [Card, Card, Card] => {
  const aceOfSpades = hand.find(card => card.suit === 'spades' && card.rank === 14);
  const kingOfSpades = hand.find(card => card.suit === 'spades' && card.rank === 13);
  const queenOfSpades = hand.find(card => card.suit === 'spades' && card.rank === 12);
  const spadesCount = hand.filter(card => card.suit === 'spades').length;
  const heartsCount = hand.filter(card => card.suit === 'hearts').length;
  const diamondsCount = hand.filter(card => card.suit === 'diamonds').length;
  const clubsCount = hand.filter(card => card.suit === 'clubs').length;

  const KEEP_QUEEN_OF_SPADES_THRESHOLD = 5;
  const OUT_OF_SUIT_COUNT_THRESHOLD = 2;
  const OUT_OF_SUIT_CARD_RANK_THRESHOLD = 6;

  const passCards: Card[] = [];

  // Step 1: Queen of Spades Logic
  if (queenOfSpades) {
    if (spadesCount < KEEP_QUEEN_OF_SPADES_THRESHOLD) {
      passCards.push(queenOfSpades);
    }
  } else {
    if (aceOfSpades) {
      passCards.push(aceOfSpades);
    }
    if (kingOfSpades) {
      passCards.push(kingOfSpades);
    }
  }

  // Step 2: Out of Suit Logic
  const outOfSuitCounts: [Suit, number][] = [
    ['spades', spadesCount],
    ['hearts', heartsCount],
    ['diamonds', diamondsCount],
    ['clubs', clubsCount],
  ];
  for (const [suit, count] of outOfSuitCounts) {
    const openings = 3 - passCards.length;
    if (openings <= 0) break;
    if (count <= OUT_OF_SUIT_COUNT_THRESHOLD) {
      // The 2 of clubs leads off after passing, so it's safe to pass alongside a high club — but
      // only if doing so actually clears the suit. If another low, non-2 club would be left
      // behind, passing the 2 alone doesn't get us out of clubs, so skip the exception.
      const canPassTwoOfClubs =
        suit === 'clubs' &&
        !hand.some(card => card.suit === 'clubs' && card.rank !== 2 && card.rank < OUT_OF_SUIT_CARD_RANK_THRESHOLD);

      const outOfSuitCards = hand.filter(
        card =>
          card.suit === suit &&
          (card.rank >= OUT_OF_SUIT_CARD_RANK_THRESHOLD || (canPassTwoOfClubs && card.rank === 2)),
      );

      if (outOfSuitCards.length <= openings) {
        passCards.push(...outOfSuitCards);
      }
    }
  }

  // Step 3: Highest Card Logic
  if (passCards.length < 3) {
    const highestCards = hand.sort((a, b) => b.rank - a.rank);
    passCards.push(...highestCards.slice(0, 3 - passCards.length));
  }

  return passCards as [Card, Card, Card];
};

const choosePlay = (observation: Observation): Card => {
  //In the first trick, play the highest card possible
  if (observation.isFirstTrick && observation.legalPlays) {
    return observation.legalPlays.sort((a, b) => b.rank - a.rank)[0];
  }

  //If I lead, play the lowest card possible
  if (observation.currentTrick?.leaderId === observation.you) {
    return observation.legalPlays!.sort((a, b) => a.rank - b.rank)[0];
  }

  // Otherwise, play the highest-ranked legal card that's still below the highest-ranked card
  // currently in the trick — duck under the trick without wasting a stronger card than needed.
  // If every legal card is at or above that (no safe duck), fall back to the lowest legal card.
  const highestInTrick = Math.max(...observation.currentTrick!.plays.map(play => play.card.rank));
  const cardsBelowTrick = observation.legalPlays!.filter(card => card.rank < highestInTrick);
  return cardsBelowTrick.length > 0
    ? cardsBelowTrick.sort((a, b) => b.rank - a.rank)[0]
    : observation.legalPlays!.sort((a, b) => a.rank - b.rank)[0];
};

function decideAction(_observation: Observation): Action {
  if (_observation.phase === 'passing') {
    return { type: 'pass', cards: choosePass(_observation.hand) };
  }
  return { type: 'play', card: choosePlay(_observation) };
}

runBot<Observation, Action>({ decideAction });
