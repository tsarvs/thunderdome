# @thunderdome/research-fusion

A structured, real, growing fusion-commercialization research dataset built on
`@thunderdome/research-core`. Its purpose is twofold: prove the generic core schema can carry
substantial real domain research, and serve as the actual research substrate the
`fusion-fundamental-*`/`fusion-professional-*` bots (`bots/stock-market-4/`) trade against. It
deliberately excludes anything about how a bot should trade on it — that boundary is
non-negotiable (see [`@thunderdome/research-core`](../core/README.md)'s own README).

```ts
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '@thunderdome/research-fusion';

const dataset = createFusionFixtureDataset();
```

## What's in the dataset (current counts — this file gets stale fast, see below)

| Collection | Count |
|---|---|
| Entities | 121 |
| Relationships | 76 |
| Evidence | 85 |
| Assertions | 10 |
| Hypotheses | 25 |
| Models | 3 |
| Scenarios | 9 |
| Events | 27 |
| Questions | 45 |

Broad categories: reactors/projects (ARC, SPARC, ITER, EU-DEMO, J-DEMO, STEP, CFETR, CFEDR, BEST,
DTT, COMPASS-U, CREST, JT-60SA, ...), the 11 tracked-security companies (ELMT, Furukawa, Vitzro
Nextech, Almonty, Freemelt, Syntec Optics, General Fusion, Fujikura, Sumitomo, Kennametal, AMSC)
plus a much larger set of background/counterparty companies and government/research bodies (CFS,
Walter Tosto, Vitzro Tech, SIMIC, ATI, A.L.M.T., Plansee, Shanghai Superconductor, ams OSRAM, UKAEA,
ORNL, DOE, NNSA, TAE Technologies, Proxima Fusion, Pacific Fusion, Kyoto Fusioneering, and dozens
more), materials (Tungsten, HTS/REBCO, Vanadium, FLiBe, Tritium, Rhenium, CuCrZr), and components
(Vacuum Vessel, TF Magnet, TF Case, Divertor). `test/fixture.test.ts` validates the whole dataset
and spot-checks specific claims (hypothesis register completeness, the ELMT-tungsten-mass proxy
tagging, the uncomputed revenue variable, an explicit check that no ELMT-supplies-ARC relationship
exists even though ELMT manufactures tungsten and ARC requires it) rather than asserting these
counts directly — the counts above will drift as the dataset keeps growing; run
`createFusionFixtureDataset().entities.length` (etc.) yourself for the exact current number rather
than trusting this table long-term.

## How the dataset grew — four ingestion waves

1. **Original ingestion** (September 2026 snapshot) — the initial ~40-entity baseline: the core
   reactor/company/material/component register, ~20 relationships (most notably Walter Tosto's
   SPARC supply relationship evolving `tested` (2024) → `qualified` (2025) → `production contract`
   (2029), and SIMIC's TF-case supply to SPARC), ~30 evidence records with real provenance (SEC
   filings, company disclosures, peer-reviewed papers with DOIs), 10 assertions (the source
   material's "anti-thesis" analytical discipline — fusion sentiment trap, directness bias,
   commodity trap, qualification/contract fallacies, market-cap blindness, bottleneck power vs.
   revenue size, compounding replacement demand), the T-001…T-009/H016…H024 hypothesis register,
   3 models (fusion revenue, ARC first-wall tungsten derivation, ELMT valuation sensitivity), and
   9 scenarios (Fusion Bull, Fusion Delay, Materials Bottleneck, HTS Breakthrough, Tritium
   Bottleneck, Fusion False Dawn, Supplier Winner, Commodity Trap, High-demand/constrained
   tritium) — none with a `probability`, since nothing in the source justified assigning one.
2. **ELMT / Schwabmünchen** — The Elmet Group's announced acquisition of ams OSRAM's
   Schwabmünchen, Germany tungsten/molybdenum manufacturing operation, added following the same
   discipline (see its own section below). Required one genuinely domain-neutral schema addition
   to `research-core`: the `ResearchQuestion` type.
3. **Jul-Aug 2026 market verification update** — a broad real-world news-verification pass across
   the wider fusion ecosystem (UKAEA/Eni's RH3OVA joint venture, Proxima Fusion and Pacific Fusion
   funding rounds, JET's decommissioning, CFS's own funding/SPARC progress, several licensing and
   spinout events, and more) — most of this is background/context for entities OTHER than the 11
   tracked securities, and accounts for most of the entity/evidence growth beyond the original
   baseline. Added via [`daily-research-update-skill.md`](./daily-research-update-skill.md)'s
   broad-scope research pass.
4. **Sept 9-11, 2026 updates, and the ongoing portfolio-research-scoped pass** — real, dated news
   specifically about the 11 tracked securities: Freemelt's real F4E/JT-60SA tungsten-component
   order (Sept 9), a UKAEA/MAST-U transmission-system procurement notice and an ITER
   assembly-progress update (Sept 10-11, both correctly modeled as NOT touching any tracked
   security), and — most recently — a `portfolio-research-update-skill.md`-scoped pass covering
   Jul 1 - Sept 11, 2026 across 9 of the 11 tracked tickers (earnings reports, contract awards, an
   IPO, board changes; nothing found for VITZRONEXTECH in that window). This is the wave most
   directly relevant to what the bots actually trade on, and the one most likely to keep growing —
   see "Keeping this dataset current" below.

## ELMT / Schwabmünchen (wave 2, above)

Notable modeling choices:

- **Capability is tracked separately from qualification, which is tracked separately from a
  customer relationship.** Schwabmünchen manufacturing tungsten (an evidenced `manufactures`
  relationship) does not upgrade any of the nine independently-tracked
  `potential_fusion_customer`/`fusion_qualification` relationships (ITER, DEMO, EUROfusion, DTT,
  STEP, SPARC, ARC, CFS, and an "Other Private Fusion" placeholder bucket) away from their
  initialized `UNKNOWN`/confidence-0 state — none of them has supporting evidence yet.
- **Planned capability is never conflated with existing capability.** TZM and tungsten heavy alloy
  get `plans_to_produce` relationships (`status: 'planned'`, `metadata.notCurrentCapability: true`)
  — never a `manufactures` relationship, which is reserved for capability with actual evidentiary
  support.
- **The purchase-price mechanism is never collapsed into a bare number.** The acquisition entity
  records `purchaseConsideration: { status: 'formula_defined', finalConsideration: 'UNKNOWN' }`
  rather than a specific figure — the actual asset purchase agreement's formula nets a negative
  starting point against pension, restructuring, and working-capital adjustments not yet resolved.
- **36 research questions** (`RQ-ELMT-001`…`036`) are generated from one data-driven list rather
  than hand-duplicated as 36 near-identical object literals — see `ELMT_RESEARCH_QUESTIONS` in
  `fixture.ts`.

See `test/elmt-schwabmunchen.test.ts` for the acceptance-criteria coverage specific to this
addition.

## What was deliberately left out

The original source research dump also contained extensive guidance on bot strategy: signal
generation, position sizing, portfolio archetypes, buy/sell conditions, human-approval workflow,
and strategy maturity roadmap. None of that was ingested here — `research-core`/`research-fusion`
must stay completely unaware of any bot that might eventually consume this data. That material
belongs with whatever bot trades on it (see `bots/stock-market-4/fusion-fundamental-v6`/
`fusion-fundamental-v7`/`fusion-quant-v0`'s own `research/`, `valuation/`, `alpha/` code), never in
this dataset.

Not every numeric detail from a source is its own queryable `Variable` — deep single-use
academic-paper parameters are folded into `Evidence.description` text instead of exploded into
dozens of low-value near-duplicate objects. Nothing is silently lost, but not everything is
independently queryable.

## Why this matters: the tests, not just the data

- `test/fixture.test.ts` validates the whole dataset and spot-checks specific claims (see above).
- `test/temporal.test.ts` reconstructs H032/H033/H034's confidence histories (culminating at
  0.94/0.92/0.75) and the Walter Tosto/SPARC relationship's state history at several historical
  cutoffs.
- `test/information-leak.test.ts` is the fixture's core proof, exercised against multiple
  independent point-in-time cases (Walter Tosto's 2029 production contract, ELMT's September 8,
  2026 ams OSRAM acquisition announcement, Vitzro Nextech's August 6, 2026 Hanwha Aerospace
  contract, Freemelt's September 9, 2026 F4E/JT-60SA order): a snapshot taken even one day before
  each event cannot see it — not the event, not the evidence, not a stray string anywhere in the
  serialized JSON.

See [`@thunderdome/research-core`](../core/README.md) for what every type here means and how
temporal visibility is computed.

## Keeping this dataset current

The dataset itself lives at `data/dataset.json` — a plain JSON file validated against
`@thunderdome/research-core`'s `ResearchDataset` schema, loaded by `createFusionFixtureDataset()`
(`src/fixture.ts`) at runtime. It is no longer hardcoded TypeScript, specifically so it can grow
without a coding agent hand-editing this package's source — see below.

Two companion skills gather new real-world findings:

- [`daily-research-update-skill.md`](./daily-research-update-skill.md) — broad fusion-industry
  awareness, not limited to the 11 tracked securities. Use for general context. Still produces a
  loose findings summary for a human/coding session to work from, not yet wired into
  `apply:research-update` below (a planned fast-follow).
- [`portfolio-research-update-skill.md`](./portfolio-research-update-skill.md) — the narrower,
  usually more useful companion, scoped to only the 11 actual tracked securities (see that file's
  own table). Its output is now schema-exact `ResearchDataset`-partial JSON (entities/
  relationships/evidence/events), meant to be run against a free external AI and fed DIRECTLY into
  the pipeline below — no coding agent required.

**The no-coding-agent update flow**: run `portfolio-research-update-skill.md`'s prompt against a
free external AI (having it first run `yarn workspace @thunderdome/research-fusion run
list:entities` — or paste that output in — so it references real, existing entity ids), save its
JSON response to a file, then:

```bash
yarn workspace @thunderdome/research-fusion run apply:research-update -- --update-file <path>
```

`scripts/applyResearchUpdate.ts` merges the update into `data/dataset.json` and validates the WHOLE
result with `validateResearchDataset` — the same function this package's own tests and
`fixture.ts`'s load path use — before writing anything. Any issue (an unknown entity id, a
duplicate id, a broken cross-reference, an overlapping relationship timeline) refuses the ENTIRE
update and writes nothing, rather than guessing or partially applying it. `data/dataset.json`'s
`version` field gets an `+update.N` suffix on each successful run, so it's always visible whether a
copy of the dataset is the original hand-authored snapshot or has script-applied updates layered on
top.

Once new research is in the dataset, `src/timeline.ts`'s `buildResearchTimeline(dataset,
asOfDate)` turns the whole dataset into a real `stock-market-4` match's `config.researchTimeline`
— one entry per distinct day anything became knowable, each a full `createResearchSnapshot` at
that point in time. `scripts/emitForwardMatchConfig.ts` (run via `yarn workspace
@thunderdome/research-fusion run emit:forward-config`) wraps this into a complete match config
(universe, dataset reference, dates, and the generated `researchTimeline`) ready to hand to
`thunderdome match forward run --config-file <path>` or `match run --config-file <path>` — see
[`apps/cli/README.md`](../../apps/cli/README.md#match-forward-run--list--inspect) for the full
command reference. A real `researchTimeline` built this way routinely runs to megabytes, well past
what a shell allows as an inline `--config` argument, which is exactly why `--config-file` exists
on both commands.
