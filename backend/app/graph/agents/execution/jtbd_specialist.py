"""
Execution Agent: JTBD Specialist
==================================
Applies Jobs-To-Be-Done framework using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List, Optional
from pydantic import BaseModel, Field
from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke, build_critic_feedback_block
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

class StrictTopInterventionJTBD(BaseModel):
    """Top-ranked JTBD intervention — strict: all operational fields required."""
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)
    target_event: str = Field(description="The user event signalling the job is failing (e.g. 'time_to_first_value_gt_3_days').")
    trigger_window: str = Field(description="When this intervention fires (e.g. 'first_session', 'day_7_post_signup').")
    success_metric_formula: str = Field(description="Exact metric, e.g. 'job_completion_rate = users_completed_job / users_started_job'.")
    min_sample_size: int = Field(description="Per-arm minimum users for adequate statistical power.")
    expected_lift_pct_p50: float = Field(description="Median expected lift on the success_metric.")
    expected_lift_pct_p90: float = Field(description="P90 (optimistic) expected lift.")
    copy_example: str = Field(description="Required when can_ship is 'No': concrete copy. Else 'n/a — product change'.")

class AdditionalInterventionJTBD(BaseModel):
    """Rank 2+ JTBD intervention — operational fields optional."""
    intervention: str
    job_focus: str
    expected_impact: float
    implementation_effort: str
    confidence: float = Field(default=0.8)
    target_event: Optional[str] = None
    trigger_window: Optional[str] = None
    success_metric_formula: Optional[str] = None
    min_sample_size: Optional[int] = None
    expected_lift_pct_p50: Optional[float] = None
    expected_lift_pct_p90: Optional[float] = None
    copy_example: Optional[str] = None

class JobPriority(BaseModel):
    job_type: str
    description: str
    priority: int

class JTBDResult(BaseModel):
    identified_jobs: List[IdentifiedJob]
    satisfaction_gaps: List[SatisfactionGap]
    top_intervention: StrictTopInterventionJTBD
    additional_interventions: List[AdditionalInterventionJTBD] = Field(default_factory=list)
    job_priority_ranking: List[JobPriority]


def run_jtbd_specialist(state: RetentionGraphState) -> dict[str, Any]:
    """Generate strategies using the JTBD framework via Groq."""
    try:
        verified_causes = state.get("verified_root_causes", [])
        constrained_brief = state.get("constrained_brief", {})
        q = state.get("questionnaire", {})
        hitl_answers = state.get("human_clarification", {}).get("responses", {})
        top_segments = state.get("top_segments", []) or []

        llm = get_llm("groq", temperature=0.5)

        prompt = ChatPromptTemplate.from_template(
            """You are a JTBD specialist. Map churn causes to unmet user jobs for a {business_model} company.

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
- If the product has a completion point ("Yes"), churn after completion may be healthy — separate "job done" churn from failure churn. If "No", frame jobs as ongoing and target habit loops.
- If priority_segment contains "Newest customers" or "first 90 days", weight functional onboarding jobs highest.
- If priority_segment is "High-value / enterprise", focus on social and strategic jobs.
- For each top segment listed, name at least one job that segment is failing to get done.

For each cause, identify the functional, emotional, and social jobs. Then propose interventions addressing the highest-gap jobs.

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

{critic_feedback}"""
        )

        if top_segments:
            segments_str = "\n".join(
                f"- {s['segment_id']} (size={s['size']}, churn={s['churn_rate']*100:.1f}%, "
                f"descriptor='{s['descriptor']}'"
                + (", statistically significant" if s.get('significant') else '')
                + ")"
                for s in top_segments
            )
        else:
            segments_str = "(no segment table available)"

        critic_feedback = build_critic_feedback_block(state, label_singular="intervention")

        response = safe_llm_invoke(
            llm, JTBDResult,
            prompt.format(
                business_model=q.get("business_model", "B2B SaaS"),
                priority_segment=q.get("priority_segment", ""),
                typical_customer=q.get("typical_customer", ""),
                industry=q.get("business_context", q.get("industry", "")),
                stage=q.get("company_stage", ""),
                can_ship=q.get("can_ship_changes", "Unknown"),
                has_completion_point=q.get("has_completion_point", "Unknown"),
                hitl_answers=json.dumps(hitl_answers) if hitl_answers else "None provided",
                causes=json.dumps(verified_causes),
                top_segments=segments_str,
                constraints=json.dumps(constrained_brief),
                critic_feedback=critic_feedback,
            ),
            agent_name="JTBDSpecialist",
        )

        top_dump = response.top_intervention.model_dump()
        top_dump["is_top_ranked"] = True
        additional_dump = [i.model_dump() for i in response.additional_interventions]
        interventions_dump = [top_dump, *additional_dump]

        return {
            "agent": "jtbd_specialist",
            "identified_jobs": [j.model_dump() for j in response.identified_jobs],
            "satisfaction_gaps": [g.model_dump() for g in response.satisfaction_gaps],
            "top_intervention": top_dump,
            "additional_interventions": additional_dump,
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
