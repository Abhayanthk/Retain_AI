"""
Edge Conditions — Routing logic between nodes.
================================================
Each function returns the name of the next node (or END).
Used as `conditional_edge` callbacks in the graph builder.
"""

from __future__ import annotations

from typing import Literal

from langgraph.graph import END

from app.graph.state import RetentionGraphState


# ── After Node 2: Data Audit ─────────────────────────────────────────
DATA_QUALITY_THRESHOLD = 0.5  # Lowered to reduce unnecessary retries
MAX_RETRIES = 0


def route_after_data_audit(
    state: RetentionGraphState,
) -> Literal["feature_engineering", "retry_handler"]:
    """
    If data quality score >= threshold → proceed to Feature Engineering.
    Otherwise → route to Retry Handler (request better data).
    """
    score = state.get("data_quality_score", 0.0)
    if score >= DATA_QUALITY_THRESHOLD:
        return "feature_engineering"
    return "retry_handler"


# ── After Retry Handler ──────────────────────────────────────────────
def route_after_retry(
    state: RetentionGraphState,
) -> Literal["input_ingest", "feature_engineering"]:
    """
    If retry attempts exceeded → proceed with current data to Feature Engineering.
    Otherwise → loop back to input_ingest for fresh data.
    """
    if state.get("retry_count", 0) >= MAX_RETRIES:
        return "feature_engineering"
    return "input_ingest"


# ── After Hypothesis Validation ──────────────────────────────────────
# Counts discovery attempts (diagnosis_merge increments once per pass).
# Value 1 = single discovery pass, no retry. Retry doubled RSS on Render
# free tier (326MB → 539MB, past 512MB cap) because state accumulates both
# passes' forensic outputs. Raise to 2 only on larger instances.
MAX_DISCOVERY_ATTEMPTS = 0


def route_after_hypothesis_validation(
    state: RetentionGraphState,
) -> Literal["constraint_add", "behavioral_map"]:
    """
    Verified root cause       → proceed to Constraint Add.
    Unverified / Weak Proof   → loop back to Discovery (fan-out via behavioral_map).
    Attempts >= max           → proceed with current data to Constraint Add.
    """
    if state.get("hypothesis_status") == "verified":
        return "constraint_add"
    # Max retries exhausted — proceed with best available data
    if state.get("discovery_attempts", 0) >= MAX_DISCOVERY_ATTEMPTS:
        return "constraint_add"
    return "behavioral_map"


# ── After Strategy Critic ────────────────────────────────────────────
# Counts critic passes (strategy_critic increments iteration_count once per pass).
# Value 2 = up to 2 critic passes total = 1 retry after the first review.
MAX_CRITIC_ITERATIONS = 2


def route_after_strategy_critic(
    state: RetentionGraphState,
) -> Literal["evidence_dossier", "adaptive_hitl"]:
    """
    Approved                → proceed to Evidence Dossier → Execution Architect.
    Low Lift / Violation    → loop back to Strategy Agents (fan-out via adaptive_hitl).
    Max iterations reached  → proceed with current data to Evidence Dossier.
    """
    verdict = state.get("critic_verdict", "")
    iterations = state.get("iteration_count", 0)

    if verdict == "approved":
        return "evidence_dossier"

    # Max retries exhausted — proceed with best available data
    if iterations >= MAX_CRITIC_ITERATIONS:
        return "evidence_dossier"

    # Otherwise retry strategy generation
    return "adaptive_hitl"
