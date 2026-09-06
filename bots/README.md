# Bots

Competitor-owned code, grouped by game: `bots/<game-id>/<bot-id>/`. Each bot directory is a fully
self-contained unit — any language, its own `Dockerfile`, never imported by the platform, never a
Yarn workspace member (see `docs/adr/0001-monorepo-and-boundary.md`). A submission touches
exactly one `bots/<game-id>/<bot-id>/` directory — mechanically enforced by
`ci/tools/boundary-check`, which also checks that a bot's manifest's `game` field agrees with the
game it's grouped under.

New to Node, Docker, or dev environments in general? Read
[`docs/guides/getting-started.md`](../docs/guides/getting-started.md) first — it explains what
those things actually are before the guides below assume you already know.

To write your own bot, run `yarn scaffold:bot <game-id> <your-bot-id>` for a working starting
point (see the doc comment at the top of
[`scripts/scaffold-bot.mjs`](../scripts/scaffold-bot.mjs) for every flag), then follow
[`docs/guides/bot-author-guide.md`](../docs/guides/bot-author-guide.md) for the full contract,
manifest, Dockerfile, and testing steps — game-agnostic throughout, with a dedicated section for
each game's own specifics (Rock-Paper-Scissors, Hearts, Texas Hold'em).

Two different kinds of bot live under `bots/`, and the distinction matters: **reference bots**
exist to teach the wire protocol and SDK — deliberately simple, sometimes deliberately bad, so
their own code stays easy to read as a starting point. **Competitors** are real, submitted
strategies actually trying to win — read them for strategy ideas, not API plumbing.

## Reference bots

| Bot                                                                             | Game                | Language   | Strategy                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`rock-paper-scissors/random-rps`](rock-paper-scissors/random-rps/)             | Rock Paper Scissors | JavaScript | Uniformly random choice each round, using a PRNG seeded from the match's `rngSeed` — never `Math.random()`.  |
| [`rock-paper-scissors/copycat-rps`](rock-paper-scissors/copycat-rps/)           | Rock Paper Scissors | JavaScript | Plays whatever the opponent played last round; `rock` on round 1.                                            |
| [`rock-paper-scissors/only-rock`](rock-paper-scissors/only-rock/)               | Rock Paper Scissors | TypeScript | Always plays `rock`, no matter what.                                                                         |
| [`rock-paper-scissors/only-paper`](rock-paper-scissors/only-paper/)             | Rock Paper Scissors | TypeScript | Always plays `paper`, no matter what.                                                                        |
| [`rock-paper-scissors/only-scissors`](rock-paper-scissors/only-scissors/)       | Rock Paper Scissors | TypeScript | Always plays `scissors`, no matter what.                                                                     |
| [`connect-four/leftmost-connect-four`](connect-four/leftmost-connect-four/)     | Connect Four        | JavaScript | Always drops into the lowest-indexed column that still has room, ignoring the board entirely.                |
| [`connect-four/random-connect-four`](connect-four/random-connect-four/)        | Connect Four        | JavaScript | Picks a uniformly random legal column each turn, PRNG seeded from the match's `rngSeed`.                     |
| [`connect-four/tactical-connect-four`](connect-four/tactical-connect-four/)    | Connect Four        | Python     | Plays an immediate winning move when one exists, otherwise blocks the opponent's immediate winning move, otherwise prefers the column closest to center. Uses `thunderdome_bot_sdk`, the Python analog of `@thunderdome/bot-sdk-js`. |
| [`card-game-hearts/random-hearts`](card-game-hearts/random-hearts/)            | Hearts              | JavaScript | Uniformly random pass/play every turn, seeded from the match's `rngSeed`.                                    |
| [`card-game-hearts/lowest-card-hearts`](card-game-hearts/lowest-card-hearts/)  | Hearts              | JavaScript | Always plays/passes by raw rank, ignoring the trick, hearts, or scores entirely.                             |
| [`card-game-hearts/point-dodger-hearts`](card-game-hearts/point-dodger-hearts/) | Hearts              | JavaScript | Sheds dangerous cards when passing, leads safe non-point cards, ducks under the trick's current winner when it can, and dumps its most dangerous card when void in the led suit. |
| [`poker-texas-hold-em/random-poker`](poker-texas-hold-em/random-poker/)        | Texas Hold Em       | JavaScript | Uniformly random choice among whatever's currently legal (fold/check/call/raise/allIn), with a uniformly random raise amount, PRNG seeded from the match's `rngSeed`. |
| [`poker-texas-hold-em/calling-station-poker`](poker-texas-hold-em/calling-station-poker/) | Texas Hold Em | JavaScript | Never folds or raises: checks when possible, otherwise calls (capped at its own stack). No randomness at all. |
| [`poker-texas-hold-em/tight-poker`](poker-texas-hold-em/tight-poker/)          | Texas Hold Em       | TypeScript | Bets/raises only with a good hand (a standard tight preflop range, or a made pair-or-better postflop) and never bluffs; calls a bet only when it's no more than the big blind. |
| [`stock-market/random-stock-market`](stock-market/random-stock-market/)        | Stock Market        | JavaScript | Uniformly random choice among BUY/SELL/HOLD (only offering BUY/SELL when affordable/owned) with a uniformly random quantity, PRNG seeded from the match's `rngSeed`. |
| [`stock-market/buy-and-hold-stock-market`](stock-market/buy-and-hold-stock-market/) | Stock Market | JavaScript | Spends 90% of its starting cash on shares in round 0, then holds for the rest of the match. No randomness at all. |
| [`stock-market/momentum-stock-market`](stock-market/momentum-stock-market/)    | Stock Market        | JavaScript | Buys after a price rise, sells after a price fall, holds when unchanged — a fixed quantity each time, capped by affordability/ownership. |
| [`stock-market/mean-reversion-stock-market`](stock-market/mean-reversion-stock-market/) | Stock Market | JavaScript | Buys once price has drifted well below its own recent average, sells once it's drifted well above it, holds in between. |
| [`stock-market/news-reaction-stock-market`](stock-market/news-reaction-stock-market/) | Stock Market | Python | Reacts only to the round's public news — buys on clearly positive headlines, sells on clearly negative ones, holds on `NO_NEWS`. Never looks at price history at all. |
| [`stock-market/target-allocation-stock-market`](stock-market/target-allocation-stock-market/) | Stock Market | TypeScript | Rebalances toward keeping roughly half its portfolio value in shares, buying/selling to correct drift beyond a small tolerance band. |
| [`stock-market-2/buy-and-hold-stock-market-2`](stock-market-2/buy-and-hold-stock-market-2/) | Stock Market 2 | JavaScript | Ported from `stock-market/buy-and-hold-stock-market`: spends 90% of its starting cash on shares (sized off the visible ask) in round 0, then holds for the rest of the match, in either SYNTHETIC or HISTORICAL mode. |
| [`stock-market-2/cash-stock-market-2`](stock-market-2/cash-stock-market-2/) | Stock Market 2 | JavaScript | Never trades, ever — exists to prove the market moves on its own (regime drift, events, synthetic external flow) independent of any bot's own trading. |
| [`stock-market-2/random-stock-market-2`](stock-market-2/random-stock-market-2/) | Stock Market 2 | JavaScript | Uniformly random choice among MARKET/LIMIT/HOLD (only offering a side when affordable/held, or shortable when the game has margin enabled), random quantity/price/time-in-force, PRNG seeded from the match's `rngSeed`. |
| [`stock-market-2/momentum-stock-market-2`](stock-market-2/momentum-stock-market-2/) | Stock Market 2 | JavaScript | Buys at market after the last realized close rose, sells after it fell, holds when unchanged — a fixed quantity each time, capped by affordability/ownership. |
| [`stock-market-2/mean-reversion-stock-market-2`](stock-market-2/mean-reversion-stock-market-2/) | Stock Market 2 | JavaScript | Buys at market once the last realized close has drifted well below its own recent average, sells once it's drifted well above it, holds in between. |
| [`stock-market-2/short-momentum-stock-market-2`](stock-market-2/short-momentum-stock-market-2/) | Stock Market 2 | JavaScript | Opens/adds to a short after two consecutive down realized closes, covers on the first uptick; never goes long, and never trades at all unless the game has `config.risk.allowShortSelling` on. |
| [`stock-market-2/market-maker-stock-market-2`](stock-market-2/market-maker-stock-market-2/) | Stock Market 2 | JavaScript | Every round, quotes a fresh DAY limit buy and sell around the visible mid-price, sized within what's affordable/held (or shortable, with margin enabled). |

## Competitors

Real strategies, entered to actually win — not written to demonstrate anything about the protocol.

| Bot                                                                           | Game                | Language   | Strategy                                                                                                      |
|-------------------------------------------------------------------------------| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`rock-paper-scissors/tominator-t800`](rock-paper-scissors/tominator-t800/)   | Rock Paper Scissors | TypeScript | Three fixed phases: early-game deck exploration, mid-game exploitation of what it learned, late-game coast-or-reevaluate. |
| [`rock-paper-scissors/tominator-t1000`](rock-paper-scissors/tominator-t1000/) | Rock Paper Scissors | TypeScript | A red-herring/research/exploit/reevaluate/defense state machine that adapts through the match instead of tominator-t800's fixed phases. |
| [`rock-paper-scissors/tominator-tx`](rock-paper-scissors/tominator-tx/)       | Rock Paper Scissors | TypeScript | Defaults to a self-correcting balancing deck; exploits an opponent pattern only past a strict z-score bar, retreating on any real recent lead. |
| [`card-game-hearts/tominator-t1`](card-game-hearts/tominator-t1/)             | Hearts              | TypeScript | Plays the highest card in hand that still loses to the trick's current highest card.                          |
| [`card-game-hearts/tominator-t101`](card-game-hearts/tominator-t101/)          | Hearts              | TypeScript | Tracks played cards and which suits opponents have shown out of to inform play; defaults to defensive point-avoidance but switches to an aggressive shoot-the-moon attempt once a hand-strength signal crosses a threshold while leading. |
| [`stock-market/tominator-t70`](stock-market/tominator-t70/)                   | Stock Market        | TypeScript | Reacts to each signed event like `news-reaction-stock-market` — trusting the same free directional read and holding a position until the next contradicting event, never unwinding early just because price has started converging — but sizes the trade off an inferred, weight-informed magnitude estimate and portfolio value instead of a flat share count, capping any single trade's own market-impact contribution to avoid runaway feedback. Measured to beat `news-reaction-stock-market` head-to-head in the large majority of matches. |
| [`stock-market-2/tominator-t71-stock-market-2`](stock-market-2/tominator-t71-stock-market-2/) | Stock Market 2 | TypeScript | Reacts to signed events (real in HISTORICAL mode, synthetic in the other) with a learned magnitude estimate, confirmed/dampened by short-term trend; fades deviations from a longer trailing average on the many rounds with no event (never on margin — that heuristic bet is always sized cash-only). Goes short on a negative event when the game has margin enabled, discounting the edge by an estimated borrow-cost carry. Never averages down into a losing position, runs a self-imposed buying-power safety margin well short of the exchange's own limit, and backs both with a portfolio-level stop-loss and a proactive margin-call de-risk — real historical data can decline for a genuinely sustained stretch, unlike SYNTHETIC mode's bounded, structurally mean-reverting price process. |
| [`stock-market-2/tominator-t72-stock-market-2`](stock-market-2/tominator-t72-stock-market-2/) | Stock Market 2 | TypeScript | An evolution of tominator-t71-stock-market-2, tuned against many real matches against this exact roster: HISTORICAL mode now trades only on genuine events (empirically, fading trailing-average deviations in real single-stock data lost more often than it won, even cost-gated and cash-only), while SYNTHETIC mode's mean-reversion fade — safe there, since that price process is structurally bounded — is now margin-eligible at a conservative cap. Also adds realized-volatility-scaled sizing and an order-flow confirmation signal from the previous round's net demand, neither read by any other bot in this roster. Measured across many real match runs against the full current roster: the strongest performer in HISTORICAL mode by a clear margin, and consistently upper-half in SYNTHETIC mode. |
| [`stock-market-2/tominator-t73-stock-market-2`](stock-market-2/tominator-t73-stock-market-2/) | Stock Market 2 | TypeScript | A deliberately more aggressive fork of tominator-t72-stock-market-2 that targets T-72's own big-win mechanism directly: a real event's trade size is set by fixed sizing ceilings, not by the learned magnitude estimate (which already saturates those ceilings for virtually every real event), so this fork simply raises the ceilings, drops the "never average down" guard for event-driven signals only (a real event stays trustworthy through a transient paper loss, unlike a mean-reversion heuristic), and loosens its backstops just enough to let a real winning position run further. Measured across many real match runs against the full current roster: dominant in HISTORICAL mode with margin enabled (frequently the outright winner, occasionally by 2x+ portfolio value), but this comes at a real cost — noticeably weaker and more erratic than T-72 in SYNTHETIC mode, where the same aggressive sizing gets applied to a heuristic fade rather than a genuine signal. Higher variance than T-72 by design, not a strict improvement on it. |
| [`stock-market-2/adaptive-market-maker-stock-market-2`](stock-market-2/adaptive-market-maker-stock-market-2/) | Stock Market 2 | TypeScript | A risk-managed two-sided market maker: quotes a fee-aware spread around the mid-price, skewed by the same event-magnitude learning as the tominator lineage (plus a mean-reversion fade in SYNTHETIC mode only), inventory, and order-flow imbalance, with a toxic-flow streak detector and asymmetric sizing to lean against adverse selection, backed by the same stop-loss and margin de-risk backstops. Measured across many real match runs against the full current roster: consistently mid-to-back of the pack, underperforming the tominator lineage — this roster's other bots trade on real signals rather than random noise, so resting limit quotes get picked off more than they capture spread. Kept as a reference implementation of a market-making approach, not a top competitive pick. |

Both tables are one roster as far as the platform is concerned — nothing about `match run`,
`tournament run`, or the registry distinguishes a "reference" bot from a "competitor" one; the
split above is purely for a reader trying to figure out which bots to imitate versus which to
actually try to beat.

Each bot is verified against the real Docker runtime by its own `smoke-test.mjs` — build the
image, then `node <bot>/smoke-test.mjs` from the repo root; any bot's own `smoke-test.mjs` is a
working template for the pattern (e.g.
[`rock-paper-scissors/only-rock/smoke-test.mjs`](rock-paper-scissors/only-rock/smoke-test.mjs)).

Every JS/TS bot depends on `@thunderdome/bot-sdk-js`'s `runBot()` for the NDJSON wire-protocol
handling (replying to `init`, reading `observation`, exiting on `match-end`) — each bot's own file
is just a `decideAction()` (and, for `random-rps`/`tominator-t800`/`tominator-t1000`/
`tominator-tx`/`random-connect-four`/`random-hearts`/`random-poker`/`random-stock-market`, an
`onInit` hook to seed its PRNG from the match's `rngSeed`). `tactical-connect-four` and
`news-reaction-stock-market` are the two Python bots, and depend on the Python analog instead:
[`packages/bot-sdk-python`](../packages/bot-sdk-python)'s `run_bot()` — same contract, same NDJSON
wire protocol ([`docs/guides/protocol-reference.md`](../docs/guides/protocol-reference.md)), just
a `decide_action()` in place of `decideAction()`.

Since `bots/**` isn't a Yarn workspace member and has no package registry to install from
(neither npm nor Python's), a real dependency on either SDK means vendoring it directly into the
bot's own directory rather than a live workspace link or an installed package. For
`@thunderdome/bot-sdk-js` that's a packed tarball: each JS/TS bot has its own `package.json`,
`package-lock.json`, and `vendor/thunderdome-bot-sdk-js.tgz`, produced by
[`scripts/pack-bot-sdk-js.sh`](../scripts/README.md#pack-bot-sdk-jssh). `thunderdome_bot_sdk.py` has no
build step or packaging format to speak of — vendoring it is a straight file copy, produced by
[`scripts/vendor-python-bot-sdk.sh`](../scripts/vendor-python-bot-sdk.sh). The `only-*` bots, every
`tominator-*` bot, `tight-poker`, and `target-allocation-stock-market` additionally show the shape
of a TypeScript bot: their own `tsconfig.json` and a multi-stage `Dockerfile` that compiles TS in a
build stage and ships only the resulting JS plus production `node_modules` — no build tooling ends
up in the runtime image.
Every other JS/TS bot is plain JS with no build step at all — just an `index.mjs` (or `index.js`)
shipped directly into the image. Neither Python bot has a build step either — just
`thunderdome_bot_sdk.py` and its own `bot.py`, copied straight into a `python:3.12-alpine` image.

Want to watch them actually play each other? `yarn thunderdome match run <botId> <botId>
[...moreBotIds]` runs a real match between registry-resolved bots through the real engine and
runtime (building each bot's Docker image on demand) — 2 bot ids for Rock Paper Scissors or
Connect Four, exactly 4 for Hearts, 2-10 for Texas Hold'em or Stock Market, 1-10 for Stock Market
2 (it plays solo against the real historical market just as well as head-to-head). See
[`docs/guides/bot-author-guide.md`](../docs/guides/bot-author-guide.md) §9/§10/§11 for details.
To play against 3 Hearts bots yourself instead of watching, see `yarn thunderdome play` in
[`apps/cli/README.md`](../apps/cli/README.md#play).
