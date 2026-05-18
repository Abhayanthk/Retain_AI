"""
Graph State — Shared state flowing through every node.
========================================================
Each node reads from and writes to this TypedDict.
Add new keys as nodes produce artefacts.
"""

from __future__ import annotations

import operator
from typing import Any, Annotated
from typing_extensions import TypedDict


def _last_value(a, b):
    """Reducer that keeps the latest value (for parallel writes to same key)."""
    return b


class RetentionGraphState(TypedDict, total=False):
    """
    Cumulative state passed between LangGraph nodes.

    Keys are added progressively as described in the Excalidraw diagram:
      Node 1  → input_context, input_constraints
      Node 2  → data_quality_score, data_quality_logs
      Node 3  → feature_store
      Node 4  → behavior_curves, behavior_cohorts
      Node 5  → diagnosis_results (from parallel Discovery Agents)
      Node 6  → hypothesis_status, verified_root_causes
      Node 7  → constrained_brief
      Node 8  → human_clarification
      Node 9  → strategy_outputs (from parallel Execution Agents)
      Node 10 → simulations, lift_percent
      Node 11 → critic_verdict, iteration_count
      Node 12 → final_playbook
    """

    # ── Input ────────────────────────────────────────────────────────
    raw_csv_path: str
    questionnaire: dict[str, Any]
    job_id: str  # used by cancellation wrapper in builder.py

    # ── Node 1: Input Ingest ─────────────────────────────────────────
    normalized_df: list[dict[str, Any]]   # DataFrame stored as list of row dicts
    input_context: dict[str, Any]
    input_constraints: dict[str, Any]

    # ── Node 2: Data Audit ───────────────────────────────────────────
    data_quality_score: float
    data_quality_logs: list[str]

    # ── Node 3: Feature Engineering ──────────────────────────────────
    feature_store: dict[str, Any]

    # ── Node 4: Behavioral Map ───────────────────────────────────────
    behavior_curves: dict[str, Any]
    behavior_cohorts: list[dict[str, Any]]

    # ── Node 5: Diagnosis Pod (parallel Discovery Agents) ────────────
    forensic_detective_output: dict[str, Any]
    pattern_matcher_output: dict[str, Any]
    professional_skeptic_output: dict[str, Any]
    competitor_research_output: dict[str, Any]
    diagnosis_results: dict[str, Any]

    # ── Node 5c (extended): top-segment table for strategy agents
    top_segments: list[dict[str, Any]]

    # ── Node 6: Hypothesis Validation ────────────────────────────────
    hypothesis_status: str  # "verified" | "weak_proof" | "unverified"
    verified_root_causes: list[dict[str, Any]]

    # ── Node 7: Constraint Add ───────────────────────────────────────
    constrained_brief: dict[str, Any]

    # ── Node 8: Adaptive HITL ────────────────────────────────────────
    human_clarification: dict[str, Any]
    hitl_questions: list[str]

    # ── Node 9: Strategy Pod (parallel Execution Agents) ─────────────
    unit_economist_output: dict[str, Any]
    jtbd_specialist_output: dict[str, Any]
    growth_hacker_output: dict[str, Any]
    strategy_outputs: dict[str, Any]

    # ── Node 9e: Strategy Skeptic (adversarial pre-simulation review)
    strategy_skeptic_output: dict[str, Any]

    # ── Node 10: Simulation ──────────────────────────────────────────
    simulations: dict[str, Any]
    lift_percent: float

    # ── Node 11: Strategy Critic ─────────────────────────────────────
    critic_verdict: str  # "approved" | "low_lift" | "violation"
    iteration_count: int
    criticism: dict[str, Any]
    feedback: str

    # ── Node 11b: Evidence Dossier (stat → cause → tactic → outcome → risk → mitigation)
    evidence_dossier: list[dict[str, Any]]

    # ── Node 12: Execution Architect ─────────────────────────────────
    final_playbook: dict[str, Any]
    playbook_status: str

    # ── Metadata / Control ───────────────────────────────────────────
    # Annotated with reducers so parallel nodes can write without conflict
    errors: Annotated[list[str], operator.add]
    current_node: Annotated[str, _last_value]
    retry_count: int
    discovery_attempts: int
