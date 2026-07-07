# Agent — JTBD Specialist

**File:** [`backend/app/graph/agents/execution/jtbd_specialist.py`](../../backend/app/graph/agents/execution/jtbd_specialist.py).

Strategy Pod agent. Apply the Jobs-to-be-Done framework: reframe each verified root cause as an underserved functional / emotional / social job; propose interventions that close the satisfaction gap.

For node-level context: [`docs/nodes/jtbd-specialist.md`](../nodes/jtbd-specialist.md).

## Model

| | |
|---|---|
| Provider | Groq |
| Model ID | `openai/gpt-oss-120b` |
| Temp | `0.5` (warmer than unit_economist — JTBD benefits from qualitative framing) |
| Keys | Round-robin via `FailoverLLM` |
| Quirks | Factory auto-applies `reasoning_effort="low"` + `method="json_schema"` for this model. |

## Pydantic schema

```python
class IdentifiedJob(BaseModel):
    job_type: str                    # "functional" | "emotional" | "social"
    description: str
    related_cause: str

class SatisfactionGap(BaseModel):
    job: str
    current_satisfaction: float
    target_satisfaction: float
    gap: float

class StrictTopInterventionJTBD(BaseModel):
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)
    target_event: str                # e.g. "time_to_first_value_gt_3_days"
    trigger_window: str
    success_metric_formula: str      # e.g. "job_completion_rate = completed / started"
    min_sample_size: int
    expected_lift_pct_p50: float
    expected_lift_pct_p90: float
    copy_example: str

class AdditionalInterventionJTBD(BaseModel):
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)
    # ...all F6 fields Optional[...]

class JTBDResult(BaseModel):
    identified_jobs: List[IdentifiedJob]
    satisfaction_gaps: List[SatisfactionGap]
    top_intervention: StrictTopInterventionJTBD
    additional_interventions: List[AdditionalInterventionJTBD] = Field(default_factory=list)
    job_priority_ranking: List[JobPriority]
```

## Public entry point

```python
def run_jtbd_specialist(state: RetentionGraphState) -> dict[str, Any]:
```

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Each cause maps to one or more underserved jobs. |
| `constrained_brief` | Feasibility floor. |
| `top_segments` | Localize identified jobs. |
| `questionnaire` | `business_model`, `priority_segment`, `typical_customer`, `industry`, `company_stage`, `can_ship_changes`, `has_completion_point`. |
| `human_clarification.responses` | HITL answers. |

## Prompt

```
You are a JTBD specialist. Map churn causes to unmet user jobs for a {business_model} company.

Business context:
- Priority segment: {priority_segment}
- Typical customer profile: {typical_customer}
- Industry: {industry}
- Stage: {stage}
- Can ship product changes: {can_ship}
- Product has a natural completion point (job can be "done"): {has_completion_point}
- Human clarifications: {hitl_answers}

Instructions:
- Focus identified_jobs on the priority segment.
- If priority_segment contains "Newest customers" or "first 90 days", weight functional
  onboarding jobs highest.
- If priority_segment is "High-value / enterprise", focus on social and strategic jobs.
- For each top segment listed, name at least one job that segment is failing to get done.
- If the product has a completion point ("Yes"), churn after completion may be healthy —
  separate "job done" churn from failure churn. If "No", frame jobs as ongoing and target
  habit loops.

For each cause, identify the functional, emotional, and social jobs. Then propose
interventions addressing the highest-gap jobs.

Output rules (STRICT):
- top_intervention is the single highest-impact JTBD bet. It MUST include concrete,
  non-empty values for target_event, trigger_window, success_metric_formula,
  min_sample_size, expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  If can_ship is "No", copy_example must be real email/in-app/CSM-script content.
- additional_interventions: 2–4 alternatives. Operational fields optional.

Verified Causes: {causes}

Top Segments (use to localize jobs):
{top_segments}

Constraints: {constraints}

{critic_feedback}
```

### `can_ship` plumbing (F6 fix)

Earlier the JTBD agent didn't see `can_ship` and would propose product-change tactics when the user had marked `can_ship: "No"`. F6 added `can_ship` to the prompt; the copy_example rule then forces real email/CSM copy as the deliverable on no-product-ship runs.

## Output

```python
{
    "agent": "jtbd_specialist",
    "identified_jobs": [{job_type, description, related_cause}, ...],
    "satisfaction_gaps": [{job, current_satisfaction, target_satisfaction, gap}, ...],
    "top_intervention": {...strict..., "is_top_ranked": True},
    "additional_interventions": [{...relaxed...}, ...],
    "proposed_interventions": [<top>, *additional],
    "job_priority_ranking": [{job_type, description, priority}, ...],
    "framework": "Jobs-to-be-Done",
    "confidence": <avg>,
}
```

## Failure handling

```python
except Exception as e:
    return {"agent": "jtbd_specialist", "error": str(e)}
```

## Wall time

~3–5 s.

## Why warmer than unit_economist

Unit economics rewards precision; JTBD rewards qualitative framing of *why* users behave the way they do. Temp 0.5 lets the agent explore emotional/social framings that temp 0.3 would suppress. The strict-tier schema on `top_intervention` keeps the warm output from drifting into vagueness on the deliverable.
