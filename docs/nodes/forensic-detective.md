# Node 5a — `forensic_detective`

**File:** [`backend/app/graph/nodes/forensic_detective_node.py`](../../backend/app/graph/nodes/forensic_detective_node.py) (thin wrapper) → [`backend/app/graph/agents/discovery/forensic_detective.py`](../../backend/app/graph/agents/discovery/forensic_detective.py) (agent logic).

Heaviest node in the graph. Runs in parallel with [`pattern_matcher`](./pattern-matcher.md) and [`competitor_research`](./competitor-research.md); all three fan into [`diagnosis_merge`](./diagnosis-merge.md).

## What it does end-to-end

1. **Compute statistical evidence** — 7 stat buckets covering channel, integration, plan tier, support volume, usage decile, tenure bucket, time-to-churn.
2. **Derive signal tags** from those stats (`30_day_cliff`, `low_integration`, `plan_tier_churn`, …).
3. **HyDE pass 1 — broad retrieval** — write a 3-sentence hypothetical answer for the priority segment, embed it, query Chroma with `k=6` + signal tags.
4. **Self-consistency vote** — fire the candidate-cause prompt **3× in parallel** at temps 0.2 / 0.5 / 0.7 (each gets a different Gemini key via the round-robin factory). Keep causes that appear in ≥2 runs.
5. **Per-cause RAG pass** — for each top-3 voted cause, retrieve `k=3` more chunks using the cause text itself as the query.
6. **Merge citations** — union of LLM-self-cited ids + per-cause retrieval ids.

The whole thing typically takes 40–60 s wall time on Render's free tier with 8 Gemini keys configured.

## Inputs (from state)

| Key | Used for |
|---|---|
| `raw_csv_path` | Re-read to compute stat buckets. |
| `input_context.detected_columns` | Resolve churn/tenure/plan/usage/support/integration columns. |
| `behavior_curves` | `median_survival_time`, `milestone_retention.month_1` → signal tags. |
| `feature_store.predictive_churn_risk.driver_features` | CoxPH top-5 — surfaced into the prompt as quantitative anchors. |
| `questionnaire` | `priority_segment`, `business_model`, `business_context`, `competitors`, `churn_destination`, `goal`. |

## Signal derivation

`_derive_signals(stats, behavior_curves)` emits tags from observed thresholds. Excerpt:

| Condition | Tag |
|---|---|
| `churn_rate > 0.25` | `high_churn` |
| Channel-spread > 0.15 | `channel_churn`, `channel_variance`, `bad_fit` |
| Any integration data | `low_integration`, `integration_failure`, `b2b_churn` |
| Plan-tier spread > 0.15 | `plan_tier_churn` |
| Support-volume disparity | `high_support_volume` |
| Usage-decile spread | `engagement_decay`, `shallow_engagement` |
| `median_survival_time ≤ 3` | `short_tenure_churn`, `30_day_cliff`, `onboarding_friction` |
| `median_survival_time ≤ 9` | `mid_tenure_churn`, `90_day_cliff` |
| `milestone_retention.month_1 < 0.85` | `new_user_drop_off` |

RAG's `+0.05` per matching tag boost then biases retrieval toward chunks that talk about *these specific patterns* rather than just topically-close ones.

## Self-consistency loop (F3) — parallelized

```python
SELF_CONSISTENCY_TEMPS = [0.2, 0.5, 0.7]

def _run_one(idx_temp):
    idx, t = idx_temp
    push_progress(job_id, "forensic_progress", {"run": idx, ..., "status": "started"})
    llm_t = get_llm("gemini", temperature=t)        # grabs next round-robin key
    resp = safe_llm_invoke(llm_t, DetectiveResult, formatted_prompt, ...)
    push_progress(job_id, "forensic_progress", {..., "status": "completed", "causes_found": ...})
    return idx, t, resp, None

with ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(_run_one, enumerate(SELF_CONSISTENCY_TEMPS, start=1)))
```

Three concurrent Gemini calls → three different round-robin keys in flight → wall time = max(individual call) instead of sum. Each call streams a `forensic_progress` SSE event so the UI can show per-run progress.

### Voting

`_aggregate_detective_runs()`:

1. Normalize each cause text (lowercase + strip punctuation + collapse whitespace).
2. Group runs by normalized cause.
3. **Winners** = causes appearing in ≥ `SELF_CONSISTENCY_VOTE_THRESHOLD` (2) runs.
4. **Canonical phrasing** = phrasing from the highest-confidence run that produced it.
5. **Confidence** = mean across runs that produced it.
6. **Citations** = union across runs.
7. **Fallback**: if voting yields nothing (e.g. only 1 surviving run), keep top-3 by max-confidence and set `consensus_metadata.fallback_used = True`.

## Per-cause RAG pass (F4)

```python
for cause in candidate_causes[:3]:
    cause_query = f"Specific intervention frameworks and root cause patterns for: {cause}. Industry: {business_model}."
    cause_hits = rag_retrieve(cause_query, k=3, signals=signals)
    per_cause_evidence[cause] = [{id, source, topic, score} for c in cause_hits]
```

Result populates `forensic_detective_output.per_cause_evidence`. Each cause now has both LLM-claimed citations and corpus-retrieved evidence.

## Output (state key `forensic_detective_output`)

```python
{
    "agent": "forensic_detective",
    "suspected_causes": [str, ...],                    # top 3 after vote
    "confidence_scores": {cause: float},
    "citations": {cause: [chunk_id, ...]},             # union of LLM + per-cause
    "statistical_evidence": {                           # 7 buckets
        "churn_rate": float,
        "churn_by_channel": {label: {churn_rate, size}},
        "churn_by_integration": {...},
        "churn_by_plan_tier": {...},
        "churn_by_support_volume": {none/low/high: {...}},
        "churn_by_usage_decile": {q1/q2/q3/q4: {...}},
        "churn_rate_by_tenure_bucket": {"0-1mo": {...}, ..., "24+mo": {...}},
        "time_to_churn_distribution": {mean, median, p25, p75, p90},
    },
    "retrieved_sources": [{id, source, topic, score}, ...],
    "per_cause_evidence": {cause: [{id, source, topic, score}, ...]},
    "driver_features": [...],                          # forwarded from feature_store
    "hyde_answer": str,                                # the 3-sentence hypothetical for observability
    "consensus_metadata": {
        "runs_total": 3,
        "runs_temps": [0.2, 0.5, 0.7],
        "vote_threshold": 2,
        "fallback_used": bool,
        "votes": [{cause, votes, mean_confidence, phrasings: [...]}, ...],
        "partial_failures": [str, ...]                  # only present if some runs failed
    },
    "analysis_depth": "high",
}
```

## Mid-node SSE events

`push_progress(job_id, "forensic_progress", ...)` fires 6 events per pipeline run (3 starts + 3 completions, in interleaved order due to parallelism). Each carries `{run, total, temp, status, causes_found?, error?}`.

## Downstream consumers

| Consumer | Reads |
|---|---|
| `diagnosis_merge` | `suspected_causes`, `confidence_scores`, `citations`, `per_cause_evidence`, `statistical_evidence` (to build top_segments). |
| `professional_skeptic` (run by diagnosis_merge) | `suspected_causes`, `confidence_scores`, `statistical_evidence`. |
| `evidence_dossier` | `statistical_evidence` (`_best_stat_for_cause` matches by keyword overlap). |
| `execution_architect` | `driver_features` (via state's `feature_store`). |
| Frontend F15 evidence drawer | `per_cause_evidence`, `citations`, `consensus_metadata`. |

## Deep dive

Agent-level reference: [`docs/agents/forensic-detective.md`](../agents/forensic-detective.md).
