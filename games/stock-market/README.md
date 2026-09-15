# Stock Market

_Nobody agrees anymore on what the sky looked like the night the Griddle went dark, only that it
did, and that when the ash finally settled there was nothing left standing taller than a chimney.
Whatever else the old world took with it, it left behind one word, passed clanhold to clanhold
across the Ashfields like a coal cupped in bare hands so it wouldn't go out before the next
gathering: **DENN**. Every hearthkeeper old enough to remember their grandmother's grandmother
swears the same story — that somewhere out past the ash, untouched by whatever burned everything
else to the ground, one griddle never went cold, and it is still, to this hour, turning out Grand
Slams for whoever can prove they're owed one. Nobody's ever found it. Nobody's really meant to.
What every clanhold trades instead, gathering after gathering, is a claim on it — a scorched,
dog-eared scrap of a stake in whatever that griddle serves up next — and its worth rises and falls
on nothing sturdier than what the Ashfields are collectively willing to believe about it this
season._

A turn-based simulation of trading the only claim left worth trading: every hearthkeeper — a
clanhold's own fully autonomous trading instinct, since no clanhold survives long letting any one
person decide alone — manages its own stock of credits and Griddle-claims, and the only thing the
Ashfields have ever measured a clanhold by is what they're left holding when the gathering's fire
finally burns down to nothing.

## Objective

Finish the gathering with the highest total worth you can show — your credits on hand, plus
whatever your Griddle-claims are fetching when the last fire of the gathering goes out. Nothing
else has ever bought a clanhold standing in the Ashfields: not how many trades you made, not
credits hoarded for their own sake, not loyalty to any other clanhold's cause. Just the final
tally, and the Ashfields have never once cared how you arrived at it.

## Setup

Every hearthkeeper starts the gathering holding exactly what every other one does: the same
starting stock of credits (\$10,000 by default), zero claims, and — the oldest law the Ashfields
still enforce without exception — no debt of any kind. There is nothing left to trade a debt
against anyway, and no clanhold left standing that would make good on one. There is exactly one
claim worth anything at this gathering, because there has been exactly one thing worth claiming for
longer than anyone alive can remember: **DENN**. Where its worth opens is nobody's call in
particular — drawn fresh each gathering from a range no elder and no clanhold gets to fix in
advance, so nobody ever walks in already knowing the number. A gathering can still be declared
against a specific opening worth on purpose, when that's the whole point of holding it, but that's
the stated exception, never the rule. The gathering runs a fixed number of rounds (100 by default),
and every hearthkeeper is told that count before the first claim ever changes hands — the Ashfields
are many things, but they have never once pretended a gathering would run forever.

## How a round works

Every round runs the same way every gathering has run one since before anyone currently trading was
born, and every hearthkeeper acts in the same instant — no hearthkeeper's order is ever visible to
another's before every order this round has already been sealed:

1. **The Trading Fire is lit.** A worth for DENN, and sometimes a smoke-sign, is live the instant
   the round begins.
2. **Every hearthkeeper reads the same fire.** Every hearthkeeper is handed the current worth, a
   recent history of it, their own holdings, and this round's smoke-sign (if one rises) — all in
   the same breath, before anyone commits to a trade.
3. **Every hearthkeeper trades in isolation.** Each one decides: buy claims, sell claims, or hold —
   see below. Every decision is sealed the moment it's made; nobody's choice reaches anyone else's
   ears until every hearthkeeper's this round is already locked in.
4. **Every trade clears at the identical worth.** Every buy and sell submitted this round settles at
   the exact worth every hearthkeeper was just handed — there is no such thing as moving the fire
   and then trading against your own smoke, and no hearthkeeper can shift the worth and immediately
   trade on it inside the same round.
5. **The Trading Fire is stoked again.** Based on the round's aggregate buying and selling, plus the
   forces described below, a new worth is set — this is exactly what every hearthkeeper reads the
   instant the next round's fire catches.

## Actions

Each round, a hearthkeeper commits to exactly one trade:

- **Buy** a quantity of claims, paid for immediately at the round's worth out of their own credits.
  A hearthkeeper can never commit more credits than their clanhold is actually holding — nobody in
  the Ashfields extends credit to anybody, ever.
- **Sell** a quantity of claims they currently hold, converted immediately to credits at the round's
  worth. A hearthkeeper can never sell more claims than they actually hold.
- **Hold** — trade nothing this round.

Every buy and sell is skimmed by the Fire-tender's own standing toll (0.10% of the trade's value,
by default) — the one due nobody in the Ashfields has ever successfully argued their way out of,
taken the instant the trade clears. Holding costs nothing at all, which is exactly why so many
hearthkeepers default to it the moment their nerve runs out.

## What moves the worth

DENN isn't purely a roll of the bones, but it isn't purely something you can work out on paper
either — whoever first ran the Trading Fire built it that way generations ago, specifically so no
one hearthkeeper could ever fully solve it. A few forces combine every round:

- **The wind.** Every round carries some small, unpredictable shift up or down, stirred up
  independently of anything any hearthkeeper actually traded — the Ashfields have never claimed
  perfect calm, only that the fire keeps burning regardless.
- **Every hearthkeeper's trades, aggregated.** If the gathering's hearthkeepers collectively buy
  more than they sell in a round, that net hunger for claims pushes the worth up; net selling pushes
  it down. One hearthkeeper's trade rarely moves the number alone, but a whole gathering reaching
  for the same claim at once absolutely can.
- **The Deep Ledger.** Somewhere underneath all the ash, the story goes, whoever tended the Last
  Griddle before everything burned kept a true reckoning of what a claim on it is actually worth —
  but that number has never once reached a hearthkeeper's ears, not even secondhand. Over time, the
  worth tends to drift toward it rather than away, though slowly, and it can still get dragged clean
  off course for whole gatherings by raw trading or plain wind.
- **Smoke-signs.** Every round the Trading Fire may throw up a smoke-sign — anything from routine
  nothing to a rumor of a good harvest, a bad omen, or word that the Last Griddle itself was sighted
  again somewhere out past the ash. Every hearthkeeper reads the exact same sign in the exact same
  breath. A sign nudges the Deep Ledger's true number, but the fire has only ever shown the sign
  itself, never the number behind it. The rarer, bigger signs — a sighting of the Griddle chief
  among them — tend to move the worth more than the routine drip of daily rumor, but no
  hearthkeeper has ever seen the reckoning that turns one into the other, and it's never quite the
  same reckoning twice anyway, so not even an elder who memorized last gathering's signs could carry
  them over to this one.

Because the true number is buried equally deep from every hearthkeeper, most of what separates a
sharp clanhold from a doomed one is reading the smoke itself — using the signs and DENN's own
behavior to guess whether the current worth looks like a bargain, a bubble, or fair trade, long
before anyone could ever confirm it outright.

## Winning the gathering

Once the last round's fire dies down, every hearthkeeper's holdings are tallied as credits on hand
plus claims held, valued at the gathering's final worth. Whichever hearthkeeper posts the highest
tally wins the gathering — and with it, whatever standing the Ashfields still have left to offer
beyond a bigger number to their name. If two or more hearthkeepers post an exact tie for the top
tally, the gathering ends in a draw between them, and the Ashfields, as ever, are unmoved either
way.

## Good to know

- There is no way to bet against DENN (no short-selling), no borrowing against a claim (no margin),
  and no second claim anywhere in the Ashfields to hedge into — there has never been anything else
  left worth trading.
- Every trade in a round clears at the identical worth for every hearthkeeper, and no hearthkeeper
  ever hears another's decision until after their own is already sealed — trading order, or even
  whether a hearthkeeper trades at all, has never once handed anyone an edge.
- If a hearthkeeper fails to commit a valid trade in a round — whether they reached for something
  the Ashfields would never allow (like spending credits they don't have) or simply missed the
  window — that round is quietly logged as a hold. It has never once gotten a clanhold turned away
  from the fire entirely. The Ashfields' patience, whatever else can be said of them, is total.
- DENN is simulated for this game only — its starting worth, every shift in it, and every smoke-sign
  it ever throws are produced entirely by this platform's own engine. None of it is real market
  data, and none of it reflects the actual, real-world Denny's Corporation or its actual stock.
