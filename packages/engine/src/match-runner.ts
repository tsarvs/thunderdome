import type {
  GameDefinition,
  MissingActionReason,
  RoundEvent,
  Rng,
  StandingOutcome,
} from './types.js';

/**
 * The generic per-match loop. Contains no game-specific logic and no knowledge of Docker, bot
 * processes, or any wire protocol — `ActionCollector` is the seam a real adapter fills in with
 * real bot processes (`@thunderdome/runtime`'s `DockerActionCollector`); here it's just
 * an interface, so this whole module is testable with a synthetic collector and a synthetic game
 * (see test/match-runner.test.ts).
 */
export interface RequestActionArgs {
  participantId: string;
  roundId: number;
  observation: unknown;
  deadlineMs: number;
  required: boolean;
}

export type CollectedAction =
  { ok: true; action: unknown } | { ok: false; reason: MissingActionReason };

export interface ActionCollector {
  requestAction(args: RequestActionArgs): Promise<CollectedAction>;
}

export interface MatchOutcome<TResult> {
  status: 'completed' | 'forfeit' | 'match-timeout';
  /** Present when `status === 'completed'`. */
  result?: TResult;
  standingOutcomes: StandingOutcome[];
  /** Present when `status === 'forfeit'`. */
  forfeitedParticipantIds?: string[];
  /** One entry per round that reached `resolve()`; a forfeited round is not included. */
  events: RoundEvent[][];
}

export interface RunMatchArgs<TConfig, TState, TObservation, TAction, TResult> {
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>;
  config: TConfig;
  participantIds: string[];
  rng: Rng;
  collector: ActionCollector;
  /** Used for any pending entry that doesn't specify its own `deadlineMs`. */
  defaultDeadlineMs: number;
  /**
   * The whole-match wall-clock safety net docs/adr/0003-docker-bot-isolation.md calls for:
   * every participant can be responding perfectly, on time, every single round, and the match
   * can still never terminate — e.g. two bots whose strategies converge into an infinite draw
   * cycle (`isTerminal()` only becomes true once someone reaches a majority of round *wins*, and
   * an endless run of draws never produces one). No single participant is at fault here, so this
   * is deliberately distinct from a `forfeit` — see `status: 'match-timeout'`.
   */
  matchDeadlineMs: number;
  /** Injectable clock, for deterministic tests of the above; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Optional: called once per round, right after `resolve()` produces it — the seam a caller
   * (e.g. the CLI's human-play mode) uses to observe every round's events live, not just the
   * final aggregated `MatchOutcome.events` returned once the whole match ends. Never called for
   * a round that ends in forfeit (no `resolve()` ever runs for one).
   */
  onRoundResolved?: (events: RoundEvent[]) => void;
}

export async function runMatch<TConfig, TState, TObservation, TAction, TResult>(
  args: RunMatchArgs<TConfig, TState, TObservation, TAction, TResult>,
): Promise<MatchOutcome<TResult>> {
  const {
    game,
    config,
    participantIds,
    rng,
    collector,
    defaultDeadlineMs,
    matchDeadlineMs,
    onRoundResolved,
  } = args;
  const now = args.now ?? Date.now;
  const matchStartedAt = now();

  let state = game.initialize({ config, participantIds, rng });
  const events: RoundEvent[][] = [];
  let roundId = 0;

  while (!game.isTerminal(state)) {
    if (now() - matchStartedAt >= matchDeadlineMs) {
      return {
        status: 'match-timeout',
        standingOutcomes: synthesizeTimeoutStandings(participantIds),
        events,
      };
    }

    const pending = game.getPendingActions(state);

    // Every pending participant — required or not — is requested concurrently
    // (docs/adr/0004-deterministic-randomness.md: real arrival order must never influence
    // outcomes, and a slow optional responder must never delay a required one).
    const requests = await Promise.all(
      pending.map(async (entry) => {
        const observation = game.getObservation(state, entry.participantId);
        const collected = await collector.requestAction({
          participantId: entry.participantId,
          roundId,
          observation,
          deadlineMs: entry.deadlineMs ?? defaultDeadlineMs,
          required: entry.required,
        });
        return { entry, collected };
      }),
    );

    const actions = new Map<string, TAction>();
    const forfeitedParticipantIds: string[] = [];

    for (const { entry, collected } of requests) {
      if (collected.ok) {
        const validated = game.validateAction(state, entry.participantId, collected.action);
        if (validated.ok) {
          actions.set(entry.participantId, validated.value);
          continue;
        }
        if (!entry.required) {
          continue; // an invalid *voluntary* submission is simply ignored, not a fault
        }
        applyMissingActionPolicy(
          game,
          state,
          entry.participantId,
          'invalid',
          actions,
          forfeitedParticipantIds,
        );
        continue;
      }

      if (!entry.required) {
        continue; // no voluntary submission arrived — nothing to do
      }
      applyMissingActionPolicy(
        game,
        state,
        entry.participantId,
        collected.reason,
        actions,
        forfeitedParticipantIds,
      );
    }

    if (forfeitedParticipantIds.length > 0) {
      return {
        status: 'forfeit',
        standingOutcomes: synthesizeForfeitStandings(participantIds, forfeitedParticipantIds),
        forfeitedParticipantIds,
        events,
      };
    }

    const outcome = game.resolve({ state, actions, rng });
    events.push(outcome.events);
    onRoundResolved?.(outcome.events);
    state = outcome.nextState;
    roundId += 1;
  }

  const result = game.getResult(state);
  return {
    status: 'completed',
    result,
    standingOutcomes: game.getStandingOutcomes(result),
    events,
  };
}

function applyMissingActionPolicy<TConfig, TState, TObservation, TAction, TResult>(
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>,
  state: TState,
  participantId: string,
  reason: MissingActionReason,
  actions: Map<string, TAction>,
  forfeitedParticipantIds: string[],
): void {
  const decision = game.onMissingAction?.({ state, participantId, reason }) ?? {
    policy: 'forfeit-match',
  };
  if (decision.policy === 'forfeit-match') {
    forfeitedParticipantIds.push(participantId);
  } else {
    actions.set(participantId, decision.action);
  }
}

/**
 * Generic match-administration, not game logic: forfeiting participants rank last, survivors
 * rank ahead of them. In the common 2-player case with exactly one forfeiter, the survivor's
 * outcome is unambiguous ("win"); beyond that, "win" doesn't generalize cleanly (docs/adr's
 * partial-forfeit policy notes) so only rank is set for survivors.
 */
function synthesizeForfeitStandings(
  participantIds: readonly string[],
  forfeitedParticipantIds: readonly string[],
): StandingOutcome[] {
  const forfeited = new Set(forfeitedParticipantIds);
  const survivors = participantIds.filter((id) => !forfeited.has(id));
  const survivorsWin = participantIds.length === 2 && survivors.length === 1;

  const outcomes: StandingOutcome[] = survivors.map((participantId) =>
    survivorsWin ? { participantId, rank: 1, outcome: 'win' } : { participantId, rank: 1 },
  );
  for (const participantId of forfeitedParticipantIds) {
    outcomes.push({ participantId, rank: 2, outcome: 'loss' });
  }
  return outcomes;
}

/**
 * A match-timeout is nobody's fault — every participant may have responded correctly, on time,
 * every round — so unlike a forfeit, everyone shares the same rank rather than winners/losers
 * being distinguished.
 */
function synthesizeTimeoutStandings(participantIds: readonly string[]): StandingOutcome[] {
  return participantIds.map((participantId) => ({ participantId, rank: 1, outcome: 'draw' }));
}
