# Node 5b — `pattern_matcher`

**File:** [`backend/app/graph/nodes/pattern_matcher_node.py`](../../backend/app/graph/nodes/pattern_matcher_node.py) (thin wrapper) → [`backend/app/graph/agents/discovery/pattern_matcher.py`](../../backend/app/graph/agents/discovery/pattern_matcher.py).

Runs in parallel with [`forensic_detective`](./forensic-detective.md) and [`competitor_research`](./competitor-research.md). Fan-in at [`diagnosis_merge`](./diagnosis-merge.md).

## What it does

Single Gemini call on the fast tier (no self-consistency, no RAG, no depth promotion — this call always uses `gemini-3.1-flash-lite` regardless of `analysis_depth`). Looks at `feature_store`, `behavior_cohorts`, and the top-5 CoxPH hazard drivers, then asks Gemini to identify:

- High-risk **user segments** (biased toward the priority segment).
- Feature-adoption **patterns** anchored to hazard ratios.
- **Churn sequences** (steps users take before leaving, with probabilities).
- **Topic clusters**.

The "creative" counterpart to the forensic agent's evidence-grounded reasoning. The professional skeptic (inline in `diagnosis_merge`) stress-tests both.

## Inputs (from state)

| Key | Used for |
|---|---|
| `feature_store` | RFM / velocity / LTV / engagement_cohorts / predictive_churn_risk. |
| `feature_store.predictive_churn_risk.driver_features` | Top-5 hazard ratios — segment names must reference these. |
| `behavior_cohorts` | Tenure-quartile cohorts. |
| `questionnaire` | `business_model`, `priority_segment`, `typical_customer`. |

## Prompt (excerpt)

```
Identify:
1. High-risk user segments — bias toward the priority segment if signals match.
   Each segment_id should reference the actual data driver (e.g. "low_integration_b2b"
   not "Segment A").
2. Feature-based patterns (specific feature adoption gaps tied to hazard ratios above).
3. Common churn sequences (steps users take before leaving), ordered.
4. pattern_confidence in [0, 1].
```

The driver string fed in:

```
- low_integrations: HR=2.34 (raises_churn, p=0.003)
- support_tickets:  HR=1.87 (raises_churn, p=0.01)
- usage_decile:     HR=0.62 (protects, p=0.04)
- ...
```

## Output (state key `pattern_matcher_output`)

```python
{
    "agent": "pattern_matcher",
    "patterns_found": [
        {"pattern": str, "churn_risk": "low"|"medium"|"high", "affected_users": int, "description": str},
        ...
    ],
    "user_segments": [
        {"segment_id": str, "size": int, "retention_rate": float, "characteristics": str},
        ...
    ],
    "topic_clusters": [{"topic": str, "cluster_size": int}, ...],
    "churn_sequences": [{"sequence": str, "probability": float}, ...],
    "pattern_confidence": float,
}
```

## Why no RAG / no self-consistency

- **No RAG:** forensic already pulls the framework context. Duplicating that here would just send a redundant prompt with the same chunks. Pattern matcher's job is structural pattern recognition on the aggregated features, not framework citation.
- **No self-consistency:** segments and patterns are descriptive, not causal claims. Voting over 3 runs would mostly just average phrasing differences without filtering hallucinations the way it does for causes. Single call at temp 0.2 is sufficient.

## Downstream consumers

| Consumer | Reads |
|---|---|
| `diagnosis_merge` | `user_segments` (folded into the unified `top_segments` table), `patterns_found` (counted for `total_patterns_identified`). |
| `professional_skeptic` | `churn_sequences`, `patterns_found` — cross-checks for confirmation bias. |
| Frontend | `user_segments` rendered as segment chips in the diagnosis section. |

## Wall time

Typically a few seconds on Render's free tier — a single fast-tier Gemini structured-output call. Was 25–40s under the old default model; the fast-tier switch made this one of the biggest per-node latency wins in the pipeline.

## Deep dive

Agent-level reference: [`docs/agents/pattern-matcher.md`](../agents/pattern-matcher.md).
