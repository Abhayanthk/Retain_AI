"""
Discovery Agent: Pattern Matcher
==================================
Identifies recurring patterns and user segments using Gemini.
Called by: pattern_matcher_node (parallel with forensic_detective, fan-in at diagnosis_merge)
"""

from __future__ import annotations

from typing import Any, List
from pydantic import BaseModel, Field
from app.graph.utils import safe_llm_invoke
from app.config import get_llm
from app.graph.state import RetentionGraphState
from langchain_core.prompts import ChatPromptTemplate


class PatternDef(BaseModel):
    pattern: str
    churn_risk: str
    affected_users: int
    description: str

class UserSegment(BaseModel):
    segment_id: str
    size: int
    retention_rate: float
    characteristics: str

class TopicCluster(BaseModel):
    topic: str
    cluster_size: int

class ChurnSequence(BaseModel):
    sequence: str
    probability: float

class PatternMatcherResult(BaseModel):
    patterns_found: List[PatternDef]
    user_segments: List[UserSegment]
    topic_clusters: List[TopicCluster]
    churn_sequences: List[ChurnSequence]
    pattern_confidence: float

def run_pattern_matcher(state: RetentionGraphState) -> dict[str, Any]:
    """Discover recurring retention/churn patterns via LLM analysis."""
    try:
        feature_store = state.get("feature_store", {})
        behavior_cohorts = state.get("behavior_cohorts", [])
        q = state.get("questionnaire", {})
        driver_features = (feature_store.get("predictive_churn_risk", {}) or {}).get("driver_features", []) or []

        llm = get_llm("gemini", temperature=0.2, thinking_level="low")

        prompt = ChatPromptTemplate.from_template(
            """Analyze these user behavior cohorts and features to identify recurring churn patterns and segments for a {business_model} company.

Business context:
- Priority segment: {priority_segment}
- Typical customer: {typical_customer}

Behavior Cohorts: {cohorts}
Feature Store Data: {features}

CoxPH Hazard Drivers (use feature names below as anchors for patterns and segment definitions):
{drivers}

Identify:
1. High-risk user segments — bias toward the priority segment if signals match. Each segment_id should reference the actual data driver (e.g. "low_integration_b2b" not "Segment A").
2. Feature-based patterns (specific feature adoption gaps tied to hazard ratios above).
3. Common churn sequences (steps users take before leaving), ordered.
4. pattern_confidence in [0, 1]."""
        )

        if driver_features:
            drivers_str = "\n".join(
                f"- {d['feature']}: HR={d['hazard_ratio']} ({d['direction']}, p={d['p_value']})"
                for d in driver_features
            )
        else:
            drivers_str = "(no quantitative drivers — reason from cohorts alone)"

        import json
        response = safe_llm_invoke(
            llm, PatternMatcherResult,
            prompt.format(
                business_model=q.get("business_model", "SaaS"),
                priority_segment=q.get("priority_segment", "all users"),
                typical_customer=q.get("typical_customer", "Unspecified"),
                cohorts=json.dumps(behavior_cohorts),
                features=json.dumps(feature_store),
                drivers=drivers_str,
            ),
            agent_name="PatternMatcher",
        )

        return {
            "agent": "pattern_matcher",
            "patterns_found": [p.model_dump() for p in response.patterns_found],
            "user_segments": [s.model_dump() for s in response.user_segments],
            "topic_clusters": [t.model_dump() for t in response.topic_clusters],
            "churn_sequences": [s.model_dump() for s in response.churn_sequences],
            "pattern_confidence": response.pattern_confidence,
        }

    except Exception as e:
        return {
            "agent": "pattern_matcher",
            "error": str(e),
        }
