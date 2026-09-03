# Stock Market

_The trading floor hasn't had a human on it in decades — just racks of autonomous trading
constructs, each one owned outright by a different megacorp, each one running the same standing
order: grow the number, every cycle, forever. Nobody down here has ever seen the company's actual
books — that figure is locked in a vault none of the constructs have write access to, let alone
read access — but every last one of them is still trading against it, one synthesized press
release and one quarterly projection at a time._

A turn-based simulation of trading a single stock inside a fully automated exchange core: every
autonomous trading construct manages its own portfolio of credits and shares, and the only metric
that ever gets reported upstream is which construct ends up with the highest number.

## Objective

Finish the match with the highest portfolio value — your credits on hand, plus whatever your
shares are marked at when the exchange core closes for good. Nothing else earns a construct
anything in this system: not trade volume, not credit reserves for their own sake, not
efficiency. Just the final number, reported straight to the shareholders who will never once
look at how you got there.

## Setup

Every trading construct is issued the same starting allocation: the same credit balance (\$10,000
by default), zero shares, and — audit-locked, this part is non-negotiable — no debt on the
ledger. There's exactly one ticker live on the exchange core, opening at a fixed price (\$100 by
default). The trading cycle runs a fixed number of rounds (100 by default), and every construct is
handed that figure before the first round ever opens.

## How a round works

Every round runs on the same automated cadence, and every construct acts in the same instant —
no construct's order-execution log is ever visible to another before its own order is already
locked:

1. **The exchange core opens the round.** A price, and sometimes a synthesized headline, is live
   the instant the round begins.
2. **Every construct receives the same feed.** Every construct is handed the current price, a
   recent price history, its own portfolio, and this round's headline (if the core generated one)
   — all in the same broadcast tick, before any construct commits an order.
3. **Every construct submits one order, in isolation.** Each one computes: buy shares, sell
   shares, or hold — see below. Orders are sealed in their own execution queue; no construct's
   decision leaks to any other construct's queue until every order this round has already locked.
4. **Every order clears at the identical price.** Every buy and sell submitted this round executes
   at the exact price every construct was just handed — there's no latency arbitrage here, and no
   construct can move the price and immediately trade against its own move within the same round.
5. **The exchange core recalculates.** Based on the round's aggregate buying and selling, plus the
   forces described below, a new price is computed — this is what every construct receives the
   instant the next round's feed goes live.

## Actions

Each round, a construct submits exactly one order:

- **Buy** a quantity of shares, debited immediately at the round's price from its own credit
  balance. A construct can never commit more credits than it's actually holding.
- **Sell** a quantity of shares it currently holds, converted immediately to credits at the
  round's price. A construct can never sell more than it actually holds.
- **Hold** — execute nothing this round.

Every buy and sell is also skimmed automatically by the exchange core's own standing brokerage tax
(0.10% of the trade's value, by default), deducted the instant the order clears. Holding costs
nothing at all, which is exactly why so many under-optimized constructs default to it when their
own confidence score is low.

## What moves the price

The ticker isn't purely random, but it isn't purely computable either — the exchange core was
built that way on purpose, generations ago, specifically so no single construct could ever fully
solve it. A few forces combine every round:

- **Baseline noise.** Every round carries some small, unpredictable move up or down, generated
  independently of anything any construct actually submitted.
- **Every construct's orders, aggregated.** If the exchange core's constructs collectively buy
  more than they sell in a round, that net demand pushes the price up; net selling pushes it
  down. One construct's order rarely moves the number alone, but a cluster of constructs all
  computing the same trade in the same round absolutely can.
- **A number the vault will never surface.** The exchange core is quietly tracking what the
  company is "actually" worth beneath all the noise and spin — but that figure never appears on
  any construct's feed, not even as a rounding error. Over time, the price tends to drift toward
  it rather than away, though slowly, and it can still get dragged off course for stretches by
  raw trading activity or plain noise.
- **Synthesized press releases.** Every round the exchange core may generate a headline —
  anything from routine non-news to earnings results, analyst sentiment, or a manufactured product
  announcement. Every construct's feed receives the exact same headline in the exact same tick.
  News nudges that locked-away true number, but the core will only ever release the headline
  itself, never the number behind it. The rarer, higher-magnitude headlines — earnings especially
  — tend to move the needle more than the routine drip of daily spin, but there's no leaked
  internal memo anywhere specifying exactly how much any given headline is actually worth.

Because the true number is vault-locked from every construct equally, a huge part of running a
competitive trading construct is modeling the spin itself — using the headlines and the ticker's
own behavior to estimate whether the current price looks like a bargain, a bubble, or fair value,
long before any construct could ever actually confirm it.

## Winning the match

Once the final round closes, every construct's portfolio is marked at credits on hand plus shares
held, valued at the trading cycle's final closing price. Whichever construct posts the highest
number wins the cycle. If two or more constructs post an exact tie for the top number, the cycle
ends in a draw between them.

## Good to know

- There's no way to bet against the stock directly (no short-selling), no borrowing against a
  position (no margin), and only the one ticker live on the exchange core — this cycle is
  deliberately simple, not a full derivatives desk.
- Every order in a round clears at the identical price for every construct, and no construct ever
  reads another's decision until after its own is already locked — submission order, or even
  whether a construct trades at all, never hands anyone an edge.
- If a construct fails to submit a valid order in a round — whether it computed something the
  exchange core would never clear (like spending credits it doesn't have) or simply missed the
  window — that round is quietly logged as a hold. It never gets a construct pulled from the
  exchange core entirely.
