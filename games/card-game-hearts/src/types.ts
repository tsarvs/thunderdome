import type { Card } from '@thunderdome/deck-of-cards';
import { z } from 'zod';

export const HeartsConfigSchema = z.object({
  /** Match ends once, after a completed hand's scoring, any player's cumulative score reaches
   * this. Every hand awards at least 26 total penalty points to someone (26 normally, 78 across
   * everyone on a shoot-the-moon hand: 0+26+26+26), so the sum of all scores strictly increases
   * every hand — the match is guaranteed to terminate. */
  pointLimit: z.number().int().min(20).max(1000).default(100),
});
export type HeartsConfig = z.infer<typeof HeartsConfigSchema>;

const SuitSchema = z.enum(['clubs', 'diamonds', 'hearts', 'spades']);
// `Card`'s `rank` is a 2..14 literal union; zod has no direct numeric-range-to-literal-union
// inference, so this is validated as a bounded integer and the type is bridged via the explicit
// annotation below — safe because every integer in [2, 14] is exactly one member of that union.
const RankSchema = z.number().int().min(2).max(14) as unknown as z.ZodType<Card['rank']>;
const CardSchema = z.object({ suit: SuitSchema, rank: RankSchema });

export const HeartsActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pass'),
    cards: z.tuple([CardSchema, CardSchema, CardSchema]),
  }),
  z.object({ type: z.literal('play'), card: CardSchema }),
]);
export type HeartsAction = z.infer<typeof HeartsActionSchema>;

export type PassDirection = 'left' | 'right' | 'across' | 'hold';

export interface HeartsTrick {
  leaderId: string;
  plays: { participantId: string; card: Card }[];
}

export interface CompletedTrick {
  plays: { participantId: string; card: Card }[];
  winnerId: string;
}

interface HeartsCommon {
  /** Fixed seat order = clockwise turn order. */
  participantIds: [string, string, string, string];
  config: HeartsConfig;
  /** 0-based; passing direction for this hand = `passDirectionForHand(handNumber)`. */
  handNumber: number;
  /** FULL hidden hands — authoritative; redacted only in `getObservation`. */
  hands: Record<string, Card[]>;
  /** Reset to `false` at the start of every hand. */
  heartsBroken: boolean;
  /** 0..13 within the current hand; `0` means "this is the first trick". */
  tricksCompleted: number;
  /** Running penalty tally for the CURRENT hand only; reset every hand. */
  handPoints: Record<string, number>;
  /** Cumulative match score; LOWER is better; never reset. */
  scores: Record<string, number>;
  /** Set once, at the hand boundary where a score first reaches `config.pointLimit`. */
  matchComplete: boolean;
  /** The most recently completed trick THIS hand — `null` before the first trick of a hand has
   * completed. Reset to `null` at the start of every hand (including during that hand's passing
   * round), so it never carries a stale trick over from the previous hand. */
  lastTrick: CompletedTrick | null;
}

/**
 * Discriminated on `phase` rather than one flat interface with "ignored while passing"
 * placeholder trick fields — so there is no reachable state where those fields hold
 * stale/meaningless data. There is also no `pendingPasses` field: the engine's round loop
 * collects all 4 simultaneous pass actions into a single `resolve()` call (like RPS's
 * multi-entry `actions` map, just 4 wide instead of 2), so there is never a "some passes
 * collected, waiting on more" state to persist between `resolve()` calls.
 */
export type HeartsState =
  | (HeartsCommon & { phase: 'passing' })
  | (HeartsCommon & {
      phase: 'playing';
      currentTrick: HeartsTrick;
      /** Always `participantIds.indexOf(currentTrick.leaderId) + currentTrick.plays.length`, mod
       * 4. Typed as the literal `0 | 1 | 2 | 3` (matching `participantIds`' fixed-length tuple, à
       * la Connect Four's `currentPlayerIndex: 0 | 1`) so indexing `participantIds` with it never
       * produces `string | undefined` under `noUncheckedIndexedAccess`. */
      currentPlayerIndex: 0 | 1 | 2 | 3;
    });

export interface HeartsObservation {
  you: string;
  participantIds: [string, string, string, string];
  phase: 'passing' | 'playing';
  handNumber: number;
  passDirection: PassDirection;
  /** Your full hand, sorted. */
  hand: Card[];
  /** Every participant including yourself — no other player's actual cards. */
  handSizes: Record<string, number>;
  heartsBroken: boolean;
  tricksCompleted: number;
  isFirstTrick: boolean;
  /** `null` while passing. */
  currentTrick: HeartsTrick | null;
  /** The most recently completed trick this hand, and who won it — `null` before the first
   * trick of the current hand has completed. */
  lastTrick: CompletedTrick | null;
  /** Running penalty tally for the CURRENT hand only; reset every hand. */
  handPoints: Record<string, number>;
  scores: Record<string, number>;
  pointLimit: number;
  /** Present only when it's your turn to play a card. */
  legalPlays?: Card[];
  youMustAct: boolean;
}

export interface HeartsResult {
  participantIds: [string, string, string, string];
  /** Final cumulative scores — lower is better. */
  scores: Record<string, number>;
  handsPlayed: number;
}
