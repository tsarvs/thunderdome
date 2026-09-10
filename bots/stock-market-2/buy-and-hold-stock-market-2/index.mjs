/**
 * Buy And Hold — Stock Market 2 — spends 90% of its starting cash on shares in round 0 (a 10%
 * cash buffer is comfortably more than the transaction fee needs), then holds for every
 * remaining round no matter what the real news or real price does.
 *
 * Ported for stock-market-2's rebuilt exchange (real order book, bid/ask spread, limit orders):
 * this bot still only ever submits ONE market order, in round 0, sized off the visible ask (the
 * price a market buy will actually walk into) rather than the last realized close — a closer
 * estimate of what round 0's fill will actually cost, though the real fill can still differ
 * slightly (spread/slippage/fees).
 *
 * All of the NDJSON wire-protocol handling (replying to "init", reading "observation", exiting
 * on "match-end") lives in @thunderdome/bot-sdk-js's runBot() — see
 * docs/guides/bot-author-guide.md for the full protocol walkthrough. This file only needs
 * to decide each round's orders — no randomness, so no PRNG/onInit needed at all.
 */
import { runBot } from '@thunderdome/bot-sdk-js';

function decideAction(observation) {
  if (observation.round === 0) {
    const price = observation.market.ask ?? observation.market.lastClose;
    const maxAffordable = Math.floor((observation.portfolio.availableCash * 0.9) / price);
    if (maxAffordable >= 1) {
      return { orders: [{ kind: 'MARKET', side: 'BUY', quantity: maxAffordable }] };
    }
  }
  return { orders: [] };
}

runBot({ decideAction });
