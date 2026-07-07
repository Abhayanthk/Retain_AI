"""
Execution Agent: Growth Hacker
================================
Applies growth frameworks and tactics using Groq (Llama-3).
Called by: strategy_pod_node
"""

from __future__ import annotations

import json
from typing import Any, List, Optional
from pydantic import BaseModel, Field
from app.graph.utils import safe_llm_invoke, build_critic_feedback_block
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState


class StrictTopTactic(BaseModel):
    """Top-ranked growth tactic — strict: all operational fields required."""
    name: str
    description: str
    target_metric: str
    expected_lift: float
    implementation_timeline: str
    confidence: float = Field(default=0.8)
    target_event: str = Field(description="Specific user event triggering this tactic (e.g. 'no_login_d3', 'activation_step_2_drop').")
    trigger_window: str = Field(description="When tactic fires, e.g. 'within 24h of trigger event'.")
    success_metric_formula: str = Field(description="Exact metric definition, e.g. 'd14_retention = returned_d14 / signups'.")
    min_sample_size: int = Field(description="Per-arm users needed for adequate statistical power.")
    expected_lift_pct_p50: float = Field(description="Median expected lift in pp on the target metric.")
    expected_lift_pct_p90: float = Field(description="P90 (optimistic) expected lift in pp.")
    copy_example: str = Field(description="When can_ship is 'No': real email/in-app/CSM copy. Else 'n/a — product change'.")


class AdditionalTactic(BaseModel):
    """Rank 2+ growth tactic — operational fields optional."""
    name: str
    description: str
    target_metric: str
    expected_lift: float
    implementation_timeline: str
    confidence: float = Field(default=0.8)
    target_event: Optional[str] = None
    trigger_window: Optional[str] = None
    success_metric_formula: Optional[str] = None
    min_sample_size: Optional[int] = None
    expected_lift_pct_p50: Optional[float] = None
    expected_lift_pct_p90: Optional[float] = None
    copy_example: Optional[str] = None

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
    top_tactic: StrictTopTactic
    additional_tactics: List[AdditionalTactic] = Field(default_factory=list)
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
        top_segments = state.get("top_segments", []) or []
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
- If can_ship is "No", every tactic and quick_win must require zero product/engineering changes (email, copy, settings, campaigns only).
- If timeline is "Quick wins (30 days)", populate quick_wins with >= 3 tactics achievable in <= 30 days; set long_term to [].
- If timeline is "6-month strategic shift" or "Long-term", include a rich long_term list.
- Do NOT propose tactics already tried.
- For each top segment, design at least one experiment targeted at that segment specifically (trigger uses segment definition, sample size uses segment size).

Output rules (STRICT):
- top_tactic is your single highest-lift bet. It MUST include concrete, non-empty
  values for target_event, trigger_window, success_metric_formula, min_sample_size,
  expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  If can_ship is "No", copy_example must be real, ready-to-send copy.
- additional_tactics: 2–4 alternatives. Operational fields optional.

Verified Causes of Churn: {causes}

Top Segments (use real sizes to size A/B sample needs):
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

        critic_feedback = build_critic_feedback_block(state, label_singular="tactic")

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
                top_segments=segments_str,
                constraints=json.dumps(constrained_brief),
                critic_feedback=critic_feedback,
            ),
            agent_name="GrowthHacker",
        )

        top_dump = response.top_tactic.model_dump()
        top_dump["is_top_ranked"] = True
        additional_dump = [t.model_dump() for t in response.additional_tactics]
        tactics_dump = [top_dump, *additional_dump]

        return {
            "agent": "growth_hacker",
            "top_tactic": top_dump,
            "additional_tactics": additional_dump,
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
