"""
Execution Agent: Unit Economist
=================================
Analyses unit economics implications using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List, Dict
from pydantic import BaseModel, Field
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState


class ProposedInterventionUE(BaseModel):
    intervention: str
    confidence: float
    estimated_cost: str
    cost_usd: float
    expected_roi: float
    rationale: str

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
    proposed_interventions: List[ProposedInterventionUE]
    roi_projections: Dict[str, ROIProjection]
    cac_ltv_impact: Dict[str, CACLTVImpact]
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

        llm = get_llm("groq", temperature=0.3)

        prompt = ChatPromptTemplate.from_template(
            """You are a Unit Economist. Propose ROI-positive interventions for a {business_model} company facing the churn causes below.

Business context:
- Goal: {top_goal}
- Timeline: {timeline}
- Stage: {stage}
- Support model: {support_model}
- Can ship product changes: {can_ship}
- Already tried: {already_tried}
- Human clarifications: {hitl_answers}

Instructions:
- If timeline is "Quick wins (30 days)", limit to interventions with payback_months <= 1.
- If top_goal is "Increase LTV / expansion", weight expansion-revenue interventions higher.
- If can_ship is "No", exclude any intervention requiring product builds or UI redesigns.
- Do NOT propose tactics already tried.

Verified Causes: {causes}
Mean LTV: ${ltv}
Constraints: {constraints}"""
        )

        response = safe_llm_invoke(
            llm, UnitEconomistResult,
            prompt.format(
                business_model=q.get("business_model", "B2B SaaS"),
                top_goal=q.get("goal", "Reduce churn rate"),
                timeline=q.get("timeline", ""),
                stage=q.get("company_stage", ""),
                support_model=q.get("support_model", ""),
                can_ship=q.get("can_ship_changes", ""),
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                hitl_answers=json.dumps(hitl_answers) if hitl_answers else "None provided",
                causes=json.dumps(verified_causes),
                ltv=mean_ltv,
                constraints=json.dumps(constrained_brief),
            ),
            agent_name="UnitEconomist",
        )

        interventions_dump = [i.model_dump() for i in response.proposed_interventions]

        return {
            "agent": "unit_economist",
            "proposed_interventions": interventions_dump,
            "roi_projections": {k: v.model_dump() for k, v in response.roi_projections.items()},
            "cac_ltv_impact": {k: v.model_dump() for k, v in response.cac_ltv_impact.items()},
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
