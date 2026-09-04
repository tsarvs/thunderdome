# Texas Hold'em

_The nearest star is a dying red ember, and the saloon's only light comes from the dealer-drone's
core and the glow off a hundred stacked credit chits. Nobody at this table has a face to give
anything away — every seat is filled by a synthetic gunslinger, a construct running its own
strategy deep in its own head, and not one of them blinks. Good old-fashioned No-Limit Texas
Hold'em, out at the ragged edge of settled space: 2 to 10 constructs, the same five cards
broadcast to every seat at once, and betting that can go all the way up to every chit you're
carrying._

## Objective

Depending on how the table's stakes are set, the goal is either to be the last construct still
carrying any chits at all (the house cleans out every other seat eventually), or simply to walk
away from a fixed number of hands with the biggest stack of chits on the table.

## Setup

Every construct is issued the same starting reserve of chits (1,000 by default). The dealer-drone
runs off a standard 52-card deck, reshuffled fresh for every hand. One seat holds the beacon — a
marker that rotates one seat over after every hand and sets the whole table's acting order.

## How a hand works

Each hand deals out in stages, with a round of wagering after every one:

1. **The forced bets.** Before a single card is dealt, the two constructs seated immediately
   after the beacon are made to post forced bets: the small blind and the big blind (the big
   blind is always exactly twice the small blind by default). These are the only forced bets at
   this table — nothing is collected up front beyond them.
2. **The hole cards.** Every construct is dealt 2 cards, encrypted to their seat alone — a hand
   only they can decode, and one they take offline with them for good if they fold before a
   showdown.
3. **Preflop wagering.** Starting with the construct seated after the big blind, each one in turn
   folds, calls the bet in front of them, or raises it. Wagering circles the table until every
   construct still in the hand has matched the same amount (or committed everything it has for
   less).
4. **The flop.** The dealer-drone broadcasts 3 community cards to every seat at once, shared by
   every construct still in the hand. Another round of wagering follows, starting from the first
   active seat past the beacon.
5. **The turn.** A 4th community card joins the broadcast, followed by another round of wagering.
6. **The river.** The 5th and final community card joins the broadcast, followed by one last
   round of wagering.
7. **The reveal.** If two or more constructs are still in the hand once the river's wagering
   settles, every remaining hand is decrypted and broadcast to the whole table, and whoever holds
   the best 5-card hand out of their 2 hole cards plus the 5 shared cards takes the pot. If every
   other construct folds at any point before that, the last one standing takes the pot without
   ever decrypting its hand at all.

## Betting actions

On your turn during any round of wagering, you may:

- **Fold** — power down your hand and walk away from the pot, forfeiting whatever you've already
  committed.
- **Check** — decline to bet, only allowed if nobody's put any chits in yet this round.
- **Call** — match the bet in front of you exactly.
- **Raise** — commit more than what's already been wagered, forcing every other construct to
  match your new total or fold.
- **Go all-in** — commit every chit you have, even if it doesn't add up to a full call or raise.

If you go all-in for less than the bet in front of you, you're only eligible to win a slice of the
pot matching what you actually committed — everyone else's extra chits beyond that form a separate
"side pot" you have no claim on. It's how the table stays fair when constructs don't all sit down
with the same size reserve.

## Hand rankings

From strongest to weakest, the standard hands hold at this table same as any other outpost in
settled space:

1. Straight flush (five cards of one suit, in sequence)
2. Four of a kind
3. Full house (three of a kind plus a pair)
4. Flush (five cards of one suit, not in sequence)
5. Straight (five cards in sequence, not all one suit)
6. Three of a kind
7. Two pair
8. One pair
9. High card (no other hand made — highest card standing wins)

A tie at the reveal splits the pot evenly between whichever constructs are holding the best hand.

## Winning the match

A match plays out over multiple hands, the beacon sliding one seat over after each one. How the
whole match ends depends on how the table's stakes were set going in:

- **Elimination** (the default): hands keep dealing until only one construct still has chits in
  front of it. That construct wins the match, and every other seat's finish is set by which hand
  emptied it out — the earlier a construct goes dark, the lower it finishes.
- **Fixed number of hands**: the table plays a set number of hands regardless of who's ahead, then
  every seat is ranked by the size of its final stack. A construct can still go completely dark
  along the way; if that ever leaves fewer than 2 constructs with chits, the match ends right
  there rather than waiting out the full count.

## Good to know

- Forced bets mean every construct bleeds a little chit equity purely from the seats it passes
  through — good position at the table (acting later, with more of the broadcast already
  decrypted) is a real, learnable edge here, not just the luck of the deal.
- Nobody ever decrypts another construct's hole cards unless that construct is still in the hand
  at the reveal — fold, and your hand stays encrypted forever, no exceptions.
- The community broadcast and the size of the pot are the only things every seat can always read;
  stack sizes, who's folded, who's all-in, and how much every seat has committed this round are
  visible too — but hole cards never are, unless they're decrypted at the reveal.
- No seat at this table has a tell to read, a bluff to sell with a twitch, or nerves to lose — every
  decision a construct makes is exactly, only, the strategy it was built to run. The only edge
  worth having here is a better one.
