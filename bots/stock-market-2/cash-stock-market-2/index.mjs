/**
 * Cash Bot — Stock Market 2 — never trades, ever, for the entire match. Every round's action is
 * an empty orders list (HOLD).
 *
 * Its purpose is entirely diagnostic: if a match's price still moves round to round with every
 * participant holding, that proves the market is genuinely moving on its own (regime drift,
 * events, synthetic external flow, or other participants' own trades in a multi-bot match) rather
 * than being an artifact of some bot's own trading (spec §38, games/stock-market-2/README.md).
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file's decision never
 * changes, so it doesn't even need to look at the observation.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

function decideAction() {
  return { orders: [] };
}

runBot({ decideAction });
