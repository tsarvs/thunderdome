import { z } from 'zod';

/**
 * A forward match's persisted lifecycle state — distinct from `@thunderdome/tournament-store`'s
 * `'running' | 'completed' | 'failed'` because a forward match has a genuinely different middle
 * state: `'active'` doesn't mean "currently executing" (nothing executes between invocations —
 * see docs/adr/0013-forward-match-persistence.md), it means "not yet fully resolved through
 * `config.endDate`, resumable on a future invocation."
 */
export const ForwardMatchStatusSchema = z.enum(['active', 'completed', 'forfeited']);
export type ForwardMatchStatus = z.infer<typeof ForwardMatchStatusSchema>;

/**
 * One forward match's whole persisted record — one JSON file per `matchId` (see `store.ts`).
 * `config`/`snapshot` are BOTH fully opaque (`unknown`) to this package, mirroring
 * `@thunderdome/tournament-store`'s own `gameConfig: unknown` — this package never depends on
 * `@thunderdome/engine` or any game, and never inspects what it's persisting beyond this record's
 * own bookkeeping fields. `games/stock-market-4`'s `serializeForwardState`/`resumeForwardState`
 * (or an equivalent for any future game that adopts this same pattern) own the `snapshot` shape
 * entirely; this store only ever round-trips it.
 */
export const ForwardMatchRecordSchema = z
  .object({
    /** Operator-chosen and STABLE across every resume — unlike `TournamentRecord.id`
     * (`crypto.randomUUID()`), this is never auto-generated. A forward match is meant to be found
     * and resumed deliberately (roadmap: "discover an existing forward game... rather than
     * creating one accidentally"), not looked up by a value nobody remembers. */
    matchId: z.string().min(1),
    gameId: z.string().min(1),
    gameVersion: z.string().min(1),
    config: z.unknown(),
    participantIds: z.array(z.string()),
    /** Hex-encoded, generated once at creation and reused verbatim on every resume — a bot's
     * derived `rngSeed` must never change across a resume, or a resumed bot could receive
     * different randomness than an uninterrupted run would have. */
    matchSeed: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: ForwardMatchStatusSchema,
    roundsPlayed: z.number().int().nonnegative(),
    forfeitedParticipantIds: z.array(z.string()).optional(),
    snapshot: z.unknown(),
  })
  .strict();
export type ForwardMatchRecord = z.infer<typeof ForwardMatchRecordSchema>;

/** The lightweight projection `list()` returns — enough to pick a match without loading (and
 * validating) its opaque `config`/`snapshot` just to show a list. */
export interface ForwardMatchSummary {
  matchId: string;
  gameId: string;
  status: ForwardMatchStatus;
  createdAt: string;
  updatedAt: string;
  roundsPlayed: number;
  participantIds: string[];
}
