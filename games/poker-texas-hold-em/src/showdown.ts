import type { RoundEvent } from '@thunderdome/engine';
import { bestHand, compareHandRank, type BestHand } from './hand-evaluator.js';
import { computeSidePots, oddChipOrder } from './table.js';
import type { PokerHandSummary, PokerShowdownReveal, PokerTexasHoldEmState } from './types.js';

/** Everyone but one player folded — award them the whole pot, no showdown needed (and no side-pot
 * math either: with only one eligible player, every layer's chips go to the same winner). */
export function awardPotToSoleWinner(
  state: PokerTexasHoldEmState,
  winnerId: string,
  events: RoundEvent[],
): PokerTexasHoldEmState {
  const potTotal = state.seatOrder.reduce((sum, id) => sum + (state.players[id]?.committed ?? 0), 0);
  const stacks = { ...state.stacks, [winnerId]: (state.stacks[winnerId] ?? 0) + potTotal };
  const summary: PokerHandSummary = {
    handNumber: state.handNumber,
    winners: [{ participantId: winnerId, amount: potTotal }],
    reason: 'fold',
    board: state.board,
  };
  events.push({ type: 'hand-complete', participantIds: [winnerId], data: summary });
  return { ...state, stacks, lastHandSummary: summary };
}

/**
 * The river's betting closed with 2+ players still in — reveal hands, split every side-pot layer
 * among whoever's still eligible for it, and pay out. A pot layer with zero eligible contenders
 * (everyone who reached it folded) is skipped as a defensive no-op rather than treated as
 * unreachable — real play can't actually produce one (the last aggressor at any layer with real
 * chips in it is never the one who folds into their own bet), but nothing here depends on that.
 */
export function doShowdown(state: PokerTexasHoldEmState, events: RoundEvent[]): PokerTexasHoldEmState {
  const committed = Object.fromEntries(
    state.seatOrder.map((id) => [id, state.players[id]?.committed ?? 0]),
  );
  const foldedSet = new Set(state.seatOrder.filter((id) => state.players[id]?.folded === true));
  const pots = computeSidePots(committed, foldedSet);

  const handsByParticipant = new Map<string, BestHand>();
  const showdownReveals: PokerShowdownReveal[] = [];
  for (const id of state.seatOrder) {
    if (foldedSet.has(id)) {
      continue;
    }
    const player = state.players[id];
    if (player === undefined) {
      throw new Error(`unreachable: "${id}" is seated this hand`);
    }
    const rank = bestHand([...player.holeCards, ...state.board]);
    handsByParticipant.set(id, rank);
    showdownReveals.push({ participantId: id, holeCards: player.holeCards, category: rank.category });
  }

  const winningsByParticipant = new Map<string, number>();
  for (const pot of pots) {
    const contenders = pot.eligibleParticipantIds.filter((id) => handsByParticipant.has(id));
    if (contenders.length === 0) {
      continue;
    }
    let bestRank: BestHand | null = null;
    for (const id of contenders) {
      const rank = handsByParticipant.get(id);
      if (rank !== undefined && (bestRank === null || compareHandRank(rank, bestRank) > 0)) {
        bestRank = rank;
      }
    }
    if (bestRank === null) {
      continue;
    }
    const winningRank = bestRank;
    const winners = contenders.filter((id) => {
      const rank = handsByParticipant.get(id);
      return rank !== undefined && compareHandRank(rank, winningRank) === 0;
    });
    const ordered = oddChipOrder(winners, state.seatOrder);
    const base = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - base * winners.length;
    for (const id of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      winningsByParticipant.set(id, (winningsByParticipant.get(id) ?? 0) + base + extra);
    }
  }

  const stacks = { ...state.stacks };
  for (const [id, amount] of winningsByParticipant) {
    stacks[id] = (stacks[id] ?? 0) + amount;
  }

  const summary: PokerHandSummary = {
    handNumber: state.handNumber,
    winners: [...winningsByParticipant.entries()].map(([participantId, amount]) => ({
      participantId,
      amount,
    })),
    reason: 'showdown',
    showdown: showdownReveals,
    board: state.board,
  };
  events.push({
    type: 'showdown',
    participantIds: showdownReveals.map((reveal) => reveal.participantId),
    data: summary,
  });
  return { ...state, stacks, lastHandSummary: summary };
}
