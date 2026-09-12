# fusion-quant-v0

A trading bot for the [Stock Market 4](../../../games/stock-market-4/README.md) game, and the
successor to [`fusion-fundamental-v6`](../fusion-fundamental-v6/README.md)/
[`fusion-fundamental-v7`](../fusion-fundamental-v7/README.md) — but this bot isn't really "a
better v6." Both of those reduce to the same shape: one fair-value estimate per company, mapped to
one of six discrete buy/sell buckets, mapped to one hardcoded position size. `fusion-quant-v0`
replaces that shape entirely with a small pipeline modeled on how a real quant research desk
actually separates its work: **independent alpha signals → measured (not guessed) combination →
pluggable portfolio construction → an independent risk stage that can only ever shrink, never
override**.

It still tracks the same 11 real companies in the fusion-energy supply chain, using the same
research-derived valuation math (`src/valuation/*.ts`, `src/research/*.ts`) as its predecessors —
what's different is everything downstream of "here's what I think this company is worth."

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

## The pipeline, stage by stage

### 1. Five independent alpha signals (`src/alpha/*.ts`)

Every round, for every priced security, this bot computes five separate opinions instead of one
blended number:

| Signal | File | What it reads |
|---|---|---|
| `evidence_delta` | `alpha/evidenceDelta.ts` | Any new research event/relationship/hypothesis change since last round |
| `commercialization` | `alpha/commercialization.ts` | Specifically a `supplier_capture`-type relationship change (an upgrade/downgrade in how much of a program's spend this company actually captures) |
| `valuation_gap` | `alpha/valuationGap.ts` | The gap between the modeled fair value and the current market price |
| `market_implied` | `alpha/marketImplied.ts` | Inverting the valuation formula to ask "what is the market ALREADY pricing in," and flagging when that's outside even the bear/bull range |
| `momentum` | `alpha/momentum.ts` | A plain trailing-return read over a shorter window than the other signals use — the only one of the five that isn't research-derived |

Each one is a small, independently-testable `AlphaSignal { factor, ticker, date, value,
confidence }` — see `src/alpha/types.ts`.

### 2. Measured combination, not hand-picked weights (`src/alpha/ic.ts`)

The five signals aren't averaged with fixed weights. Every round, this bot measures each factor's
own **information coefficient (IC)** — both plain Pearson and rank (Spearman) correlation between
what that factor predicted and what actually happened next — using every realized (prediction,
outcome) pair accumulated so far in the run. A factor with enough history (10+ paired
observations, configurable) gets an ensemble weight proportional to its own measured
`|rank IC|`. A factor that hasn't accumulated enough history yet gets the *average* of whatever
the reliably-measured factors are getting — an honest "we don't know if this one is good or bad
yet" default, never an invented number and never a silent zero.

This is genuinely adaptive within a run — see the caveat below about what that does and doesn't
mean.

### 3. Blended statistical + causal correlation (`src/correlation/`)

Two securities can be correlated for two different reasons: their prices have historically moved
together (`correlation/statistical.ts`, plain Pearson on return series), or they share real
research exposure — the same counterparty, the same reactor program, the same supply chain node
(`correlation/causal.ts`, built on `research/exposure.ts`'s causal-graph footprint overlap).
`correlation/blended.ts` combines both into one "effective correlation" per pair, with the causal
share weighted deliberately high (`correlationBlend.causalWeight`, default 0.4) precisely because
there's so little real price history to estimate the statistical half from reliably right now.

### 4. Pluggable portfolio construction (`src/portfolio/`)

Given each security's combined expected-return/confidence and the effective-correlation matrix,
one of three configurable strategies (`src/portfolio/select.ts`) turns that into target weights:

- **`equal_weight`** — every active position gets the same size.
- **`inverse_volatility`** — sized inversely to each security's own trailing daily volatility (the
  **default**).
- **`risk_parity`** — sized so each position contributes roughly equal risk, using the blended
  correlation matrix from stage 3.

There is deliberately **no mean-variance optimizer** — with 11 securities and only a couple months
of real price history, fitting one would be manufactured precision, not a real edge. The
walk-forward harness (below) is what actually compares these three empirically instead of the bot
committing to one.

### 5. An independent risk stage that only ever shrinks (`src/risk/riskEngine.ts`)

Portfolio construction's output then passes through a risk engine that can **only reduce** a
weight, never increase or override it, in three sequential passes: a per-position concentration
cap, a liquidity/average-daily-volume-proxy cap, and a thesis-group cap (positions that share
real research exposure — e.g. several tungsten-supply-chain names — get capped as a group, reusing
`fusion-fundamental-v7`'s own `applyThesisGroupCaps` unchanged). Every shrink is recorded with a
plain-language reason in `TradingDecision.riskAdjustments`; when nothing needs shrinking, the
weights pass through byte-identical.

### 6. Execution-cost-aware orders (`src/execution/costs.ts`, `src/portfolio.ts`)

Each order gets a bounded, illustrative transaction-cost estimate (a flat fee plus a term scaled by
order notional ÷ an average-daily-volume proxy) attached for reporting — not a full spread/slippage
model, which would need real bid/ask data this project doesn't have. **Phase 1 is long-only**: no
shorting, no stop-loss, no trend-filter veto — those were v6-era mechanisms tied to its discrete
signal-bucket design, which this bot doesn't have.

### 7. A "null research" ablation switch (`src/ablation.ts`)

One config field, `ablationMode`, controls which alphas are actually allowed to influence the
ensemble: `full` (all five), `research_only` (drops `momentum`), `price_only`/`null_research`
(keeps only `momentum`). This exists specifically to let the walk-forward harness ask the central
question this whole bot is for: **does the research-derived signal add real, measurable alpha, or
would trading on price alone do just as well?**

## The walk-forward harness (`backtest/walkForward.ts`)

This is the actual point of the bot, more than any one config's trading performance. It splits the
real available price history into rolling train/validate folds and — critically — asserts a later
fold's data can never leak into an earlier fold's decision (see
`test/backtest/walkforward-leakage.test.ts`, which truncates the dataset and proves an
already-computed decision is byte-identical before and after). It runs `fusion-fundamental-v6`,
`fusion-fundamental-v7` (both completely unmodified, read-only, as frozen benchmarks), every
`fusion-quant-v0` portfolio-strategy/ablation-mode combination, and dumb controls (equal-weight,
buy-and-hold, cash) through the identical harness, so they're genuinely comparable.

**An honest, load-bearing caveat**: with only ~2-3 months of real price history to fold, any
specific numbers this harness reports today are statistically thin — a working proof of the
mechanism, not a settled verdict on any strategy. It gets more meaningful automatically as
`packages/market-data`'s `fetch:append-bars` keeps growing the real dataset.

**A second, related caveat, worth being just as direct about**: the IC-weighted ensemble (stage 2
above) adapts *online, within a single continuous run* — for one long backtest over the same real
window, its weights in September are shaped by realized outcomes from July-August of that same
run. That's causally legitimate (it never sees ahead of itself) and is exactly what an adaptive
ensemble is supposed to do, but it is not the same thing as the walk-forward harness's proper
held-out validation. A single continuous `match run`/`match forward run` and the walk-forward
harness have in fact disagreed on relative ranking in practice — that discrepancy is a real,
still-open finding, not resolved by this README.

## What's explicitly deferred (not silently dropped)

- Full alpha/beta/cost return-attribution decomposition — each decision records which alpha/stage
  moved it, but the full breakdown isn't computed yet.
- Signal half-life/decay measurement — needs more historical depth than ~2 months can support
  meaningfully.
- Full bid/ask spread/slippage modeling beyond the bounded ADV-scaled approximation.
- A persisted, queryable decision ledger — still in-memory per decision, not a database.

## Quickstart

```bash
cd bots/stock-market-4/fusion-quant-v0
npm install   # first time only
npm test      # run the test suite
npm run backtest   # replay it against real historical prices and research
```

Run `npx tsx backtest/walkForward.ts` from this directory for the rolling train/validate comparison
described above. See [`apps/cli/README.md`](../../../apps/cli/README.md) for running this bot
against `fusion-fundamental-v6`/`fusion-fundamental-v7` through the real Docker-backed engine
(`match run`/`match forward run`).
