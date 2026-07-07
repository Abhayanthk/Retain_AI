"""
Discovery Agent: Professional Skeptic
=======================================
Challenges assumptions and stress-tests hypotheses using LLM-powered
adversarial reasoning.
Called by: diagnosis_merge_node (after forensic_detective + pattern_matcher fan-in)
"""

from __future__ import annotations

import json
from typing import Any, List, Dict
from pydantic import BaseModel, Field
from app.graph.state import RetentionGraphState
from app.graph.utils import safe_llm_invoke
from app.config import get_llm, gemini_model
from langchain_core.prompts import ChatPromptTemplate

class CounterArgument(BaseModel):
    hypothesis: str
    counter_argument: str
    strength: str

class AlternativeExplanation(BaseModel):
    hypothesis: str
    alternative: str
    testability: str

class BiasFlag(BaseModel):
    issue: str
    risk: str
    recommendation: str

class OverallQuality(BaseModel):
    forensic_quality: float
    pattern_quality: float
    combined_confidence: float
    recommendation: str

class SkepticResult(BaseModel):
    counter_arguments: List[CounterArgument]
    robustness_scores: Dict[str, float]
    alternative_explanations: List[AlternativeExplanation]
    bias_flags: List[BiasFlag]
    overall_quality: OverallQuality

def run_professional_skeptic(
    state: RetentionGraphState,
    forensic_findings: dict[str, Any],
    pattern_findings: dict[str, Any],
) -> dict[str, Any]:
    """Adversarial review of hypotheses and findings using LLM reasoning."""
    try:
        forensic_causes = forensic_findings.get("suspected_causes", [])
        forensic_confidence = forensic_findings.get("confidence_scores", {})
        statistical_evidence = forensic_findings.get("statistical_evidence", {})
        pattern_sequences = pattern_findings.get("churn_sequences", [])
        pattern_found = pattern_findings.get("patterns_found", [])
        q = state.get("questionnaire", {})

        llm = get_llm(
            "gemini", temperature=0.4,
            model=gemini_model(q.get("analysis_depth"), deep_call=True),
        )

        skeptic_prompt = ChatPromptTemplate.from_template(
            """You are a Professional Skeptic reviewing churn analysis findings.
Your job is to challenge assumptions, find flaws, and stress-test hypotheses against the actual data.

## Business context
Priority segment: {priority_segment}
Goal: {goal}
Tactics already tried (so retread proposals are suspect): {already_tried}
Analyst notes / caveats (a cause that ignores these is weak — check each hypothesis against them): {edge_cases}

## Forensic Findings
Suspected causes: {causes}
Confidence scores: {confidence}

## Underlying data the forensic agent used (use this to cross-check)
Statistical evidence: {evidence}

## Pattern Findings
Churn sequences: {sequences}
Patterns found: {patterns}

For EACH suspected cause:
1. Specific counter-argument — reference the actual cause AND the statistical_evidence above.
2. Robustness score (0.0-1.0) — penalize if the evidence is weak or the cause overlaps with already-tried tactics.
3. One alternative explanation.

Also flag cognitive biases (confirmation, survivorship, overfitting, channel-attribution bias).
strength / testability / risk values: "low", "medium", or "high".
robustness_scores keys: the suspected cause strings. All numeric scores in [0, 1]."""
        )

        response = safe_llm_invoke(
            llm, SkepticResult,
            skeptic_prompt.format(
                priority_segment=q.get("priority_segment", "all users"),
                goal=q.get("goal", "Reduce churn"),
                already_tried=", ".join(q.get("retention_tactics", [])) or "None",
                edge_cases=" | ".join(str(e) for e in (q.get("edge_cases") or [])) or "None",
                causes=json.dumps(forensic_causes),
                confidence=json.dumps(forensic_confidence),
                evidence=json.dumps(statistical_evidence)[:1400],
                sequences=json.dumps(pattern_sequences[:3]),
                patterns=json.dumps([p.get("pattern", "") if isinstance(p, dict) else "" for p in pattern_found[:5]]),
            ),
            agent_name="ProfessionalSkeptic",
        )

        return {
            "agent": "professional_skeptic",
            "counter_arguments": [c.model_dump() for c in response.counter_arguments][:5],
            "bias_flags": [b.model_dump() for b in response.bias_flags],
            "robustness_scores": response.robustness_scores,
            "alternative_explanations": [a.model_dump() for a in response.alternative_explanations][:3],
            "overall_quality_assessment": response.overall_quality.model_dump(),
            "approval_status": "conditional_proceed",
        }

    except Exception as e:
        return {
            "agent": "professional_skeptic",
            "error": str(e),
        }
