# Hearts

_Four alien delegations, stranded on the same scrap of contested battleground, are all this
system has left of a war nobody quite remembers the start of. There's no ceasefire, only an
uneasy standoff — punctuated, every so often, by a flood: a wave of raw damage that crashes
across the field and has to land on somebody. Nobody wants to be standing in it. Somebody always
is._

The classic 4-player trick-taking standoff, where the goal is to take as little of the flood as
possible — unless you're reckless enough to let the whole thing crash down on you on purpose.

## Objective

Hearts is scored the opposite way from most battles: **you want to have absorbed the least.**
Every surge card you take a hit from costs you a point of flood damage, and the Deluge — the
Queen of Spades, the single worst strike in the whole flood — costs you thirteen points on her
own. The standoff plays out as a series of waves, and it ends the instant any delegation's
running damage total reaches the configured limit (100 by default) — at that point, whoever has
taken the _least_ damage wins the battleground.

## Setup

Exactly 4 delegations, holding the field together. A standard 52-card deck is shuffled and dealt
out completely, 13 cards to each delegation, at the start of every wave.

## How a wave works

Each wave has two phases: the supply exchange, then the flood itself.

### The supply exchange

Before the flood hits, every delegation selects 3 cards from its hand to send to another
delegation — offloading whatever it can least afford to be caught holding when the wave lands.
The direction rotates wave to wave in a fixed 4-wave cycle:

1. Send left (to the next delegation in turn order)
2. Send right (to the previous delegation in turn order)
3. Send across (to the delegation directly opposite you)
4. Hold — no exchange this wave at all

...then the cycle repeats. Every delegation sends 3 cards and receives 3 different cards back
before anyone sees what they've been handed.

### The flood

Once every delegation holds its final hand for the wave, the flood breaks in a series of
exchanges — 13 of them per wave, one for every card each delegation holds:

1. Whoever holds the Two of Clubs fires the opening volley of the wave, and must lead with it —
   the one strike in the whole deck guaranteed to carry no flood damage.
2. Play continues clockwise around the field. Each other delegation must answer in kind (play a
   card of the same suit that was led) if it can. If it can't, it may throw anything it's
   holding — including a surge card, or the Deluge herself.
3. Once all 4 delegations have thrown, whoever threw the highest card of the suit that was led
   takes the brunt of that exchange — no suit outranks another here, so an answer thrown
   off-suit never takes the hit, no matter how high it is.
4. Whoever took the brunt leads the next exchange, and the wave continues until all 13 exchanges
   have landed.

A couple of standing orders shape the opening of every wave:

- **No damage on the first exchange.** Nobody may throw a surge card or the Deluge on the very
  first exchange of a wave, unless every card in their hand deals damage.
- **The floodgates stay shut until breached.** A delegation may not lead an exchange with a surge
  card until one has already landed elsewhere in the wave (thrown because a delegation couldn't
  answer in kind) — unless surge cards are the only cards it has left to throw.

## Scoring a wave

Every surge card that lands on you costs 1 point of flood damage; the Deluge costs 13 points on
her own. Every other card costs nothing. At the end of a wave, each delegation's damage from that
wave is added to its running campaign total.

**Swallowing the flood whole:** if a single delegation ends up taking every surge card and the
Deluge in one wave (26 points' worth), something turns. Rather than being drowned by it, that
delegation becomes the eye of the storm — its damage for the wave drops to 0, and the flood
reverses, crashing 26 points down onto every other delegation instead. It's an all-or-nothing
gambit: reach for it and fall even one card short, and you've simply taken the single worst wave
possible.

## Winning the standoff

Waves break one after another, each with a fresh deal and the exchange direction advancing to the
next step in its cycle. The instant any delegation's cumulative damage reaches the configured
limit (100 by default), the standoff ends immediately once that wave is scored. Whoever has taken
the _least_ damage holds the battleground — remember, here, the delegation still standing with the
lightest losses is the one who wins. A tie for the least damage splits the win.

## Good to know

- Because every surge card and the Deluge all deal damage, most "normal" instincts run backward
  here: delegations usually want to lose the exchange, not win it, except when they're
  specifically maneuvering to swallow the whole flood.
- The supply exchange is a real tactical decision, not a formality — it's your one chance each
  wave (except on a "hold" wave) to offload the cards you can't afford to be caught holding, and
  to gamble on what you'll be handed back.
- Watching what other delegations throw when they can't answer in kind is one of the only windows
  you ever get into a hand you otherwise can't see at all.
