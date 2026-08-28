// The only Rock-Paper-Scissors-specific part of this bot. Everything else (harness.mjs) is
// generic protocol plumbing that knows nothing about this game.
const BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

// Receives the RpsObservation ({ round, totalRounds, yourWins, opponentWins, opponentId, history })
// described in docs/guides/bot-author-guide.md §9, and returns an RPS action
// ({ choice: 'rock' | 'paper' | 'scissors' }).
export function decideAction(observation) {
  const lastRound = observation.history.at(-1);
  return { choice: lastRound ? BEATS[lastRound.opponent] : 'rock' };
}
