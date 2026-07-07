# Node 5d — `diagnosis_merge`

**File:** [`backend/app/graph/nodes/diagnosis_merge.py`](../../backend/app/graph/nodes/diagnosis_merge.py).

Fan-in after the three parallel Discovery Pod nodes (`forensic_detective`, `pattern_matcher`, `competitor_research`). Builds the `diagnosis_results` payload, runs the **Professional Skeptic** inline, and constructs the unified **`top_segments`** table that every downstream strategy agent consumes.

## What it does

1. Run [`professional_skeptic`](../agents/professional-skeptic.md) on the forensic + pattern outputs.
2. Assemble `merged_hypotheses` from the forensic top-3 causes (with their confidence, citations, per-cause RAG evidence).
3. Build `top_segments` — the unified segment table.
4. Increment `discovery_attempts`.

## merged_hypotheses shape

```python
{
    "hypothesis": cause_text,
    "confidence": forensic_conf.get(cause, 0.5),
    "supported_by": ["forensic_detective", "pattern_matcher"],
    "citations": forensic_citations.get(cause, []),
    "evidence_sources": per_cause_evidence.get(cause, []),    # F4 per-cause RAG hits
}
```

Top-3 only — anything beyond rank 3 from the forensic vote is discarded here.

## `top_segments` table (F5)

Built by `_build_top_segments(forensic_output, pattern_output, behavior_cohorts, forensic_causes)`. Combines three sources:

### 1. Forensic stat buckets

Seven bucket families from `forensic_output.statistical_evidence`:

| Bucket | Family label | Descriptor |
|---|---|---|
| `churn_by_channel` | `channel` | `Acquisition channel = <label>` |
| `churn_by_integration` | `integration` | `Integration status = <label>` |
| `churn_by_plan_tier` | `plan_tier` | `Plan tier = <label>` |
| `churn_by_contract` | `contract` | `Contract cadence = <label>` |
| `churn_by_support_volume` | `support` | `Support ticket volume = <label>` |
| `churn_by_usage_decile` | `usage` | `Usage decile = <label>` |
| `churn_rate_by_tenure_bucket` | `tenure` | `Tenure bucket = <label>` |

Each label in a bucket produces a row with `{segment_id: "<family>::<label>", source: <family>, size, retention_rate, churn_rate, descriptor, p_value, significant}` — `p_value`/`significant` are carried straight through from the forensic z-test.

### 2. Pattern matcher segments

From `pattern_output.user_segments`:

```python
{
    "segment_id": f"pattern::{seg.segment_id}",
    "source": "pattern_matcher",
    "label": seg.segment_id,
    "size": seg.size,
    "retention_rate": seg.retention_rate,
    "churn_rate": 1 - seg.retention_rate,
    "descriptor": seg.characteristics,
}
```

### 3. Behavioral tenure cohorts

From `behavior_cohorts` (the `low_tenure` / `medium_tenure` / `high_tenure` rows produced by `behavioral_map`):

```python
{
    "segment_id": f"cohort::{cohort.cohort_id}",
    "source": "behavioral_map",
    "label": cohort.characteristics,
    "size": cohort.size,
    "retention_rate": cohort.retention_rate,
    "churn_rate": 1 - cohort.retention_rate,
    "descriptor": cohort.characteristics,
}
```

### Dominant cause attribution

For each row, do a keyword overlap match against `forensic_causes` and attach the best-matching cause as `dominant_cause`. Best-effort — used as a UI hint, not a strict assertion.

### Ranking + cap

```python
def _impact(r):
    base = r["churn_rate"] * r["size"]
    if r.get("p_value") is not None and not r.get("significant", False):
        return base * 0.6            # demote — z-test failed, likely noise
    return base

rows.sort(key=_impact, reverse=True)
return rows[:8]
```

`churn_rate × size` = lost-users proxy. Stat-bucket rows that failed the z-test are demoted (×0.6, not dropped) before ranking — rows from `pattern_matcher` / behavioral cohorts carry no `p_value` and are unaffected. Top 8 kept.

## Output

```python
{
    "professional_skeptic_output": {...},
    "diagnosis_results": {
        "forensic_findings": <full forensic_detective_output>,
        "pattern_findings": <full pattern_matcher_output>,
        "skeptic_findings": <professional_skeptic_output>,
        "competitor_research": <competitor_research_output>,
        "merged_hypotheses": [{hypothesis, confidence, supported_by, citations, evidence_sources}, ...],
        "highest_confidence": max(forensic_conf.values()),
        "total_patterns_identified": len(pattern_output.patterns_found),
    },
    "top_segments": [...up to 8 rows...],
    "discovery_attempts": int + 1,
    "current_node": "diagnosis_merge",
}
```

## SSE event

`diagnosis_ready`:

```json
{
  "type": "diagnosis_ready",
  "data": {
    "merged_hypotheses": [...],
    "forensic_findings": [...],
    "pattern_findings": [...],
    "skeptic_findings": {...},
    "user_segments": [...],
    "top_segments": [...],
    "driver_features": [...],
    "total_patterns_identified": 7,
    "competitors": [...],
    "churn_destination": "Microsoft Teams",
    "competitor_research": {matched, evidence, counter_positioning}
  }
}
```

Frontend renders `merged_hypotheses` as clickable root-cause cards. Clicking opens the F15 evidence drawer with the per-hypothesis stat / citations / skeptic caveat / alternative / hazard drivers chain.

## Downstream consumers of `top_segments`

| Consumer | How it uses |
|---|---|
| `unit_economist` | Reads top segments into the prompt; intervention must reference at least one. |
| `jtbd_specialist` | Localizes identified jobs to top segments. |
| `growth_hacker` | Sizes A/B sample sizes against top segment `size`. |
| `strategy_skeptic` | Flags tactics that ignore the top segments. |
| `execution_architect` | Renders top segments into the playbook prompt; uses sizes for `estimated_users_retained`. |

## Why this is pure Python (no LLM)

The merge + segment-table build is structural data assembly. The Professional Skeptic call is the LLM step — wrapped in `try/except` so a skeptic failure doesn't block the merge.

## Failure handling

Whole node wrapped in try/except. On failure returns `{diagnosis_results: {error: ...}, top_segments: [], discovery_attempts: count + 1}` and appends to `errors`. Downstream hypothesis_validation will see no merged hypotheses and produce `hypothesis_status: "unverified"`.

## Routing

After this node, `hypothesis_validation` runs. Its conditional edge can route back to `behavioral_map` if `hypothesis_status != "verified"` and `discovery_attempts < MAX_DISCOVERY_ATTEMPTS`. With `MAX_DISCOVERY_ATTEMPTS = 0` on free tier, that loop never fires — diagnosis_merge runs exactly once per pipeline.
