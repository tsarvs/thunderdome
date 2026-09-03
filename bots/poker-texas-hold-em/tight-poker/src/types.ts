// Mirrors games/poker-texas-hold-em/src/types.ts's Observation/Action shapes — bots/** never
// depends on games/** (docs/adr/0001-monorepo-and-boundary.md), so this is a hand-copied subset,
// not an import. `lastHandSummary` is typed loosely since this bot's strategy never reads it.

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
/** 2..10, then 11=J, 12=Q, 13=K, 14=A — numeric so "highest card" is a plain `>`. */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type LegalActionType = 'fold' | 'check' | 'call' | 'raise' | 'allIn';

export interface Opponent {
  participantId: string;
  stack: number;
  committed: number;
  committedThisStreet: number;
  folded: boolean;
  allIn: boolean;
  isButton: boolean;
}

export interface Observation {
  you: string;
  handNumber: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  board: Card[];
  holeCards: [Card, Card];
  pot: number;
  yourStack: number;
  yourCommittedThisStreet: number;
  /** 0 means you can check. */
  toCall: number;
  /** The minimum legal `raise` amount, or `null` if you have no chips left to raise with. */
  minRaiseTo: number | null;
  /** Your all-in amount — the max legal `raise` amount. */
  maxRaiseTo: number;
  smallBlind: number;
  bigBlind: number;
  buttonParticipantId: string;
  opponents: Opponent[];
  legalActions: LegalActionType[];
  lastHandSummary: unknown;
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' };
