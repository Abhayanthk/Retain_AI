# Node 9a — `unit_economist`

**File:** [`backend/app/graph/nodes/unit_economist_node.py`](../../backend/app/graph/nodes/unit_economist_node.py) (thin wrapper) → [`backend/app/graph/agents/execution/unit_economist.py`](../../backend/app/graph/agents/execution/unit_economist.py).

One of three strategy agents running in parallel after `adaptive_hitl`. Fan-in at [`strategy_merge`](./strategy-merge.md).

## What it does

Apply an LTV/CAC lens: propose ROI-positive interventions for each verified root cause. Optimized for payback speed and revenue impact.

## Model

Groq `llama-3.3-70b-versatile` via `get_llm("groq", temperature=0.3)`. Coldest of the strategy agents — unit economics rewards precision over creativity.

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Primary input — strategies must address one. |
| `constrained_brief` | JSON-dumped into prompt. Feasibility hard-floor. |
| `feature_store.ltv_estimates.mean_ltv` | Anchors ROI math. |
| `feature_store.predictive_churn_risk.driver_features` | Top-5 hazard ratios — used to size effect. |
| `top_segments` | Strategies MUST reference at least one. |
| `questionnaire` | `business_model`, `goal`, `timeline`, `company_stage`, `support_model`, `can_ship_changes`, `retention_tactics`. |
| `human_clarification.responses` | HITL answers, JSON-dumped. |
| `criticism` (via `build_critic_feedback_block`) | On retry: prior critic verdict + weaknesses surface in `{critic_feedback}` placeholder. |

## Tiered output schema (F6)

Two tiers in the Pydantic schema:

```python
class StrictTopInterventionUE(BaseModel):
    """Top-ranked intervention — strict: all operational fields required."""
    intervention: str
    target_event: str                  # e.g. "no_login_for_7_days"
    trigger_window: str                # e.g. "day_8_post_signup"
    success_metric_formula: str        # e.g. "d30_retention = returned_d30 / activated_d0"
    min_sample_size: int               # per-arm for 80% power at α=0.05
    expected_lift_pct_p50: float       # median expected lift in pp
    expected_lift_pct_p90: float       # P90 (optimistic) lift in pp
    copy_example: str                  # real copy when can_ship == "No", else "n/a — product change"
    confidence: float
    estimated_cost: str
    cost_usd: float
    expected_roi: float
    rationale: str

class AdditionalInterventionUE(BaseModel):
    """Rank 2+ — operational fields all Optional[...]."""
    intervention: str
    confidence: float
    estimated_cost: str
    cost_usd: float
    expected_roi: float
    rationale: str
    target_event: Optional[str] = None
    # ...all F6 fields optional
```

Strict tier on the **top** intervention forces the LLM to commit to a specific event / metric / sample size / copy. Lighter tier on alternatives because requiring 4 fully-operational tactics with real copy is wasted output budget — the architect only consumes the top.

## Prompt rules

```
Instructions:
- If timeline is "Quick wins (30 days)", limit to interventions with payback_months <= 1.
- If top_goal is "Increase LTV / expansion", weight expansion-revenue interventions higher.
- If can_ship is "No", exclude any intervention requiring product builds or UI redesigns.
- Do NOT propose tactics already tried.
- Target the highest-impact segment from the table (largest churned-users count = churn_rate * size).
  Name the segment in rationale.

Output rules (STRICT):
- top_intervention is your highest-ROI bet. It MUST include concrete, non-empty values for:
    target_event, trigger_window, success_metric_formula, min_sample_size,
    expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  When can_ship is "No", copy_example MUST be a real example string (subject + body
  for email, or 1-2 sentences for in-app/CSM script). Otherwise set copy_example to
  "n/a — product change".
- additional_interventions: 2–4 alternatives. Same fields optional but fill what you can.
```

## Output (state key `unit_economist_output`)

```python
{
    "agent": "unit_economist",
    "top_intervention": {
        ...all StrictTopInterventionUE fields...,
        "is_top_ranked": True,
    },
    "additional_interventions": [{...AdditionalInterventionUE...}, ...],
    "proposed_interventions": [<top>, <additional...>],         # flat — backwards compat
    "roi_projections": {cause: {year_1_revenue_impact, implementation_cost, roi_percent, payback_months}},
    "cac_ltv_impact": {current_ltv, projected_ltv, ltv_improvement_pct},
    "cost_estimates": {cause: {implementation, ongoing_monthly, time_to_value_weeks}},
    "top_roi_intervention": {intervention, expected_roi},
    "framework": "Unit Economics / LTV-CAC",
    "confidence": <avg of intervention confidences>,
}
```

`proposed_interventions` is a flat list with `top_intervention` at index 0 (carrying `is_top_ranked: True`). This shape preserves backwards compatibility for any downstream consumer that hasn't migrated to reading `top_intervention` directly.

## Critic feedback block (F8)

```python
critic_feedback = build_critic_feedback_block(state, label_singular="intervention")
```

On the first pass returns `""`. On retry returns a prompt-embedded block:

```
── PRIOR CRITIC FEEDBACK (this is retry pass 1 — REVISE, do not repeat) ──
Critic verdict: violation
Verdict reason: ...
Weaknesses to fix: [...]
Required improvements: [...]
Prior intervention that was rejected: [...]
Your output must materially differ from the rejected intervention and explicitly address each weakness above.
```

Currently dormant — `MAX_CRITIC_ITERATIONS = 0` on Render free tier means no retry ever fires. Active when raised.

## Failure handling

Try/except. On failure returns `{agent: "unit_economist", error: str(e)}`. `strategy_merge` then skips this agent's contribution but still produces output from the other two.

## Wall time

5–10 s. Groq Llama 3.3 70B is fast on structured output.

## Deep dive

Agent-level reference: [`docs/agents/unit-economist.md`](../agents/unit-economist.md).
