# Node 9b — `jtbd_specialist`

**File:** [`backend/app/graph/nodes/jtbd_specialist_node.py`](../../backend/app/graph/nodes/jtbd_specialist_node.py) (thin wrapper) → [`backend/app/graph/agents/execution/jtbd_specialist.py`](../../backend/app/graph/agents/execution/jtbd_specialist.py).

Parallel sibling of `unit_economist` and `growth_hacker`. Fan-in at [`strategy_merge`](./strategy-merge.md).

## What it does

Apply the **Jobs-To-Be-Done** framework. For each verified root cause, identify the functional / emotional / social job being underserved, quantify the satisfaction gap, and propose interventions that close it.

## Model

Groq `llama-3.3-70b-versatile` via `get_llm("groq", temperature=0.5)`. Slightly warmer than unit economist — JTBD benefits from qualitative framing.

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Primary input — each cause maps to one or more underserved jobs. |
| `constrained_brief` | Feasibility floor. |
| `top_segments` | Localize identified jobs to specific segments. |
| `questionnaire` | `business_model`, `priority_segment`, `typical_customer`, `industry`, `company_stage`, `can_ship_changes`. |
| `human_clarification.responses` | HITL answers. |
| `criticism` (via `build_critic_feedback_block`) | Retry-pass feedback. |

## Tiered output schema (F6)

Same strict-top / relaxed-rest pattern as unit_economist:

```python
class StrictTopInterventionJTBD(BaseModel):
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)
    target_event: str                    # e.g. "time_to_first_value_gt_3_days"
    trigger_window: str                  # e.g. "first_session", "day_7_post_signup"
    success_metric_formula: str          # e.g. "job_completion_rate = completed / started"
    min_sample_size: int
    expected_lift_pct_p50: float
    expected_lift_pct_p90: float
    copy_example: str
```

## Prompt rules

```
Instructions:
- Focus identified_jobs on the priority segment.
- If priority_segment contains "Newest customers" or "first 90 days", weight functional
  onboarding jobs highest.
- If priority_segment is "High-value / enterprise", focus on social and strategic jobs.
- For each top segment listed, name at least one job that segment is failing to get done.

Output rules (STRICT):
- top_intervention is the single highest-impact JTBD bet. It MUST include concrete,
  non-empty values for target_event, trigger_window, success_metric_formula,
  min_sample_size, expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  If can_ship is "No", copy_example must be real email/in-app/CSM-script content.
```

JTBD is the agent most likely to hallucinate generic-sounding jobs ("users want to feel productive"). The "weight by priority segment" rule + "name at least one job per top segment" rule forces the LLM to anchor on real data.

## Output (state key `jtbd_specialist_output`)

```python
{
    "agent": "jtbd_specialist",
    "identified_jobs": [
        {"job_type": "functional"|"emotional"|"social", "description": str, "related_cause": str},
        ...
    ],
    "satisfaction_gaps": [
        {"job": str, "current_satisfaction": float, "target_satisfaction": float, "gap": float},
        ...
    ],
    "top_intervention": {...StrictTopInterventionJTBD..., "is_top_ranked": True},
    "additional_interventions": [{...AdditionalInterventionJTBD...}, ...],
    "proposed_interventions": [<top>, <additional...>],
    "job_priority_ranking": [{"job_type", "description", "priority"}, ...],
    "framework": "Jobs-to-be-Done",
    "confidence": <avg>,
}
```

## Note on `can_ship` plumbing (F6 fix)

Earlier the JTBD agent didn't see `can_ship` and would propose product-change tactics when the user had marked `can_ship: "No"`. F6 added `can_ship` to the prompt; the copy_example rule then forces real email/CSM copy as the deliverable on no-product-ship runs.

## Failure handling

Try/except. On failure returns `{agent: "jtbd_specialist", error: str(e)}`.

## Wall time

5–10 s.

## Deep dive

Agent-level reference: [`docs/agents/jtbd-specialist.md`](../agents/jtbd-specialist.md).
