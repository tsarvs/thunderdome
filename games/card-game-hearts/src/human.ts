import { cardId, parseCardId, sortCards, type Card } from '@thunderdome/card-kit';
import { passTargetIndex } from './rules.js';
import type { HeartsAction, HeartsObservation } from './types.js';

// An empty string, not '\n' — `.join('\n')` below already inserts a newline between every pair
// of array elements, so an empty element contributes exactly one blank line on its own
// ("content" + "\n" + "" + "\n" + "content" = "content\n\ncontent"). A literal '\n' element would
// double up (three consecutive newlines, i.e. two blank lines) instead of one.
const BLANK_LINE = '';

const CARD_NOTATION_LINE =
  'Cards: rank+suit — 2-9, T=10, J, Q, K, A; C=clubs, D=diamonds, H=hearts, S=spades (e.g. QS = queen of spades, TH = ten of hearts).';

// Marks the start of a new turn's prompt, so consecutive rounds don't visually run together.
const SEPARATOR = '----------';

/** left ↔ right pass to each other; across passes to itself (offset 2 of 4 is its own inverse). */
const OPPOSITE_PASS_DIRECTION: Record<'left' | 'right' | 'across', 'left' | 'right' | 'across'> = {
  left: 'right',
  right: 'left',
  across: 'across',
};

export function describeObservation(observation: HeartsObservation): string {
  const youIndex = observation.participantIds.indexOf(observation.you) as 0 | 1 | 2 | 3;
  const passDirectionLine =
    observation.phase !== 'passing'
      ? undefined
      : observation.passDirection === 'hold'
        ? '  — passing direction: hold (no pass this hand)'
        : `  — passing direction: ${observation.passDirection}`;
  const youPassToLine =
    observation.phase !== 'passing' || observation.passDirection === 'hold'
      ? undefined
      : `  — pass to: ${
          observation.participantIds[passTargetIndex(observation.passDirection, youIndex)]
        }`;
  const youReceiveFromLine =
    observation.phase !== 'passing' || observation.passDirection === 'hold'
      ? undefined
      : `  — receive from: ${
          observation.participantIds[
            passTargetIndex(OPPOSITE_PASS_DIRECTION[observation.passDirection], youIndex)
          ]
        }`;
  const handLine = `Your hand: ${sortCards(observation.hand).map(cardId).join(' ')}`;
  const lastTrickLine =
    observation.lastTrick === null
      ? undefined
      : `Last trick: ${observation.lastTrick.plays
          .map(
            (play) =>
              `${play.participantId === observation.you ? 'you' : play.participantId}: ${cardId(play.card)}`,
          )
          .join(', ')} — won by ${
          observation.lastTrick.winnerId === observation.you
            ? 'you'
            : observation.lastTrick.winnerId
        }`;
  const scoresLine = `Scores (lowest wins at ${String(observation.pointLimit)})`;
  const handPointsOf = (id: string) => String(observation.handPoints[id] ?? 0);
  const scoresLineWithYou = `  — you: ${String(observation.scores[observation.you] ?? 0)} (${handPointsOf(observation.you)} this hand)`;
  const scoresLinesForOthers = observation.participantIds
    .filter((id) => id !== observation.you)
    .map((id) => `  — ${id}: ${String(observation.scores[id] ?? 0)} (${handPointsOf(id)} this hand)`);
  const trickLine =
    observation.currentTrick === null
      ? undefined
      : observation.currentTrick.plays.length === 0
        ? 'Current trick: (none yet)'
        : `Current trick: ${observation.currentTrick.plays
            .map((play) => `${play.participantId}: ${cardId(play.card)}`)
            .join(', ')}`;
  const promptLine =
    observation.phase === 'passing'
      ? observation.passDirection === 'hold'
        ? '(no pass this hand)'
        : `Pass 3 cards ${observation.passDirection}. Type: PASS <card> <card> <card>  (example: PASS 2C 5C TH)`
      : observation.legalPlays !== undefined
        ? (() => {
            const legal = sortCards(observation.legalPlays);
            const example = legal[0];
            return (
              `Legal plays: ${legal.map(cardId).join(' ')}\n` +
              `Type: PLAY <card>${example ? `  (example: PLAY ${cardId(example)})` : ''}`
            );
          })()
        : undefined;

  const heartsBrokenLine = `  — hearts broken: ${observation.heartsBroken ? 'yes' : 'no'}`;

  return (
    [
      SEPARATOR,
      BLANK_LINE,
      `Hearts — Hand ${String(observation.handNumber + 1)} (${observation.phase})`,
      heartsBrokenLine,
      passDirectionLine,
      youPassToLine,
      youReceiveFromLine,
      scoresLine,
      scoresLineWithYou,
      ...scoresLinesForOthers,
      BLANK_LINE,
      lastTrickLine,
      observation.lastTrick === null ? undefined : BLANK_LINE,
      trickLine,
      observation.currentTrick === null ? undefined : BLANK_LINE,
      handLine,
      BLANK_LINE,
      CARD_NOTATION_LINE,
      promptLine,
    ]
      // Only `undefined` means "omit this line" — an empty string is `BLANK_LINE` itself and must
      // survive this filter, or the blank-line separator above would silently disappear.
      .filter((line): line is string => line !== undefined)
      .join('\n')
  );
}

/**
 * Confirms exactly how `parseInput` understood the human's last input — printed right after
 * they submit, before the next prompt — so a valid-but-unintended parse (e.g. a typo that still
 * happens to name a real card) doesn't slip past unnoticed. See
 * `packages/engine/src/types.ts`'s `humanInterface.describeAction` for why this exists.
 */
export function describeAction(action: HeartsAction): string {
  if (action.type === 'pass') {
    return `Passed: ${sortCards(action.cards).map(cardId).join(' ')}`;
  }
  return `Played: ${cardId(action.card)}`;
}

/**
 * Syntactically distinguishes `PASS`/`PLAY` without any state access, per the interface's own
 * constraint (`parseInput` has no access to state/phase) — `validateAction` is what actually
 * enforces which one is legal right now.
 */
export function parseInput(raw: string): HeartsAction | undefined {
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  const [command, ...rest] = tokens;

  if (command === 'PASS' && rest.length === 3) {
    const cards = rest.map(parseCardId);
    if (!cards.every((card): card is Card => card !== undefined)) {
      return undefined;
    }
    if (new Set(cards.map(cardId)).size !== 3) {
      return undefined;
    }
    const [first, second, third] = cards;
    if (first === undefined || second === undefined || third === undefined) {
      return undefined;
    }
    return { type: 'pass', cards: [first, second, third] };
  }

  if (command === 'PLAY' && rest.length === 1) {
    const card = parseCardId(rest[0] ?? '');
    return card === undefined ? undefined : { type: 'play', card };
  }

  return undefined;
}
