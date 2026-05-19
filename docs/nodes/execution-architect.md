# Node 12 — `execution_architect`

**File:** [`backend/app/graph/nodes/execution_architect.py`](../../backend/app/graph/nodes/execution_architect.py). **Terminal node** (→ END).

Generates the final 30-60-90-day playbook. **Two-pass synthesis (F12):** pass 1 produces a freeform reasoning trace, pass 2 produces the Pydantic-validated playbook conditioned on that trace.

## Why two passes

Single-pass structured output forces the LLM to think and format simultaneously. The reasoning gets compressed, problems get under-justified, and the synthesis suffers. Pass 1 lets the LLM think out loud over the dossier / drivers / sim / constraints at higher temperature; pass 2 then writes the strict Pydantic playbook conditioned on that already-thought-through reasoning at lower temperature. The trace itself is surfaced to the UI under "Why this playbook" (F16).

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Source of problems. |
| `strategy_outputs.merged_strategies` | Source of solutions. |
| `lift_percent` | `executive_summary.total_projected_retention_lift`. |
| `input_context` | `industry`, `business_context`. |
| `questionnaire` | All operational constraints. |
| `constrained_brief` | Feasibility floor. |
| `simulations` | Lift figures + intervention impacts. |
| `criticism` | Critic feedback context. |
| `human_clarification.responses` | HITL answers. |
| `top_segments` | Real segment sizes for `affected_segment` + `estimated_users_retained`. |
| `feature_store.predictive_churn_risk.driver_features` | Hazard ratios for `current_impact`. |
| `evidence_dossier` | Per-problem rationale chains (F11). |
| `competitor_research_output` | Optional competitor counter-positioning context (F14). |
| `unit_economist_output`, `jtbd_specialist_output`, `growth_hacker_output` | Full per-agent context. |

## Pass 1 — reasoning trace (F12)

```python
llm_trace = get_llm("gemini", temperature=0.4)
trace_raw = llm_trace.invoke(trace_prompt.format(...))   # no schema, plain .invoke()
reasoning_trace = extract_llm_text(trace_raw.content)
```

The trace prompt forces a 6-question synthesis over ~450 words:

```
1. Which dossier rows become which playbook problems, and why this rank ordering?
   Reference dossier stat_ids explicitly (e.g. `plan_tier::Starter`).
2. Where do two root causes overlap and need to be merged into one problem?
3. What is the cross-cutting risk that affects more than one problem, and what is the
   single mitigation that addresses it best?
4. How do the operational constraints shape the phase_1/2/3 split — what shifts to
   later phases because of can_ship / pricing / support constraints?
5. Where is the simulation prior weakest (anchor='self_reported' or low confidence),
   and how should you hedge the language for that problem's expected_lift?
6. What is the one piece of evidence you would NOT cite in the playbook because it's
   weak or contradicted upstream?
```

Pass-1 failures are caught — pass 2 still runs with a `(reasoning-trace pass failed: ...)` placeholder.

## Pass 2 — structured playbook

```python
llm_struct = get_llm("gemini", temperature=0.1)
response = safe_llm_invoke(llm_struct, Playbook, prompt.format(..., reasoning_trace=reasoning_trace[:3000]), ...)
```

The structured prompt has a `## Reasoning Trace` section that receives `reasoning_trace[:3000]`. The LLM is told to follow the synthesis it produced in pass 1.

## Pydantic schema

```python
class Playbook(BaseModel):
    title: str
    executive_summary: ExecutiveSummary {
        total_problems_identified: int,
        total_projected_retention_lift: str,
        estimated_timeline: str,
        estimated_budget: str,
        confidence_level: "High" | "Medium" | "Low",
    }
    problems_and_solutions: List[ProblemSolution] {
        priority: int,
        problem: ProblemDetail {title, description, affected_segment, current_impact},
        solution: SolutionDetail {title, description, framework_used, key_actions},
        retention_impact: RetentionImpact {estimated_lift_percent, estimated_users_retained,
                                            estimated_revenue_impact, confidence, time_to_impact},
        implementation_steps: List[ImplementationStep] {step, action, owner, effort, timeline,
                                                          deliverable, dependencies},
    }
    roadmap_30_60_90: Roadmap = Field(alias="30_60_90_roadmap") {
        phase_1_30_days, phase_2_60_days, phase_3_90_days  # each: theme, goals, key_milestones, expected_lift
    }
    success_metrics: List[SuccessMetric] {metric, current_value, target_value,
                                            measurement_method, review_frequency}
    risks_and_mitigations: List[RiskMitigation] {risk, probability, mitigation, contingency}
    resource_requirements: ResourceRequirements {team, technology,
                                                   budget_breakdown: {people, technology, marketing, total}}
```

Note the alias: `roadmap_30_60_90` is the Python field name; `30_60_90_roadmap` is the JSON key. Python identifiers can't start with a digit.

## Constraint enforcement (in prompt)

```
CONSTRAINT ENFORCEMENT (violating these makes the playbook unusable):
- If "Can ship product changes" is "No", every action must be doable without engineering
  (email, campaigns, content, ops, manual outreach only).
- If pricing_flex includes "None — pricing is locked", do not propose discounts, plan
  changes, or pricing experiments.
- If support_model is "Self-serve only", do not propose CSM motions or 1:1 outreach as
  a required step.
- If timeline is "Quick wins (30 days)", phase_2 and phase_3 should be lighter; phase_1
  carries the bulk of expected_lift.
- NEVER re-propose anything from the Already Tried list.
- Weight the priority_segment in problem.affected_segment for at least the priority-1 problem.
```

The skeptic and critic already enforce these upstream — the architect is the last line of defense.

## Dossier mapping (F11)

```
## Evidence Dossier (read this — one row per top problem, pre-assembled reasoning chain)
Each row is: stat → cause → tactic → simulated_outcome → risk → mitigation.
Problem #N in your output MUST correspond to dossier row #N (same rank, same root cause).
Use the dossier `stat` to fill problem.current_impact, the dossier `risk` to fill at least
one risks_and_mitigations entry, and the dossier `mitigation` to fill the corresponding
contingency. The dossier is the source of truth — do not invent risks that aren't here.
```

## De-duplication pass

After Pydantic parse, identical-looking problems are merged:

```python
# Title word overlap > 60% → duplicate
# key_actions overlap > 50% → duplicate
```

Priorities are renumbered after dedupe.

## Rationale chain attach (F11)

```python
for idx, problem in enumerate(problems_after_dedupe):
    if idx < len(evidence_dossier):
        problem["rationale_chain"] = evidence_dossier[idx]
```

Grafted onto the dumped Pydantic dict — Pydantic schema unchanged. The frontend F16 RationaleChainStrip reads this.

## Enrichment

```python
playbook["created_date"] = datetime.now().isoformat()
playbook["company"] = input_context.get("industry", "SaaS")
playbook["estimated_total_lift"] = round(lift_percent, 1)
playbook["reasoning_trace"] = reasoning_trace
```

## Output (state key `final_playbook`)

Full Pydantic dump (with the `30_60_90_roadmap` alias preserved via `by_alias=True`) plus the enrichment + rationale_chain grafts. Also writes `playbook_status: "approved_for_execution"`.

## SSE event

`solution_ready`:

```json
{
  "type": "solution_ready",
  "data": {
    "final_playbook": {...full playbook including reasoning_trace + problems_and_solutions[*].rationale_chain},
    "evidence_dossier": [...]
  }
}
```

Then `complete` is pushed (in `app/main.py`) and the SSE handler tears down.

## Failure handling

Try/except. On either pass failing irrecoverably, returns `{final_playbook: {error: str(e)}, playbook_status: "error"}` and appends to `errors`. SSE handler then emits `solution_ready` with the error blob; frontend shows a retry affordance.

## Wall time

45–80 s. Two Gemini calls + large structured-output schema = dominant cost in the strategy half of the pipeline.

## Why Gemini (not Groq)

Earlier this node ran on Groq Llama 3.3 70B. Switched to Gemini for two reasons:

1. **Pydantic alias support.** Llama via langchain-groq sometimes drops alias names when validating nested models. Gemini handles `Field(alias="30_60_90_roadmap")` cleanly.
2. **Reasoning trace pass.** Pass 1 is freeform prose — Gemini's natural-language quality is noticeably better than Llama's on long structured reasoning.

Both passes share the same `get_llm("gemini")` round-robin key pool.
