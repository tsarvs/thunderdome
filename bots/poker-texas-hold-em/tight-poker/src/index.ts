/**
 * Tight Poker — bets and raises only with a good hand (a standard tight preflop range, or a made
 * pair-or-better postflop), never bluffs, and only calls a bet cheaply with a weak hand. See
 * strategy.ts for the hand-strength heuristic and decision logic.
 */
import { runBot } from '@thunderdome/bot-sdk-js';
import { decideAction } from './strategy.js';
import type { Action, Observation } from './types.js';

runBot<Observation, Action>({ decideAction });
