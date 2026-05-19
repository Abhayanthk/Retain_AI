# Agent — Unit Economist

**File:** [`backend/app/graph/agents/execution/unit_economist.py`](../../backend/app/graph/agents/execution/unit_economist.py).

Strategy Pod agent. Apply LTV/CAC lens to each verified root cause; propose ROI-positive interventions with strict operational fields on the top-ranked one.

For node-level context: [`docs/nodes/unit-economist.md`](../nodes/unit-economist.md).

## Model

| | |
|---|---|
| Provider | Groq |
| Model ID | `llama-3.3-70b-versatile` |
| Temp | `0.3` (coldest strategy agent — unit economics rewards precision) |
| Keys | Round-robin via `FailoverLLM` across all `GROQ_API_KEY[_N]` |

## Tiered Pydantic schema (F6)

```python
class StrictTopInterventionUE(BaseModel):
    """Top-ranked — all operational fields REQUIRED."""
    intervention: str
    target_event: str                  # e.g. "no_login_for_7_days", "payment_failed"
    trigger_window: str                # e.g. "day_8_post_signup"
    success_metric_formula: str        # e.g. "d30_retention = returned_d30 / activated_d0"
    min_sample_size: int               # per-arm at 80% power, α=0.05
    expected_lift_pct_p50: float
    expected_lift_pct_p90: float
    copy_example: str                  # real copy when can_ship='No', else 'n/a — product change'
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
    trigger_window: Optional[str] = None
    success_metric_formula: Optional[str] = None
    min_sample_size: Optional[int] = None
    expected_lift_pct_p50: Optional[float] = None
    expected_lift_pct_p90: Optional[float] = None
    copy_example: Optional[str] = None

class UnitEconomistResult(BaseModel):
    top_intervention: StrictTopInterventionUE
    additional_interventions: List[AdditionalInterventionUE] = Field(default_factory=list)
    roi_projections: Dict[str, ROIProjection]
    cac_ltv_impact: CACLTVImpact
    cost_estimates: Dict[str, CostEstimate]
    top_roi_intervention: TopROIIntervention
```

### Why tiered

Forcing all 7 F6 operational fields on 4 alternatives = wasted output budget. The architect only consumes the top intervention's operational details (via `merged_strategies[0]` and the evidence dossier). Alternatives carry the cheaper fields (cost, ROI, confidence) that critic and architect use for context but not for execution.

## Public entry point

```python
def run_unit_economist(state: RetentionGraphState) -> dict[str, Any]:
```

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Each cause becomes a candidate intervention. |
| `constrained_brief` | Feasibility floor. |
| `feature_store.ltv_estimates.mean_ltv` | Anchors ROI math; defaults to `1000` if absent. |
| `feature_store.predictive_churn_risk.driver_features` | Sizing effects with HR. |
| `top_segments` | Strategies MUST reference at least one (the highest churn×size). |
| `questionnaire` | `business_model`, `goal`, `timeline`, `company_stage`, `support_model`, `can_ship_changes`, `retention_tactics`. |
| `human_clarification.responses` | HITL answers. |
| `criticism` (via `build_critic_feedback_block`) | Retry-pass feedback (dormant on free tier). |

## Output

```python
{
    "agent": "unit_economist",
    "top_intervention": {...StrictTopInterventionUE..., "is_top_ranked": True},
    "additional_interventions": [{...AdditionalInterventionUE...}, ...],
    "proposed_interventions": [<top_dump>, *additional_dumps],   # flat, backwards-compat
    "roi_projections": {cause: {year_1_revenue_impact, implementation_cost, roi_percent, payback_months}},
    "cac_ltv_impact": {current_ltv, projected_ltv, ltv_improvement_pct},
    "cost_estimates": {cause: {implementation, ongoing_monthly, time_to_value_weeks}},
    "top_roi_intervention": {intervention, expected_roi},
    "framework": "Unit Economics / LTV-CAC",
    "confidence": <avg of intervention confidences>,
}
```

`proposed_interventions` is a flat list with the strict top at index 0 (carrying `is_top_ranked: True`). This shape lets `strategy_merge` and any other consumer reading flat lists keep working unchanged.

## Failure handling

```python
except Exception as e:
    return {"agent": "unit_economist", "error": str(e)}
```

`strategy_merge` then drops this agent's row from `merged_strategies`. The other two agents still contribute.

## Wall time

5–10 s. Groq Llama 3.3 70B is fast on structured output. Bottleneck is input prompt size — `verified_root_causes` + `constrained_brief` + `top_segments` together can run 2–3 kB.

## Why Groq (not Gemini)

The three strategy agents historically ran on Groq because their structured output is more deterministic on Llama than on Gemini. The architect was moved to Gemini for the F12 two-pass reasoning trace, but the strategy agents kept Groq for speed.
