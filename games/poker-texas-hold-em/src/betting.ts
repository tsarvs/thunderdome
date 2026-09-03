import type { RoundEvent } from '@thunderdome/engine';
import type {
  PokerPlayerHandState,
  PokerTexasHoldEmAction,
  PokerTexasHoldEmState,
} from './types.js';

export interface AppliedAction {
  state: PokerTexasHoldEmState;
  events: RoundEvent[];
}

/** Applies one already-validated player action to `state`: updates their chips/committed
 * amounts, and the street's `currentBet`/`minRaise`/`playersToAct` bookkeeping. Doesn't decide
 * anything beyond that single action — closing the betting round, dealing the next street, or
 * settling the hand is `advance()`'s job (advance.ts), run right after this by `resolve()`. */
export function applyPlayerAction(
  state: PokerTexasHoldEmState,
  participantId: string,
  action: PokerTexasHoldEmAction,
): AppliedAction {
  const player = state.players[participantId];
  if (player === undefined) {
    throw new Error(`unreachable: "${participantId}" is not seated in the current hand`);
  }
  const stack = state.stacks[participantId] ?? 0;
  const players = { ...state.players };
  const stacks = { ...state.stacks };
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let playersToAct = state.playersToAct;
  const events: RoundEvent[] = [];

  // Takes `basePlayer` explicitly (rather than closing over the outer `player`) so TS's
  // undefined-narrowing above actually applies at every call site — narrowing a `const` doesn't
  // carry into a nested function declaration's body.
  function commit(basePlayer: PokerPlayerHandState, delta: number): PokerPlayerHandState {
    stacks[participantId] = stack - delta;
    const updated: PokerPlayerHandState = {
      ...basePlayer,
      committed: basePlayer.committed + delta,
      committedThisStreet: basePlayer.committedThisStreet + delta,
      allIn: stacks[participantId] === 0,
    };
    players[participantId] = updated;
    return updated;
  }

  // A raise (full or a short all-in) reopens the action for everyone else still live. This
  // deliberately simplifies the cardroom rule that a short (under-min-raise) all-in does NOT
  // reopen betting for players who already acted at the current level — a real but rare-in-play
  // edge case; every raise here is treated uniformly for simplicity.
  function reopenActionAfterRaise(): string[] {
    return state.seatOrder.filter(
      (id) => id !== participantId && players[id]?.folded !== true && players[id]?.allIn !== true,
    );
  }

  switch (action.type) {
    case 'fold': {
      players[participantId] = { ...player, folded: true };
      playersToAct = playersToAct.filter((id) => id !== participantId);
      events.push({ type: 'action', participantIds: [participantId], data: { action: 'fold' } });
      break;
    }
    case 'check': {
      playersToAct = playersToAct.filter((id) => id !== participantId);
      events.push({ type: 'action', participantIds: [participantId], data: { action: 'check' } });
      break;
    }
    case 'call': {
      const toCall = Math.min(currentBet - player.committedThisStreet, stack);
      commit(player, toCall);
      playersToAct = playersToAct.filter((id) => id !== participantId);
      events.push({
        type: 'action',
        participantIds: [participantId],
        data: { action: 'call', amount: toCall },
      });
      break;
    }
    case 'raise': {
      const delta = action.amount - player.committedThisStreet;
      commit(player, delta);
      const isFullRaise = action.amount - currentBet >= minRaise;
      if (isFullRaise) {
        minRaise = action.amount - currentBet;
      }
      currentBet = action.amount;
      playersToAct = reopenActionAfterRaise();
      events.push({
        type: 'action',
        participantIds: [participantId],
        data: { action: 'raise', amount: action.amount },
      });
      break;
    }
    case 'allIn': {
      const updated = commit(player, stack);
      const amount = updated.committedThisStreet;
      if (amount > currentBet) {
        const isFullRaise = amount - currentBet >= minRaise;
        if (isFullRaise) {
          minRaise = amount - currentBet;
        }
        currentBet = amount;
        playersToAct = reopenActionAfterRaise();
      } else {
        playersToAct = playersToAct.filter((id) => id !== participantId);
      }
      events.push({
        type: 'action',
        participantIds: [participantId],
        data: { action: 'allIn', amount },
      });
      break;
    }
  }

  return { state: { ...state, players, stacks, currentBet, minRaise, playersToAct }, events };
}
