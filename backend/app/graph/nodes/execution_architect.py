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
from app.graph.utils import safe_llm_invoke, extract_llm_text
from app.config import get_llm, gemini_model

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
        top_segments = state.get("top_segments", []) or []
        feature_store_for_drivers = state.get("feature_store", {}) or {}
        driver_features = (feature_store_for_drivers.get("predictive_churn_risk", {}) or {}).get("driver_features", []) or []
        evidence_dossier = state.get("evidence_dossier", []) or []
        competitor_research = state.get("competitor_research_output", {}) or {}

        # Strategy agent outputs
        economist_output = state.get("unit_economist_output", {})
        jtbd_output = state.get("jtbd_specialist_output", {})
        growth_output = state.get("growth_hacker_output", {})

        # F12: two-pass synthesis. Pass 1 generates a freeform reasoning trace at
        # higher temp; pass 2 (lower temp, structured) consumes that trace to
        # produce the final Pydantic-validated playbook.
        # Depth mode: quick skips pass 1 entirely and runs pass 2 on the fast
        # model; deep runs both passes on the deep model.
        depth = questionnaire.get("analysis_depth")
        is_deep = (depth or "").strip().lower() == "deep"
        arch_model = gemini_model(depth, deep_call=True)
        llm_trace = get_llm("gemini", model=arch_model, temperature=0.4)
        llm_struct = get_llm("gemini", model=arch_model, temperature=0.1)

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

## Analyst Notes (from the company — ground-truth caveats; the playbook must not contradict these)
{edge_cases}

## Verified Root Causes (from data analysis)
{root_causes}

## Top Segments (real sizes — use for affected_segment + estimated_users_retained)
{top_segments}

## CoxPH Hazard Drivers (quantitative — cite hazard ratio in current_impact)
{drivers}

## Strategies Proposed (from specialist agents)
Unit Economist: {economist}
JTBD Specialist: {jtbd}
Growth Hacker: {growth}

## Merged Strategy Recommendations
{strategies}

## Competitor Research (only present when churn_destination is a known competitor)
{competitor_research}

## Evidence Dossier (read this — one row per top problem, pre-assembled reasoning chain)
Each row is: stat → cause → tactic → simulated_outcome → risk → mitigation.
Problem #N in your output MUST correspond to dossier row #N (same rank, same root cause).
Use the dossier `stat` to fill problem.current_impact, the dossier `risk` to fill at least
one risks_and_mitigations entry, and the dossier `mitigation` to fill the corresponding
contingency. The dossier is the source of truth — do not invent risks that aren't here.

{dossier}

## Simulation Results
Projected Lift: {lift}%
Simulations: {simulations}

## Constraints
{constraints}

## Critic Feedback
{criticism}

## Human Clarifications (HITL answers)
{hitl_answers}

## Reasoning Trace (from your own pass-1 thinking — follow this synthesis)
{reasoning_trace}

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

        root_causes_str = json.dumps(verified_root_causes)
        strategies_str = json.dumps(merged_strategies)
        dossier_str = (
            json.dumps(evidence_dossier)[:2500]
            if evidence_dossier
            else "(no dossier — fall back to root_causes + strategies)"
        )
        edge_cases_str = " | ".join(str(e) for e in (questionnaire.get("edge_cases") or [])) or "None"
        if competitor_research.get("matched"):
            competitor_str = json.dumps(competitor_research)[:1500]
        else:
            competitor_str = "(churn_destination is not a known competitor — skip counter-positioning specifics)"

        if top_segments:
            top_segments_str = "\n".join(
                f"- {s['segment_id']} (size={s['size']}, churn={s['churn_rate']*100:.1f}%, "
                f"retention={s['retention_rate']*100:.1f}%, descriptor='{s['descriptor']}'"
                + (f", dominant_cause='{s['dominant_cause']}'" if s.get('dominant_cause') else '')
                + (", statistically significant" if s.get('significant') else '')
                + ")"
                for s in top_segments
            )
        else:
            top_segments_str = "(no segment table available)"

        if driver_features:
            drivers_str = "\n".join(
                f"- {d['feature']}: hazard_ratio={d['hazard_ratio']} ({d['direction']}, "
                f"p={d['p_value']}{', significant' if d.get('significant') else ''})"
                for d in driver_features
            )
        else:
            drivers_str = "(no quantitative drivers)"

        competitors_val = questionnaire.get("competitors", [])
        competitors_str = ", ".join(competitors_val) if isinstance(competitors_val, list) else str(competitors_val or "None named")

        # ── F12 Pass 1: freeform reasoning trace (no schema, higher temp) ─────
        trace_prompt = ChatPromptTemplate.from_template(
            """You are about to write a 30/60/90-day retention playbook. BEFORE writing it,
think out loud about the synthesis. Do not produce the playbook itself — just the reasoning.

Inputs you must reason over:
- Verified Root Causes: {root_causes}
- Evidence Dossier (rank → stat → cause → tactic → outcome → risk → mitigation):
{dossier}
- Top Segments: {top_segments}
- CoxPH Hazard Drivers: {drivers}
- Simulation: lift={lift}% with intervention_impacts {simulations}
- Critic verdict + feedback: {criticism}
- Competitor research (only if matched): {competitor_research}
- Analyst notes (ground-truth caveats from the company): {edge_cases}
- Hard operational constraints: can_ship={can_ship}, support_model={support_model},
  pricing_flex={pricing_flex}, timeline={timeline}, already_tried={already_tried}.

Cover these questions in order, in plain prose (no JSON, no headings deeper than `##`):
1. Which dossier rows become which playbook problems, and why this rank ordering?
   Reference dossier stat_ids explicitly (e.g. `plan_tier::Starter`).
2. Where do two root causes overlap and need to be merged into one problem?
3. What is the cross-cutting risk that affects more than one problem, and what is the
   single mitigation that addresses it best?
4. How do the operational constraints shape the phase_1/2/3 split — what shifts to
   later phases because of can_ship / pricing / support constraints?
5. Where is the simulation prior weakest (anchor='self_reported' or low confidence),
   and how should you hedge the language for that problem's expected_lift?
6. What is the one piece of evidence you would NOT cite in the playbook because it's
   weak or contradicted upstream?

Output: continuous prose. Max ~450 words. Be specific. No fluff."""
        )

        if not is_deep:
            # Quick mode: skip the freeform trace LLM call — pass 2 still gets
            # full structured context (dossier, drivers, sim, constraints).
            reasoning_trace = "(skipped — quick analysis mode)"
        else:
            try:
                trace_raw = llm_trace.invoke(
                    trace_prompt.format(
                        root_causes=root_causes_str[:1500],
                        dossier=dossier_str,
                        top_segments=top_segments_str[:800],
                        drivers=drivers_str[:600],
                        lift=lift_percent,
                        simulations=json.dumps(simulations.get("intervention_impacts", []))[:800]
                            if simulations else "No simulation data",
                        criticism=json.dumps(criticism)[:600] if criticism else "No critic feedback",
                        competitor_research=competitor_str[:600],
                        edge_cases=edge_cases_str,
                        can_ship=questionnaire.get("can_ship_changes", "Unknown"),
                        support_model=questionnaire.get("support_model", "Unknown"),
                        pricing_flex=", ".join(questionnaire.get("pricing_flexibility", [])) or "Unspecified",
                        timeline=questionnaire.get("timeline", "Unspecified"),
                        already_tried=", ".join(questionnaire.get("retention_tactics", [])) or "None",
                    )
                )
                reasoning_trace = extract_llm_text(trace_raw.content)
            except Exception as trace_err:
                # Trace is non-essential — pass 2 still has full structured context.
                reasoning_trace = f"(reasoning-trace pass failed: {trace_err})"

        response = safe_llm_invoke(
            llm_struct, Playbook,
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
                edge_cases=edge_cases_str,
                root_causes=root_causes_str,
                top_segments=top_segments_str,
                drivers=drivers_str,
                # merged_strategies + dossier already carry the operational fields —
                # per-agent dumps are context color, not the source of truth.
                economist=json.dumps(economist_output)[:700],
                jtbd=json.dumps(jtbd_output)[:700],
                growth=json.dumps(growth_output)[:700],
                strategies=strategies_str,
                competitor_research=competitor_str,
                dossier=dossier_str,
                lift=lift_percent,
                simulations=json.dumps(simulations)[:1000] if simulations else "No simulation data",
                constraints=json.dumps(constrained_brief)[:1000] if constrained_brief else "No constraints",
                criticism=json.dumps(criticism)[:500] if criticism else "No critic feedback",
                hitl_answers=json.dumps(hitl_answers)[:500] if hitl_answers else "None provided",
                reasoning_trace=reasoning_trace[:3000],
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

        # Attach rationale_chain from evidence_dossier (F11). Problem N → dossier row N.
        problems_after_dedupe = playbook.get("problems_and_solutions", []) or []
        for idx, problem in enumerate(problems_after_dedupe):
            if idx < len(evidence_dossier):
                problem["rationale_chain"] = evidence_dossier[idx]

        # Enrich with metadata
        playbook["created_date"] = datetime.now().isoformat()
        # questionnaire.industry is never collected by the form — business_model is.
        playbook["company"] = (
            input_context.get("industry")
            or questionnaire.get("business_model")
            or "SaaS"
        )
        playbook["estimated_total_lift"] = round(lift_percent, 1)
        # F12: surface pass-1 trace so the UI can show "why this playbook".
        playbook["reasoning_trace"] = reasoning_trace

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
