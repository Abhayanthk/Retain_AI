"""
Node 11: Strategy Critic
==========================
Action:  Senior partner review with iteration control
Tools:   Gemini LLM (senior partner persona)
Adds:    critic_verdict, iteration_count, criticism, feedback
"""

from __future__ import annotations

import json
from pydantic import BaseModel, Field
from typing import List, Literal

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.graph.stream_utils import push_progress
from app.graph.conditions import MAX_CRITIC_ITERATIONS
from app.config import get_llm

class CriticEvaluation(BaseModel):
    quality_score: float = Field(description="Score from 0.0 to 1.0 reflecting strategy quality")
    strengths: List[str]
    weaknesses: List[str]
    critical_feedback: List[str]
    recommendations: List[str]
    constraint_violations: int
    verdict: Literal["approved", "low_lift", "violation"]
    verdict_reason: str


def strategy_critic_node(state: RetentionGraphState, config: RunnableConfig) -> dict:
    """Senior-partner-level review of the proposed strategy using LLM."""
    job_id = (config.get("configurable") or {}).get("job_id") if config else None
    try:
        merged_strategies = state.get("strategy_outputs", {}).get("merged_strategies", [])
        lift_percent = state.get("lift_percent", 0)
        iteration_count = state.get("iteration_count", 0) + 1
        constrained_brief = state.get("constrained_brief", {})
        human_feedback = state.get("human_clarification", {}).get("responses", {})
        verified_causes = state.get("verified_root_causes", [])
        skeptic_output = state.get("strategy_skeptic_output", {}) or {}
        q = state.get("questionnaire", {})

        llm = get_llm("gemini", temperature=0.1)

        prompt = ChatPromptTemplate.from_template(
            """You are a senior strategy partner reviewing a retention strategy proposal.

## User Constraints
- Goal: {goal}
- Timeline: {timeline}
- Can ship product changes: {can_ship}
- Support model: {support_model}
- Pricing flexibility: {pricing_flex}
- Already tried: {already_tried}
- Priority segment: {priority_segment}

## Proposed Strategies
{strategies}

## Verified Root Causes
{causes}

## Strategy Skeptic Review (read this FIRST — its weak_points are additional violation triggers)
Headline critique: {skeptic_headline}
Overall robustness (0..1): {skeptic_robustness}
Weak points: {skeptic_weak}
Assumption risks: {skeptic_assumptions}

## Simulation Results
Projected Lift: {lift}%

## Computed Constraints
{constraints}

## Human Feedback (HITL)
{feedback}

Evaluate critically. A strategy COUNTS AS A CONSTRAINT VIOLATION when:
- can_ship is "No" and the strategy requires product/eng work
- pricing_flex includes "None — pricing is locked" and strategy proposes discounts or plan changes
- support_model is "Self-serve only" and strategy needs CSM / 1:1 outreach
- strategy duplicates a tactic in already_tried
- strategy ignores the priority_segment
- skeptic flagged any high-severity weak_point (treat as a hard violation)

Verdict rules:
- "violation" if ANY of the above triggers
- "low_lift" if lift < 8% or quality_score < 0.55 or skeptic_robustness < 0.5
- "approved" otherwise

In `weaknesses` field, MERGE your own findings with the skeptic's high/medium-severity weak_points
(do not lose information — downstream nodes consume `criticism.weaknesses`).
quality_score in [0, 1]. constraint_violations is an integer count."""
        )

        skeptic_weak = skeptic_output.get("weak_points", []) or []
        skeptic_assumptions = skeptic_output.get("assumption_risks", []) or []
        skeptic_robustness = float(skeptic_output.get("overall_robustness", 0.0) or 0.0)
        skeptic_headline = skeptic_output.get("headline_critique", "(none)")

        evaluation = safe_llm_invoke(
            llm, CriticEvaluation,
            prompt.format(
                goal=q.get("goal", "Reduce churn"),
                timeline=q.get("timeline", "Unspecified"),
                can_ship=q.get("can_ship_changes", "Unknown"),
                support_model=q.get("support_model", "Unknown"),
                pricing_flex=", ".join(q.get("pricing_flexibility", [])) or "Unspecified",
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                priority_segment=q.get("priority_segment", "all users"),
                strategies=json.dumps(merged_strategies)[:2000],
                causes=json.dumps(verified_causes)[:1000],
                skeptic_headline=skeptic_headline,
                skeptic_robustness=round(skeptic_robustness, 3),
                skeptic_weak=json.dumps(skeptic_weak)[:1200],
                skeptic_assumptions=json.dumps(skeptic_assumptions)[:800],
                lift=lift_percent,
                constraints=json.dumps(constrained_brief)[:1000],
                feedback=json.dumps(human_feedback)[:500] if human_feedback else "No human feedback",
            ),
            agent_name="StrategyCritic",
        )

        quality_score = evaluation.quality_score
        llm_verdict = evaluation.verdict

        # Hard gate: skeptic high-severity weak_points are violations regardless of LLM verdict.
        skeptic_high_severity = [
            w for w in skeptic_weak
            if isinstance(w, dict) and str(w.get("severity", "")).lower() == "high"
        ]
        total_violations = evaluation.constraint_violations + len(skeptic_high_severity)

        # Determine final verdict (combine LLM verdict with hard thresholds + skeptic gate)
        if total_violations > 0 or llm_verdict == "violation":
            critic_verdict = "violation"
            feedback = (
                evaluation.verdict_reason
                or f"Strategy has constraint violations (incl. {len(skeptic_high_severity)} skeptic flags)."
            )
        elif (
            llm_verdict == "approved"
            and quality_score >= 0.55
            and lift_percent >= 8
            and skeptic_robustness >= 0.5
        ):
            critic_verdict = "approved"
            feedback = evaluation.verdict_reason or "Strategy approved."
        else:
            critic_verdict = "low_lift"
            feedback = (
                evaluation.verdict_reason
                or f"Lift {lift_percent}% below threshold, quality {quality_score}, "
                f"skeptic robustness {round(skeptic_robustness, 2)}."
            )

        # Merge skeptic weak_points into criticism.weaknesses so retry agents see them via
        # build_critic_feedback_block. Preserve LLM weaknesses too.
        merged_weaknesses = list(evaluation.weaknesses or [])
        for w in skeptic_weak:
            if isinstance(w, dict):
                merged_weaknesses.append(
                    f"[skeptic:{w.get('severity', '?')}] {w.get('tactic', '')}: {w.get('weakness', '')}"
                )

        criticism = {
            "quality_score": round(quality_score, 3),
            "lift_assessment": f"{lift_percent}% projected lift",
            "constraint_violations": total_violations,
            "critical_feedback": evaluation.critical_feedback,
            "strengths": evaluation.strengths,
            "weaknesses": merged_weaknesses,
            "recommendations": evaluation.recommendations,
            "skeptic_high_severity_count": len(skeptic_high_severity),
            "skeptic_robustness": round(skeptic_robustness, 3),
        }

        # If the verdict will trigger a retry AND we still have budget, surface that
        # to the UI now — otherwise the strategy stage looks frozen for ~30-60s
        # while three Groq agents re-run silently.
        will_retry = (
            critic_verdict != "approved"
            and iteration_count < MAX_CRITIC_ITERATIONS
        )
        if will_retry:
            push_progress(job_id, "critic_retry_started", {
                "iteration": iteration_count,
                "max": MAX_CRITIC_ITERATIONS,
                "verdict": critic_verdict,
                "reason": feedback[:240] if feedback else "",
                "weak_points_count": len(criticism.get("weaknesses", []) or []),
                "skeptic_flags": criticism.get("skeptic_high_severity_count", 0),
            })

        return {
            "critic_verdict": critic_verdict,
            "iteration_count": iteration_count,
            "criticism": criticism,
            "feedback": feedback,
            "current_node": "strategy_critic",
        }

    except Exception as e:
        return {
            "critic_verdict": "low_lift",
            "iteration_count": state.get("iteration_count", 0) + 1,
            "criticism": {"error": str(e)},
            "feedback": f"Critique error: {str(e)}",
            "errors": [f"Strategy critic error: {str(e)}"],
            "current_node": "strategy_critic",
        }
