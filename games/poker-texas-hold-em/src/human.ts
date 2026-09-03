import { cardId, type Card } from '@thunderdome/card-kit';
import type { RoundEvent } from '@thunderdome/engine';
import type {
  BettingStreet,
  PokerHandSummary,
  PokerLegalActionType,
  PokerTexasHoldEmAction,
  PokerTexasHoldEmObservation,
} from './types.js';

// Same convention as card-game-hearts/src/human.ts: an empty string element contributes exactly
// one blank line once `.join('\n')` runs — a literal '\n' element would double it up.
const BLANK_LINE = '';
const SEPARATOR = '----------';

function describeCards(cards: readonly Card[]): string {
  return cards.length === 0 ? '(none)' : cards.map(cardId).join(' ');
}

const STREET_LABELS: Record<PokerTexasHoldEmObservation['street'], string> = {
  preflop: 'preflop',
  flop: 'flop',
  turn: 'turn',
  river: 'river',
};

function describeLegalActions(observation: PokerTexasHoldEmObservation): string {
  const parts: string[] = [];
  const has = (action: PokerLegalActionType) => observation.legalActions.includes(action);
  if (has('fold')) parts.push('FOLD');
  if (has('check')) parts.push('CHECK');
  if (has('call')) parts.push(`CALL (${String(observation.toCall)})`);
  if (has('raise') && observation.minRaiseTo !== null) {
    parts.push(
      `RAISE <amount> (min ${String(observation.minRaiseTo)}, max ${String(observation.maxRaiseTo)})`,
    );
  }
  if (has('allIn')) parts.push(`ALLIN (${String(observation.maxRaiseTo)})`);
  return parts.join(' | ');
}

export function describeObservation(observation: PokerTexasHoldEmObservation): string {
  const opponentLines = observation.opponents.map((opponent) => {
    const status = opponent.folded ? 'folded' : opponent.allIn ? 'all-in' : 'in';
    const buttonTag = opponent.isButton ? ' [button]' : '';
    return `  ${opponent.participantId}${buttonTag}: stack ${String(opponent.stack)}, committed ${String(opponent.committed)} this hand (${status})`;
  });

  const youAreButton = observation.buttonParticipantId === observation.you ? ' [button]' : '';

  return [
    SEPARATOR,
    BLANK_LINE,
    `Texas Hold'em — Hand #${String(observation.handNumber + 1)} (${STREET_LABELS[observation.street]})`,
    `  - Blinds: ${String(observation.smallBlind)}/${String(observation.bigBlind)} — button: ${observation.buttonParticipantId === observation.you ? 'you' : observation.buttonParticipantId}`,
    BLANK_LINE,
    `Board: ${describeCards(observation.board)}`,
    `Pot: ${String(observation.pot)} (to call: ${String(observation.toCall)})`,
    BLANK_LINE,
    'Opponents:',
    ...opponentLines,
    BLANK_LINE,
    `You${youAreButton}:`,
    `  Your stack: ${String(observation.yourStack)} (committed ${String(observation.yourCommittedThisStreet)} this street)`,
    `  Your cards: ${describeCards(observation.holeCards)}`,
    BLANK_LINE,
    `Cards: rank+suit — 2-9, T=10, J, Q, K, A; C=clubs, D=diamonds, H=hearts, S=spades.`,
    `Type: ${describeLegalActions(observation)}`,
  ].join('\n');
}

/**
 * Confirms exactly how `parseInput` understood the human's last input, printed right before the
 * next prompt — matters most for RAISE, where a typo'd amount is still a well-formed, just
 * different, legal-or-illegal action (card-game-hearts/src/human.ts's `describeAction` exists for
 * the same reason).
 */
export function describeAction(action: PokerTexasHoldEmAction): string {
  switch (action.type) {
    case 'fold':
      return 'You folded.';
    case 'check':
      return 'You checked.';
    case 'call':
      return 'You called.';
    case 'raise':
      return `You raised to ${String(action.amount)}.`;
    case 'allIn':
      return 'You went all-in.';
  }
}

/**
 * Syntactically parses the command, with no access to state — `validateAction` is the sole
 * authority on whether it's actually legal right now (e.g. checking when there's a bet to call).
 */
export function parseInput(raw: string): PokerTexasHoldEmAction | undefined {
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  const [command, ...rest] = tokens;

  switch (command) {
    case 'FOLD':
    case 'F':
      return rest.length === 0 ? { type: 'fold' } : undefined;
    case 'CHECK':
    case 'CHK':
    case 'X':
      return rest.length === 0 ? { type: 'check' } : undefined;
    case 'CALL':
    case 'C':
      return rest.length === 0 ? { type: 'call' } : undefined;
    case 'ALLIN':
    case 'ALL-IN':
    case 'SHOVE':
    case 'A':
      return rest.length === 0 ? { type: 'allIn' } : undefined;
    case 'RAISE':
    case 'BET':
    case 'R': {
      if (rest.length !== 1) {
        return undefined;
      }
      const amount = Number(rest[0]);
      return Number.isInteger(amount) && amount > 0 ? { type: 'raise', amount } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Catches a raise whose amount `parseInput` accepted as a well-formed positive integer but which
 * falls outside what this observation says is actually raiseable right now — the same min/max
 * bounds `game.ts`'s `validateAction` enforces against the authoritative state, computed here from
 * the observation's own `minRaiseTo`/`maxRaiseTo` (see `getObservation` in game.ts, which derives
 * both from the identical `stack`/`committedThisStreet`/`currentBet`/`minRaise` this mirrors) so a
 * human gets an immediate reprompt instead of the collector forwarding an illegal action that
 * `validateAction` would then reject as a missing/invalid required action (forfeiting the match —
 * see `onMissingAction`'s comment in game.ts).
 */
export function validateInput(
  action: PokerTexasHoldEmAction,
  observation: PokerTexasHoldEmObservation,
): string | undefined {
  if (action.type !== 'raise') {
    return undefined;
  }
  if (observation.minRaiseTo === null) {
    return 'You have no chips left to raise with';
  }
  if (action.amount > observation.maxRaiseTo) {
    return `You can't commit more than your stack (max ${String(observation.maxRaiseTo)})`;
  }
  const currentBet = observation.yourCommittedThisStreet + observation.toCall;
  if (action.amount <= currentBet) {
    return 'Your raise must exceed the current bet';
  }
  if (action.amount < observation.minRaiseTo) {
    return `Your raise must reach at least ${String(observation.minRaiseTo)} (or go all-in for less)`;
  }
  return undefined;
}

// ---------- live round narration (see GameDefinition.humanInterface.describeRoundEvents) ----------

/** The `data` shape betting.ts's `applyPlayerAction` puts on every `'action'` event. */
interface ActionEventData {
  action: 'fold' | 'check' | 'call' | 'raise' | 'allIn';
  amount?: number;
}

/** The `data` shape advance.ts's `dealNextStreetWithBetting` puts on every `'street-dealt'` event. */
interface StreetDealtEventData {
  street: BettingStreet;
  board: Card[];
}

const STREET_HEADERS: Record<Exclude<BettingStreet, 'preflop'>, string> = {
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

function describeActionEvent(participantId: string, data: ActionEventData): string {
  switch (data.action) {
    case 'fold':
      return `${participantId} folds.`;
    case 'check':
      return `${participantId} checks.`;
    case 'call':
      return `${participantId} calls${data.amount === undefined ? '' : ` ${String(data.amount)}`}.`;
    case 'raise':
      return `${participantId} raises to ${String(data.amount)}.`;
    case 'allIn':
      return `${participantId} goes all-in${data.amount === undefined ? '' : ` (${String(data.amount)})`}.`;
  }
}

/** Lines announcing a completed hand's outcome — a dedicated "winner:" line always leads,
 * whether the hand ended by fold or showdown, since `summary.winners` can list more than one
 * participant on a split pot or a multi-way side pot. */
function describeHandSummary(summary: PokerHandSummary, youParticipantId: string): string[] {
  const who = (id: string) => (id === youParticipantId ? 'you' : id);
  const winnerLine = summary.winners
    .map((w) => `${who(w.participantId)} +${String(w.amount)}`)
    .join(', ');

  if (summary.reason === 'fold') {
    return [`Hand result: everyone else folded — winner: ${winnerLine}`];
  }
  const reveals = (summary.showdown ?? []).map(
    (reveal) =>
      `  ${who(reveal.participantId)}: ${describeCards(reveal.holeCards)} (${reveal.category})`,
  );
  return [`Hand result (showdown) — winner: ${winnerLine}`, ...reveals];
}

/**
 * Narrates a round's events live for a human bystander — called by the CLI even on rounds where
 * it isn't the human's turn (see `GameDefinition.humanInterface.describeRoundEvents`,
 * `packages/engine/src/types.ts`), which is the only way a human still learns what happened in
 * the hand that busts them out: `describeObservation` never fires again once they have no more
 * turns coming. Skips narrating the human's own action, since `describeAction` already confirmed
 * it the moment they submitted it.
 */
export function describeRoundEvents(
  events: RoundEvent[],
  youParticipantId: string,
): string | undefined {
  const lines: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'action': {
        const participantId = event.participantIds?.[0];
        if (participantId === undefined || participantId === youParticipantId) {
          break;
        }
        lines.push(describeActionEvent(participantId, event.data as ActionEventData));
        break;
      }
      case 'street-dealt': {
        const { street, board } = event.data as StreetDealtEventData;
        if (street === 'preflop') {
          break; // never actually emitted for preflop — deal.ts's dealNewHand starts there directly
        }
        lines.push(`${STREET_HEADERS[street]}: ${describeCards(board)}`);
        break;
      }
      case 'hand-complete':
      case 'showdown':
        lines.push(...describeHandSummary(event.data as PokerHandSummary, youParticipantId));
        break;
      case 'busted': {
        for (const participantId of event.participantIds ?? []) {
          lines.push(
            participantId === youParticipantId
              ? 'You are out of chips!'
              : `${participantId} is out of chips!`,
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return lines.length === 0 ? undefined : lines.join('\n');
}
