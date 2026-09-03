// Shared test-only helpers for constructing poker fixtures by hand — not a test suite itself
// (vitest only picks up *.test.ts), just factored out since table/deal/betting/showdown/advance
// each need small pieces of the same state shape to unit-test their one function in isolation,
// per game-authoring-guide.md §11's "build state directly" convention.
import { parseCardId, type Card } from '@thunderdome/card-kit';
import { createRng, type Rng } from '@thunderdome/rng';
import type { PokerPlayerHandState, PokerTexasHoldEmConfig, PokerTexasHoldEmState } from '../src/types.js';

export function rng(seed = 1): Rng {
  return createRng(Buffer.alloc(16, seed));
}

export function testConfig(overrides?: Partial<PokerTexasHoldEmConfig>): PokerTexasHoldEmConfig {
  return {
    matchFormat: 'elimination',
    totalHands: 10,
    startingStack: 1000,
    smallBlind: 10,
    bigBlind: 20,
    ...overrides,
  };
}

/** Parses card notation (see card-kit's `cardId`/`parseCardId`: rank+suit, e.g. "AS", "TC") —
 * throws on anything malformed, since a bad fixture should fail loudly, not silently. */
export function card(id: string): Card {
  const parsed = parseCardId(id);
  if (parsed === undefined) {
    throw new Error(`invalid card id "${id}" in test fixture`);
  }
  return parsed;
}

export function cards(ids: readonly string[]): Card[] {
  return ids.map(card);
}

export function holeCards(a: string, b: string): [Card, Card] {
  return [card(a), card(b)];
}

export function player(overrides?: Partial<PokerPlayerHandState>): PokerPlayerHandState {
  return {
    holeCards: holeCards('2C', '7D'),
    folded: false,
    allIn: false,
    committed: 0,
    committedThisStreet: 0,
    ...overrides,
  };
}

/** A minimal but fully-shaped `PokerTexasHoldEmState` — every field defaulted to an inert value
 * (heads-up, preflop, nobody committed) so a test only needs to override what it actually cares
 * about, per game-authoring-guide.md §11's "skip initialize(), build state directly" convention. */
export function pokerState(overrides?: Partial<PokerTexasHoldEmState>): PokerTexasHoldEmState {
  const participantIds = overrides?.participantIds ?? ['alice', 'bob'];
  const seatOrder = overrides?.seatOrder ?? participantIds;
  const players =
    overrides?.players ?? Object.fromEntries(seatOrder.map((id) => [id, player()]));
  return {
    participantIds,
    config: testConfig(),
    stacks: Object.fromEntries(participantIds.map((id) => [id, 1000])),
    bustedOut: [],
    handNumber: 0,
    buttonParticipantId: seatOrder[0] ?? participantIds[0] ?? '',
    seatOrder,
    players,
    board: [],
    remainingBoardCards: [],
    street: 'preflop',
    currentBet: 0,
    minRaise: 20,
    playersToAct: [...seatOrder],
    actingIndex: 0,
    lastHandSummary: null,
    matchComplete: false,
    ...overrides,
  };
}
