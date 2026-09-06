# Stock Market 2

A daily-round, single-symbol exchange simulation. Where [`games/stock-market`](../stock-market/README.md)
(v1) clears every round at one synthetic price with no real order book, this version trades
against a real simplified exchange: a bid/ask spread, market and limit orders, partial fills,
order-book depth, GTC/DAY order lifetimes, player-vs-player matching, and simulated external
liquidity so a bot never depends on another bot to have someone to trade with.

One round = one trading day. Each day produces a real OHLCV candle derived from that day's actual
executions (or, on a day with no trades at all, `open = high = low = close =` that day's reference
price and `volume = 0`).

## Two market modes

```
mode: "SYNTHETIC" | "HISTORICAL"   (default: SYNTHETIC)
```

- **SYNTHETIC** (default): a single configured security (`config.symbol`, `config.synthetic`)
  whose reference price follows a deterministic, seeded placeholder random walk. This is
  deliberately the simplest possible price process — there is no hidden fundamental value, market
  regime, or event generator yet. Bot trading's actual price impact still shows up (walking a real
  order book naturally produces slippage — see below), it just isn't currently reinforced by a
  fundamental-value mean-reversion mechanic. That's explicit future work, not attempted here.
- **HISTORICAL**: replays the real historical daily record of **DENN** — Denny's Corporation's
  real Nasdaq ticker — across 2,515 real trading days, 2016-01-19 through 2026-01-16 (the real date
  Denny's was taken private and delisted). Every event a bot sees (`EARNINGS_BEAT`/`MISS`,
  `POSITIVE_NEWS`/`NEGATIVE_NEWS`) is derived from Denny's actual, dated SEC Form 8-K filings — see
  [`src/data/README.md`](src/data/README.md) for sourcing and
  [`src/data/events.ts`](src/data/events.ts) for the classification logic.

  **No lookahead bias**: each round's reference/pre-open price is always the *previous* real
  trading day's real close (round 0 is the one exception — it starts at its own pinned starting
  day's close, which is simply the match's configured starting point, not a leak). A bot is never
  handed today's real close before submitting orders. The simulated exchange's own executions never
  rewrite this real path either — HISTORICAL mode is a *historical market environment*, not a
  historically-accurate reconstruction of DENN's real order book (which the data doesn't contain).

Both modes feed the exact same exchange, matching, and portfolio-accounting code — neither of
those layers knows or cares which mode is in play (see `src/market/` vs `src/exchange/`).

## The exchange

Every round, before any orders are collected, the engine has already generated that day's
synthetic external liquidity ladder (`src/exchange/liquidity.ts`) — several price levels of
simulated depth on each side, centered on the day's reference price, sized off expected daily
volume and widened by a volatility hint. This same ladder is what every bot's observation is built
from *and* what the exchange actually matches against, so every bot decides against the identical
public state the exchange is about to use.

Each round, in order (`src/exchange/matchingEngine.ts`):

1. Cancels are applied first (freeing up buying power for new orders in the same submission).
2. New MARKET/LIMIT orders are admitted (LIMIT orders reserve buying power up front, since they
   might rest; MARKET orders never rest, so any real affordability limit is enforced per fill).
3. **Player orders match against player orders first** — resting GTC orders plus this round's new
   submissions, at price priority with a *seeded random* tie-break for equal prices (never
   registration/submission order, so no participant is structurally favored). A participant can
   never trade against their own order (self-trade prevention).
4. Whatever's left matches against the synthetic liquidity ladder, walking multiple price levels
   if needed — this is what produces realistic slippage on a large order, with no separate
   artificial "market impact" formula needed.
5. MARKET remainders and DAY LIMIT remainders that don't fill are dropped; GTC LIMIT remainders
   persist into the next round's book.

### Order types

```jsonc
{ "kind": "MARKET", "side": "BUY" | "SELL", "quantity": 10 }
{ "kind": "LIMIT", "side": "BUY" | "SELL", "quantity": 10, "limitPrice": 100.50, "timeInForce": "DAY" | "GTC" }
{ "kind": "CANCEL", "orderId": "alice:3" }
```

A round's action is `{ "orders": [...] }` — up to `config.maxOrdersPerRound` instructions,
processed in the order listed (so a `CANCEL` earlier in the list frees up buying power for a new
order later in the same list). An empty `orders` array is a HOLD.

## What's real, and what's still simulated (HISTORICAL mode)

- **The price path is real.** Every round's reference price is a real historical close.
- **The news calendar is real.** Every event is derived from Denny's actual, dated SEC filings.
- **The order book is simulated.** DENN's real historical order book isn't in the data, and
  reconstructing one wasn't attempted — the exchange described above (spread, liquidity, matching,
  slippage) is what actually determines every execution price.
- **Only one ticker, for now.** Multi-symbol support is a deliberate, documented future direction.

## What's not implemented yet

This is a deliberately scoped rework (the market-environment/exchange split, plus the exchange
itself), not the full eventual design. Not yet implemented, on purpose:

- Short selling, margin, buying power, or borrow costs — every position is long-only, cash-only.
- A hidden fundamental value, market regimes, or an event-impact model (SYNTHETIC mode's price
  process is intentionally the simplest possible placeholder).
- Multiple symbols per game instance.

## Setup and winning

Starting cash defaults to $10,000; a transaction fee (`config.transactionFee`, default 0.10%) is
charged to both sides of every executed fill. Highest final portfolio value (cash + shares ×
last realized close) wins; an exact tie is a draw. As few as 1 participant may play — a bot trading
solo against the market is a complete, valid match on its own.

## Good to know

- `config.historyStartIndex` (HISTORICAL mode only) pins a match to a specific real starting day
  for reproducible demos/tests; omitted, a random valid offset is drawn per match.
- A bot never sees: the numeric effect size behind an event headline, HISTORICAL mode's own future
  data, or any other participant's portfolio or open orders.
- None of this reflects real-time or current Denny's Corp data — Denny's Corp is a real company
  that was, in real life, taken private and delisted in January 2026. HISTORICAL mode is a closed
  historical record used for a game/bot benchmark, not a live market feed.
