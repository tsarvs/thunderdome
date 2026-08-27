import type { Card, Rank, Suit } from './types.js';

const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const cardKey = (card: Card): string => `${card.suit}-${String(card.rank)}`;

export const fullDeck = (): Card[] => SUITS.flatMap(suit => RANKS.map(rank => ({ suit, rank })));
