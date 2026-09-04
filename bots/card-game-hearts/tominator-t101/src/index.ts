import { runBot } from '@thunderdome/bot-sdk-js';
import { choosePass } from './pass.js';
import { choosePlay } from './play.js';
import { updateStateFromObservation } from './state.js';
import type { Action, Observation } from './types.js';

/**
 * Tominator T2 — a bot for the "card-game-hearts" game.
 *
 * Builds on T1's passing logic (unchanged, see pass.ts) with two additions: tracking every card
 * played this hand and which suits opponents have proven "out of" (state.ts), and a sticky
 * per-hand "shoot the moon" mode entered from a lead once a hand-strength signal crosses a
 * threshold (play.ts).
 */
function decideAction(observation: Observation): Action {
  // Runs before dispatching on phase so a new hand's tracking reset happens as soon as its
  // passing round starts, not only once the first trick-play decision of that hand is reached.
  updateStateFromObservation(observation);

  if (observation.phase === 'passing') {
    return { type: 'pass', cards: choosePass(observation.hand) };
  }
  return { type: 'play', card: choosePlay(observation) };
}

runBot<Observation, Action>({ decideAction });
