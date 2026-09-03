import type { Card } from '@thunderdome/card-kit';
import { z } from 'zod';
import type { HandCategory } from './hand-evaluator.js';

export const PokerTexasHoldEmConfigSchema = z
  .object({
    /** `'elimination'`: hands repeat until only one participant still has chips (tournament
     * style) — `totalHands` is ignored. `'fixedHands'`: play exactly `totalHands` hands, then
     * rank by final chip count; a hand can still bust participants along the way, and if that
     * ever leaves fewer than 2 with chips the match ends early regardless of `totalHands` (you
     * can't deal a hold'em hand to one player). */
    matchFormat: z.enum(['elimination', 'fixedHands']).default('elimination'),
    totalHands: z.number().int().positive().default(10),
    startingStack: z.number().int().positive().default(1000),
    smallBlind: z.number().int().positive().default(10),
    bigBlind: z.number().int().positive().default(20),
  })
  .refine((config) => config.bigBlind > config.smallBlind, {
    message: 'bigBlind must be greater than smallBlind',
    path: ['bigBlind'],
  })
  .refine((config) => config.startingStack >= config.bigBlind * 2, {
    message: 'startingStack must be at least 2x bigBlind so every seat can post a blind and still have chips left to play',
    path: ['startingStack'],
  });
export type PokerTexasHoldEmConfig = z.infer<typeof PokerTexasHoldEmConfigSchema>;

// Unlike card-game-hearts, no action here ever carries a `Card` (you bet on your hand, you never
// name a specific card), so there's no per-card zod schema to define — just the discriminated
// action shapes below.
export const PokerTexasHoldEmActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  // `amount` is a "raise to" target — your total committed-this-street chip count after the
  // raise, not the increment — since that's unambiguous regardless of what's already in front of
  // you. Also used for the very first bet of a street (currentBet === 0).
  z.object({ type: z.literal('raise'), amount: z.number().int().positive() }),
  // Convenience over `raise` with `amount` set to your whole stack — spares a bot from having to
  // know its own exact stack size just to shove.
  z.object({ type: z.literal('allIn') }),
]);
export type PokerTexasHoldEmAction = z.infer<typeof PokerTexasHoldEmActionSchema>;

export type BettingStreet = 'preflop' | 'flop' | 'turn' | 'river';

export interface PokerPlayerHandState {
  holeCards: [Card, Card];
  folded: boolean;
  /** True once this player has committed their entire stack this hand — never asked to act
   * again for the rest of the hand. */
  allIn: boolean;
  /** Total chips committed to the pot this HAND, across every street so far. Drives side-pot
   * math at showdown/fold-win. */
  committed: number;
  /** Chips committed during the CURRENT street only; reset to 0 whenever a new street is dealt. */
  committedThisStreet: number;
}

export interface PokerHandWinner {
  participantId: string;
  amount: number;
}

export interface PokerShowdownReveal {
  participantId: string;
  holeCards: [Card, Card];
  category: HandCategory;
}

export interface PokerHandSummary {
  handNumber: number;
  winners: PokerHandWinner[];
  reason: 'fold' | 'showdown';
  /** Present only when `reason === 'showdown'` — every non-folded player's hand, as real poker
   * reveals them at showdown. A hand that ends by everyone-but-one folding never reveals the
   * winner's cards, same as the table game. */
  showdown?: PokerShowdownReveal[];
  board: Card[];
}

interface PokerTexasHoldEmCommon {
  /** Fixed original roster and seating order — stable for the whole match. A given hand's
   * button-relative acting order is `seatOrder`, derived from this each time a hand is dealt. */
  participantIds: string[];
  config: PokerTexasHoldEmConfig;
  /** Chips each participant currently holds, NOT counting whatever they've committed to the
   * pot in the hand in progress (see `players[id].committed` for that). */
  stacks: Record<string, number>;
  /** Participants with `stacks[id] === 0` who are out of the match entirely, grouped by the hand
   * in which they busted (participants who bust in the very same hand share a group, and so tie
   * in `getStandingOutcomes`) — earlier groups busted earlier, and rank below later ones. */
  bustedOut: string[][];
  /** 0-based; incremented each time a new hand is dealt. */
  handNumber: number;
  buttonParticipantId: string;
  /** This hand's active participants (excludes anyone in `bustedOut`), rotated so index 0 is
   * the button — the frame every other per-hand field below is indexed against. */
  seatOrder: string[];
  players: Record<string, PokerPlayerHandState>;
  board: Card[];
  /** Community cards dealt but not yet revealed onto `board` (flop/turn/river, in reveal order).
   * Set aside once at deal time so an all-in runout or a later street reveal never needs `rng`
   * again mid-hand. Never exposed via `getObservation`. */
  remainingBoardCards: Card[];
  street: BettingStreet;
  /** The highest `committedThisStreet` among this street's active players — what a call needs
   * to match. */
  currentBet: number;
  /** The minimum size a full raise must add on top of `currentBet` (an all-in for less is still
   * legal, see `validateAction`, but doesn't have to clear this). Starts each hand at the big
   * blind, and becomes the size of the last full raise. */
  minRaise: number;
  /** Participants (from `seatOrder`) who still need to act before this street's betting closes.
   * Emptied one at a time as each acts; a raise refills it with everyone else still live. */
  playersToAct: string[];
  /** Index into `seatOrder` of whoever is next to act — meaningful only while `playersToAct` is
   * non-empty. */
  actingIndex: number;
  lastHandSummary: PokerHandSummary | null;
  matchComplete: boolean;
}

// `getPendingActions`/`resolve` treat `PokerTexasHoldEmState` as a single shape rather than a
// phase-discriminated union (contrast card-game-hearts) — every field here is meaningful in every
// reachable non-terminal state, since a hand is always "in progress" (dealt, mid-street, or right
// at the showdown/fold-win instant that `resolve()` settles synchronously) until `matchComplete`.
export type PokerTexasHoldEmState = PokerTexasHoldEmCommon;

export interface PokerOpponentView {
  participantId: string;
  stack: number;
  committed: number;
  committedThisStreet: number;
  folded: boolean;
  allIn: boolean;
  isButton: boolean;
}

export type PokerLegalActionType = 'fold' | 'check' | 'call' | 'raise' | 'allIn';

export interface PokerTexasHoldEmObservation {
  you: string;
  handNumber: number;
  street: BettingStreet;
  board: Card[];
  holeCards: [Card, Card];
  /** Total chips committed by everyone this hand so far, across all streets (before whatever
   * you're about to do). */
  pot: number;
  yourStack: number;
  yourCommittedThisStreet: number;
  /** 0 means you can check. */
  toCall: number;
  /** The minimum legal `raise` `amount`, or `null` if you have no chips left to raise with.
   * Already capped at your all-in amount when your stack is too short to clear a full raise. */
  minRaiseTo: number | null;
  /** Your all-in amount (`yourStack + yourCommittedThisStreet`) — the max legal `raise` `amount`. */
  maxRaiseTo: number;
  smallBlind: number;
  bigBlind: number;
  buttonParticipantId: string;
  /** Every other still-in-the-match participant, in seat order starting after you. */
  opponents: PokerOpponentView[];
  /** Advisory only, mirroring `PendingAction.actionSchema`'s convention — `validateAction` is the
   * real authority. */
  legalActions: PokerLegalActionType[];
  lastHandSummary: PokerHandSummary | null;
}

export interface PokerTexasHoldEmResult {
  participantIds: string[];
  stacks: Record<string, number>;
  bustedOut: string[][];
  handsPlayed: number;
}
