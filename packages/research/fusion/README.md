# @thunderdome/research-fusion

A structured ingestion of real fusion-commercialization research (research snapshot: September
2026), built on `@thunderdome/research-core`. Its purpose is to prove the generic core schema can
carry substantial real domain research — it is **not** the complete fusion research database,
and it deliberately excludes anything about how a bot should trade on it.

```ts
import { createFusionFixtureDataset, FUSION_FIXTURE_IDS } from '@thunderdome/research-fusion';

const dataset = createFusionFixtureDataset();
```

## What's in the dataset

- **~40 entities**: reactors/projects (ARC, SPARC, ITER, EU-DEMO, J-DEMO, STEP, CFETR, CFEDR,
  BEST, DTT, COMPASS-U, CREST), companies (CFS, ELMT, Fujikura, Furukawa, Walter Tosto, Vitzro
  Nextech, Vitzro Tech, SIMIC, ATI, A.L.M.T., Sumitomo, Plansee, Almonty, Kennametal, AMSC,
  Shanghai Superconductor, ams OSRAM, Type One, Realta, DOE), materials (Tungsten, HTS/REBCO,
  Vanadium, FLiBe, Tritium, Rhenium, CuCrZr), and components (Vacuum Vessel, TF Magnet, TF Case,
  Divertor).
- **~20 relationships**, several with temporal state histories — most notably Walter Tosto's
  SPARC supply relationship evolving `tested` (2024) → `qualified` (2025) → `production contract`
  (2029), and SIMIC's TF-case supply to SPARC moving through `production-began` →
  `first-units-shipped` → `delivery-complete` across 2024-2025.
- **~30 evidence records** with real provenance (SEC filings, company disclosures, peer-reviewed
  papers with DOIs/preprint identifiers), each tagged in `metadata.provenanceClass` with the
  source dump's own classification (`FACT`, `COMPANY_CLAIM`, `GOVERNMENT_CLAIM`, `PAPER_FINDING`,
  `ENGINEERING_ESTIMATE`, `OUR_INFERENCE`, or `CONVERSATION_RESEARCH` where no explicit source was
  captured).
- **10 assertions**, including the source material's "anti-thesis" analytical discipline (fusion
  sentiment trap, directness bias, commodity trap, qualification/contract fallacies, market-cap
  blindness, bottleneck power vs. revenue size, compounding replacement demand).
- **17 hypotheses** (the full T-001…T-009 / H016…H034 register), each with real confidence
  values; H032/H033/H034 additionally carry a multi-year assessment history culminating at their
  stated baselines (~0.94/~0.92/~0.75).
- **3 models**: the fusion revenue model, the ARC first-wall tungsten derivation (~257 m² × 5 mm
  ≈ 1.285 m³ × ~19.25 tonnes/m³ ≈ 24.7 tonnes, tagged derived/approximate/proxy), and an
  illustrative ELMT valuation-sensitivity model — none of their formulas are executed.
- **9 scenarios**: the original "High-demand / constrained tritium" plus the source material's
  eight named scenarios (Fusion Bull, Fusion Delay, Materials Bottleneck, HTS Breakthrough,
  Tritium Bottleneck, Fusion False Dawn, Supplier Winner, Commodity Trap) — none with a
  `probability`, since nothing in the source justifies assigning one.
- **4 events**, three of them exercised by point-in-time tests below.

## ELMT / Schwabmünchen (a later, separate addition)

A second body of research — The Elmet Group's announced acquisition of ams OSRAM's
Schwabmünchen, Germany tungsten/molybdenum manufacturing operation — was added after the
initial ingestion above, following the same discipline: verified facts, hypotheses, evidence,
and relationships stay distinct, and nothing is inferred beyond what's evidenced.

This addition needed one small, genuinely domain-neutral schema addition to `research-core`
itself: a `ResearchQuestion` type (`code`, `question`, `status`, `createdAt`,
`relatedEntityIds`/`relatedHypothesisIds`) — every research domain accumulates open questions
it doesn't yet have evidence to answer, and neither `Assertion` (a declarative claim) nor
`Hypothesis` (a testable belief with a confidence value) fits a bare question like "what is the
annual tungsten production capacity?" See `@thunderdome/research-core`'s own README for that
type.

Notable modeling choices:

- **Capability is tracked separately from qualification, which is tracked separately from a
  customer relationship.** Schwabmünchen manufacturing tungsten (an evidenced `manufactures`
  relationship) does not upgrade any of the nine independently-tracked
  `potential_fusion_customer`/`fusion_qualification` relationships (ITER, DEMO, EUROfusion, DTT,
  STEP, SPARC, ARC, CFS, and an "Other Private Fusion" placeholder bucket) away from their
  initialized `UNKNOWN`/confidence-0 state — none of them has supporting evidence yet.
  "Other Private Fusion" is a deliberate placeholder aggregate entity, not a real company, that
  exists purely so an UNKNOWN bucket for unspecified private developers can be tracked the same
  way as the named programs.
- **Planned capability is never conflated with existing capability.** TZM and tungsten heavy
  alloy get `plans_to_produce` relationships (`status: 'planned'`,
  `metadata.notCurrentCapability: true`) — never a `manufactures` relationship, which is
  reserved for capability with actual evidentiary support (tested explicitly).
- **The purchase-price mechanism is never collapsed into a bare number.** The acquisition entity
  records `purchaseConsideration: { status: 'formula_defined', finalConsideration: 'UNKNOWN' }`
  rather than "ELMT paid/received €18M" — the actual asset purchase agreement's formula nets a
  negative €18M starting point against pension, restructuring, and working-capital adjustments
  not yet resolved.
- **36 research questions** (`RQ-ELMT-001`…`036`) are generated from one data-driven list rather
  than hand-duplicated as 36 near-identical object literals — see `ELMT_RESEARCH_QUESTIONS` in
  `fixture.ts`.

See `test/elmt-schwabmunchen.test.ts` for the acceptance-criteria coverage specific to this
addition.

## What was deliberately left out

The source research dump also contained extensive guidance on bot strategy: signal generation,
position sizing, portfolio archetypes, buy/sell conditions, human-approval workflow, and strategy
maturity roadmap. None of that was ingested here — `research-core`/`research-fusion` must stay
completely unaware of any bot that might eventually consume this data (spec's non-negotiable
#2/#11). That material belongs with whatever eventually builds a bot for `stock-market-4`, not in
a research dataset.

Not every numeric detail from the source is its own queryable `Variable` — deep single-use
academic-paper parameters (irradiation dpa/temperature conditions, individual remote-handling
timing breakdowns, etc.) are folded into `Evidence.description` text instead of exploded into
dozens of low-value near-duplicate objects. Nothing is silently lost, but not everything is
independently queryable.

## Why this matters: the tests, not just the data

- `test/fixture.test.ts` validates the whole dataset and spot-checks the specific claims above
  (hypothesis register completeness, scenario list, the ELMT-tungsten-mass proxy tagging, the
  uncomputed revenue variable) — including an explicit check that no ELMT-supplies-ARC
  relationship exists, even though ELMT manufactures tungsten and ARC requires tungsten: a
  plausible relationship is never promoted to an established one without evidence (source §60/§79).
- `test/temporal.test.ts` reconstructs H032/H033/H034's confidence histories and the Walter
  Tosto/SPARC relationship's state history at several historical cutoffs.
- `test/information-leak.test.ts` is the fixture's core proof, exercised against **three
  independent point-in-time cases**: Walter Tosto's 2029 production contract, ELMT's September 8,
  2026 ams OSRAM acquisition announcement, and Vitzro Nextech's August 6, 2026 Hanwha Aerospace
  contract. A snapshot taken even one day before each event cannot see it — not the event, not
  the evidence, not a stray string in the serialized JSON. Building these caught a real bug: an
  early draft put acquisition-specific detail into the _entity's_ description field (which is
  visible from 2023 onward) rather than into the evidence gated to the announcement date — fixed,
  and now covered by a regression test.

See [`@thunderdome/research-core`](../core/README.md) for what every type here means and how
temporal visibility is computed.
