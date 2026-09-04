import { shuffle, standardDeck, type Card } from '@thunderdome/deck-of-cards';
import type { Rng, RoundEvent } from '@thunderdome/engine';
import {
  bigBlindSeatIndex,
  buildSeatOrder,
  nextButton,
  preflopFirstToActIndex,
  smallBlindSeatIndex,
} from './table.js';
import type { BettingStreet, PokerPlayerHandState, PokerTexasHoldEmConfig } from './types.js';

export interface DealtHand {
  seatOrder: string[];
  players: Record<string, PokerPlayerHandState>;
  board: Card[];
  remainingBoardCards: Card[];
  street: BettingStreet;
  currentBet: number;
  minRaise: number;
  playersToAct: string[];
  /** A pointer to the seat BEFORE the real first-to-act seat, not the seat itself — `advance()`
   * (advance.ts) always resolves "who's actually next" by walking forward from here to the first
   * live member of `playersToAct`, which is the one thing that's correct whether or not the
   * formula seat happens to have folded or been dealt out all-in (impossible preflop, but the
   * same dealing path also feeds `dealNextStreetWithBetting` in advance.ts, where it's common). */
  actingIndex: number;
  buttonParticipantId: string;
  handNumber: number;
  stacks: Record<string, number>;
  events: RoundEvent[];
}

/**
 * Deals a fresh hand: rotates the button, shuffles, deals hole cards, and posts blinds. Does NOT
 * decide whether any further betting is actually possible this hand (e.g. both blinds posting
 * all-in) — `advance()` (advance.ts) is what settles that, uniformly for every state transition.
 *
 * The deck is shuffled once and sliced into contiguous chunks (2 cards per seat, then 5 reserved
 * for the board) rather than dealt round-robin or with burn cards between streets — a single
 * uniform shuffle makes contiguous slicing statistically identical to either of those (see
 * @thunderdome/deck-of-cards's `dealHands` doc comment for the same reasoning), so both are omitted.
 */
export function dealNewHand(
  participantIds: readonly string[],
  stacks: Readonly<Record<string, number>>,
  bustedOut: ReadonlySet<string>,
  previousButtonParticipantId: string | null,
  handNumber: number,
  config: PokerTexasHoldEmConfig,
  rng: Rng,
): DealtHand {
  const activeParticipantIds = participantIds.filter((id) => !bustedOut.has(id));
  const buttonParticipantId =
    previousButtonParticipantId === null
      ? rng.pick(activeParticipantIds)
      : nextButton(participantIds, previousButtonParticipantId, bustedOut);
  const seatOrder = buildSeatOrder(participantIds, buttonParticipantId, bustedOut);
  const n = seatOrder.length;

  const deck = shuffle(standardDeck(), rng);
  const players: Record<string, PokerPlayerHandState> = {};
  seatOrder.forEach((id, index) => {
    const first = deck[index * 2];
    const second = deck[index * 2 + 1];
    if (first === undefined || second === undefined) {
      throw new Error('unreachable: standardDeck() has 52 cards, far more than 2 per seat needs');
    }
    players[id] = {
      holeCards: [first, second],
      folded: false,
      allIn: false,
      committed: 0,
      committedThisStreet: 0,
    };
  });
  const remainingBoardCards = deck.slice(n * 2, n * 2 + 5);

  const nextStacks = { ...stacks };
  const events: RoundEvent[] = [
    { type: 'hand-started', data: { handNumber, buttonParticipantId, seatOrder } },
  ];

  function postBlind(participantId: string, desired: number): number {
    const stack = nextStacks[participantId] ?? 0;
    const posted = Math.min(desired, stack);
    nextStacks[participantId] = stack - posted;
    const player = players[participantId];
    if (player === undefined) {
      throw new Error(`unreachable: "${participantId}" was just dealt into players above`);
    }
    players[participantId] = {
      ...player,
      committed: player.committed + posted,
      committedThisStreet: player.committedThisStreet + posted,
      allIn: nextStacks[participantId] === 0,
    };
    return posted;
  }

  const sbId = seatOrder[smallBlindSeatIndex(n)];
  const bbId = seatOrder[bigBlindSeatIndex(n)];
  if (sbId === undefined || bbId === undefined) {
    throw new Error('unreachable: seatOrder always has at least 2 seats');
  }
  const sbPosted = postBlind(sbId, config.smallBlind);
  const bbPosted = postBlind(bbId, config.bigBlind);
  events.push({
    type: 'blinds-posted',
    participantIds: [sbId, bbId],
    data: {
      smallBlind: { participantId: sbId, amount: sbPosted },
      bigBlind: { participantId: bbId, amount: bbPosted },
    },
  });

  return {
    seatOrder,
    players,
    board: [],
    remainingBoardCards,
    street: 'preflop',
    currentBet: bbPosted,
    minRaise: config.bigBlind,
    playersToAct: seatOrder.filter((id) => players[id]?.allIn !== true),
    actingIndex: (preflopFirstToActIndex(n) - 1 + n) % n,
    buttonParticipantId,
    handNumber,
    stacks: nextStacks,
    events,
  };
}
