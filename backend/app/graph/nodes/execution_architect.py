"""
Node 12: Execution Architect
===============================
Action:  Generate LLM-powered final playbook from real pipeline data
Tools:   Groq LLM (Llama 3.3 70B)
Adds:    final_playbook
"""

from __future__ import annotations

import json
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Union
from datetime import datetime

from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.config import get_llm

class ExecutiveSummary(BaseModel):
    total_problems_identified: int
    total_projected_retention_lift: str
    estimated_timeline: str
    estimated_budget: str
    confidence_level: str

class ProblemDetail(BaseModel):
    title: str
    description: str
    affected_segment: str
    current_impact: str

class SolutionDetail(BaseModel):
    title: str
    description: str
    framework_used: str
    key_actions: List[str]

class RetentionImpact(BaseModel):
    estimated_lift_percent: float
    estimated_users_retained: int
    estimated_revenue_impact: str
    confidence: float
    time_to_impact: str

class ImplementationStep(BaseModel):
    step: int
    action: str
    owner: str
    effort: str
    timeline: str
    deliverable: str
    dependencies: List[str]

class ProblemSolution(BaseModel):
    priority: int
    problem: ProblemDetail
    solution: SolutionDetail
    retention_impact: RetentionImpact
    implementation_steps: List[ImplementationStep]

class PhaseSummary(BaseModel):
    theme: str
    goals: List[str]
    key_milestones: List[str]
    expected_lift: str

class Roadmap(BaseModel):
    phase_1_30_days: PhaseSummary
    phase_2_60_days: PhaseSummary
    phase_3_90_days: PhaseSummary

class SuccessMetric(BaseModel):
    metric: str
    current_value: str
    target_value: str
    measurement_method: str
    review_frequency: str

class RiskMitigation(BaseModel):
    risk: str
    probability: str
    mitigation: str
    contingency: str

class BudgetBreakdown(BaseModel):
    people: str
    technology: str
    marketing: str
    total: str

class ResourceRequirements(BaseModel):
    team: List[str]
    technology: List[str]
    budget_breakdown: BudgetBreakdown

class Playbook(BaseModel):
    model_config = {"populate_by_name": True}
    title: str
    executive_summary: ExecutiveSummary
    problems_and_solutions: List[ProblemSolution]
    roadmap_30_60_90: Roadmap = Field(alias="30_60_90_roadmap")
    success_metrics: List[SuccessMetric]
    risks_and_mitigations: List[RiskMitigation]
    resource_requirements: ResourceRequirements


def execution_architect_node(state: RetentionGraphState) -> dict:
    """Produce the final execution playbook using LLM with real pipeline data."""
    try:
        # ── Gather all real data from the pipeline ───────────────────────
        verified_root_causes = state.get("verified_root_causes", [])
        merged_strategies = state.get("strategy_outputs", {}).get("merged_strategies", [])
        lift_percent = state.get("lift_percent", 0)
        input_context = state.get("input_context", {})
        questionnaire = state.get("questionnaire", {})
        constrained_brief = state.get("constrained_brief", {})
        simulations = state.get("simulations", {})
        criticism = state.get("criticism", {})
        hitl_answers = state.get("human_clarification", {}).get("responses", {})

        # Strategy agent outputs
        economist_output = state.get("unit_economist_output", {})
        jtbd_output = state.get("jtbd_specialist_output", {})
        growth_output = state.get("growth_hacker_output", {})

        llm = get_llm("gemini", temperature=0.3)

        prompt = ChatPromptTemplate.from_template(
            """You are a senior retention strategist creating a final execution playbook for a real company.

## Company Context
Industry: {industry}
Business Model: {business_model}
Company Stage: {company_stage}
Target Churn Rate: {target_churn}
Goal: {goal}

## Operational Constraints (must respect — these are hard limits)
Priority segment: {priority_segment}
Timeline: {timeline}
Can ship product changes: {can_ship}
Support model: {support_model}
Pricing flexibility: {pricing_flex}
Named competitors: {competitors}
Churn destination: {churn_dest}
Already tried (do NOT re-propose): {already_tried}

## Verified Root Causes (from data analysis)
{root_causes}

## Strategies Proposed (from specialist agents)
Unit Economist: {economist}
JTBD Specialist: {jtbd}
Growth Hacker: {growth}

## Merged Strategy Recommendations
{strategies}

## Simulation Results
Projected Lift: {lift}%
Simulations: {simulations}

## Constraints
{constraints}

## Critic Feedback
{criticism}

## Human Clarifications (HITL answers)
{hitl_answers}

---

Based on ALL of the above real data, create a detailed execution playbook.

CRITICAL RULES:
- Each problem MUST address a DIFFERENT root cause. Do NOT create two problems about the same underlying issue.
- If multiple root causes overlap, MERGE them into a single problem with a combined solution.
- Prioritize problems by impact: the problem causing the most churn goes first.
- Solutions must be SPECIFIC to this company's data, not generic advice.
- Reference actual numbers from the data (churn rates, user counts, revenue impact).

CONSTRAINT ENFORCEMENT (violating these makes the playbook unusable):
- If "Can ship product changes" is "No", every action must be doable without engineering (email, campaigns, content, ops, manual outreach only).
- If pricing_flex includes "None — pricing is locked", do not propose discounts, plan changes, or pricing experiments.
- If support_model is "Self-serve only", do not propose CSM motions or 1:1 outreach as a required step.
- If timeline is "Quick wins (30 days)", phase_2 and phase_3 should be lighter; phase_1 carries the bulk of expected_lift.
- NEVER re-propose anything from the Already Tried list.
- Weight the priority_segment in problem.affected_segment for at least the priority-1 problem.

For EACH problem identified:
1. Problem — what specific problem (reference the actual root cause).
2. Solution — how to solve it (reference the actual strategy proposed).
3. Retention Impact — use real numbers from simulation/lift data.
4. Implementation steps — step-by-step plan with effort/owner/timeline/deliverable/dependencies.

Field guidance:
- estimated_timeline: "30/60/90 days" style. estimated_budget: dollar range string.
- confidence_level: "High" / "Medium" / "Low".
- problems_and_solutions: 2–4 distinct problems (priority 1..N).
- solution.framework_used: "Unit Economics" / "JTBD" / "Growth Hacking" / mix.
- retention_impact.confidence in [0, 1]. estimated_lift_percent is numeric (e.g. 5.0, not "5%").
- implementation_steps.effort: "low" / "medium" / "high". timeline: "Week 1–2" style.
- 30_60_90_roadmap: three phases (phase_1_30_days, phase_2_60_days, phase_3_90_days), each with theme, goals (list), key_milestones (list), expected_lift (string with % sign).
- success_metrics: include measurement_method + review_frequency.
- risks_and_mitigations.probability: "low" / "medium" / "high".
- resource_requirements.budget_breakdown: people / technology / marketing / total (all dollar strings).
- Use total_projected_retention_lift = "{lift}%"."""
        )

        root_causes_str = json.dumps(verified_root_causes, indent=2)
        strategies_str = json.dumps(merged_strategies, indent=2)

        competitors_val = questionnaire.get("competitors", [])
        competitors_str = ", ".join(competitors_val) if isinstance(competitors_val, list) else str(competitors_val or "None named")
        response = safe_llm_invoke(
            llm, Playbook,
            prompt.format(
                industry=questionnaire.get("business_context", input_context.get("industry", "Unknown")),
                business_model=questionnaire.get("business_model", "Unknown"),
                company_stage=questionnaire.get("company_stage", "Unknown"),
                target_churn=questionnaire.get("target_churn_rate", "Unknown") or "Unknown",
                goal=questionnaire.get("goal", "Reduce churn"),
                priority_segment=questionnaire.get("priority_segment", "all users"),
                timeline=questionnaire.get("timeline", "Unspecified"),
                can_ship=questionnaire.get("can_ship_changes", "Unknown"),
                support_model=questionnaire.get("support_model", "Unknown"),
                pricing_flex=", ".join(questionnaire.get("pricing_flexibility", [])) or "Unspecified",
                competitors=competitors_str or "None named",
                churn_dest=questionnaire.get("churn_destination", "Unknown"),
                already_tried=", ".join(questionnaire.get("retention_tactics", [])) or "None",
                root_causes=root_causes_str,
                economist=json.dumps(economist_output, indent=2)[:1500],
                jtbd=json.dumps(jtbd_output, indent=2)[:1500],
                growth=json.dumps(growth_output, indent=2)[:1500],
                strategies=strategies_str,
                lift=lift_percent,
                simulations=json.dumps(simulations, indent=2)[:1000] if simulations else "No simulation data",
                constraints=json.dumps(constrained_brief, indent=2)[:1000] if constrained_brief else "No constraints",
                criticism=json.dumps(criticism, indent=2)[:500] if criticism else "No critic feedback",
                hitl_answers=json.dumps(hitl_answers)[:500] if hitl_answers else "None provided",
            ),
            agent_name="ExecutionArchitect",
        )

        playbook = response.model_dump(by_alias=True)

        # ── De-duplicate overlapping problems ────────────────────────────
        problems = playbook.get("problems_and_solutions", [])
        if len(problems) > 1:
            deduped = [problems[0]]
            for p in problems[1:]:
                is_duplicate = False
                p_words = set(p["problem"]["title"].lower().split())
                for existing in deduped:
                    existing_words = set(existing["problem"]["title"].lower().split())
                    # Check word overlap — if >60% similar, it's a duplicate
                    if len(p_words) > 0 and len(existing_words) > 0:
                        overlap = len(p_words & existing_words) / min(len(p_words), len(existing_words))
                        if overlap > 0.6:
                            is_duplicate = True
                            break
                    # Also check if key_actions are >50% identical
                    p_actions = set(a.lower() for a in p.get("solution", {}).get("key_actions", []))
                    e_actions = set(a.lower() for a in existing.get("solution", {}).get("key_actions", []))
                    if len(p_actions) > 0 and len(e_actions) > 0:
                        action_overlap = len(p_actions & e_actions) / min(len(p_actions), len(e_actions))
                        if action_overlap > 0.5:
                            is_duplicate = True
                            break
                if not is_duplicate:
                    deduped.append(p)
            # Re-number priorities
            for i, p in enumerate(deduped):
                p["priority"] = i + 1
            playbook["problems_and_solutions"] = deduped

        # Enrich with metadata
        playbook["created_date"] = datetime.now().isoformat()
        playbook["company"] = input_context.get("industry", "SaaS")
        playbook["estimated_total_lift"] = round(lift_percent, 1)

        return {
            "final_playbook": playbook,
            "playbook_status": "approved_for_execution",
            "current_node": "execution_architect",
        }

    except Exception as e:
        return {
            "final_playbook": {"error": str(e)},
            "playbook_status": "error",
            "errors": [*state.get("errors", []), f"Execution architect error: {str(e)}"],
            "current_node": "execution_architect",
        }
