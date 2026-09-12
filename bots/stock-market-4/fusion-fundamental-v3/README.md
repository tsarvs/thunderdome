# fusion-fundamental-v2

A [Stock Market 4](../../../games/stock-market-4/README.md) bot that reads point-in-time research
about fusion-energy supply-chain companies, turns it into a fair-value estimate for each one,
compares that against the market's own price, and trades the gap — buying when the model thinks a
stock is undervalued relative to what research actually supports, trimming when it's not, and
holding when there's nothing new to act on. It never invents a relationship or a number research
hasn't established; every assumption it makes is an explicit, documented Bear/Base/Bull range, not
a guess dressed up as precision.

It tracks seven real, currently-traded companies: **ELMT** (tungsten components), Furukawa Electric
(`FURUKAWA`), Vitzro Nextech (`VITZRONEXTECH`), Almonty Industries (`ALM`), Freemelt (`FREEM`),
Syntec Optics (`OPTX`), and General Fusion (`GFUZ`).

**v2, vs. [`fusion-fundamental-v1`](../fusion-fundamental-v1):**
- **Conviction-ordered execution, not array-position execution.** v0/v1 processed securities in
  whatever order they happened to sit in `config.securities`, sharing one round's cash budget in
  that fixed order — so a mild `BUY` sitting earlier in the list could claim the round's cash before
  a `STRONG_BUY` sitting later in the list was even evaluated, purely by array position. v2 ranks
  every priced security by signal strength FIRST (`STRONG_BUY` before `BUY`, ties broken by the
  larger valuation gap) and only then spends the shared budget in that order — see
  [`src/decision.ts`](src/decision.ts)'s `buyPriorityRank`/`computeTradingDecisions`.
- **Two explicit cash reserves, subtracted from the deployable budget before anything else can
  claim it:**
  - `emergencyCashReservePct` — a hard floor as a fraction of STARTING capital (default 5%),
    mirroring a real personal-finance emergency fund: money set aside for a reason unrelated to any
    market view, that doesn't shrink just because a bad trading stretch shrank the portfolio.
  - `dryPowderTargetPct` — a softer target as a fraction of CURRENT equity (default 7.5%, the
    midpoint of a typical actively-managed portfolio's 5-10% target), intentionally left liquid for
    buying a decline, funding a rebalance without selling something else, or just reducing pressure
    to force a trade every round. Floats with the portfolio's own size, unlike the fixed emergency
    reserve above.
  - See [`src/config.ts`](src/config.ts)'s `PortfolioPolicy` doc comments for both.
- Motivation: a real July–August 2026 head-to-head match left v1 holding over 30% cash at the end
  of the window — mostly because per-security target weights rarely sum anywhere near 100%, not
  because of any deliberate reserve. v2 doesn't change target weights or risk appetite per
  security; it makes sure whatever cash IS meant to be deployed actually goes to the highest-
  conviction opportunity first, while making the "how much stays uninvested on purpose" decision
  explicit instead of incidental.

Everything else — signal classification, hysteresis, shorting with its confidence gate, valuation
methodology — is unchanged from v1. See that bot's own README for the full pipeline writeup.

<details>
<summary>v1, vs. <a href="../fusion-fundamental-v0">fusion-fundamental-v0</a> (unchanged in v2)</summary>

- **Shorting.** v0's most bearish signal (`SELL`) only ever flattened to cash — it could express
  "not worth owning" but never "worth betting against." v1 adds a `STRONG_SELL` level, symmetric to
  `STRONG_BUY`, that can drive a genuinely negative target weight (a short). But shorting is a
  materially higher-risk move than sizing a long (downside is theoretically unbounded, vs.
  capped-at-100% for a long), so it's gated behind an INDEPENDENT confidence floor
  (`policy.minShortConfidence`) on top of the score threshold — a large valuation gap alone, with
  low confidence in this round's change, still degrades to a plain flatten, not a bet against the
  security. See [`src/config.ts`](src/config.ts)'s `SignalThresholds.strongSellThreshold` /
  `PortfolioPolicy.shortTargetWeight`/`minShortConfidence`, and
  [`src/portfolio.ts`](src/portfolio.ts)'s `targetWeightForSignal`/`buildOrders`.
- **Tuned `hysteresisBand`/`rebalanceToleranceWeight`.** A real-engine parameter sweep over the
  July–August 2026 backtest window (`games/stock-market-4/scripts/sweepFusionFundamentalV0Thresholds.ts`)
  found `hysteresisBand: 0` / `rebalanceToleranceWeight: 0.03` strictly better than v0's defaults
  (`0.03`/`0.02`) on return, max drawdown, AND Sharpe simultaneously over that window — not just a
  risk/return tradeoff. Caveat: a single ~2-month window; worth re-validating against a longer or
  different period before trusting it as a general improvement.
- Shorting only actually fills against an engine configured with `config.risk.allowShortSelling:
  true` — against the game's cash-only default, a `STRONG_SELL` order is capped at shares actually
  held, same as v0, and never opens a short. The bot itself doesn't need to know which mode it's
  in; it always expresses its true desired position and lets the engine cap the fill. See
  `games/stock-market-4/scripts/runFusionFundamentalV1.ts` for a runnable demonstration of a real
  short actually opening and filling.

</details>

## Quickstart

### Run the backtest (fastest — no Docker, no game engine)

```bash
cd bots/stock-market-4/fusion-fundamental-v2
npm install   # first time only
npm run backtest
```

This replays the bot's real `decideAction` against every tracked security's real price history
([`backtest/*HistoricalPrices.ts`](backtest/)) and a real, structured research fixture
(`@thunderdome/research-fusion`'s `createFusionFixtureDataset()`), day by day — see
[`backtest/runBacktest.ts`](backtest/runBacktest.ts). It prints a strategy trace per decision to
stderr, and a final JSON summary (trading days, trade count, return, max drawdown, Sharpe, and a
buy-and-hold comparison per ticker) to stdout. This is the fast, in-process tier: it reuses the
real game's own performance-metrics math but a deliberately simplified portfolio ledger, not the
real engine's fee/margin/execution accounting — see the real match below for that.

### Run it for real, through the actual game engine

`yarn thunderdome match run` (the plain, non-forward command) always requires **at least two**
bot ids — it has no notion of a solo run, even though `stock-market-4` itself does. Since this is
currently the only `stock-market-4` bot in the repo, running it for real, alone, against a
`marketDataUniverse` matching its own tracked securities means using `match forward run` instead
(below) — the same engine, the same real fees/fills/portfolio accounting, just the command that
actually supports one participant. `match run` becomes relevant again once a second
`stock-market-4` bot exists to pair it against — see
[`apps/cli/README.md`](../../../apps/cli/README.md#match-run) for that command's own reference.

### Run it as a persistent, resumable forward-shadow match

This is the interesting one: a match that plays real trading days as they close, persists its
progress, and picks back up later — see
[`docs/adr/0013-forward-match-persistence.md`](../../../docs/adr/0013-forward-match-persistence.md)
for the design. Worked example, seeding a real dataset from this bot's own tracked securities:

```ts
// seed a market-data dataset from this bot's own real price history (see
// packages/market-data/README.md for publishDatasetVersion/appendBars)
import { createMarketDataStore, publishDatasetVersion } from '@thunderdome/market-data';
import { ELMT_REAL_HISTORICAL_PRICES } from './backtest/elmtHistoricalPrices.js';
import { ALMONTY_REAL_HISTORICAL_PRICES } from './backtest/almontyHistoricalPrices.js';
import { FURUKAWA_REAL_HISTORICAL_PRICES } from './backtest/furukawaHistoricalPrices.js';
import { VITZRO_NEXTECH_REAL_HISTORICAL_PRICES } from './backtest/vitzroNextechHistoricalPrices.js';
import { FREEMELT_REAL_HISTORICAL_PRICES } from './backtest/freemeltHistoricalPrices.js';

const store = createMarketDataStore('.thunderdome/market-data/fusion-live.sqlite');
publishDatasetVersion(store, { id: 'fusion-live', version: '1' }, {
  bars: {
    ELMT: ELMT_REAL_HISTORICAL_PRICES,
    FURUKAWA: FURUKAWA_REAL_HISTORICAL_PRICES,
    VITZRONEXTECH: VITZRO_NEXTECH_REAL_HISTORICAL_PRICES,
    ALM: ALMONTY_REAL_HISTORICAL_PRICES,
    FREEM: FREEMELT_REAL_HISTORICAL_PRICES,
  },
});
```

```bash
yarn thunderdome match forward run fusion-live fusion-fundamental-v2 --config '{
  "gameType": "FORWARD_SHADOW",
  "startDate": "2026-07-06",
  "endDate": "2026-12-31",
  "marketDataUniverse": ["ELMT", "FURUKAWA", "VITZRONEXTECH", "ALM", "FREEM"],
  "marketDataset": {"id": "fusion-live", "version": "1", "storeDir": ".thunderdome/market-data"}
}'
```

It plays every currently-known trading day, then stops — "Still resumable — more data may arrive
later." As new real trading days close, append them with `appendBars` (same package) and re-run
the *exact same command* (drop `--config` — a resumed match always uses its own stored one) to
pick up where it left off:

```ts
import { appendBars, createMarketDataStore } from '@thunderdome/market-data';
const store = createMarketDataStore('.thunderdome/market-data/fusion-live.sqlite');
appendBars(store, { id: 'fusion-live', version: '1' }, {
  bars: { ELMT: [{ date: '2026-09-09', open: 19.5, high: 19.9, low: 19.1, close: 19.6, volume: 400_000 }] },
});
```

```bash
yarn thunderdome match forward run fusion-live fusion-fundamental-v2
yarn thunderdome match forward inspect fusion-live   # check status/progress anytime
```

See [`apps/cli/README.md`](../../../apps/cli/README.md#match-forward-run--list--inspect) for the
full `match forward` reference.

## How it decides

Every round, for every tracked security independently (no cross-security portfolio optimization —
see [`decision.ts`](src/decision.ts)):

1. **Read the latest research** (`observation.research`, decoded via
   [`asResearchSnapshot`](src/research/types.ts)) and compute what changed since last round —
   [`research/delta.ts`](src/research/delta.ts).
2. **Turn that delta into fair-value effects** — [`research/interpretEvents.ts`](src/research/interpretEvents.ts).
3. **Compute a fair value per share** under this security's own Bear/Base/Bull assumptions
   ([`valuation/companyValue.ts`](src/valuation/companyValue.ts),
   [`valuation/fusionValue.ts`](src/valuation/fusionValue.ts)) and compare it against the market's
   own current price to get a **valuation gap**.
4. **Classify a signal level** — `STRONG_BUY` / `BUY` / `HOLD` / `REDUCE` / `SELL` / `STRONG_SELL`
   — from `signalScore = valuationGap × confidence` against configurable thresholds, with
   hysteresis so ordinary daily price noise near a threshold boundary doesn't whipsaw the level
   back and forth with no new research behind it ([`signal.ts`](src/signal.ts)).
5. **Map the signal to a target portfolio weight** (e.g. `STRONG_BUY` → 20% of equity, `SELL` →
   0%) and emit whatever `BUY`/`SELL` order closes the gap between that target and the current
   position — skipping dust-sized rebalances below a minimum notional
   ([`portfolio.ts`](src/portfolio.ts)). `STRONG_SELL` is the one exception to a simple lookup: it
   only maps to a NEGATIVE target (a short) when `signal.confidence` also clears
   `policy.minShortConfidence` — otherwise it degrades to the same 0% target as a plain `SELL`.
   Shorting is a materially higher-risk move than sizing a long, so it needs its own, higher
   confidence bar, not just an extreme score.

A security the bot has zero position in is a **valid, deliberate outcome** — being in this bot's
tracked universe means "worth evaluating," not "must be owned." See
[`decision.ts`](src/decision.ts) and [`signal.ts`](src/signal.ts) for the exact math; run
`npm run backtest` and read the strategy trace on stderr to see it reasoning about a real security
round by round.

## Configuring the bot itself

Unlike the *game's* config (which this bot reads exactly like any other participant — see the
game's own [Quickstart](../../../games/stock-market-4/README.md#quickstart)), this bot's own
trading assumptions are baked into its Docker image at
[`src/config.ts`](src/config.ts)'s `DEFAULT_FUSION_FUNDAMENTAL_CONFIG` — there's no `--config` flag
for the bot's own strategy, only for the match it's playing in. Each tracked security is one
`SecurityConfig` entry:

```ts
const ELMT_SECURITY: SecurityConfig = {
  ticker: 'ELMT',
  targetEntityId: 'entity-elmt', // the research-core entity id this security's research is filed under
  sharesOutstanding: 30_460_000, // public share count, for converting a $-valuation into a per-share one
  valuation: {
    baseBusinessValuePerShare: { bear: 12.74, base: 16.78, bull: 19.89 }, // anchored to ELMT's own real trading range
    fusionOptionValueBaselinePerShare: { bear: 0, base: 0.5, bull: 1.5 },
    fusion: { /* reactor deployments, tungsten content/price, supplier capture, ... — see config.ts */ },
    sensitivities: { /* how much a research-driven change to each of those moves fair value */ },
  },
};
```

Every `{ bear, base, bull }` triple is an explicit scenario range, never a single "true" number —
there's no basis for tighter precision than that, and the code is written to make that honest
rather than hide it behind a point estimate. Adding a new tracked security means adding one of
these entries (plus its own real price history under `backtest/`) — nothing else in the pipeline
needs to change, since every security is evaluated independently.

`signal`/`portfolio` (also in `config.ts`) are the shared threshold/target-weight policy every
security uses — see [How it decides](#how-it-decides) above for what each field controls.

## How research reaches it

The game hands every participant `observation.research: unknown` — completely opaque to the game
itself (see [The research boundary](../../../games/stock-market-4/README.md#the-research-boundary)).
This bot expects that payload to be a `@thunderdome/research-core` `ResearchSnapshot` and decodes
it defensively via [`asResearchSnapshot`](src/research/types.ts) — an unrecognized or missing
payload is treated as "nothing new this round" (hold across the board), never a crash. See the
[research boundary quickstart](../../../games/stock-market-4/README.md#4-feed-in-research-optional)
for how a match organizer actually builds that payload
(`createResearchSnapshot(dataset, timestamp)`).

## Tests

```bash
npm test
```

Includes acceptance tests specifically proving this bot never sees future information
(`test/acceptance/leakage.test.ts`), is fully deterministic (`determinism.test.ts`), and doesn't
infer relationships research hasn't established (`anti-inference.test.ts`, `no-information.test.ts`).
