"""
Execution Agent: Growth Hacker
================================
Applies growth frameworks and tactics using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List
from pydantic import BaseModel, Field
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState


class ProposedTactic(BaseModel):
    name: str
    description: str
    target_metric: str
    expected_lift: float
    implementation_timeline: str
    confidence: float = Field(default=0.8)

class ExperimentDesign(BaseModel):
    test_name: str
    control: str
    variant: str
    metric: str
    sample_size: int
    duration_days: int

class ActivationImprovement(BaseModel):
    focus: str
    current_step: str
    improvement: str
    estimated_lift: float

class ViralLoop(BaseModel):
    loop: str
    trigger: str
    incentive: str
    estimated_impact: str

class SpeedToImpact(BaseModel):
    quick_wins: List[str]
    medium_term: List[str]
    long_term: List[str]
    prioritization_logic: str

class GrowthHackerResult(BaseModel):
    proposed_tactics: List[ProposedTactic]
    experiment_designs: List[ExperimentDesign]
    activation_improvements: List[ActivationImprovement]
    viral_loops: List[ViralLoop]
    speed_to_impact: SpeedToImpact


def run_growth_hacker(state: RetentionGraphState) -> dict[str, Any]:
    """Generate growth-focused retention strategies using Groq."""
    try:
        verified_causes = state.get("verified_root_causes", [])
        constrained_brief = state.get("constrained_brief", {})
        q = state.get("questionnaire", {})
        hitl_answers = state.get("human_clarification", {}).get("responses", {})
        can_ship = q.get("can_ship_changes", "")
        timeline = q.get("timeline", "")

        llm = get_llm("groq", temperature=0.6)

        prompt = ChatPromptTemplate.from_template(
            """You are a Growth Hacker. Design activation and retention experiments using AARRR for a {business_model} company.

Business context:
- Timeline: {timeline}
- Can ship product changes: {can_ship}
- Priority segment: {priority_segment}
- Already tried: {already_tried}
- Human clarifications: {hitl_answers}

Instructions:
- If can_ship is "No", every proposed_tactic and quick_win must require zero product/engineering changes (email, copy, settings, campaigns only).
- If timeline is "Quick wins (30 days)", populate quick_wins with >= 3 tactics achievable in <= 30 days; set long_term to [].
- If timeline is "6-month strategic shift" or "Long-term", include a rich long_term list.
- Do NOT propose tactics already tried.

Verified Causes of Churn: {causes}
Constraints: {constraints}"""
        )

        response = safe_llm_invoke(
            llm, GrowthHackerResult,
            prompt.format(
                business_model=q.get("business_model", "B2B SaaS"),
                timeline=timeline,
                can_ship=can_ship,
                priority_segment=q.get("priority_segment", ""),
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                hitl_answers=json.dumps(hitl_answers) if hitl_answers else "None provided",
                causes=json.dumps(verified_causes),
                constraints=json.dumps(constrained_brief),
            ),
            agent_name="GrowthHacker",
        )

        tactics_dump = [t.model_dump() for t in response.proposed_tactics]

        return {
            "agent": "growth_hacker",
            "proposed_tactics": tactics_dump,
            "experiment_designs": [e.model_dump() for e in response.experiment_designs],
            "viral_loops": [v.model_dump() for v in response.viral_loops],
            "activation_improvements": [a.model_dump() for a in response.activation_improvements],
            "speed_to_impact": response.speed_to_impact.model_dump(),
            "framework": "Pirate Metrics (AARRR)",
            "confidence": _avg_confidence(tactics_dump),
        }

    except Exception as e:
        return {
            "agent": "growth_hacker",
            "error": str(e),
        }


def _avg_confidence(items: list) -> float:
    scores = [i.get("confidence", 0) for i in items if isinstance(i, dict)]
    return round(sum(scores) / len(scores), 3) if scores else 0.0
