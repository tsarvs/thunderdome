# Data provenance

Real, static, permanently-frozen data — Denny's Corp (DENN) was taken private by a TriArtisan-led
consortium and delisted from Nasdaq on 2026-01-16, so none of this will ever need refreshing.

## `denn-prices.json`

2,515 real daily OHLCV bars, 2016-01-19 through 2026-01-16 inclusive, oldest first. Pulled from
`stockanalysis.com`'s public history API:

```
https://stockanalysis.com/api/symbol/s/DENN/history?range=10Y&period=Daily
```

(pulled 2026-09-04). Fields: `date` (`YYYY-MM-DD`), `open`, `high`, `low`, `close`, `volume`.

## `denn-filings.json`

132 real, dated SEC Form 8-K filings for Denny's Corp (CIK `0000852772`) within the same date
range, each with its real item codes as filed (e.g. `2.02` = "Results of Operations and Financial
Condition" — a real earnings release). Pulled from SEC EDGAR's public submissions API:

```
https://data.sec.gov/submissions/CIK0000852772.json
```

(pulled 2026-09-04, filtered to `form === '8-K'` within the price-history date range; two real
same-day double-filings — 2022-05-03 and 2025-11-04 — were merged into one record with the union
of both filings' item codes). Nothing in this file is interpreted or labeled — just the raw real
SEC data as filed.

## `denn-events.json`

A committed snapshot of `events.ts`'s `buildEventSeries(denn-prices, denn-filings)` output: one
real-data-derived event classification per trading day. Committed for human auditability (scan a
real date → its assigned event type without executing the classifier) — `test/events.test.ts`'s
golden-file test recomputes `buildEventSeries()` and asserts it deep-equals this file, so the
snapshot and the classification code can never silently drift apart. Regenerate by running
`buildEventSeries()` against the two raw fixtures above whenever `events.ts` actually changes.
