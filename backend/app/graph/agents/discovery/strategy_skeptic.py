"""
Discovery Agent: Strategy Skeptic
====================================
Adversarial review of proposed strategies — surfaces weak_points,
hidden assumptions, and alternative tactics BEFORE simulation/critic.
Called by: strategy_skeptic_node (between strategy_merge and simulation).
"""

from __future__ import annotations

import json
from typing import Any, List, Dict
from pydantic import BaseModel, Field
from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate


class WeakPoint(BaseModel):
    tactic: str = Field(description="The strategy recommendation being challenged.")
    weakness: str = Field(description="Specific flaw — vague target_event, untestable metric, ignores priority segment, etc.")
    severity: str = Field(description="'low' | 'medium' | 'high'.")


class AssumptionRisk(BaseModel):
    assumption: str = Field(description="Implicit assumption the tactic depends on.")
    why_risky: str = Field(description="Why this assumption may not hold for THIS dataset.")
    mitigation: str = Field(description="Concrete test or change that would de-risk it.")


class AlternativeTactic(BaseModel):
    instead_of: str = Field(description="Original tactic being replaced.")
    alternative: str = Field(description="Stronger alternative grounded in the same root cause.")
    why_better: str = Field(description="Specific reason — better evidence, faster payback, addresses bigger segment.")


class StrategySkepticResult(BaseModel):
    weak_points: List[WeakPoint]
    assumption_risks: List[AssumptionRisk]
    alternative_tactics: List[AlternativeTactic]
    overall_robustness: float = Field(description="0..1 — combined confidence the strategy set will actually move the needle.")
    headline_critique: str = Field(description="One-sentence verdict for the critic to read.")


def run_strategy_skeptic(state: RetentionGraphState) -> dict[str, Any]:
    """Adversarial review of merged_strategies. Output consumed by strategy_critic."""
    try:
        strategy_outputs = state.get("strategy_outputs", {}) or {}
        merged_strategies = strategy_outputs.get("merged_strategies", []) or []
        verified_causes = state.get("verified_root_causes", []) or []
        top_segments = state.get("top_segments", []) or []
        q = state.get("questionnaire", {}) or {}
        constrained_brief = state.get("constrained_brief", {}) or {}

        if not merged_strategies:
            return {
                "agent": "strategy_skeptic",
                "weak_points": [{
                    "tactic": "(no strategies)",
                    "weakness": "Strategy merge produced no recommendations — upstream agent failure.",
                    "severity": "high",
                }],
                "assumption_risks": [],
                "alternative_tactics": [],
                "overall_robustness": 0.0,
                "headline_critique": "No strategies to evaluate.",
            }

        llm = get_llm("gemini", temperature=0.4)

        prompt = ChatPromptTemplate.from_template(
            """You are a Strategy Skeptic — an adversarial reviewer hired to break weak strategies BEFORE they ship.
Your job is to challenge the proposed strategies against the actual data and constraints,
NOT to produce them. Be specific. Generic doubt is useless.

## Hard constraints (a tactic that violates these is automatically a high-severity weak_point)
- Priority segment: {priority_segment}
- Timeline: {timeline}
- Can ship product changes: {can_ship}
- Support model: {support_model}
- Pricing flexibility: {pricing_flex}
- Already tried (re-proposing = automatic weak_point): {already_tried}

## Verified Root Causes
{causes}

## Top Segments (size + churn — strategies should target these)
{top_segments}

## Proposed Strategies (review these one by one)
{strategies}

For EACH strategy that has issues, produce at least one WeakPoint. Look for:
- Missing or vague target_event / trigger_window / success_metric_formula.
- expected_lift_pct numbers that wildly diverge from typical SaaS retention lifts (>30 pp on a single tactic is almost always overclaimed).
- Tactics that ignore the priority_segment or top_segments table.
- Tactics that quietly require product/eng work when can_ship is "No".
- Tactics that quietly require CSM motions when support_model is self-serve.
- Tactics that re-tread already-tried items.
- A min_sample_size that's bigger than the entire targeted segment.
- copy_example missing or filler ("TBD", "n/a") when can_ship is "No".

For assumption_risks, surface implicit dependencies (e.g. "assumes day-1 push notifications drive day-7 retention — has not been shown for this audience").

For alternative_tactics, propose 1-3 concrete swaps (one per the weakest proposed strategies). Each must:
- Target the same root cause.
- Be MORE evidence-grounded or operationally cheaper than the original.

Constraints on output values:
- severity: "low" | "medium" | "high".
- overall_robustness in [0.0, 1.0]. < 0.55 means "do not ship without changes".
"""
        )

        response = safe_llm_invoke(
            llm, StrategySkepticResult,
            prompt.format(
                priority_segment=q.get("priority_segment", "all users"),
                timeline=q.get("timeline", "Unspecified"),
                can_ship=q.get("can_ship_changes", "Unknown"),
                support_model=q.get("support_model", "Unknown"),
                pricing_flex=", ".join(q.get("pricing_flexibility", [])) or "Unspecified",
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                causes=json.dumps(verified_causes, indent=2)[:1200],
                top_segments=json.dumps(top_segments, indent=2)[:1200],
                strategies=json.dumps(merged_strategies, indent=2)[:2000],
            ),
            agent_name="StrategySkeptic",
        )

        return {
            "agent": "strategy_skeptic",
            "weak_points": [w.model_dump() for w in response.weak_points],
            "assumption_risks": [r.model_dump() for r in response.assumption_risks],
            "alternative_tactics": [a.model_dump() for a in response.alternative_tactics],
            "overall_robustness": round(float(response.overall_robustness), 3),
            "headline_critique": response.headline_critique,
        }

    except Exception as e:
        return {
            "agent": "strategy_skeptic",
            "error": str(e),
            "weak_points": [],
            "assumption_risks": [],
            "alternative_tactics": [],
            "overall_robustness": 0.0,
            "headline_critique": f"Skeptic error: {e}",
        }
