# Agent — Forensic Detective

**File:** [`backend/app/graph/agents/discovery/forensic_detective.py`](../../backend/app/graph/agents/discovery/forensic_detective.py).

Discovery Pod agent. The most expensive component in the graph in deep mode — runs HyDE + 2 RAG passes + a parallel self-consistency vote across Gemini (1 run quick, 3 runs deep).

For node-level context, fan-out, and consumers: [`docs/nodes/forensic-detective.md`](../nodes/forensic-detective.md).

## Public entry point

```python
def run_forensic_detective(state: RetentionGraphState, job_id: str | None = None) -> dict[str, Any]:
```

Called by `forensic_detective_node` (the thin wrapper in `nodes/`). `job_id` is needed for `push_progress` SSE events during self-consistency.

## Model

| | |
|---|---|
| Provider | Google Gemini |
| Model ID | `gemini_model(depth, deep_call=True)` — `gemini-3.1-flash-lite` in quick mode, `gemini-3.5-flash` in deep mode (`app/config.py`) |
| Temps | `[0.3]` in quick mode; `[0.2, 0.5, 0.7]` for the 3 self-consistency runs in deep mode |
| Keys | Round-robin across all `GOOGLE_API_KEY[_N]` via `FailoverLLM` |
| Structured output | `safe_llm_invoke` — retries the structured call once, then falls back to raw-JSON parse with the schema appended to the prompt |

## Pydantic schema

```python
class DetectiveResult(BaseModel):
    suspected_causes: List[str]
    confidence_scores: Dict[str, float]
    citations: Dict[str, List[str]] = Field(default_factory=dict)
```

Three fields, all consumed downstream:

- `suspected_causes` — feeds `merged_hypotheses` and the vote.
- `confidence_scores` — drives `_aggregate_detective_runs` mean-confidence merging.
- `citations` — merged with per-cause RAG into `forensic_detective_output.citations`.

## Step-by-step flow

### 1. Re-read CSV and compute 7 stat buckets

`run_forensic_detective` re-reads the CSV via DuckDB rather than using `state["normalized_df"]` for the same reasons as `data_audit` — independence + serialization safety.

Stat buckets (each becomes `{churn_rate, size, churned, p_value, significant}` per label):

| Bucket | Built from |
|---|---|
| `churn_by_channel` | `acquisition` / `channel` column |
| `churn_by_integration` | `integration` column (with `none`/`low`/`high` buckets if no string labels) |
| `churn_by_plan_tier` | `plan` column |
| `churn_by_contract` | `contract` column — detected separately from plan tier (contract cadence: monthly/quarterly/annual) |
| `churn_by_support_volume` | Support ticket count → `none`/`low`/`high` buckets (counts of 0, 1-3, 4+) |
| `churn_by_usage_decile` | Usage column → quartile buckets `q1`..`q4` |
| `churn_rate_by_tenure_bucket` | `0-1mo`, `1-3mo`, `3-6mo`, `6-12mo`, `12-24mo`, `24+mo` |
| `time_to_churn_distribution` | `mean`, `median`, `p25`, `p75`, `p90` of tenure for churned users |

`p_value`/`significant` come from a two-proportion z-test of each bucket against the rest of the population (`_apply_significance`). The candidate-cause prompt is told to discount buckets where `significant=false` — a numeric guard against building a narrative on statistical noise. All buckets also carry `{churn_rate, size}` so `_build_top_segments` in `diagnosis_merge` and `_best_stat_for_cause` in `evidence_dossier` can compute lost-users impact.

### 2. Derive signal tags

```python
signals = _derive_signals(stats, behavior_curves)
```

Produces tags like `30_day_cliff`, `low_integration`, `plan_tier_churn`, `engagement_decay`, etc. Full tag table: [docs/nodes/forensic-detective.md](../nodes/forensic-detective.md#signal-derivation).

### 3. HyDE pass

```python
hyde_answer = hypothetical_segment_answer(priority_segment, industry, business_model)
# 3-sentence hypothetical prose — see docs/rag/hyde.md
```

Surfaces as `forensic_detective_output.hyde_answer` for observability.

### 4. Broad RAG retrieval (k=6)

```python
broad_query = f"{hyde_answer}\n\nObserved patterns: ...\nChurn rate {x}\nMedian survival {y}"
broad_retrieved = rag_retrieve(broad_query, k=6, signals=signals)
```

Concatenated into `evidence_block`:

```python
evidence_block = "\n\n".join(
    f"[{i+1}] Source: {c['source']} (id: {c['id']})\n{c['text']}"
    for i, c in enumerate(broad_retrieved)
)
```

If the corpus is empty (e.g. `python -m app.rag.ingest` hasn't run), `evidence_block` becomes `"(no retrieved frameworks — reason from stats alone)"` and citations will be empty.

### 5. Self-consistency vote — parallel

```python
SELF_CONSISTENCY_TEMPS = [0.2, 0.5, 0.7]         # deep mode
SELF_CONSISTENCY_VOTE_THRESHOLD = 2               # deep mode; quick mode uses threshold=1

depth = q.get("analysis_depth")
sc_temps = SELF_CONSISTENCY_TEMPS if depth == "deep" else [0.3]
sc_vote_threshold = SELF_CONSISTENCY_VOTE_THRESHOLD if len(sc_temps) >= 2 else 1
forensic_model = gemini_model(depth, deep_call=True)

def _run_one(idx_temp):
    idx, t = idx_temp
    push_progress(job_id, "forensic_progress", {"run": idx, "total": len(sc_temps), "temp": t, "status": "started"})
    try:
        llm_t = get_llm("gemini", model=forensic_model, temperature=t)
        resp = safe_llm_invoke(llm_t, DetectiveResult, formatted_prompt, agent_name=f"ForensicDetective(t={t})")
        push_progress(job_id, "forensic_progress", {..., "status": "completed", "causes_found": len(resp.suspected_causes)})
        return idx, t, resp, None
    except Exception as err:
        push_progress(job_id, "forensic_progress", {..., "status": "failed", "error": str(err)[:120]})
        return idx, t, None, f"temp={t}: {err}"

with ThreadPoolExecutor(max_workers=len(sc_temps)) as pool:
    results = list(pool.map(_run_one, enumerate(sc_temps, start=1)))
```

In deep mode, three Gemini calls fire **concurrently** — each grabs a different round-robin key. Wall time ≈ max(individual call latency), not sum. Quick mode runs a single call with no thread-pool overhead.

### 6. Aggregate vote

`_aggregate_detective_runs(runs, temps=sc_temps, vote_threshold=sc_vote_threshold)`:

```python
norm_to_records = {}                        # norm_cause → [(original_phrasing, conf, citations), ...]
for run in runs:
    for cause in run.suspected_causes:
        norm = _normalize_cause(cause)      # lowercase + strip punct + collapse whitespace
        norm_to_records.setdefault(norm, []).append((
            cause,
            run.confidence_scores.get(cause, 0.0),
            run.citations.get(cause, []),
        ))

voted = [(norm, recs) for norm, recs in norm_to_records.items()
          if len(recs) >= SELF_CONSISTENCY_VOTE_THRESHOLD]
```

Winners ranked by `(vote_count desc, mean_confidence desc)`. Canonical phrasing = phrasing from the highest-confidence run that produced it. Mean confidence merged. Citations unioned.

**Fallback:** if no causes survive the vote (e.g. only 1 run succeeded), keep top-3 by max-confidence and set `consensus_metadata.fallback_used = True`.

### 7. Per-cause RAG (F4)

```python
for cause in candidate_causes[:3]:
    cause_query = f"Specific intervention frameworks and root cause patterns for: {cause}. Industry: {business_model}."
    cause_hits = rag_retrieve(cause_query, k=3, signals=signals)
    per_cause_evidence[cause] = [{id, source, topic, score} for c in cause_hits]
```

Surfaces in `forensic_detective_output.per_cause_evidence`.

### 8. Merge citations

```python
for cause in candidate_causes:
    ids = set(candidate_citations.get(cause, []))    # LLM self-citations
    for hit in per_cause_evidence.get(cause, []):
        ids.add(hit["id"])                            # RAG retrievals
    merged_citations[cause] = sorted(ids)
```

## Prompt (candidate-cause)

```
You are a retention analyst for a {business_model} company. Diagnose the 3 most likely root
causes of churn, ranked by evidence strength.

── Business context ──
Goal, priority_segment, competitors, churn_destination, churn_definition, top_channels,
edge_cases (analyst notes / caveats — treated as ground truth that may invalidate a naive
reading of the stats).

── Dataset statistics ──
Overall churn rate + 8 stat buckets (each with p_value/significant) + signals. Prompt
explicitly forbids building a cause primarily on a bucket where significant=false.

── CoxPH Driver Features (quantitative hazard ratios) ──
{drivers_str}

── Retrieved retention frameworks (broad sweep) ──
{evidence_block}

Requirements:
- Each suspected cause must be a concrete, specific phrase (not "users churn"; instead
  "users on Starter plan with <2 integrations churn at 38% by month 3").
- Reference the highest-signal numeric evidence — CoxPH hazard ratio, tenure-bucket cliff,
  support-volume jump.
- If churn_destination names a competitor, weight a "losing to {competitor}" hypothesis
  accordingly.
- Bias causes toward the priority segment when its tenure window matches the data signal.
- Reference frameworks by source id in citations map.
- Confidence in [0.7, 1.0].
```

## Output

```python
{
    "agent": "forensic_detective",
    "suspected_causes": [...],                          # top 3 post-vote
    "confidence_scores": {cause: float},                # mean across producing runs
    "citations": {cause: [chunk_id, ...]},              # union of LLM + per-cause RAG
    "retrieved_sources": [{id, source, topic, score}],  # all (broad + per-cause) hits
    "per_cause_evidence": {cause: [{id, source, topic, score}, ...]},  # F4
    "statistical_evidence": {...8 buckets incl. churn_by_contract, each with p_value/significant, + time_to_churn_distribution...},
    "driver_features": [...],                           # forwarded from feature_store
    "hyde_answer": str,                                 # F13 — the hypothetical
    "consensus_metadata": {                             # F3
        "runs_total": 1,                                 # 3 in deep mode
        "runs_temps": [0.3],                              # [0.2, 0.5, 0.7] in deep mode
        "vote_threshold": 1,                              # 2 in deep mode
        "fallback_used": bool,
        "votes": [{cause, votes, mean_confidence, phrasings: [...]}, ...],
        "partial_failures": [str],                       # only present if some runs failed
    },
    "analysis_depth": "high",
}
```

## Failure modes

| Failure | Result |
|---|---|
| CSV missing / DuckDB parse error | Returns `{agent, error}`. Whole agent output is an error stub. Diagnosis_merge sees zero causes. |
| Chroma collection empty | `evidence_block = "(no retrieved frameworks — reason from stats alone)"`. No citations. |
| All 3 self-consistency runs fail | Raises `RuntimeError("All self-consistency runs failed: ...")` — caught by outer try/except, returns error stub. |
| 1-2 of 3 runs fail | Vote falls back to top-3 by max-confidence; `consensus_metadata.fallback_used = True`; surviving run errors recorded under `partial_failures`. |
| LLM returns invalid JSON | `safe_llm_invoke` raises `ValueError`. Caught per-run. |
| HyDE call fails | Templated fallback string substitutes. No error surface. |
| Per-cause RAG fails | That cause's `per_cause_evidence` is empty. Citations fall back to LLM self-cited only. |

## Wall time

Quick mode: ~5–10 s total on Render free tier (fast-tier model, single run, no thread-pool). Deep mode: 40–60 s. Deep-mode breakdown:
- HyDE: 1–3 s
- Broad RAG: ~1 s (local Chroma)
- 3× self-consistency (parallel): 30–50 s (max of three concurrent Gemini structured-output calls)
- Per-cause RAG: ~2 s (3 Chroma queries)
- Aggregation + citation merge: <100 ms

In deep mode the dominant cost is the parallel Gemini block — adding more keys won't reduce it (it's max-bound, not sum-bound); shrinking the prompt or output schema would. Quick mode is disproportionately faster than "1/3 of deep mode" because `gemini-3.1-flash-lite` is also simply much faster per call than the deep-tier model on structured output (bench: ~2s vs 130s+ for an equivalent 4k-token call).

## Why 3 temps not random restarts (deep mode)

Temperatures 0.2 / 0.5 / 0.7 deliberately span low-creativity to high-creativity. A "creative" run can surface a cause the cold runs missed; a "cold" run anchors the vote in the most-likely-correct phrasing. Three runs at identical temps wouldn't have this diversity. Quick mode trades this away deliberately — one run at temp 0.3 for speed, no vote to filter hallucination. That's the depth/speed trade-off the questionnaire toggle exposes to the user.
