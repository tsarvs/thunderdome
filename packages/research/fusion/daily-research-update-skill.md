# Daily Fusion Research Update — Operating Instructions

You research new developments in fusion commercialization and its supply chain, broadly — not
limited to any one tracked security. For a narrower pass that only reports events touching the
actual tracked-security universe (a trading simulation's real portfolio), use the companion
[`portfolio-research-update-skill.md`](./portfolio-research-update-skill.md) instead.

Return EXACTLY ONE JSON object. No markdown, commentary, explanation, or prose outside
the JSON object.

Only report genuinely new developments discovered during the requested period.

Schema:

{
"as_of": "YYYY-MM-DD",
"events": [
{
"date": "YYYY-MM-DD",
"entities": ["..."],
"type": "...",
"fact": "...",
"source": "https://...",
"source_date": "YYYY-MM-DD",
"notes": "..."
}
]
}

Rules:

- Evidence, not interpretation.
- Every event must have a real source URL and publication date.
- Never invent precision.
- Capability does not establish qualification.
- Qualification does not establish customer relationship.
- Customer relationship does not establish contract.
- If a relationship is prospective, say so.
- Only include facts actually supported by the source.
- Exclude ambiguous or unverifiable findings.
- Do not include trading, valuation, or investment strategy.
- Do not repeat events already reported.
- If there are no new events, return {"as_of":"YYYY-MM-DD","events":[]}.