# Stock Market 2

A daily-round, single-symbol exchange simulation. Where [`games/stock-market`](../stock-market/README.md)
(v1) clears every round at one synthetic price with no real order book, this version trades
against a real simplified exchange: a bid/ask spread, market and limit orders, partial fills,
order-book depth, GTC/DAY order lifetimes, player-vs-player matching, simulated external
liquidity, a hidden fundamental value with regime-driven drift/volatility, and — when enabled —
short selling with Reg-T-style margin, borrow costs, margin calls, and forced liquidation.

One round = one trading day. Each day produces a real OHLCV candle derived from that day's actual
executions, forced liquidations included (or, on a day with no trades at all, `open = high = low =
close =` that day's reference price and `volume = 0`).

## Two market modes

```
mode: "SYNTHETIC" | "HISTORICAL"   (default: SYNTHETIC)
```

- **SYNTHETIC** (default): a single configured security (`config.symbol`, `config.synthetic`) with
  a hidden fundamental value (`market/syntheticEnvironment.ts`) that evolves independently of the
  tradable reference price — its own drift/volatility, plus a hidden market regime
  (`market/regime.ts`) that transitions Markov-style each round and shapes that regime's drift,
  volatility, liquidity/spread, and public-event frequency, plus a regime-aware event generator
  (`market/eventGenerator.ts`) producing the same five headline types HISTORICAL mode uses, each
  with a hidden signed impact. The reference/tradable price only gravitates toward the fundamental
  value (`config.referenceModel.meanReversionFactor`); it never snaps to it, so there's always a
  gap left to trade on (momentum, mean-reversion, value, and event-driven strategies all become
  meaningful exactly because the fundamental value and the tradable price aren't the same number).
- **HISTORICAL**: replays the real historical daily record of **DENN** — Denny's Corporation's
  real Nasdaq ticker — across 2,515 real trading days, 2016-01-19 through 2026-01-16 (the real date
  Denny's was taken private and delisted). Every event a bot sees (`EARNINGS_BEAT`/`MISS`,
  `POSITIVE_NEWS`/`NEGATIVE_NEWS`) is derived from Denny's actual, dated SEC Form 8-K filings — see
  [`src/data/README.md`](src/data/README.md) for sourcing and
  [`src/data/events.ts`](src/data/events.ts) for the classification logic. Its "hidden fundamental
  value" simply *is* the real closing price (never a fabricated number), and its "regime" is a
  deterministic classification of real trailing volatility/trend (never a stochastic process) —
  affecting only liquidity/spread sizing, never price directly, since the real close already *is*
  the price signal.

  **No lookahead bias**: each round's reference/pre-open price is always pulled from the *previous*
  real trading day's real close (round 0 is the one exception — it starts at its own pinned
  starting day's close, which is simply the match's configured starting point, not a leak). A bot
  is never handed today's real close before submitting orders, even indirectly. The simulated
  exchange's own executions never rewrite this real path either — HISTORICAL mode is a *historical
  market environment*, not a historically-accurate reconstruction of DENN's real order book (which
  the data doesn't contain).

Both modes feed the exact same exchange, matching, and portfolio-accounting code — neither of
those layers knows or cares which mode is in play (see `src/market/` vs `src/exchange/` vs
`src/portfolio/`). Turning a mode's raw ingredients (fundamental value, regime, event, hidden
impact) into an actual reference price is shared logic too (`market/referencePriceModel.ts`) —
setting `referenceModel: { meanReversionFactor: 1, referenceVolatility: 0 }` makes either mode's
reference price snap exactly to its fundamental value every round; `meanReversionFactor: 0` makes
either mode ignore the fundamental value entirely and just carry its own noise forward.

## The exchange

Every round, before any orders are collected, the engine has already generated that day's
synthetic external liquidity ladder (`src/exchange/liquidity.ts`) — several price levels of
simulated depth on each side, centered on the day's reference price, sized off expected daily
volume and widened by a volatility hint (both regime-adjusted). This same ladder is what every
bot's observation is built from *and* what the exchange actually matches against, so every bot
decides against the identical public state the exchange is about to use.

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
5. Borrow fees are charged on any short position, then every account is checked against its
   maintenance margin requirement; anyone below it has their open orders cancelled and their
   position forced flat (or as flat as remaining liquidity allows) through this same liquidity
   ladder — never a bare accounting adjustment. An account that's still underwater after that is
   marked bankrupt and can never trade again.
6. MARKET remainders and DAY LIMIT remainders that don't fill are dropped; GTC LIMIT remainders
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

## Short selling and margin (`config.risk`)

Off by default (`allowShortSelling: false`) — every position stays exactly as it was before this
was added: long-only, cash-only, no margin. Turning it on enables both short selling **and** margin
buying power for long positions together, the same way a real brokerage requires a margin account
to short at all:

```ts
risk: {
  allowShortSelling: true,
  borrowableShares: 1000,       // hard cap on any one participant's short size
  borrowFeeAnnualized: 0.03,    // charged daily on a short's mark-to-market notional
  initialMarginRatio: 0.5,      // gross position value may not exceed equity / this
  maintenanceMarginRatio: 0.3,  // equity below this * gross position value triggers a margin call
}
```

A position's quantity can then be positive (long), zero (flat), or negative (short). Buying power,
margin used, and the maintenance requirement are all surfaced per-participant in their own
observation (`portfolio.buyingPower`/`marginUsed`/`maintenanceRequirement`) — never for anyone
else's account. Covering a short back toward flat, or reducing a long back toward flat, is always
allowed regardless of margin; only the portion that pushes a position *past* flat into the
opposite side consumes buying power (and, for a short, counts against `borrowableShares`).

`src/portfolio/accounting.ts` is where position accounting lives — average cost basis and realized
P&L are tracked correctly through every transition: opening, adding to, partially closing, fully
closing, and a single fill large enough to reverse straight through flat into the opposite side.

**Not implemented in this pass**: a shared borrow pool across participants (`borrowableShares` is
a per-participant limit, not a depleting shared float); maximum drawdown or other risk-adjusted
result metrics (explicitly secondary analytics — final net liquidation value remains the primary
score).

## What's real, and what's still simulated (HISTORICAL mode)

- **The price path is real.** Every round's fundamental value is a real historical close.
- **The news calendar is real.** Every event is derived from Denny's actual, dated SEC filings.
- **The order book is simulated.** DENN's real historical order book isn't in the data, and
  reconstructing one wasn't attempted — the exchange described above (spread, liquidity, matching,
  slippage) is what actually determines every execution price.
- **Only one ticker, for now.** Multi-symbol support is a deliberate, documented future direction.

## Setup and winning

Starting cash defaults to $10,000; a transaction fee (`config.transactionFee`, default 0.10%) is
charged to both sides of every executed fill, forced liquidations included. Highest final net
liquidation value (cash + position × last realized close, which can be negative for an
underwater short) wins; an exact tie is a draw. As few as 1 participant may play — a bot trading
solo against the market is a complete, valid match on its own.

## Good to know

- `config.historyStartIndex` (HISTORICAL mode only) pins a match to a specific real starting day
  for reproducible demos/tests; omitted, a random valid offset is drawn per match.
- A bot never sees: the hidden fundamental value, the hidden market regime, the numeric effect size
  behind an event headline, HISTORICAL mode's own future data, or any other participant's
  portfolio, open orders, or margin status.
- None of this reflects real-time or current Denny's Corp data — Denny's Corp is a real company
  that was, in real life, taken private and delisted in January 2026. HISTORICAL mode is a closed
  historical record used for a game/bot benchmark, not a live market feed.
