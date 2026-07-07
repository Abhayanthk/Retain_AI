# Node 5c — `competitor_research`

**File:** [`backend/app/graph/nodes/competitor_research.py`](../../backend/app/graph/nodes/competitor_research.py).

Runs in parallel with [`forensic_detective`](./forensic-detective.md) and [`pattern_matcher`](./pattern-matcher.md). Fan-in at [`diagnosis_merge`](./diagnosis-merge.md).

**Added in F14.** Pure RAG node — no LLM call. Returns competitor-positioning evidence + parsed counter-positioning items when `questionnaire.churn_destination` names a known competitor; otherwise returns a `matched: False` stub at zero cost.

## What it does

1. Substring-match `questionnaire.churn_destination` against the curated `KNOWN_COMPETITORS` table.
2. **Fallback match (added 2026-07):** the form's churn-destination question is a generic radio (`"To a competitor"`, `"We don't know"`, `"Build something in-house"`, …) with no competitor name in it — a direct match against step 1 almost never fires anymore. If `churn_destination` contains the word "competitor" and step 1 found nothing, fall back to matching each name in `questionnaire.competitors` (the free-text "top competitors" field) against `KNOWN_COMPETITORS` instead.
3. If matched (by either path): query Chroma for `topic: competitor_positioning` chunks with signal-tag boost.
4. Parse `Counter-play:` / `Counter-positioning:` markers out of the retrieved text into a discrete list.
5. Surface evidence + counter_positioning into state.

Without step 2 this node was silently dead for every real user — the destination question changed from a free-text field to a generic radio at some point, and nobody noticed the competitor match rate had dropped to ~0 until an audit compared the form's actual options against the matcher's assumptions.

## Known competitors

`KNOWN_COMPETITORS` dict in the file. ~40 entries grouped by category:

| Category | Examples |
|---|---|
| Team collaboration | Slack, Microsoft Teams, Discord |
| CRM | HubSpot, Salesforce, Pipedrive |
| Customer support | Intercom, Zendesk, Freshdesk, Drift |
| Docs / wikis | Notion, Confluence |
| Project mgmt | Asana, Jira, Trello, Linear, Monday |
| Marketing email | Mailchimp, Klaviyo, ConvertKit, Marketo, Pardot |
| Video conferencing | Zoom, Google Meet, Webex |
| Design | Figma, Sketch, Adobe XD |
| Payments / commerce | Stripe, Square, Shopify, BigCommerce |
| Web builders | Webflow, Squarespace |
| Scheduling | Calendly |
| Video msging | Loom, Vidyard |
| Generic incumbents | Microsoft, Google, Adobe, Atlassian |

Match is case-insensitive substring against `questionnaire.churn_destination.strip().lower()`. The dict also short-circuits on direct hits (`"slack"` → `"Slack"`) before falling through to substring scan. Strings like `"unknown"`, `"none"`, `"n/a"` early-return as no-match.

To add a competitor: extend the dict here AND add corresponding `topic: competitor_positioning` chunks (with `Counter-play:` markers in the text) to `backend/app/rag/corpus_data.py`. Re-run `python -m app.rag.ingest`.

## Retrieval

```python
query = (
    f"Counter-positioning, retention, and switching-cost defense when customers "
    f"churn to {competitor}. Industry: {industry}. Business model: {business_model}."
)
hits = rag_retrieve(query, k=4, signals=["competitor_threat", "switching_to_incumbent", "bundling_loss"])
```

Then prefer `topic == "competitor_positioning"` hits; fall back to all hits if none.

## Counter-play extraction

```python
for h in chosen:
    text = h.get("text") or ""
    for marker in ("Counter-play:", "Counter-positioning:"):
        idx = text.find(marker)
        if idx >= 0:
            counter_positioning.append(text[idx + len(marker):].strip()[:300])
            break
```

The corpus chunks added in F14 deliberately include lines like `Counter-play: lean into integrations that Slack-first teams already have; offer one-click migration of channels`. This regex-free parse pulls them into a discrete actionable list. Each entry is capped at 300 chars to keep prompts compact.

## Output (state key `competitor_research_output`)

### Matched

```python
{
    "matched": True,
    "competitor": "Microsoft Teams",
    "churn_destination": "Microsoft Teams",
    "evidence": [
        {"id": "...", "source": "...", "topic": "competitor_positioning", "score": ..., "snippet": "..."},
        ...  # top 3
    ],
    "counter_positioning": [
        "lean into integrations that Slack-first teams already have; offer one-click migration of channels",
        ...
    ],
}
```

### Not matched

```python
{
    "matched": False,
    "churn_destination": <raw value>,
    "competitor": None,
    "evidence": [],
    "counter_positioning": [],
}
```

### Error path

If `rag_retrieve` fails, returns `matched: True` with empty `evidence` / `counter_positioning` and an `error` field carrying the exception text.

## Downstream consumers

| Consumer | Reads |
|---|---|
| `diagnosis_merge` | Surfaces under `diagnosis_results.competitor_research`. |
| `execution_architect` | Pass-1 (reasoning trace) and pass-2 (structured) prompts both include a `## Competitor Research` section. When unmatched, that section prints a one-line "not a known competitor — skip counter-positioning specifics" so the LLM doesn't hallucinate framing. |
| Frontend SSE | `diagnosis_ready` event includes `competitor_research` payload. |

## Wall time

5–10 s (one Chroma query + parsing). Doesn't gate anything — diagnosis_merge waits for all three discovery nodes regardless.

## Why not LLM-driven

The competitor-positioning answer is essentially "look up what is known about countering Slack". That's a retrieval problem, not a reasoning problem. Adding an LLM would just paraphrase the corpus chunks at extra cost. The architect's pass-1 trace already does the reasoning step when it consumes this output.
