# Stock Market 3

Where [`games/stock-market-2`](../stock-market-2/README.md) trades one ticker against a real
order book, this version trades a whole small market: a configurable universe of equities (9 by
default) spread across 5 sectors, plus one tradable synthetic index built from the same
constituents. Every equity's price is driven by its own hidden fundamental value, but those hidden
values aren't independent — they all partially load on a shared, hidden macro economy, so sectors
genuinely move together (and against each other) in ways a bot can learn to trade, not just each
stock in isolation. On top of that: real quarterly company fundamentals and earnings reports with
their own analyst-consensus estimates, a public economic-release calendar, and corporate actions
(dividends, buybacks, splits, acquisitions, delistings) — all layered onto the same order-book
exchange, margin/short-selling, and portfolio-accounting machinery `stock-market-2` established.

One round = one trading day, same as before.

## The universe: securities, sectors, and the index

```
config.equities: [{ symbol, sector }, ...]   (default: 9 equities across 5 sectors)
config.indexSymbol: string                   (default: "SYNTH_INDEX")
```

The default universe: `TECH_A`/`TECH_B`/`TECH_C` (TECHNOLOGY), `CONSUMER_A`/`CONSUMER_B`
(CONSUMER), `INDUSTRIAL_A`/`INDUSTRIAL_B` (INDUSTRIAL), `FINANCIAL_A` (FINANCIAL), `HEALTHCARE_A`
(HEALTHCARE) — configurable from 2 to 30 symbols. `SYNTH_INDEX` (`kind: "INDEX"`) is a real,
independently tradable security built as a weight-blended aggregate of the equities' own returns,
not a plain average of their prices — its constituent weights are fixed for the match and never
shown to a bot (spec'd as hidden index methodology; a bot sees only the index's own tradable price
and history, the same as any equity).

## The hidden economy

Six hidden economic factors (`GROWTH`, `INFLATION`, `INTEREST_RATES`, `COMMODITY_PRICES`,
`RISK_APPETITE`, `LIQUIDITY`) drift and mean-revert on their own each round, nudged by the current
hidden market regime (`BULL`/`BEAR`/`SIDEWAYS`/`HIGH_VOLATILITY`/`LOW_VOLATILITY`/`CRISIS`), which
itself transitions Markov-style round to round. Every sector has its own fixed sensitivity profile
across those six factors, so same-sector securities are genuinely correlated beyond pure chance —
a real, tradable structure, not noise. Every company also has its own fixed loadings on five style
factors (`SIZE`/`VALUE`/`MOMENTUM`/`QUALITY`/`VOLATILITY`), tilted further by its lifecycle stage
(`HIGH_GROWTH`/`MATURE`/`DECLINE`, re-evaluated only at that company's own quarterly earnings date).

**None of that is exposed to a bot directly** — not the factor values, not the regime, not any
sector's or company's exact loadings. `security.sector` is public (so a bot can group companies
sensibly), but exactly how much a given sector actually moves in response to a macro surprise is
something a bot has to estimate from what it actually observes, the same way a real quant would —
see [Hidden Information Audit](#hidden-information-audit).

## Price formation

Each security carries two related but distinct numbers under the hood: a **hidden fundamental
value** (this round's "true" price, moved by the shared macro factors above, the company's own
quarterly fundamentals, market-wide/company-specific news, and a small idiosyncratic shock) and a
**tradable reference price** that mean-reverts toward that fundamental value every round without
ever snapping exactly to it — same relationship as `stock-market-2`'s `referenceModel`, so there's
always a real, tradable gap between "true" and "traded." On top of that reversion pull, the
tradable price also carries its own short-horizon momentum tendency and a separate longer-horizon
pull back toward its own recent trend, each scaled by a hidden per-company sensitivity. The
lookback windows behind those two tendencies, and each company's sensitivity to them, are
deliberately not published here (see [Hidden Information Audit](#hidden-information-audit)) —
they're discoverable from a security's own public `priceHistory`, the same way a real quant
backtests candidate lookback windows rather than being handed the "right" one.

The index's own fundamental value is the weight-blended log-return of its constituents' own
fundamental-value moves, plus a small independent wobble — then it goes through the exact same
reference-price process as any equity, so it trades with its own real (if usually smaller) gap
between fundamental and tradable price too.

## Company fundamentals, earnings, and analyst estimates

One quarter = 63 rounds. At the start of each of a company's quarters, its true revenue growth,
margin, and (lifecycle-tilted) trajectory for that quarter are drawn — hidden, revealed only at
that quarter's earnings report. An initial analyst consensus estimate (EPS, revenue, margin) is
published immediately, deliberately noisy and biased early on; every round after that, the
consensus is revised, pulling partway toward the still-hidden true outcome with fresh noise on
top — so a consensus that's been trending in one direction over several rounds is real, if noisy,
information about where the truth likely sits, not just static analyst guesswork sitting still
until the report.

At the earnings report, `reported` and the last public `consensus` are shown side by side — never
a `BEAT`/`MISS` label, a bot computes its own surprise. The report does move price the same round,
scaled by the size of the surprise (bounded, so no single report can blow up a name in one
round) — but exactly how that surprise is weighted (EPS vs. revenue) and exactly how large the
bound is are, again, not published here.

## Corporate actions and company lifecycle

Every round, a company may pay a cash dividend or run a buyback (both probabilistic, small, and
independent of price level). Splits are rule-based and deterministic: a security trading at **4x**
its own opening price splits 2-for-1; one that's fallen to **15%** of its opening price reverse-
splits 5-for-1 — each with a 15-round cooldown afterward so a price merely oscillating around the
trigger doesn't split every few rounds. `priceHistory` is always split-adjusted; a security's own
fixed opening price (used only for these trigger checks) never is, which is what makes "back above
4x" or "down to 15%" mean the same thing before and after a split actually fires.

Acquisitions and delistings are rare (expect roughly one or two across the default 9-equity
universe over a full match) but get **real, no-outcome-leaked advance notice**: once announced,
a bot sees the deal's fixed cash-per-share price and the exact future round it takes effect
immediately — 5 rounds out, always. Every existing holder (and anyone who buys in before then) is
automatically cashed out at exactly that disclosed price the moment it takes effect, regardless of
where the market price has wandered to in the meantime; a delisted/acquired security stops trading
entirely from that round on.

## The exchange

Same real order book and matching engine as `stock-market-2`: bid/ask spread, market and limit
orders, partial fills, GTC/DAY lifetimes, player-vs-player matching before synthetic external
liquidity, seeded random tie-breaks, self-trade prevention, and a per-round synthetic liquidity
ladder every bot's observation and the exchange's own matching both read from — see that game's
README for the full round-by-round mechanics, which carry over unchanged. `config.orderBookDepth`
(default 5) controls how many price levels of that ladder a bot actually sees per symbol per round.

```jsonc
{ "kind": "MARKET", "symbol": "TECH_A", "side": "BUY" | "SELL", "quantity": 10 }
{ "kind": "LIMIT", "symbol": "TECH_A", "side": "BUY" | "SELL", "quantity": 10, "limitPrice": 100.50, "timeInForce": "DAY" | "GTC" }
{ "kind": "CANCEL", "orderId": "..." }
```

A round's action is `{ "orders": [...] }`, up to `config.maxOrdersPerRound` (default 10) — now
naming a `symbol` on every order, since more than one security trades at once. An empty array is a
HOLD.

## Short selling and margin (`config.risk`)

The same Reg-T-style mechanics as `stock-market-2` — `allowShortSelling`, `borrowableShares`,
`borrowFeeAnnualized`, `initialMarginRatio`, `maintenanceMarginRatio`, gross position value capped
across every symbol combined (not per-symbol), a margin call forcing a position back toward flat
through the same liquidity ladder rather than a bare accounting write-down, bankruptcy for anyone
still underwater after that. The one real difference: **short selling and margin default ON**
here (`allowShortSelling: true`), not off — this game's whole design (pairs trades, market-neutral
index hedging, long/short cross-sectional strategies) assumes a margin account is ordinarily
available; set it to `false` for a long-only-only match.

## The economic calendar

`observation.calendar` lists every `EARNINGS_REPORT` and `ECONOMIC_RELEASE` round for every
symbol/indicator, past **and future**, fixed at match start — a date carries no outcome, so seeing
it early is never a leak (see [No-Future-Information Audit](#no-future-information-audit)). Of the
six hidden economic factors, only four ever get a real scheduled public release — `GDP_GROWTH`,
`INFLATION_RATE`, `POLICY_RATE`, `COMMODITY_INDEX` — each shown as `reported` vs. the last public
`consensus` vs. the prior period's `reported` value, market-wide (not per-symbol).
`RISK_APPETITE`/`LIQUIDITY` are never directly published, only inferable from how the market
actually behaves — same as in reality, there's no scheduled "risk appetite index" release.

## Setup and winning

Starting cash defaults to $100,000 over 500 rounds (250 of them a no-trading warmup where a bot
may still observe); a transaction fee (default 0.1%) is charged on every executed fill. Highest
final net liquidation value wins; an exact tie is a draw. As few as 1 participant may play — same
as `stock-market-2`, a bot trading solo against this whole simulated market is a complete match on
its own.

## Hidden Information Audit

A bot never sees, and can never derive from anything in its own observation: the six hidden
economic factors' actual values or dynamics; the current hidden market regime or its transition
structure; any sector's or company's exact loadings on those factors; any company's style-factor
loadings or lifecycle stage; the index's constituent weighting methodology; a company's true,
still-accruing quarter's fundamentals before its own earnings report; the exact lookback windows
or per-company sensitivities behind the tradable price's momentum/reversion tendencies; the exact
weighting or bound behind an earnings surprise's price impact; any other participant's portfolio,
open orders, cash, or margin status.

This is deliberate, not an oversight — several of those numbers exist as ordinary constants in this
game's own source, same as any simulator has to encode *something* concrete to actually run. This
README stops short of restating them for the same reason a bot shouldn't read them out of that
source: they're meant to be estimated from observed behavior over the course of a real match, the
same way a real quant would, not known in advance. A bot that infers "this sector is clearly rate-
sensitive" or "this stock's momentum seems to run about a week" from its own accumulated evidence
has earned a real edge; one that starts the match already knowing the exact numbers hasn't.

## No-Future-Information Audit

Every date on `observation.calendar` — past or future — carries only "something will be reported
here," never an outcome. An acquisition/delisting's 5-round advance notice discloses the deal's
terms immediately (there's nothing left to leak), but never arrives before the announcement round
itself. Analyst consensus revisions only ever pull toward the true, still-hidden outcome — they
never reveal it early. A quarter's true fundamentals are drawn at that quarter's start but are
never read by anything a bot can see before that quarter's own earnings report fires.

## Good to know

- `config.priceHistoryLength` (default 90) and `config.eventHistoryLength` (default 30) cap how
  much trailing history/event log a bot sees per symbol per round — both split-adjusted where
  relevant, and long enough that a bot can run its own backtests against them (candidate lookback
  windows, realized volatility, beta estimation, and so on) without needing to remember anything
  across rounds itself.
- `config.minimumSecurityPrice` (default $0.01) floors every price everywhere — including a
  reverse split's post-split price — so nothing ever prices at zero or negative.
- A security that's been delisted/acquired stays in `observation.securities` with `active: false`
  and stops producing new price history; existing positions in it were already force-settled at
  the effective round.
