"""
Discovery Agent: Forensic Detective
=====================================
Investigates data anomalies and traces root causes.
Called by: forensic_detective_node (parallel with pattern_matcher, fan-in at diagnosis_merge)
"""

from __future__ import annotations

from typing import Any, List, Dict
from pydantic import BaseModel, Field
from app.graph.utils import get_churn_column, safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState
from app.rag.store import retrieve as rag_retrieve


class DetectiveResult(BaseModel):
    suspected_causes: List[str]
    confidence_scores: Dict[str, float]
    citations: Dict[str, List[str]] = Field(default_factory=dict)


def _derive_signals(stats: dict, behavior_curves: dict) -> List[str]:
    """Translate detected data patterns into RAG signal tags."""
    signals: List[str] = []

    churn_rate = stats.get("churn_rate", 0) or 0
    if churn_rate > 0.25:
        signals.append("high_churn")

    if stats.get("churn_by_channel"):
        rates = list(stats["churn_by_channel"].values())
        if rates and (max(rates) - min(rates)) > 0.15:
            signals.extend(["channel_churn", "channel_variance", "bad_fit"])

    if stats.get("churn_by_integration"):
        signals.extend(["low_integration", "integration_failure", "b2b_churn"])

    median = behavior_curves.get("median_survival_time")
    max_tenure = behavior_curves.get("max_tenure", 0) or 0
    if median and max_tenure:
        if median <= 3:
            signals.extend(["short_tenure_churn", "30_day_cliff", "onboarding_friction"])
        elif median <= 9:
            signals.extend(["mid_tenure_churn", "90_day_cliff", "engagement_decay"])
        else:
            signals.append("long_tenure_churn")

    milestones = behavior_curves.get("milestone_retention", {}) or {}
    if milestones.get("month_1") is not None and milestones["month_1"] < 0.85:
        signals.append("new_user_drop_off")

    return list(dict.fromkeys(signals))  # dedupe, preserve order

def run_forensic_detective(state: RetentionGraphState) -> dict[str, Any]:
    """Deep forensic investigation of retention patterns."""
    try:
        import duckdb

        raw_csv_path = state.get("raw_csv_path", "")
        q = state.get("questionnaire", {})

        # Load CSV for actual statistical analysis
        conn = duckdb.connect(":memory:")
        df = conn.execute(f"SELECT * FROM read_csv_auto('{raw_csv_path}')").df()

        # Calculate actual statistics from data
        churn_col = get_churn_column(df)

        stats = {"churn_rate": 0, "churn_by_channel": {}, "churn_by_integration": {}}

        if churn_col:
            stats["churn_rate"] = round(df[churn_col].mean(), 2)

            acq_col = next((c for c in df.columns if 'acquisition' in c.lower() or 'channel' in c.lower()), None)
            if acq_col:
                for channel in df[acq_col].unique():
                    churn_rate = df[df[acq_col] == channel][churn_col].mean()
                    stats["churn_by_channel"][str(channel)] = round(churn_rate, 2)

            int_col = next((c for c in df.columns if 'integration' in c.lower()), None)
            if int_col:
                for status in df[int_col].unique():
                    churn_rate = df[df[int_col] == status][churn_col].mean()
                    stats["churn_by_integration"][str(status)] = round(churn_rate, 2)

        # Build RAG query + retrieve grounding frameworks
        behavior_curves = state.get("behavior_curves", {}) or {}
        signals = _derive_signals(stats, behavior_curves)
        rag_query = (
            f"Root causes of churn with patterns: {', '.join(signals) or 'general churn'}. "
            f"Churn rate {stats['churn_rate']:.1%}. "
            f"Median survival {behavior_curves.get('median_survival_time')}."
        )
        retrieved = rag_retrieve(rag_query, k=5, signals=signals)
        evidence_block = "\n\n".join(
            f"[{i+1}] Source: {c['source']} (id: {c['id']})\n{c['text']}"
            for i, c in enumerate(retrieved)
        ) or "(no retrieved frameworks — reason from stats alone)"

        llm = get_llm("gemini", temperature=0.3)

        prompt = ChatPromptTemplate.from_template(
            """You are a retention analyst for a {business_model} company. Diagnose the 3 most likely root causes of churn.

── Business context ──
Goal: {goal}
Priority segment: {priority_segment}
Named competitors: {competitors}
Churn destination: {churn_destination}

── Dataset statistics ──
Overall Churn Rate: {churn_rate}
Churn by Acquisition Channel: {churn_by_channel}
Churn by Integration Status: {churn_by_integration}
Detected Signals: {signals}

── Retrieved retention frameworks (ground your analysis in these) ──
{evidence_block}

Requirements:
- Each root cause must be specific and grounded in one or more retrieved frameworks above.
- If churn_destination names a competitor, weight a "losing to {{competitor}}" hypothesis accordingly.
- Bias causes toward the priority segment when its tenure window matches the data signal.
- Reference the framework by its source id in the `citations` map.
- Confidence in [0.7, 1.0]."""
        )

        import json
        competitors_val = q.get("competitors", [])
        competitors_str = ", ".join(competitors_val) if isinstance(competitors_val, list) else str(competitors_val or "")
        response = safe_llm_invoke(
            llm, DetectiveResult,
            prompt.format(
                business_model=q.get("business_model", "SaaS"),
                goal=q.get("goal", "Reduce churn"),
                priority_segment=q.get("priority_segment", "all users"),
                competitors=competitors_str or "None named",
                churn_destination=q.get("churn_destination", "Unknown"),
                churn_rate=f"{stats['churn_rate']:.1%}",
                churn_by_channel=json.dumps(stats['churn_by_channel']),
                churn_by_integration=json.dumps(stats['churn_by_integration']),
                signals=", ".join(signals) or "none",
                evidence_block=evidence_block,
            ),
            agent_name="ForensicDetective",
        )

        suspected_causes = response.suspected_causes
        confidence_scores = response.confidence_scores
        citations = response.citations or {}

        return {
            "agent": "forensic_detective",
            "suspected_causes": suspected_causes,
            "confidence_scores": confidence_scores,
            "citations": citations,
            "retrieved_sources": [
                {"id": c["id"], "source": c["source"], "topic": c["topic"], "score": c["score"]}
                for c in retrieved
            ],
            "statistical_evidence": stats,
            "analysis_depth": "high",
        }

    except Exception as e:
        return {
            "agent": "forensic_detective",
            "error": str(e),
        }
