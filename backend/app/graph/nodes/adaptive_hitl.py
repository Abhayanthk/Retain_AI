"""
Node 8: Adaptive HITL (Human-in-the-Loop)
==========================================
Action:  Generate targeted clarification questions, emit via SSE,
         pause graph until human responds (or 5-min timeout).
Adds:    human_clarification, hitl_questions
"""

from __future__ import annotations

import asyncio
import json
from pydantic import BaseModel, Field
from typing import List

from langchain_core.runnables import RunnableConfig
from langchain_core.prompts import ChatPromptTemplate

from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from app.shared import active_streams

HITL_TIMEOUT_SECONDS = 300


class HitlQuestions(BaseModel):
    questions: List[str] = Field(description="2-3 specific, actionable clarification questions grounded in the data findings.")


async def adaptive_hitl_node(state: RetentionGraphState, config: RunnableConfig) -> dict:
    """Generate clarification questions, push to SSE, wait for human answers."""
    job_id = (config.get("configurable") or {}).get("job_id")
    stream = active_streams.get(job_id) if job_id else None

    try:
        # On critic-retry, reuse prior HITL answers — don't re-prompt the user.
        # Detected via iteration_count: critic_node sets this >= 1 once it has run.
        if state.get("iteration_count", 0) >= 1:
            prior = state.get("human_clarification") or {
                "questions_asked": state.get("hitl_questions", []) or [],
                "responses": {},
                "clarification_status": "skipped_on_retry",
            }
            return {
                "hitl_questions": prior.get("questions_asked", []),
                "human_clarification": prior,
                "current_node": "adaptive_hitl",
            }

        constrained_brief = state.get("constrained_brief", {})
        verified_causes = state.get("verified_root_causes", [])
        applied_constraints = constrained_brief.get("applied_constraints", [])
        q = state.get("questionnaire", {})

        top_goal = q.get("goal", "")
        already_tried = q.get("retention_tactics", [])
        priority_segment = q.get("priority_segment", "")
        competitors = q.get("competitors", [])

        llm = get_llm("gemini", temperature=0.3)

        prompt = ChatPromptTemplate.from_template(
            """You generate targeted clarification questions for a retention analyst.

Data findings:
- Verified root causes: {causes}
- Applied constraints (options already eliminated): {constraints}
- User's stated goal: {top_goal}
- Priority segment: {priority_segment}
- Tactics already tried: {already_tried}
- Named competitors: {competitors}

Rules:
1. Generate exactly 2-3 questions.
2. Each question must reference a specific data finding (e.g. "Your data shows a 30-day activation cliff — did you change your onboarding in the last 6 months?").
3. Ask only about things NOT already answered in the context above.
4. Prefer questions whose answers would change which intervention to prioritize.
5. If competitors are named, ask about them specifically — never ask generically "who are your competitors?".
6. Never ask about budget or pricing if pricing_flexibility is already locked."""
        )

        response = safe_llm_invoke(
            llm, HitlQuestions,
            prompt.format(
                causes=json.dumps([c.get("cause", c) if isinstance(c, dict) else str(c) for c in verified_causes[:4]]),
                constraints=json.dumps(applied_constraints[:3]),
                top_goal=top_goal or "Reduce churn rate",
                priority_segment=priority_segment or "all users",
                already_tried=", ".join(already_tried) if already_tried else "None",
                competitors=", ".join(competitors) if isinstance(competitors, list) else str(competitors or "None named"),
            ),
            agent_name="AdaptiveHITL",
        )

        hitl_questions = response.questions

        # ── Emit questions over SSE and wait for human answers ──────────
        answers = {}
        if stream:
            await stream["queue"].put({
                "type": "hitl_questions_ready",
                "message": "Clarification needed before generating strategies.",
                "data": {"questions": hitl_questions},
            })
            try:
                await asyncio.wait_for(
                    stream["hitl_event"].wait(),
                    timeout=HITL_TIMEOUT_SECONDS,
                )
                answers = stream.get("hitl_answers", {})
            except asyncio.TimeoutError:
                answers = {}

        human_clarification = {
            "questions_asked": hitl_questions,
            "responses": answers,
            "clarification_status": "provided" if answers else "timeout",
        }

        return {
            "hitl_questions": hitl_questions,
            "human_clarification": human_clarification,
            "current_node": "adaptive_hitl",
        }

    except Exception as e:
        return {
            "human_clarification": {
                "questions_asked": [],
                "responses": {},
                "clarification_status": "error",
            },
            "errors": [*state.get("errors", []), f"HITL error: {str(e)}"],
            "current_node": "adaptive_hitl",
        }
