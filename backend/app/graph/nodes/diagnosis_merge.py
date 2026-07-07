"""
Node 5c: Diagnosis Merge
==========================
Runs the Professional Skeptic on merged findings from
Forensic Detective + Pattern Matcher, then produces
the final diagnosis_results plus a unified top_segments
table that downstream strategy agents consume.
"""

from __future__ import annotations

from typing import Any

from app.graph.state import RetentionGraphState
from app.graph.agents.discovery.professional_skeptic import run_professional_skeptic


def _build_top_segments(
    forensic_output: dict[str, Any],
    pattern_output: dict[str, Any],
    behavior_cohorts: list[dict[str, Any]],
    forensic_causes: list[str],
) -> list[dict[str, Any]]:
    """
    Build a unified segment table for strategy agents.
    Each entry: {segment_id, source, size, retention_rate, dominant_cause, descriptor}.
    Pulls from: forensic stats (channel/plan/integration/usage/support buckets),
    pattern_matcher user_segments, and behavioral cohorts.
    """
    stats = forensic_output.get("statistical_evidence", {}) or {}
    rows: list[dict[str, Any]] = []

    def _add_bucket_rows(bucket_dict: dict, family: str, descriptor_prefix: str) -> None:
        for label, payload in (bucket_dict or {}).items():
            if not isinstance(payload, dict):
                continue
            churn = payload.get("churn_rate")
            size = payload.get("size", 0)
            if churn is None or size < 1:
                continue
            retention = round(1.0 - float(churn), 3)
            rows.append({
                "segment_id": f"{family}::{label}",
                "source": family,
                "label": label,
                "size": int(size),
                "retention_rate": retention,
                "churn_rate": round(float(churn), 3),
                "descriptor": f"{descriptor_prefix} = {label}",
                "p_value": payload.get("p_value"),
                "significant": bool(payload.get("significant", False)),
            })

    _add_bucket_rows(stats.get("churn_by_channel"), "channel", "Acquisition channel")
    _add_bucket_rows(stats.get("churn_by_integration"), "integration", "Integration status")
    _add_bucket_rows(stats.get("churn_by_plan_tier"), "plan_tier", "Plan tier")
    _add_bucket_rows(stats.get("churn_by_contract"), "contract", "Contract cadence")
    _add_bucket_rows(stats.get("churn_by_support_volume"), "support", "Support ticket volume")
    _add_bucket_rows(stats.get("churn_by_usage_decile"), "usage", "Usage decile")
    _add_bucket_rows(stats.get("churn_rate_by_tenure_bucket"), "tenure", "Tenure bucket")

    # Pattern matcher user_segments (LLM-derived clusters)
    for seg in (pattern_output.get("user_segments") or []):
        if not isinstance(seg, dict):
            continue
        sid = seg.get("segment_id") or f"pattern::{len(rows)}"
        size = seg.get("size", 0) or 0
        retention = seg.get("retention_rate")
        if retention is None or size < 1:
            continue
        rows.append({
            "segment_id": f"pattern::{sid}",
            "source": "pattern_matcher",
            "label": str(sid),
            "size": int(size),
            "retention_rate": round(float(retention), 3),
            "churn_rate": round(1.0 - float(retention), 3),
            "descriptor": str(seg.get("characteristics", "")),
        })

    # Behavioral tenure cohorts
    for cohort in behavior_cohorts or []:
        retention = cohort.get("retention_rate")
        size = cohort.get("size", 0) or 0
        if retention is None or size < 1:
            continue
        rows.append({
            "segment_id": f"cohort::{cohort.get('cohort_id', 'unknown')}",
            "source": "behavioral_map",
            "label": cohort.get("characteristics", cohort.get("cohort_id", "")),
            "size": int(size),
            "retention_rate": round(float(retention), 3),
            "churn_rate": round(1.0 - float(retention), 3),
            "descriptor": cohort.get("characteristics", ""),
        })

    # Heuristic dominant-cause attribution: substring match between segment descriptor
    # and forensic causes. Best-effort, used as a hint not ground truth.
    causes_lower = [(c, c.lower()) for c in (forensic_causes or [])]
    for r in rows:
        text = (r["descriptor"] + " " + r["label"]).lower()
        dominant = None
        for original, lc in causes_lower:
            keywords = [w for w in lc.split() if len(w) > 4]
            if any(kw in text for kw in keywords):
                dominant = original
                break
        r["dominant_cause"] = dominant

    # Rank by churn impact: churn_rate * size (lost-users proxy), keep top 8.
    # Stat buckets that failed the z-test get demoted (not dropped) — rows from
    # pattern_matcher / cohorts carry no p_value and are unaffected.
    def _impact(r: dict) -> float:
        base = r["churn_rate"] * r["size"]
        if r.get("p_value") is not None and not r.get("significant", False):
            return base * 0.6
        return base

    rows.sort(key=_impact, reverse=True)
    return rows[:8]


def diagnosis_merge_node(state: RetentionGraphState) -> dict:
    """Merge Discovery Agent outputs, run skeptic, produce diagnosis + segment table."""
    try:
        forensic_output = state.get("forensic_detective_output", {})
        pattern_output = state.get("pattern_matcher_output", {})
        behavior_cohorts = state.get("behavior_cohorts", []) or []

        # Run skeptic on the merged findings
        skeptic_output = run_professional_skeptic(state, forensic_output, pattern_output)

        # Build merged hypotheses from forensic causes
        forensic_causes = forensic_output.get("suspected_causes", [])
        forensic_conf = forensic_output.get("confidence_scores", {})
        per_cause_evidence = forensic_output.get("per_cause_evidence", {})
        forensic_citations = forensic_output.get("citations", {})

        merged_hypotheses = []
        for cause in forensic_causes[:3]:
            merged_hypotheses.append({
                "hypothesis": cause,
                "confidence": forensic_conf.get(cause, 0.5),
                "supported_by": ["forensic_detective", "pattern_matcher"],
                "citations": forensic_citations.get(cause, []),
                "evidence_sources": per_cause_evidence.get(cause, []),
            })

        diagnosis_results = {
            "forensic_findings": forensic_output,
            "pattern_findings": pattern_output,
            "skeptic_findings": skeptic_output,
            "competitor_research": state.get("competitor_research_output", {}) or {},
            "merged_hypotheses": merged_hypotheses,
            "highest_confidence": max(forensic_conf.values()) if forensic_conf else 0,
            "total_patterns_identified": len(pattern_output.get("patterns_found", [])),
        }

        top_segments = _build_top_segments(
            forensic_output, pattern_output, behavior_cohorts, forensic_causes,
        )

        discovery_attempts = state.get("discovery_attempts", 0) + 1

        return {
            "professional_skeptic_output": skeptic_output,
            "diagnosis_results": diagnosis_results,
            "top_segments": top_segments,
            "discovery_attempts": discovery_attempts,
            "current_node": "diagnosis_merge",
        }

    except Exception as e:
        return {
            "diagnosis_results": {"error": str(e)},
            "top_segments": [],
            "discovery_attempts": state.get("discovery_attempts", 0) + 1,
            "errors": [*state.get("errors", []), f"Diagnosis merge error: {str(e)}"],
            "current_node": "diagnosis_merge",
        }
