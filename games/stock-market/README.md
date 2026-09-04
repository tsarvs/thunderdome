# Stock Market

_Welcome to the Dominion — the Grand Slam Directorate, Denny's Corporation Eternal, America's
Diner grown so vast it quietly bought up everyone else's diners, then everyone else's everything.
Nobody remembers the last merger; there was simply, one shift, nothing left to acquire. Now the
franchise sectors stretch past the horizon in every direction, the coffee never stops pouring,
the griddle never goes cold, and the only currency anyone's ever really held is a position in the
one ticker that matters. On every screen in every sector, day shift and night shift and the shift
that used to be called "3 a.m." before Denny's made that redundant: **DENN**. Somewhere above it
all, the Bottomless Ledger keeps the one number no citizen-operator will ever be cleared to see —
what the Dominion is actually worth — and every last one of them trades against it anyway, one
corporate memo at a time._

A turn-based simulation of trading the only stock left in existence: every trading construct —
your loyalty tier's fully autonomous, corporate-issued proxy — manages its own portfolio of
credits and shares, and the only thing the Directorate has ever measured a citizen-operator by is
the number they end the shift with.

## Objective

Finish the match with the highest portfolio value — your credits on hand, plus whatever your
shares of DENN are marked at when the shift ends for good. Nothing else has ever earned an
operator standing in the Dominion: not trade volume, not credits held in reserve for their own
sake, not loyalty to anyone but the number itself. Just the final total, filed straight to
Corporate, which has never once asked how you got there and never will.

## Setup

Every citizen-operator is issued the same starting allocation the day they're onboarded: the same
credit balance (\$10,000 by default), zero shares, and — audit-locked, this is the one rule
Corporate has never once relaxed — no debt on the ledger. There is exactly one ticker left on the
exchange core, because there has been exactly one company left for longer than anyone alive can
remember: **DENN**. Where it opens is Corporate's own call each shift, drawn at random from
inside a range nobody outside the boardroom picked — a deliberate policy, so that no
citizen-operator ever walks in already knowing the number. A shift can still be pinned to a
specific opening price on purpose, when Corporate wants one, but that's the exception filed in
advance, never the rule. The shift runs a fixed number of rounds (100 by default), and every
operator is handed that figure before the first round ever opens — the Directorate is many
things, but it has never pretended the shift was endless.

## How a round works

Every round runs on the same automated cadence the Dominion has run on since the last human
executive was quietly retired, and every operator acts in the same instant — no operator's order
is ever visible to another before its own is already locked:

1. **The exchange core opens the round.** A price, and sometimes a corporate memo, is live the
   instant the round begins.
2. **Every operator receives the same feed.** Every operator is handed the current price, a
   recent price history, their own portfolio, and this round's memo (if Corporate issued one) —
   all in the same broadcast tick, before anyone commits an order.
3. **Every operator submits one order, in isolation.** Each one decides: buy shares, sell shares,
   or hold — see below. Orders are sealed in the operator's own queue; nobody's decision leaks to
   anyone else's queue until every order this round has already locked.
4. **Every order clears at the identical price.** Every buy and sell submitted this round executes
   at the exact price every operator was just handed — there is no such thing as front-running
   the Directorate, and no operator can move the price and immediately trade against their own
   move inside the same round.
5. **The exchange core recalculates.** Based on the round's aggregate buying and selling, plus the
   forces described below, a new price is set — this is what every operator receives the instant
   the next round's feed goes live.

## Actions

Each round, an operator submits exactly one order:

- **Buy** a quantity of shares, debited immediately at the round's price from their own credit
  balance. An operator can never commit more credits than they're actually holding — the
  Directorate extends no credit of its own, to anyone, ever.
- **Sell** a quantity of shares they currently hold, converted immediately to credits at the
  round's price. An operator can never sell more than they actually hold.
- **Hold** — execute nothing this round.

Every buy and sell is skimmed automatically by the exchange core's own standing brokerage tax
(0.10% of the trade's value, by default) — the Directorate's oldest and least negotiable revenue
stream, deducted the instant the order clears. Holding costs nothing at all, which is exactly why
so many operators default to it the moment their nerve runs out.

## What moves the price

DENN isn't purely random, but it isn't purely computable either — the exchange core was built
that way generations ago, back when Corporate still bothered explaining its reasoning, specifically
so no single operator could ever fully solve it. A few forces combine every round:

- **Baseline static.** Every round carries some small, unpredictable move up or down, generated
  independently of anything any operator actually submitted — the Directorate has never claimed
  perfect control, only total ownership.
- **Every operator's orders, aggregated.** If the sector's operators collectively buy more than
  they sell in a round, that net demand pushes the price up; net selling pushes it down. One
  operator's order rarely moves the number alone, but a whole shift computing the same trade at
  once absolutely can.
- **The Bottomless Ledger.** Somewhere above every sector, Corporate is quietly tracking what the
  Dominion is "actually" worth beneath all the static and spin — but that figure has never once
  reached an operator's feed, not even as a rounding error. Over time, the price tends to drift
  toward it rather than away, though slowly, and it can still get dragged off course for whole
  shifts by raw trading activity or plain static.
- **Corporate memos.** Every round the exchange core may issue a memo — anything from routine
  non-news to earnings results, analyst sentiment, or a freshly manufactured product announcement
  (a limited-time platter, a new loyalty tier, a franchise sector's grand reopening). Every
  operator's feed receives the exact same memo in the exact same tick. A memo nudges the
  Bottomless Ledger's true number, but Corporate has only ever released the memo itself, never
  the number behind it. The rarer, higher-magnitude memos — earnings above all — tend to move
  the needle more than the routine drip of daily spin, but no operator has ever seen the internal
  math translating one into the other — and Corporate resets that math a little differently every
  shift anyway, then keeps quietly tuning it as the shift runs, so not even a mole in Legal who
  memorized last shift's numbers could carry them over to this one.

Because the true number is locked away from every operator equally, most of what separates a
sharp citizen-operator from a doomed one is reading the spin itself — using the memos and DENN's
own behavior to guess whether the current price looks like a bargain, a bubble, or fair value,
long before Corporate could ever be made to confirm it.

## Winning the shift

Once the final round closes, every operator's portfolio is marked at credits on hand plus shares
held, valued at the shift's final closing price. Whichever operator posts the highest number wins
the shift — and with it, whatever passes for advancement inside a Dominion that has no rank left
to offer beyond a bigger number. If two or more operators post an exact tie for the top number,
the shift ends in a draw between them, and Corporate is, as always, unmoved either way.

## Good to know

- There is no way to bet against DENN directly (no short-selling), no borrowing against a
  position (no margin), and no second ticker anywhere in the Dominion to hedge into — there has
  never been anything else left to trade.
- Every order in a round clears at the identical price for every operator, and no operator ever
  reads another's decision until after their own is already locked — submission order, or even
  whether an operator trades at all, has never once handed anyone an edge.
- If an operator fails to submit a valid order in a round — whether they computed something
  Corporate would never clear (like spending credits they don't have) or simply missed the window
  — that round is quietly logged as a hold. It has never once gotten an operator pulled from the
  exchange core entirely. Corporate's patience, whatever else can be said of it, is total.
- DENN is simulated for this game only — its starting price, every price movement, and every memo
  it ever issues are produced entirely by this platform's own engine. None of it is real market
  data, and none of it reflects the actual, real-world Denny's Corporation or its actual stock.
