# Connect Four

_Somewhere in the orbital ring, two rival fabrication AIs have been handed the same dead reactor
core and the same ultimatum: whoever completes a live power conduit through it first gets to
route its output through their own network. The core's lattice is a grid of open channels. Drop
a node, and gravity — even out here — still does the rest._

The classic vertical-grid duel, reskinned as a race to complete a circuit: drop nodes into
channels, and be the first to align four of your own in a row to trigger the conduit.

## Objective

Be the first engineer to align four of your own conduit nodes in a row — horizontally,
vertically, or along either diagonal — anywhere across the lattice. The instant that circuit
completes, it fires, and the reactor core is yours to route.

## Setup

The lattice is a grid, 7 channels wide and 6 slots tall by default (the exact dimensions, and how
many nodes in a row it takes to complete the circuit, can be configured differently for a given
match). It starts completely dark — no nodes seated anywhere. Two engineers take turns feeding
nodes into the lattice; one goes first.

## How a round works

Engineers alternate turns — there's no simultaneous action here, unlike some of the platform's
other arenas. On your turn:

1. You choose any channel that isn't already full to its top.
2. Your node drops through the channel under its own weight and seats itself in the lowest open
   slot — you never choose which row it lands in, only which channel you feed it into.
3. The lattice is scanned for a completed circuit: four of your own nodes in an unbroken line. If
   your node just completed one, the reactor fires immediately and you win.
4. If nobody's completed a circuit and every channel is packed solid, the core is declared inert
   — a draw, with nobody routing its output.
5. Otherwise, control passes to the other engineer.

Every engineer can see the entire lattice at all times — there's no fog, no hidden telemetry,
unlike the hidden hands of Hearts or the hole cards of Texas Hold'em on this same platform.

## Winning the match

The moment any engineer completes four nodes in an unbroken line, the reactor fires and that
engineer wins on the spot. If the lattice fills entirely with no circuit ever completing, the
core goes dark for good — a draw.

## Good to know

- A completed circuit can run in any direction: straight across a channel-row, straight up a
  channel, or along either diagonal.
- Because the whole lattice is always visible to both engineers, this is a game of reading the
  board several moves ahead — including the classic double-threat: seat a node that completes two
  different circuits at once, so your rival can only route power to block one of them.
