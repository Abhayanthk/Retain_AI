"""
Execution Agent: JTBD Specialist
==================================
Applies Jobs-To-Be-Done framework using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List
from pydantic import BaseModel, Field
from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate


class IdentifiedJob(BaseModel):
    job_type: str
    description: str
    related_cause: str

class SatisfactionGap(BaseModel):
    job: str
    current_satisfaction: float
    target_satisfaction: float
    gap: float

class ProposedIntervention(BaseModel):
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)

class JobPriority(BaseModel):
    job_type: str
    description: str
    priority: int

class JTBDResult(BaseModel):
    identified_jobs: List[IdentifiedJob]
    satisfaction_gaps: List[SatisfactionGap]
    proposed_interventions: List[ProposedIntervention]
    job_priority_ranking: List[JobPriority]


def run_jtbd_specialist(state: RetentionGraphState) -> dict[str, Any]:
    """Generate strategies using the JTBD framework via Groq."""
    try:
        verified_causes = state.get("verified_root_causes", [])
        constrained_brief = state.get("constrained_brief", {})
        q = state.get("questionnaire", {})
        hitl_answers = state.get("human_clarification", {}).get("responses", {})

        llm = get_llm("groq", temperature=0.5)

        prompt = ChatPromptTemplate.from_template(
            """You are a JTBD specialist. Map churn causes to unmet user jobs for a {business_model} company.

Business context:
- Priority segment: {priority_segment}
- Typical customer profile: {typical_customer}
- Industry: {industry}
- Stage: {stage}
- Human clarifications: {hitl_answers}

Instructions:
- Focus identified_jobs on the priority segment.
- If priority_segment contains "Newest customers" or "first 90 days", weight functional onboarding jobs highest.
- If priority_segment is "High-value / enterprise", focus on social and strategic jobs.

For each cause, identify the functional, emotional, and social jobs. Then propose interventions addressing the highest-gap jobs.

Verified Causes: {causes}
Constraints: {constraints}"""
        )

        response = safe_llm_invoke(
            llm, JTBDResult,
            prompt.format(
                business_model=q.get("business_model", "B2B SaaS"),
                priority_segment=q.get("priority_segment", ""),
                typical_customer=q.get("typical_customer", ""),
                industry=q.get("business_context", q.get("industry", "")),
                stage=q.get("company_stage", ""),
                hitl_answers=json.dumps(hitl_answers) if hitl_answers else "None provided",
                causes=json.dumps(verified_causes),
                constraints=json.dumps(constrained_brief),
            ),
            agent_name="JTBDSpecialist",
        )

        interventions_dump = [i.model_dump() for i in response.proposed_interventions]

        return {
            "agent": "jtbd_specialist",
            "identified_jobs": [j.model_dump() for j in response.identified_jobs],
            "satisfaction_gaps": [g.model_dump() for g in response.satisfaction_gaps],
            "proposed_interventions": interventions_dump,
            "job_priority_ranking": [r.model_dump() for r in response.job_priority_ranking],
            "framework": "Jobs-to-be-Done",
            "confidence": _avg_confidence(interventions_dump),
        }

    except Exception as e:
        return {
            "agent": "jtbd_specialist",
            "error": str(e),
        }


def _avg_confidence(items: list) -> float:
    scores = [i.get("confidence", 0) for i in items if isinstance(i, dict)]
    return round(sum(scores) / len(scores), 3) if scores else 0.0
