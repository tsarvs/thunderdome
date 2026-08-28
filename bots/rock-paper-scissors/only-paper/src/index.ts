/**
 * Only Paper — always plays "paper", no matter what.
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to describe what RPS looks like from a bot's point of view, and answer one question:
 * decideAction().
 */
import { runBot } from '@thunderdome/bot-sdk';

type RpsChoice = 'rock' | 'paper' | 'scissors';

/** What a bot sees each round — never includes the current round's opponent choice. */
interface RpsObservation {
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

/** Decide this round's action. Only-Paper ignores the observation entirely. */
function decideAction(_observation: RpsObservation): { choice: RpsChoice } {
  return { choice: 'paper' };
}

runBot<RpsObservation, { choice: RpsChoice }>({ decideAction });
