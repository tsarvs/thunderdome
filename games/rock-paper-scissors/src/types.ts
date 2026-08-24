import { z } from 'zod';

export const RPS_CHOICES = ['rock', 'paper', 'scissors'] as const;
export type RpsChoice = (typeof RPS_CHOICES)[number];

export const RpsConfigSchema = z.object({
  /**
   * Total hands played before the match ends and wins are tallied — not "first to a majority."
   * Deliberately generous by default: bots get many hands to size each other up (and, for a bot
   * that implements it, to adapt) rather than the match being decided by an early lucky streak.
   * Playing a fixed number of hands also means the match is bounded by construction — it can
   * never run forever the way "first to a majority of *decisive* rounds" could when two
   * particular strategies happen to draw forever (see docs/adr/0003's match-timeout note).
   */
  totalRounds: z.number().int().positive().default(300),
  /**
   * Illustrates the one game-facing extension point in the engine's timeout/forfeit path
   * (docs/adr/0005-observation-vs-game-state.md, `GameDefinition.onMissingAction`): a
   * tournament organizer can choose leniency (auto-lose just the round) over the engine's
   * default (forfeit the whole match) — purely as ordinary config, no engine change needed.
   */
  onMissingAction: z.enum(['loseRound', 'forfeitMatch']).default('forfeitMatch'),
});
export type RpsConfig = z.infer<typeof RpsConfigSchema>;

export const RpsActionSchema = z.object({ choice: z.enum(RPS_CHOICES) });

/**
 * A bot never sends `{ forfeitedRound: true }` itself — it's the substitute action the game
 * hands back from `onMissingAction`, bypassing `validateAction` entirely (the engine trusts a
 * game's own substitute actions by construction).
 */
export type RpsAction = { choice: RpsChoice } | { forfeitedRound: true };

export interface RpsRoundRecord {
  round: number;
  choices: Partial<Record<string, RpsChoice>>;
  /** A participant id, or the sentinel `'draw'` — both are plain strings, so this is just `string`. */
  winner: string;
}

export interface RpsState {
  participantIds: [string, string];
  config: RpsConfig;
  roundWins: Map<string, number>;
  history: RpsRoundRecord[];
  round: number;
}

export interface RpsObservation {
  round: number;
  totalRounds: number;
  yourWins: number;
  opponentWins: number;
  opponentId: string;
  history: {
    round: number;
    you: RpsChoice | null;
    opponent: RpsChoice | null;
    winner: 'you' | 'opponent' | 'draw';
  }[];
}

export interface RpsResult {
  /** `null` means a genuine tie after all `totalRounds` hands were played. */
  winnerId: string | null;
  roundWins: Record<string, number>;
  totalRounds: number;
}
