# Stock Market 4

Where [`stock-market-2`](../stock-market-2/README.md) and [`stock-market-3`](../stock-market-3/README.md)
*simulate* a market — a hidden price model, a hidden macro economy, an order book matching bots
against each other — this version **replays one**. You supply the daily bars (real historical
data, or a synthetic series you generated yourself); the game replays them day by day, gated so a
bot never sees a bar, corporate action, or research payload before its own date. Nothing here
invents prices. Execution is deliberately simplified (every fill is against the tape itself, never
against another participant — no order book) to keep the focus on portfolio-management decisions:
sizing, risk, leverage, and — optionally — incorporating an external research signal, rather than
exchange microstructure.

One round = one real trading day.

```ts
import { game as stockMarket4 } from '@thunderdome/game-stock-market-4';
```

## You supply the data

There is no procedural price engine in this game, historical or synthetic. `config.historicalPrices`
is a plain `{ [ticker]: DailyBar[] }` map — every bar you want this match to ever show a bot, for
every ticker in `config.marketDataUniverse`. `config.marketDataMode` (`'historical'` or
`'synthetic'`, default `'historical'`) is a label only: nothing about how a series is read,
replayed, split-adjusted, or traded against differs by mode. If you want a synthetic match, you
generate the synthetic series yourself (however you like) and hand it in exactly the same way you'd
hand in real data — see [`market/historicalPrices.ts`](src/market/historicalPrices.ts) and
[`market/calendar.ts`](src/market/calendar.ts).

```
config.startDate / config.endDate       the match's calendar window
config.tradingHolidays                  non-trading dates besides weekends (default: [])
config.historicalContextDays            trailing bars a bot sees before its first decision (default: 250)
config.marketDataUniverse               tickers this match trades (must each have a historicalPrices entry)
config.historicalPrices                 { [ticker]: DailyBar[] } — the whole declared price series
```

`state.round` N is decided for the Nth actual trading day in `[startDate, endDate]` — weekends and
`tradingHolidays` are skipped, so a two-day weekend inside the range never adds a round. A bar's
own bid to the bot is capped by `historicalContextDays`; `historicalPrices` may (and generally
should) extend earlier than `startDate` so that warmup window has real data to draw from, not just
days actually played during the match. A gap in the data (a ticker with no bar on some trading day)
is reported to the bot as `bar: null`, never silently carried forward from the prior close.

## Corporate actions

`config.corporateActions` declares real (or synthetic) dividends, splits, reverse-splits,
buybacks, acquisitions, and delistings — organizer-declared historical fact, not something this
game triggers on its own. STOCK_SPLIT/REVERSE_SPLIT get full mechanical treatment: the price series
a bot sees is retroactively adjusted so a split never looks like a 50% loss, and a held position's
share count/cost basis rescale the moment it takes effect — all pure accounting math, so it needs
no order-execution machinery to work. A split dated in the future never adjusts anything
retroactively; only once it's actually happened does the past reread as continuous, the same way
real adjusted-close data behaves. CASH_DIVIDEND settles cash onto a held position the same way.
BUYBACK/ACQUISITION/DELISTING are surfaced to a bot as fact (`observation.corporateActions`) but
have no forced-settlement mechanism (yet) — see [`market/corporateActions.ts`](src/market/corporateActions.ts).

Acquisitions/delistings may declare an `announcedDate` earlier than their effective `date` — real
advance notice, the same as an actual M&A announcement.

## Orders & execution

```ts
action = { orders: [{ kind: 'MARKET' | 'LIMIT', ticker, side: 'BUY' | 'SELL', quantity, limitPrice? }] }
```

Every order fills independently against that round's own bar — a MARKET order at the day's close,
a LIMIT order at the limit price if the day's range would plausibly have crossed it (low ≤ limit
for a BUY, high ≥ limit for a SELL), never partially against synthetic order-book depth. Orders
don't rest: an order is evaluated only for the round it's submitted in, so a bot that wants another
chance simply resubmits. A batch of orders is processed in submission order, each seeing the fill
before it — a SELL right after a BUY in the same list sees the position that BUY just opened. See
[`execution/orders.ts`](src/execution/orders.ts).

## Risk & financing (`config.risk`)

```
allowShortSelling      default false — a plain cash account; true enables margin/short-selling
borrowableShares       per-ticker short cap (default 1000, static — not dynamically scaled)
borrowFeeAnnualized    default 0.03 (3%), charged daily on any short position's notional
initialMarginRatio     default 0.5 — Reg-T-style buying power = equity / this
maintenanceMarginRatio default 0.3 — equity below this forces liquidation
```

Off by default: a BUY is capped to what cash affords, a SELL to shares actually held, never
opening a short. Turn it on and buying power (not literal cash) becomes the real spending limit —
a BUY can be financed by margin beyond your cash balance (which is then allowed to go negative), a
SELL beyond current shares opens/extends a short capped by `borrowableShares`. Every round, any
short position is charged a daily borrow fee; if equity then falls below the maintenance
requirement, positions are force-liquidated (largest exposure first, deterministic) against that
same day's close — there's no order book to partially fill against, so each forced trade closes in
one step. See [`portfolio/accounting.ts`](src/portfolio/accounting.ts),
[`portfolio/borrow.ts`](src/portfolio/borrow.ts), and [`portfolio/liquidation.ts`](src/portfolio/liquidation.ts).

## The research boundary

`config.researchTimeline` is a sorted list of `{ date, payload }` entries — `payload` is
completely opaque to this game. No schema, no validation of its shape, no interpretation. A bot
sees `observation.research`: the latest entry with `date` at or before the current round, or
`undefined` if none is knowable yet. This game deliberately doesn't import
[`@thunderdome/research-core`](../../packages/research/core/README.md) or know that it exists —
the intended real-world flow is to call that package's own `createResearchSnapshot(dataset,
timestamp)` yourself, outside this game entirely, and hand the resulting JSON straight through
here. See [`research/timeline.ts`](src/research/timeline.ts).

## Benchmarks & metrics

Every participant's whole equity curve is tracked (`observation.portfolio.equityHistory`) — one
reading at match start, one more per round. At match end, `getResult` reports each participant's
`performanceMetrics`: total return, max drawdown, annualized volatility, and a Sharpe ratio
(`null` when volatility is 0 — e.g. a single trade all match, which has no defined variance to
compute one from). Annualization uses 252 trading days/year throughout, the same convention the
borrow-fee calculation uses. Optionally declare `config.benchmarkTicker` (any ticker with a
`historicalPrices` entry — it doesn't need to be in `marketDataUniverse`, since a benchmark is
something performance is measured *against*, not necessarily something a bot can trade) for a
buy-and-hold `benchmarkReturn` over the same first-to-last trading day the match actually played.
See [`metrics/performance.ts`](src/metrics/performance.ts).

## Results, ranking, and determinism

Ranked by final equity, highest wins — ties share a rank (competition ranking: 1, 1, 3, never 1,
1, 2), same convention as `stock-market-3`'s own net-liquidation-value scoring. This was chosen
over a Sharpe-based ranking because `sharpeRatio` is legitimately `null` for plenty of real
portfolios, which would need its own tiebreak rule anyway — `performanceMetrics`/`riskStats` stay
on the result for anyone who wants a different scoring rule downstream.

Every resolved round's event carries a real audit-trail payload (`RoundEventData`): the date,
every participant's fills (order fills and any forced liquidations), which participants got
margin-called that specific round, and which corporate actions took mechanical effect that round —
enough for a replay/spectator consumer to reconstruct exactly what happened without touching raw
game state.

This game is fully deterministic (`manifest.json`'s `deterministic: true`): nothing in it ever
reads its own `rng` argument. Every outcome is a pure function of `config` and the action sequence
submitted — the same config and the same actions always produce the same result.

## Setup and winning

Starting capital defaults to $100,000; a transaction fee (default 0.1%) is charged on every
executed fill (including a forced liquidation). A missed, late, or invalid action never forfeits
the match — a historical-replay match can run hundreds of rounds, so it's substituted with an
empty order list instead (that participant just sits out the round; their portfolio, borrow fees,
and margin exposure all carry forward normally). As few as 1 participant may play — a bot trading
solo against real history is a complete match on its own, reported as a solo win.

## What this game deliberately isn't

- **Not a market simulator.** There is no hidden fundamental-value model, no macro economy, no
  synthetic index — see `stock-market-2`/`stock-market-3` for that. Every price a bot ever sees
  came from `config.historicalPrices`, verbatim (split-adjusted for continuity, never invented).
- **Not an order book.** Every fill is against the declared tape, independent of every other
  participant — there's no cross-participant matching, no synthetic bid/ask depth, no queue
  position to game.
- **Not aware of research, or of any bot.** `research/timeline.ts` never imports or assumes
  anything about `@thunderdome/research-core`; `config`/`getObservation` never leak anything a bot
  shouldn't see yet (see `redactConfigForBots`, which strips `historicalPrices`/
  `corporateActions`/`researchTimeline` down to their empty shape before a bot's own `init` — the
  full match's future tape/actions/research would otherwise go straight to it).

## Good to know

- `config.transactionFeeRate` (default 0.1%) applies to every fill, including a forced liquidation.
- A bar dated exactly on a split's own effective date is never itself adjusted by that split —
  only bars strictly before it are, which is what makes the series read as continuous rather than
  doubly-adjusted.
- `redactConfigForBots` is the only place isolation needs active enforcement beyond
  `getObservation` itself: `historicalPrices`/`corporateActions`/`researchTimeline` each hold the
  FULL match (every future bar, action, and research entry), so the wire copy of config a bot
  actually receives via `init` has all three stripped to their empty shape.
- 206 tests across 12 files cover every module in this package — see `test/` for the full suite,
  organized to mirror `src/`.
