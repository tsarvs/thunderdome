import { err, ok, type GameDefinition, type StandingOutcome } from '@thunderdome/engine';
import {
  RPS_CHOICES,
  RpsActionSchema,
  RpsConfigSchema,
  type RpsAction,
  type RpsChoice,
  type RpsConfig,
  type RpsObservation,
  type RpsResult,
  type RpsRoundRecord,
  type RpsState,
} from './types.js';

function beats(a: RpsChoice, b: RpsChoice): boolean {
  return (
    (a === 'rock' && b === 'scissors') ||
    (a === 'paper' && b === 'rock') ||
    (a === 'scissors' && b === 'paper')
  );
}

function choiceOf(action: RpsAction | undefined): RpsChoice | null {
  return action !== undefined && 'choice' in action ? action.choice : null;
}

const CHOICE_ALIASES: Record<string, RpsChoice> = {
  r: 'rock',
  rock: 'rock',
  p: 'paper',
  paper: 'paper',
  s: 'scissors',
  scissors: 'scissors',
};

function describeChoice(choice: RpsChoice | null): string {
  return choice ?? '(none)';
}

/** `thunderdome play`'s prompt each round — see `GameDefinition.humanInterface`. */
function describeObservation(observation: RpsObservation): string {
  const { round, totalRounds, yourWins, opponentWins, opponentId, history } = observation;
  const last = history.at(-1);
  const lastRoundLine =
    last === undefined
      ? ''
      : `Last round — you: ${describeChoice(last.you)}, ${opponentId}: ${describeChoice(last.opponent)} ` +
        `(${last.winner === 'you' ? 'you won' : last.winner === 'opponent' ? `${opponentId} won` : 'draw'})\n`;

  return (
    `\nRound ${String(round + 1)}/${String(totalRounds)} — you: ${String(yourWins)}, ${opponentId}: ${String(opponentWins)}\n` +
    lastRoundLine +
    'rock, paper, or scissors? (r/p/s) '
  );
}

/** Only ever produces a well-formed `{ choice }` — never `undefined`'s corresponding
 * `RpsActionSchema`-rejected shapes, so a human's typo just gets reprompted, not forfeited. */
function parseInput(raw: string): RpsAction | undefined {
  const choice = CHOICE_ALIASES[raw.trim().toLowerCase()];
  return choice === undefined ? undefined : { choice };
}

export const rockPaperScissors: GameDefinition<
  RpsConfig,
  RpsState,
  RpsObservation,
  RpsAction,
  RpsResult
> = {
  id: 'rock-paper-scissors',
  version: '1.0.0',

  parseConfig(raw) {
    const result = RpsConfigSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err(result.error.issues.map((issue) => issue.message).join('; '));
  },

  initialize({ participantIds, config }) {
    const [a, b] = participantIds;
    if (a === undefined || b === undefined || participantIds.length !== 2) {
      throw new Error('rock-paper-scissors requires exactly 2 participants');
    }
    return {
      participantIds: [a, b],
      config,
      roundWins: new Map([
        [a, 0],
        [b, 0],
      ]),
      history: [],
      round: 0,
    };
  },

  getObservation(state, participantId) {
    const opponentId = state.participantIds.find((id) => id !== participantId);
    if (opponentId === undefined) {
      throw new Error(`unknown participant "${participantId}"`);
    }
    return {
      round: state.round,
      totalRounds: state.config.totalRounds,
      yourWins: state.roundWins.get(participantId) ?? 0,
      opponentWins: state.roundWins.get(opponentId) ?? 0,
      opponentId,
      history: state.history.map((record) => ({
        round: record.round,
        you: record.choices[participantId] ?? null,
        opponent: record.choices[opponentId] ?? null,
        winner:
          record.winner === participantId
            ? 'you'
            : record.winner === opponentId
              ? 'opponent'
              : 'draw',
      })),
    };
  },

  getPendingActions(state) {
    return state.participantIds.map((participantId) => ({ participantId, required: true }));
  },

  validateAction(_state, _participantId, raw) {
    const result = RpsActionSchema.safeParse(raw);
    return result.success
      ? ok(result.data)
      : err('action must be { choice: "rock" | "paper" | "scissors" }');
  },

  resolve({ state, actions }) {
    const [a, b] = state.participantIds;
    const choiceA = choiceOf(actions.get(a));
    const choiceB = choiceOf(actions.get(b));

    let winner: string; // a participant id, or the sentinel 'draw'
    if (choiceA === null && choiceB === null) {
      winner = 'draw';
    } else if (choiceA === null) {
      winner = b;
    } else if (choiceB === null) {
      winner = a;
    } else if (choiceA === choiceB) {
      winner = 'draw';
    } else {
      winner = beats(choiceA, choiceB) ? a : b;
    }

    const nextRoundWins = new Map(state.roundWins);
    if (winner !== 'draw') {
      nextRoundWins.set(winner, (nextRoundWins.get(winner) ?? 0) + 1);
    }

    const record: RpsRoundRecord = {
      round: state.round,
      choices: {
        ...(choiceA !== null ? { [a]: choiceA } : {}),
        ...(choiceB !== null ? { [b]: choiceB } : {}),
      },
      winner,
    };

    return {
      nextState: {
        ...state,
        roundWins: nextRoundWins,
        history: [...state.history, record],
        round: state.round + 1,
      },
      events: [
        { type: 'round-result', participantIds: [a, b], data: { winner, choiceA, choiceB } },
      ],
    };
  },

  onMissingAction({ state }) {
    if (state.config.onMissingAction === 'loseRound') {
      return { policy: 'substitute', action: { forfeitedRound: true } };
    }
    return { policy: 'forfeit-match' };
  },

  // Bounded by construction: exactly `totalRounds` hands are played, full stop — never "keep
  // replaying until someone gets a decisive majority," which is what let two particular
  // strategies draw forever (docs/adr/0003's match-timeout note; reproduced for real with
  // copycat-rps vs a bot that always plays the same throw).
  isTerminal(state) {
    return state.round >= state.config.totalRounds;
  },

  getResult(state) {
    const [a, b] = state.participantIds;
    const winsA = state.roundWins.get(a) ?? 0;
    const winsB = state.roundWins.get(b) ?? 0;
    const winnerId = winsA === winsB ? null : winsA > winsB ? a : b;
    return {
      winnerId,
      roundWins: { [a]: winsA, [b]: winsB },
      totalRounds: state.config.totalRounds,
    };
  },

  getStandingOutcomes(result) {
    const participantIds = Object.keys(result.roundWins);
    const scoreOf = (participantId: string): number => result.roundWins[participantId] ?? 0;
    if (result.winnerId === null) {
      // A genuine tie in the tally after every hand was actually played — unlike the old
      // engine-level match-timeout, this reflects real gameplay, not an infrastructure give-up.
      return participantIds.map((participantId) => ({
        participantId,
        rank: 1,
        outcome: 'draw',
        score: scoreOf(participantId),
      }));
    }
    const loserId = participantIds.find((id) => id !== result.winnerId);
    const outcomes: StandingOutcome[] = [
      { participantId: result.winnerId, rank: 1, outcome: 'win', score: scoreOf(result.winnerId) },
    ];
    if (loserId !== undefined) {
      outcomes.push({ participantId: loserId, rank: 2, outcome: 'loss', score: scoreOf(loserId) });
    }
    return outcomes;
  },

  resourceLimits: {
    cpus: 0.5,
    memoryMb: 128,
    turnTimeoutMs: 5000,
  },

  humanInterface: { describeObservation, parseInput },
};

export { RPS_CHOICES };
