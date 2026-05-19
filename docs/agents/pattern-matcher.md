# Agent — Pattern Matcher

**File:** [`backend/app/graph/agents/discovery/pattern_matcher.py`](../../backend/app/graph/agents/discovery/pattern_matcher.py).

Discovery Pod agent. LLM-only — reads `feature_store`, `behavior_cohorts`, and CoxPH `driver_features`, then identifies high-risk segments + churn sequences. No RAG, no self-consistency.

For node-level context: [`docs/nodes/pattern-matcher.md`](../nodes/pattern-matcher.md).

## Model

| | |
|---|---|
| Provider | Google Gemini |
| Model ID | `gemini-3-flash-preview` |
| Temp | `0.2` |
| Keys | Round-robin via `FailoverLLM` |

## Pydantic schema

```python
class PatternDef(BaseModel):
    pattern: str
    churn_risk: str          # "low" | "medium" | "high"
    affected_users: int
    description: str

class UserSegment(BaseModel):
    segment_id: str
    size: int
    retention_rate: float
    characteristics: str

class TopicCluster(BaseModel):
    topic: str
    cluster_size: int

class ChurnSequence(BaseModel):
    sequence: str
    probability: float

class PatternMatcherResult(BaseModel):
    patterns_found: List[PatternDef]
    user_segments: List[UserSegment]
    topic_clusters: List[TopicCluster]
    churn_sequences: List[ChurnSequence]
    pattern_confidence: float
```

## Public entry point

```python
def run_pattern_matcher(state: RetentionGraphState) -> dict[str, Any]:
```

## Inputs (from state)

| Key | Used for |
|---|---|
| `feature_store` | RFM / velocity / LTV / engagement_cohorts / predictive_churn_risk (JSON-dumped into prompt). |
| `feature_store.predictive_churn_risk.driver_features` | Top-5 hazard ratios — segment names should reference these. |
| `behavior_cohorts` | Tenure-quartile cohorts (JSON-dumped). |
| `questionnaire` | `business_model`, `priority_segment`, `typical_customer`. |

## Prompt

```
Analyze these user behavior cohorts and features to identify recurring churn patterns
and segments for a {business_model} company.

Business context:
- Priority segment: {priority_segment}
- Typical customer: {typical_customer}

Behavior Cohorts: {cohorts}
Feature Store Data: {features}

CoxPH Hazard Drivers (use feature names below as anchors for patterns and segment definitions):
{drivers}

Identify:
1. High-risk user segments — bias toward the priority segment if signals match.
   Each segment_id should reference the actual data driver (e.g. "low_integration_b2b"
   not "Segment A").
2. Feature-based patterns (specific feature adoption gaps tied to hazard ratios above).
3. Common churn sequences (steps users take before leaving), ordered.
4. pattern_confidence in [0, 1].
```

The "segment_id should reference the actual data driver" rule prevents generic alphabetical naming. Anchoring on `driver_features` keeps segments grounded in CoxPH-identified hazards rather than imagined cohorts.

## Output

```python
{
    "agent": "pattern_matcher",
    "patterns_found": [{pattern, churn_risk, affected_users, description}, ...],
    "user_segments": [{segment_id, size, retention_rate, characteristics}, ...],
    "topic_clusters": [{topic, cluster_size}, ...],
    "churn_sequences": [{sequence, probability}, ...],
    "pattern_confidence": float,
}
```

## Failure handling

```python
except Exception as e:
    return {"agent": "pattern_matcher", "error": str(e)}
```

Diagnosis_merge still proceeds — `top_segments` will be built from forensic stat buckets + behavioral cohorts only (pattern's `user_segments` contribution is empty). `total_patterns_identified` drops to 0. Professional skeptic has less to cross-check.

## Wall time

25–40 s. Single Gemini structured-output call with large input (JSON-dumped `feature_store` can be 1–2 kB).

## Why no RAG / no self-consistency

- **No RAG:** the forensic agent already pulls retention frameworks. Duplicating retrieval here would send the same chunks against a similar prompt with no added signal.
- **No self-consistency:** pattern outputs are descriptive (segments + sequences), not causal claims. Voting over 3 runs would mostly average phrasing differences. Single call at low temp is sufficient — the downstream Professional Skeptic stress-tests these patterns separately.
