import type { Rng } from '@thunderdome/rng';

export type { Rng };

/** The uniform error-handling idiom at every game/engine boundary crossing. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}

/**
 * One entry per participant a game reports as part of the current round
 * (docs/architecture.md §5). `required` is what lets a single generic collection loop serve
 * both "exactly one actor" (chess) and "everyone" (rock-paper-scissors) without the engine ever
 * special-casing either shape.
 */
export interface PendingAction {
  participantId: string;
  required: boolean;
  /** Advisory only; passed through to the wire protocol verbatim. True legality is `validateAction`'s job. */
  actionSchema?: unknown;
  /** Overrides the caller's default deadline for this one entry. */
  deadlineMs?: number;
}

export interface RoundEvent {
  type: string;
  participantIds?: string[];
  /** Opaque to the engine; consumed only by replay/spectator tooling. */
  data?: unknown;
}

export interface RoundOutcome<TState> {
  nextState: TState;
  events: RoundEvent[];
}

/** Why a required participant's action didn't arrive — collapsed from runtime-level detail. */
export type MissingActionReason = 'timeout' | 'invalid' | 'disconnected';

export type MissingActionDecision<TAction> =
  { policy: 'substitute'; action: TAction } | { policy: 'forfeit-match' };

export interface StandingOutcome {
  participantId: string;
  /** 1 = best; ties share a rank. */
  rank: number;
  score?: number;
  outcome?: 'win' | 'loss' | 'draw';
}

/**
 * A game is responsible for: creating initial state, producing player-specific observations,
 * determining whose actions are required this round, validating and resolving actions,
 * advancing state, deciding when the game ends, and translating its own result into a
 * generic standings shape any `TournamentFormat` can consume. It is never responsible for
 * anything about *how* actions are collected (timeouts, transport, bot processes) — that's
 * the engine/runtime's job (docs/adr/0005-observation-vs-game-state.md).
 */
export interface GameDefinition<TConfig, TState, TObservation, TAction, TResult> {
  id: string;
  version: string;

  parseConfig(raw: unknown): Result<TConfig>;

  initialize(args: { config: TConfig; participantIds: string[]; rng: Rng }): TState;

  /**
   * The SOLE authority for what a participant may see. The engine forwards this verbatim and
   * never inspects, redacts, or infers observations from `TState` itself.
   */
  getObservation(state: TState, participantId: string): TObservation;

  getPendingActions(state: TState): PendingAction[];

  validateAction(state: TState, participantId: string, rawAction: unknown): Result<TAction>;

  resolve(args: {
    state: TState;
    actions: ReadonlyMap<string, TAction>;
    rng: Rng;
  }): RoundOutcome<TState>;

  /**
   * The one game-facing extension point in the entire timeout/forfeit path. Omitted (or
   * returning `undefined`) means the engine default applies: forfeit the whole match. A game
   * may opt into leniency (e.g. "auto-lose just this round") by returning a substitute action
   * its own `resolve()` already knows how to interpret.
   */
  onMissingAction?(args: {
    state: TState;
    participantId: string;
    reason: MissingActionReason;
  }): MissingActionDecision<TAction>;

  isTerminal(state: TState): boolean;

  getResult(state: TState): TResult;

  /** The seam that lets any `TournamentFormat` consume any game's result without knowing `TResult`. */
  getStandingOutcomes(result: TResult): StandingOutcome[];

  /** Every game must declare limits; the runtime interprets/enforces them (opaque here). */
  resourceLimits: unknown;

  /**
   * Opt-in support for a human playing this game interactively, one action at a time, through a
   * terminal (`thunderdome play`). Omitted entirely means the game doesn't support human play
   * yet — the CLI reports that clearly rather than falling back to some generic, lossy rendering
   * of `TObservation`. `parseInput` is the sole authority on what counts as well-formed typed
   * input; returning `undefined` tells the CLI the line didn't parse, so it can reprompt without
   * that ever reaching `validateAction`/`resolve()` as a real (and possibly game-illegal) action.
   */
  humanInterface?: {
    describeObservation(observation: TObservation): string;
    parseInput(raw: string): TAction | undefined;
  };
}
