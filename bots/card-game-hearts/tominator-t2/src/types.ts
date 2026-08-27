/**
 * Tominator T2 — a "hard-mode" bot for the "card-game-hearts" game.
 */

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
/** 2..10, then 11=J, 12=Q, 13=K, 14=A — numeric so "highest of suit" is a plain `>`. */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface HeartsTrick {
  leaderId: string;
  plays: { participantId: string; card: Card }[];
}

export interface CompletedTrick {
  plays: { participantId: string; card: Card }[];
  winnerId: string;
}

export interface Observation {
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
  /** Running penalty tally for the CURRENT hand only; reset every hand. */
  handPoints: Record<string, number>;
  scores: Record<string, number>;
  pointLimit: number;
  /** Present only when it's your turn to play a card. */
  legalPlays?: Card[];
  youMustAct: boolean;
}

/** Passing happens once at the start of each hand (except every 4th, which holds); playing a
 * card happens on every other turn. */
export type Action = { type: 'pass'; cards: [Card, Card, Card] } | { type: 'play'; card: Card };
