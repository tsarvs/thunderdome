# fusion-fundamental-v6

A trading bot for the [Stock Market 4](../../../games/stock-market-4/README.md) game. It follows
real news and research about companies in the fusion-energy supply chain, forms an opinion about
what each company's stock is actually worth, and trades when the market's price disagrees with
that opinion — while leaning on several everyday risk-management habits (the same kind real
investors use) to avoid getting burned along the way.

This guide explains the two things people usually want to know first: **how it decides what to buy
or sell**, and **how it protects itself from bad trades**. No finance background required.

## The companies it follows

| Ticker | Company | What they do |
|---|---|---|
| ELMT | ELMT | Tungsten components |
| FURUKAWA | Furukawa Electric | High-temperature superconducting wire |
| VITZRONEXTECH | Vitzro Nextech | Aerospace / plasma engineering components |
| ALM | Almonty Industries | Tungsten mining |
| FREEM | Freemelt | Metal 3D-printing (additive manufacturing) |
| OPTX | Syntec Optics | Precision optics, including for fusion reactors |
| GFUZ | General Fusion | Builds fusion reactors directly |
| FUJIKURA | Fujikura Ltd. | HTS wire, connectivity, and cable technology |
| SUMITOMO | Sumitomo Electric | Cable, materials, and industrial components (ITER tungsten monoblocks) |
| KMT | Kennametal | Tooling and wear-resistant materials, general tungsten exposure |
| AMSC | American Superconductor | Grid-scale power electronics and superconductor technology |

## How it decides to buy or sell

Think of the bot as answering one question, over and over, for each company: **"Is this stock
worth more or less than what the market is currently charging for it?"**

1. **It reads the news.** Every round, it checks whether anything new has been reported about a
   company — a contract, an acquisition, new evidence about its business. It only reacts to
   things that are actually established as fact, never to a guess or a rumor dressed up as one.

2. **It estimates a fair price.** Using what it knows about the company (some numbers it starts
   with, blended a little with the stock's own recent trading range — more on that below), it
   comes up with what it thinks a fair price per share should be.

3. **It compares that to the real price.** If the fair price is a lot *higher* than what the stock
   is actually trading for, the stock looks like a bargain. If the fair price is a lot *lower*,
   the stock looks overpriced.

4. **It classifies how strongly it feels**, from most bullish to most bearish:

   | Level | Meaning | What it does |
   |---|---|---|
   | STRONG_BUY | Looks very undervalued | Buy a meaningful amount |
   | BUY | Looks somewhat undervalued | Buy a smaller amount |
   | HOLD | No strong opinion | Do nothing |
   | REDUCE | Looks somewhat overvalued | Trim the position a little |
   | SELL | Looks quite overvalued | Sell out of the position entirely |
   | STRONG_SELL | Looks very overvalued, AND the bot is genuinely confident about it | *Might* bet against the stock (see below) |

   There's a bit of "stickiness" built in on purpose — the bot doesn't flip its opinion back and
   forth every time the price wiggles slightly. It has to actually change its mind by a real
   margin before it changes levels, the same way you wouldn't sell something you just bought
   because the price ticked down a penny.

### Betting against a stock (shorting) — a higher bar

Most of the time, being bearish just means "don't own this" or "sell what I have." But at the
STRONG_SELL level, the bot can go a step further and actually bet that the price will fall (this
is called "shorting"). Because betting *against* a stock is riskier than simply not owning it —
if you're wrong, the potential loss is much larger — the bot only does this when it clears an
extra, independent confidence bar on top of the price looking expensive. A stock that merely
*looks* pricey isn't enough by itself; the bot needs a genuine reason to be confident, not just a
big number on a spreadsheet.

## How it manages risk

Believing a trade is a good idea and blindly acting on it are two different things. v6 adds four
separate safety habits on top of its buy/sell opinion, each modeled on something real investors
actually do:

### 1. Don't try to catch a falling knife (or short a rocket)

A stock can look "cheap" on paper while it's in the middle of a genuine, sustained crash — buying
into that is often just buying more of a falling knife, not a bargain. So before opening or adding
to a position, the bot checks: has this stock been falling sharply over the last couple of weeks?
If so, it holds off on buying, even if its valuation model says "buy." The mirror image applies to
shorting: it won't bet against a stock that's in the middle of a strong rally, even if the model
says it's overpriced.

### 2. Size positions based on how "jumpy" a stock has been

Some stocks bounce around wildly day to day; others move calmly. For a stock that's been
unusually calm recently, the bot is willing to lean in a bit harder — putting slightly more money
behind that opinion. For a stock that's been especially wild, it doesn't get an extra boost, but it
also doesn't automatically shrink back — a lot of this bot's edge specifically comes from the
volatile movers, so it's careful not to talk itself out of exactly the trades that tend to work.

### 3. An automatic stop-loss — the ultimate safety net

Every position gets a hard rule: if it moves too far against the bot (currently: about 40% worse
than the price it was bought or shorted at), the bot exits automatically — no matter what its own
model still believes about the stock. This is the same "cut your losses" discipline any careful
investor follows: sometimes you're just wrong, and the smart move is to admit it and move on
rather than keep holding out for a turnaround.

### 4. Don't accidentally make the same bet twice

Some of these companies are in similar businesses — a few are all tied to the tungsten supply
chain, for example. If several of them tend to rise and fall together, holding all of them at full
size isn't really five separate bets — it's closer to one bigger bet wearing five different
tickers. The bot checks how closely each stock's recent price moves track the others it's
currently considering, and sizes down positions that are especially redundant with the rest of the
book. (Two stocks that move in *opposite* directions are treated as a good thing, not a bad one —
that's genuine diversification, not redundancy, so it's never penalized.)

## Why "v6"?

This bot is the sixth version in a series, each one building on the last:

- **v0** — the original: research a company, estimate fair value, trade the gap.
- **v1** — added the ability to bet against overpriced stocks (shorting), with a confidence
  requirement.
- **v2** — got smarter about which trades to fund first when cash is limited, and started keeping
  a small cash reserve on hand instead of spending everything.
- **v3** — added the "don't fight the trend" check described above.
- **v4** — added sizing positions based on how volatile a stock has been.
- **v5** — added the automatic stop-loss.
- **v6** (this one) — added the "don't double up on similar bets" check.

Each version has real, tuned settings behind it — see [`src/config.ts`](src/config.ts) if you want
to see the exact numbers and the reasoning behind each one.

## Quickstart

```bash
cd bots/stock-market-4/fusion-fundamental-v6
npm install   # first time only
npm test      # run the test suite
npm run backtest   # replay it against real historical prices and research
```

See [`games/stock-market-4/scripts/runFusionFundamentalAllBots.ts`](../../../games/stock-market-4/scripts/runFusionFundamentalAllBots.ts)
for running this bot against every other version at once, through the real game engine.
