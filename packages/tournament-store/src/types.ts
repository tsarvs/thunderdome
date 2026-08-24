import { z } from 'zod';

/**
 * The persisted shape of one match within a tournament record — everything `inspect`/`replay`
 * need, and nothing more. Deliberately mirrors `@thunderdome/engine`'s `MatchOutcome` /
 * `apps/cli/src/lib/match-execution.ts`'s `SingleMatchOutcome` shapes rather than the raw engine
 * types themselves, so this package never needs to depend on the runtime/CLI layers that produce
 * a match outcome — only on the generic `StandingOutcome`/`RoundEvent` shapes from
 * `@thunderdome/engine` that any game already produces.
 */
export const PersistedMatchSchema = z.object({
  matchId: z.string(),
  participantIds: z.array(z.string()),
  status: z.enum(['completed', 'forfeit', 'match-timeout']),
  standingOutcomes: z.array(
    z.object({
      participantId: z.string(),
      rank: z.number(),
      score: z.number().optional(),
      outcome: z.enum(['win', 'loss', 'draw']).optional(),
    }),
  ),
  /** One entry per round that reached `resolve()` — a forfeited round is not included, matching
   * `MatchOutcome.events`'s own contract. Opaque `data` per event, exactly as the game produced. */
  events: z.array(
    z.array(
      z.object({
        type: z.string(),
        participantIds: z.array(z.string()).optional(),
        data: z.unknown().optional(),
      }),
    ),
  ),
  forfeitedParticipantIds: z.array(z.string()).optional(),
});
export type PersistedMatch = z.infer<typeof PersistedMatchSchema>;

export const TournamentRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** Set once `status` moves off `'running'`. */
  completedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  /** Set only when `status === 'failed'` — e.g. a bot failed to initialize mid-tournament. */
  error: z.string().optional(),
  gameId: z.string(),
  gameVersion: z.string(),
  /** Opaque — whatever the game's own `parseConfig` accepted. */
  gameConfig: z.unknown(),
  formatId: z.string(),
  formatVersion: z.string(),
  /** Opaque — whatever the format's own `parseConfig` accepted. */
  formatConfig: z.unknown(),
  /** Bot ids, in the order given on the command line. */
  roster: z.array(z.string()),
  /**
   * Hex-encoded (`@thunderdome/rng`'s `seedToHex`) — the one entropy boundary this tournament's
   * reproducibility traces back to (ADR-0004). Not secret; safe to persist and share, since
   * every match's own seed and the format's own shuffle already derive from it one-way via
   * `deriveSeed` rather than exposing themselves.
   */
  tournamentSeed: z.string(),
  /** Appended to as each match completes — a tournament interrupted mid-run still leaves every
   * match played so far inspectable. */
  matches: z.array(PersistedMatchSchema),
  /** The format's own `getPublicStandings()` projection, set once `status` is `'completed'`. */
  standings: z.unknown().optional(),
});
export type TournamentRecord = z.infer<typeof TournamentRecordSchema>;

/** The lightweight projection `list()` returns — enough to pick a tournament without loading
 * (and validating) every match/event in every record just to show a list. */
export interface TournamentSummary {
  id: string;
  createdAt: string;
  completedAt?: string;
  status: TournamentRecord['status'];
  gameId: string;
  formatId: string;
  roster: string[];
}
