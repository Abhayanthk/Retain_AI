# HyDE — Hypothetical Document Embedding

**File:** [`backend/app/rag/hyde.py`](../../backend/app/rag/hyde.py).

## Why HyDE

Vanilla RAG queries embed the user's literal phrasing. For retention diagnosis the literal phrasing is something like `"Newest customers (first 90 days) segment, B2B SaaS, churn rate 0.34"` — a thin keyword soup with no causal language. The corpus chunks talk about *aha moments*, *time-to-value*, *integration setup*, *plan tiers* — vocabulary the query never names.

[HyDE](https://arxiv.org/abs/2212.10496) closes that gap: ask the LLM to *write the hypothetical retrieval target* first, then embed that. The hypothetical answer carries the same vocabulary as the chunks you want to retrieve, so cosine similarity actually fires on the topics that matter rather than on the bare keywords.

## API

```python
from app.rag.hyde import hypothetical_segment_answer

text = hypothetical_segment_answer(
    priority_segment="Newest customers (first 90 days)",
    industry="B2B SaaS",
    business_model="SaaS",
    temperature=0.4,
)
# → "The Newest customers (first 90 days) segment churns in B2B SaaS SaaS companies
#    primarily because of weak activation, mismatched plan-tier value, or unresolved
#    early friction. ..."
```

Returns a string ≥40 chars (real LLM output) or a deterministic templated fallback.

## Where it's used

Only the forensic detective. `forensic_detective.py` builds its broad-pass RAG query like this:

```python
hyde_answer = hypothetical_segment_answer(
    q.get("priority_segment", "all users"),
    q.get("business_context", q.get("industry", "SaaS")),
    q.get("business_model", "SaaS"),
)
query = f"{hyde_answer}\n\nObserved patterns: ...\nChurn rate {x}\nMedian survival {y}"
broad_retrieved = rag_retrieve(query, k=6, signals=signals)
```

The HyDE answer is also surfaced into the forensic output as `forensic_detective_output.hyde_answer` for observability and for the F15 evidence drawer if you want to render "what we asked the corpus about".

## Prompt

```
Write a tight 3-sentence hypothetical answer to: why does the {priority_segment}
segment churn in a {industry} {business_model} company? Reference specific behaviors
(activation, integration, support load, pricing-tier mismatch) when plausible. Do NOT
hedge ('it may depend on'). Do NOT mention you are hypothesizing. Output prose only —
no bullet points, no JSON.
```

Notes:

- **No hedging:** "it may depend on" sentences are wasted embedding mass. The prompt forbids them.
- **Reference specific behaviors:** the bracketed list (`activation, integration, support load, pricing-tier mismatch`) seeds the vocabulary the corpus uses, so the hypothetical answer is likely to land near the topics we actually have chunks for.
- **3 sentences cap:** longer hypotheticals dilute the embedding. Three sentences is enough to carry topic + cause + behavioral specifics.
- **Don't disclose hypothesizing:** "I think it might be..." tokens contaminate the embedding.

## Failure path

Gemini call wrapped in `try/except`:

```python
try:
    raw = llm.invoke(_HYDE_PROMPT.format(...))
    text = extract_llm_text(raw.content)
    if text and len(text) >= 40:
        return text
except Exception:
    pass

return (
    f"The {seg} segment churns in {ind} {bm} companies primarily because of "
    f"weak activation, mismatched plan-tier value, or unresolved early friction. "
    f"Retention recovers when the highest-friction step before first value is removed."
)
```

A deterministic templated fallback runs on LLM failure or short output. Retrieval never blocks on HyDE — worst case the broad query embeds the fallback string, which is still better than a bare keyword list.

## Cost

- One Gemini call per pipeline run, ~150 input tokens, ~120 output tokens.
- On Gemini 3 Flash Preview free tier: free, ~3–5 s latency.
- Round-robins through the same Gemini key pool as everything else (`get_llm("gemini")`).

## Why this is a separate file (not inlined in forensic_detective.py)

- Reusable. If a future strategy agent wants HyDE-anchored retrieval (e.g. `unit_economist` looking up case studies), it can import the same helper.
- Testable. Pure function: `(segment, industry, business_model) → str`. No dependencies on graph state.
- Fallback is centralized — every caller gets the deterministic template for free.

## Related

- [rag.md](../rag.md) for the broader retrieval flow.
- [nodes/forensic-detective.md](../nodes/forensic-detective.md) for how the HyDE output is consumed.
