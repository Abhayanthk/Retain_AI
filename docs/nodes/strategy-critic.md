# Node 11 — `strategy_critic`

**File:** [`backend/app/graph/nodes/strategy_critic.py`](../../backend/app/graph/nodes/strategy_critic.py).

Senior-partner review. Combines LLM judgment with hard thresholds + skeptic gates to produce the final approval verdict that gates `execution_architect`.

## Inputs (from state)

| Key | Used for |
|---|---|
| `strategy_outputs.merged_strategies` | Primary input — what's being reviewed. |
| `lift_percent` | Critic's lift threshold (≥8%). |
| `strategy_skeptic_output` | Hard + soft gates. |
| `verified_root_causes` | Each strategy should address one. |
| `constrained_brief` | Constraint-violation check. |
| `human_clarification.responses` | HITL answers fed into prompt. |
| `questionnaire` | `goal`, `timeline`, `can_ship_changes`, `support_model`, `pricing_flexibility`, `retention_tactics`, `priority_segment`. |

## Model

Gemini via `get_llm("gemini", temperature=0.1, model=gemini_model(depth, deep_call=True))` — fast tier (`gemini-3.1-flash-lite`) by default, promotes to the deep tier (`gemini-3.5-flash`) when `questionnaire.analysis_depth == "deep"`. Cold temp — critique should be consistent.

## Output schema

```python
class CriticEvaluation(BaseModel):
    quality_score: float
    strengths: List[str]
    weaknesses: List[str]
    critical_feedback: List[str]
    recommendations: List[str]
    constraint_violations: int
    verdict: Literal["approved", "low_lift", "violation"]
    verdict_reason: str
```

## Verdict logic

LLM returns one of `approved` / `low_lift` / `violation`. Two **hard gates** on top of LLM verdict:

### 1. Skeptic high-severity → forced violation

```python
skeptic_high_severity = [w for w in skeptic_weak if w.get("severity") == "high"]
total_violations = evaluation.constraint_violations + len(skeptic_high_severity)

if total_violations > 0 or llm_verdict == "violation":
    critic_verdict = "violation"
```

Any high-severity weak_point from `strategy_skeptic` is treated as a constraint violation regardless of LLM verdict. Justification: the skeptic catches operational issues (missing copy when `can_ship: "No"`, vague target_event) that the critic's coarser LLM verdict may overlook.

### 2. Quality + lift + robustness thresholds → approved

```python
elif (
    llm_verdict == "approved"
    and quality_score >= 0.55
    and lift_percent >= 8
    and skeptic_robustness >= 0.5
):
    critic_verdict = "approved"
```

All four conditions must hold. `skeptic_robustness < 0.5` is the soft gate — it forces `low_lift` even when LLM said `approved` and lift met threshold.

### Otherwise → low_lift

```python
else:
    critic_verdict = "low_lift"
```

## Prompt — what counts as a violation

Encoded in the LLM prompt:

```
A strategy COUNTS AS A CONSTRAINT VIOLATION when:
- can_ship is "No" and the strategy requires product/eng work
- pricing_flex includes "None — pricing is locked" and strategy proposes discounts or plan changes
- support_model is "Self-serve only" and strategy needs CSM / 1:1 outreach
- strategy duplicates a tactic in already_tried
- strategy ignores the priority_segment
- skeptic flagged any high-severity weak_point (treat as a hard violation)

Verdict rules:
- "violation" if ANY of the above triggers
- "low_lift" if lift < 8% or quality_score < 0.55 or skeptic_robustness < 0.5
- "approved" otherwise
```

The skeptic context is fed in explicitly:

```
## Strategy Skeptic Review (read this FIRST — its weak_points are additional violation triggers)
Headline critique: {skeptic_headline}
Overall robustness (0..1): {skeptic_robustness}
Weak points: {skeptic_weak}
Assumption risks: {skeptic_assumptions}
```

## Merging skeptic weak_points into criticism

```python
merged_weaknesses = list(evaluation.weaknesses or [])
for w in skeptic_weak:
    merged_weaknesses.append(f"[skeptic:{w.severity}] {w.tactic}: {w.weakness}")
```

This propagates through `build_critic_feedback_block` to retry agents' prompts (when retries are enabled).

## Output

```python
{
    "critic_verdict": "approved" | "low_lift" | "violation",
    "iteration_count": int + 1,
    "criticism": {
        "quality_score": float,
        "lift_assessment": f"{lift_percent}% projected lift",
        "constraint_violations": total_violations,
        "critical_feedback": [...],
        "strengths": [...],
        "weaknesses": merged_weaknesses,         # LLM + skeptic
        "recommendations": [...],
        "skeptic_high_severity_count": int,
        "skeptic_robustness": float,
    },
    "feedback": str,                              # verdict_reason
}
```

## Routing

`route_after_strategy_critic`:

```python
if verdict == "approved":
    return "evidence_dossier"
if iterations >= MAX_CRITIC_ITERATIONS:    # currently 0
    return "evidence_dossier"
return "adaptive_hitl"                      # retry loop
```

With `MAX_CRITIC_ITERATIONS = 0` and `iterations` ≥ 1 after this node, **always forwards to evidence_dossier**. The retry-on-violation loop is dormant.

To enable retries, raise the constant. Retry path: `adaptive_hitl` (short-circuits, reuses prior answers) → strategy pod → strategy_merge → strategy_skeptic → simulation → strategy_critic (second pass). Agents see `PRIOR CRITIC FEEDBACK` via `build_critic_feedback_block`.

## Mid-node SSE — critic_retry_started

If a retry will actually fire:

```python
will_retry = critic_verdict != "approved" and iteration_count < MAX_CRITIC_ITERATIONS
if will_retry:
    push_progress(job_id, "critic_retry_started", {
        "iteration", "max", "verdict", "reason", "weak_points_count", "skeptic_flags"
    })
```

Lets the UI show a "retrying — verdict X" banner. Dormant on free tier.

## Failure handling

Try/except. On LLM failure returns `{critic_verdict: "low_lift", criticism: {error}, feedback: f"Critique error: {e}"}`. Routing then forwards to `evidence_dossier` (because iterations >= MAX). The architect runs with an empty critic_feedback section.

## Wall time

10–25 s. Single Gemini structured-output call with a large input prompt.
