"""
Node 11b: Evidence Dossier
============================
For each top-3 problem, assemble a deterministic reasoning chain:
  stat_id → cause → tactic → simulated_outcome → risk → mitigation

No new LLM calls — pure assembly from upstream node outputs. Downstream
execution_architect attaches each row as `rationale_chain` to the matching
final_playbook.problems_and_solutions[] entry.
"""

from __future__ import annotations

from typing import Any

from app.graph.state import RetentionGraphState


_KEYWORD_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "that", "this", "their",
    "users", "user", "churn", "churned", "rate", "than", "they",
}


def _keywords(text: str, min_len: int = 5) -> list[str]:
    """Pull meaningful keywords from a text snippet for fuzzy matching."""
    tokens = [
        "".join(ch for ch in tok.lower() if ch.isalnum())
        for tok in (text or "").split()
    ]
    return [t for t in tokens if len(t) >= min_len and t not in _KEYWORD_STOPWORDS]


def _best_stat_for_cause(cause_text: str, stats: dict) -> dict | None:
    """Find the highest-impact (churn_rate × size) stat bucket whose label/key
    keywords overlap the cause text. Returns {stat_id, source, churn_rate, size}.
    """
    if not stats:
        return None
    cause_kw = set(_keywords(cause_text))
    candidates: list[tuple[float, dict]] = []

    for bucket_name in (
        "churn_by_plan_tier",
        "churn_by_contract",
        "churn_by_channel",
        "churn_by_integration",
        "churn_by_support_volume",
        "churn_by_usage_decile",
        "churn_rate_by_tenure_bucket",
    ):
        bucket = stats.get(bucket_name) or {}
        for label, payload in bucket.items():
            if not isinstance(payload, dict):
                continue
            churn = payload.get("churn_rate")
            size = payload.get("size", 0) or 0
            if churn is None or size < 1:
                continue
            label_kw = set(_keywords(f"{bucket_name} {label}"))
            overlap = len(cause_kw & label_kw)
            impact = float(churn) * float(size)
            score = overlap * 1000 + impact  # exact-keyword match dominates raw impact
            candidates.append((score, {
                "stat_id": f"{bucket_name}::{label}",
                "source": bucket_name,
                "churn_rate": round(float(churn), 3),
                "size": int(size),
                "label": label,
            }))

    if not candidates:
        return None
    candidates.sort(key=lambda kv: -kv[0])
    return candidates[0][1]


def _best_match_for_tactic(tactic_text: str, items: list[dict], text_key: str) -> dict | None:
    """Best fuzzy match between tactic text and a list of dicts (skeptic outputs)."""
    if not items or not tactic_text:
        return None
    target_kw = set(_keywords(tactic_text))
    best, best_score = None, 0
    for item in items:
        if not isinstance(item, dict):
            continue
        candidate_text = item.get(text_key, "")
        score = len(target_kw & set(_keywords(candidate_text)))
        if score > best_score:
            best, best_score = item, score
    return best


def _build_dossier_row(
    rank: int,
    cause: Any,
    tactic: dict,
    simulated_outcome: dict | None,
    stats: dict,
    skeptic_weak: list[dict],
    skeptic_assumptions: list[dict],
    critic_weaknesses: list[str],
    critic_recommendations: list[str],
) -> dict:
    cause_text = cause.get("cause") if isinstance(cause, dict) else str(cause)

    stat = _best_stat_for_cause(cause_text, stats)
    tactic_text = (
        tactic.get("recommendation")
        or tactic.get("name")
        or tactic.get("intervention")
        or ""
    )

    # Risk = skeptic weak_point on this tactic if any, else first critic weakness.
    risk_obj = _best_match_for_tactic(tactic_text, skeptic_weak, "tactic")
    if risk_obj:
        risk = {
            "source": "strategy_skeptic",
            "severity": risk_obj.get("severity", "medium"),
            "description": risk_obj.get("weakness", ""),
        }
    elif critic_weaknesses:
        risk = {
            "source": "strategy_critic",
            "severity": "medium",
            "description": critic_weaknesses[0],
        }
    else:
        risk = {
            "source": "none",
            "severity": "low",
            "description": "No specific risk surfaced upstream.",
        }

    # Mitigation = skeptic assumption_risk mitigation if available, else critic rec.
    mit_obj = _best_match_for_tactic(tactic_text, skeptic_assumptions, "assumption")
    if mit_obj and mit_obj.get("mitigation"):
        mitigation = {
            "source": "strategy_skeptic",
            "description": mit_obj.get("mitigation", ""),
        }
    elif critic_recommendations:
        mitigation = {
            "source": "strategy_critic",
            "description": critic_recommendations[0],
        }
    else:
        mitigation = {
            "source": "none",
            "description": "Monitor success_metric for 2 review cycles before scaling.",
        }

    return {
        "rank": rank,
        "stat": stat or {
            "stat_id": "(none)",
            "source": "(none)",
            "churn_rate": None,
            "size": None,
            "label": "(no matching statistical bucket)",
        },
        "cause": {
            "text": cause_text,
            "confidence": cause.get("confidence") if isinstance(cause, dict) else None,
            "citations": cause.get("citations", []) if isinstance(cause, dict) else [],
        },
        "tactic": {
            "recommendation": tactic_text,
            "framework": tactic.get("framework"),
            "target_event": tactic.get("target_event"),
            "trigger_window": tactic.get("trigger_window"),
            "success_metric_formula": tactic.get("success_metric_formula"),
            "min_sample_size": tactic.get("min_sample_size"),
            "expected_lift_pct_p50": tactic.get("expected_lift_pct_p50"),
            "expected_lift_pct_p90": tactic.get("expected_lift_pct_p90"),
            "copy_example": tactic.get("copy_example"),
        },
        "simulated_outcome": simulated_outcome or {
            "mean_lift": None,
            "percentile_10": None,
            "percentile_90": None,
            "lift_prior_anchor": "unknown",
        },
        "risk": risk,
        "mitigation": mitigation,
    }


def evidence_dossier_node(state: RetentionGraphState) -> dict:
    """Build top-3 reasoning chains. Pure assembly — no LLM call."""
    try:
        verified_causes = state.get("verified_root_causes", []) or []
        merged_strategies = (
            (state.get("strategy_outputs", {}) or {}).get("merged_strategies", []) or []
        )
        forensic_output = state.get("forensic_detective_output", {}) or {}
        stats = forensic_output.get("statistical_evidence", {}) or {}
        simulations = state.get("simulations", {}) or {}
        intervention_impacts = simulations.get("intervention_impacts", []) or []
        skeptic_output = state.get("strategy_skeptic_output", {}) or {}
        criticism = state.get("criticism", {}) or {}

        skeptic_weak = skeptic_output.get("weak_points", []) or []
        skeptic_assumptions = skeptic_output.get("assumption_risks", []) or []
        critic_weaknesses = criticism.get("weaknesses", []) or []
        critic_recommendations = criticism.get("recommendations", []) or []

        rows: list[dict] = []
        n = min(3, len(merged_strategies))
        for i in range(n):
            tactic = merged_strategies[i] if i < len(merged_strategies) else {}
            cause = verified_causes[i] if i < len(verified_causes) else (
                verified_causes[0] if verified_causes else "(no verified cause)"
            )
            sim = intervention_impacts[i] if i < len(intervention_impacts) else None
            rows.append(_build_dossier_row(
                rank=i + 1,
                cause=cause,
                tactic=tactic,
                simulated_outcome=sim,
                stats=stats,
                skeptic_weak=skeptic_weak,
                skeptic_assumptions=skeptic_assumptions,
                critic_weaknesses=critic_weaknesses,
                critic_recommendations=critic_recommendations,
            ))

        return {
            "evidence_dossier": rows,
            "current_node": "evidence_dossier",
        }

    except Exception as e:
        return {
            "evidence_dossier": [],
            "errors": [*(state.get("errors", []) or []), f"Evidence dossier error: {e}"],
            "current_node": "evidence_dossier",
        }
