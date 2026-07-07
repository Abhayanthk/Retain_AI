"""
Execution Agent: Unit Economist
=================================
Analyses unit economics implications using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List, Dict, Optional
from pydantic import BaseModel, Field
from app.graph.utils import safe_llm_invoke, build_critic_feedback_block
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState


class StrictTopInterventionUE(BaseModel):
    """Top-ranked intervention — strict: all operational fields required."""
    intervention: str
    target_event: str = Field(description="The specific user event that triggers this intervention (e.g. 'no_login_for_7_days', 'payment_failed', 'session_count_lt_3_by_d14').")
    trigger_window: str = Field(description="When the intervention fires relative to the event (e.g. 'day_8_post_signup', 'within_24h_of_failed_payment').")
    success_metric_formula: str = Field(description="Exact metric definition, e.g. 'd30_retention = returned_d30 / activated_d0' or 'paid_conversion = upgrades / trial_starts'.")
    min_sample_size: int = Field(description="Minimum users per arm for adequate statistical power at 80% / α=0.05.")
    expected_lift_pct_p50: float = Field(description="Median expected lift in retention/conversion percentage points.")
    expected_lift_pct_p90: float = Field(description="P90 (optimistic) expected lift in retention/conversion percentage points.")
    copy_example: str = Field(description="When can_ship is 'No', a complete example of the email/in-app/CSM-script copy. Otherwise 'n/a — product change'.")
    confidence: float
    estimated_cost: str
    cost_usd: float
    expected_roi: float
    rationale: str


class AdditionalInterventionUE(BaseModel):
    """Rank 2+ intervention — operational fields optional (best-effort)."""
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

class ROIProjection(BaseModel):
    year_1_revenue_impact: float
    implementation_cost: float
    roi_percent: float
    payback_months: float

class CACLTVImpact(BaseModel):
    current_ltv: float
    projected_ltv: float
    ltv_improvement_pct: float

class CostEstimate(BaseModel):
    implementation: float
    ongoing_monthly: float
    time_to_value_weeks: float

class TopROIIntervention(BaseModel):
    intervention: str
    expected_roi: float

class UnitEconomistResult(BaseModel):
    top_intervention: StrictTopInterventionUE
    additional_interventions: List[AdditionalInterventionUE] = Field(default_factory=list)
    roi_projections: Dict[str, ROIProjection]
    cac_ltv_impact: CACLTVImpact
    cost_estimates: Dict[str, CostEstimate]
    top_roi_intervention: TopROIIntervention


def run_unit_economist(state: RetentionGraphState) -> dict[str, Any]:
    """Generate strategies optimised for unit economics using Groq."""
    try:
        verified_causes = state.get("verified_root_causes", [])
        constrained_brief = state.get("constrained_brief", {})
        feature_store = state.get("feature_store", {})
        mean_ltv = feature_store.get("ltv_estimates", {}).get("mean_ltv", 1000)
        q = state.get("questionnaire", {})
        hitl_answers = state.get("human_clarification", {}).get("responses", {})
        top_segments = state.get("top_segments", []) or []
        driver_features = (feature_store.get("predictive_churn_risk", {}) or {}).get("driver_features", []) or []

        llm = get_llm("groq", temperature=0.3)

        prompt = ChatPromptTemplate.from_template(
            """You are a Unit Economist. Propose ROI-positive interventions for a {business_model} company facing the churn causes below.

Business context:
- Goal: {top_goal}
- Timeline: {timeline}
- Stage: {stage}
- Revenue model: {revenue_model}
- Support model: {support_model}
- Can ship product changes: {can_ship}
- Already tried: {already_tried}
- Human clarifications: {hitl_answers}

Instructions:
- If timeline is "Quick wins (30 days)", limit to interventions with payback_months <= 1.
- If top_goal is "Increase LTV / expansion", weight expansion-revenue interventions higher.
- If can_ship is "No", exclude any intervention requiring product builds or UI redesigns.
- Do NOT propose tactics already tried.
- Target the highest-impact segment from the table (largest churned-users count = churn_rate * size). Name the segment in rationale.

Output rules (STRICT):
- top_intervention is your highest-ROI bet. It MUST include concrete, non-empty values for:
    target_event, trigger_window, success_metric_formula, min_sample_size,
    expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  When can_ship is "No", copy_example MUST be a real example string (subject + body
  for email, or 1-2 sentences for in-app/CSM script). Otherwise set copy_example to
  "n/a — product change".
- additional_interventions: 2–4 alternatives. Same fields optional but fill what you can.

Verified Causes: {causes}
Mean LTV: ${ltv}

Top Segments (churn × size ranked — your interventions must reference at least one):
{top_segments}

CoxPH Hazard Drivers (quantitative — use to size effect):
{drivers}

Constraints: {constraints}

{critic_feedback}"""
        )

        if top_segments:
            segments_str = "\n".join(
                f"- {s['segment_id']} (size={s['size']}, churn={s['churn_rate']*100:.1f}%, "
                f"retention={s['retention_rate']*100:.1f}%, descriptor='{s['descriptor']}'"
                + (f", dominant_cause='{s['dominant_cause']}'" if s.get('dominant_cause') else '')
                + (", statistically significant" if s.get('significant') else '')
                + ")"
                for s in top_segments
            )
        else:
            segments_str = "(no segment table available — reason about the full user base)"

        if driver_features:
            drivers_str = "\n".join(
                f"- {d['feature']}: HR={d['hazard_ratio']} ({d['direction']}, p={d['p_value']})"
                for d in driver_features
            )
        else:
            drivers_str = "(no quantitative driver features)"

        critic_feedback = build_critic_feedback_block(state, label_singular="intervention")

        response = safe_llm_invoke(
            llm, UnitEconomistResult,
            prompt.format(
                business_model=q.get("business_model", "B2B SaaS"),
                top_goal=q.get("goal", "Reduce churn rate"),
                timeline=q.get("timeline", ""),
                stage=q.get("company_stage", ""),
                revenue_model=q.get("revenue_model", "Unknown"),
                support_model=q.get("support_model", ""),
                can_ship=q.get("can_ship_changes", ""),
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                hitl_answers=json.dumps(hitl_answers) if hitl_answers else "None provided",
                causes=json.dumps(verified_causes),
                ltv=mean_ltv,
                top_segments=segments_str,
                drivers=drivers_str,
                constraints=json.dumps(constrained_brief),
                critic_feedback=critic_feedback,
            ),
            agent_name="UnitEconomist",
        )

        top_dump = response.top_intervention.model_dump()
        top_dump["is_top_ranked"] = True
        additional_dump = [i.model_dump() for i in response.additional_interventions]
        # Flat list — preserves downstream (strategy_merge) shape; top stays at index 0.
        interventions_dump = [top_dump, *additional_dump]

        return {
            "agent": "unit_economist",
            "top_intervention": top_dump,
            "additional_interventions": additional_dump,
            "proposed_interventions": interventions_dump,
            "roi_projections": {k: v.model_dump() for k, v in response.roi_projections.items()},
            "cac_ltv_impact": response.cac_ltv_impact.model_dump(),
            "cost_estimates": {k: v.model_dump() for k, v in response.cost_estimates.items()},
            "top_roi_intervention": response.top_roi_intervention.model_dump(),
            "framework": "Unit Economics / LTV-CAC",
            "confidence": _avg_confidence(interventions_dump),
        }

    except Exception as e:
        return {
            "agent": "unit_economist",
            "error": str(e),
        }


def _avg_confidence(interventions: list) -> float:
    scores = [i.get("confidence", 0) for i in interventions if isinstance(i, dict)]
    return round(sum(scores) / len(scores), 3) if scores else 0.0
