"""
Graph Builder — Wires all nodes + conditional edges into a LangGraph.
=========================================================================
Uses LangGraph's native parallel execution for Discovery and Strategy pods.

Flow:
  Input → Node 1 → Node 2 ─┬─ Clean ──→ Node 3 → Node 4 ─┬─→ Forensic Detective ─┐
                             │                               └─→ Pattern Matcher ────┤
                             └─ Score < T → Retry → Node 1                           ↓
                                                                              Diagnosis Merge
                                                                              (+ Skeptic)
                                                                                    ↓
                                                                            Node 6 (Hypo. Validate)
                                                                             ├─ Verified → Node 7 → Node 8 ─┬─→ Unit Economist ──┐
                                                                             └─ Weak     → loop back         ├─→ JTBD Specialist ─┤
                                                                                                              └─→ Growth Hacker ──┤
                                                                                                                                   ↓
                                                                                                                            Strategy Merge
                                                                                                                                   ↓
                                                                                                                        Node 10 → Node 11 (Critic)
                                                                                                                                   ├ Approved → Node 12 → END
                                                                                                                                   ├ Low Lift → loop back (exec)
                                                                                                                                   └ Fail 3+  → loop back (disc)
"""

from __future__ import annotations

from langgraph.graph import StateGraph, END

from app.graph.state import RetentionGraphState
from app.graph.conditions import (
    route_after_data_audit,
    route_after_retry,
    route_after_hypothesis_validation,
    route_after_strategy_critic,
)
from app.graph.nodes import (
    input_ingest_node,
    data_audit_node,
    feature_engineering_node,
    behavioral_map_node,
    hypothesis_validation_node,
    constraint_add_node,
    adaptive_hitl_node,
    simulation_node,
    strategy_critic_node,
    execution_architect_node,
    retry_handler_node,
    # Discovery parallel nodes
    forensic_detective_node,
    pattern_matcher_node,
    competitor_research_node,
    diagnosis_merge_node,
    # Execution parallel nodes
    unit_economist_node,
    jtbd_specialist_node,
    growth_hacker_node,
    strategy_merge_node,
    strategy_skeptic_node,
    evidence_dossier_node,
)


def build_retention_graph() -> StateGraph:
    """
    Construct and compile the full retention analysis graph.

    Uses LangGraph native fan-out/fan-in for parallel agent execution:
    - Discovery Pod: forensic_detective + pattern_matcher run in parallel → diagnosis_merge
    - Strategy Pod:  unit_economist + jtbd_specialist + growth_hacker run in parallel → strategy_merge
    """
    graph = StateGraph(RetentionGraphState)

    # ── Register all nodes ───────────────────────────────────────────
    graph.add_node("input_ingest", input_ingest_node)
    graph.add_node("data_audit", data_audit_node)
    graph.add_node("retry_handler", retry_handler_node)
    graph.add_node("feature_engineering", feature_engineering_node)
    graph.add_node("behavioral_map", behavioral_map_node)

    # Discovery Agent nodes (parallel)
    graph.add_node("forensic_detective", forensic_detective_node)
    graph.add_node("pattern_matcher", pattern_matcher_node)
    graph.add_node("competitor_research", competitor_research_node)
    graph.add_node("diagnosis_merge", diagnosis_merge_node)

    graph.add_node("hypothesis_validation", hypothesis_validation_node)
    graph.add_node("constraint_add", constraint_add_node)
    graph.add_node("adaptive_hitl", adaptive_hitl_node)

    # Execution Agent nodes (parallel)
    graph.add_node("unit_economist", unit_economist_node)
    graph.add_node("jtbd_specialist", jtbd_specialist_node)
    graph.add_node("growth_hacker", growth_hacker_node)
    graph.add_node("strategy_merge", strategy_merge_node)
    graph.add_node("strategy_skeptic", strategy_skeptic_node)

    graph.add_node("simulation", simulation_node)
    graph.add_node("strategy_critic", strategy_critic_node)
    graph.add_node("evidence_dossier", evidence_dossier_node)
    graph.add_node("execution_architect", execution_architect_node)

    # ── Entry point ──────────────────────────────────────────────────
    graph.set_entry_point("input_ingest")

    # ── Linear edges ─────────────────────────────────────────────────
    graph.add_edge("input_ingest", "data_audit")

    # Node 2 → conditional: clean vs retry
    graph.add_conditional_edges(
        "data_audit",
        route_after_data_audit,
        {
            "feature_engineering": "feature_engineering",
            "retry_handler": "retry_handler",
        },
    )

    # Retry loops back or ends
    graph.add_conditional_edges(
        "retry_handler",
        route_after_retry,
        {
            "input_ingest": "input_ingest",
            "feature_engineering": "feature_engineering",
        },
    )

    # Node 3 → Node 4
    graph.add_edge("feature_engineering", "behavioral_map")

    # ── Discovery Pod: Fan-out (parallel) ────────────────────────────
    # behavioral_map fans out to forensic_detective, pattern_matcher, competitor_research
    graph.add_edge("behavioral_map", "forensic_detective")
    graph.add_edge("behavioral_map", "pattern_matcher")
    graph.add_edge("behavioral_map", "competitor_research")

    # All three fan-in to diagnosis_merge
    graph.add_edge("forensic_detective", "diagnosis_merge")
    graph.add_edge("pattern_matcher", "diagnosis_merge")
    graph.add_edge("competitor_research", "diagnosis_merge")

    # Diagnosis merge → hypothesis validation
    graph.add_edge("diagnosis_merge", "hypothesis_validation")

    # Node 6 → conditional: verified vs weak proof
    graph.add_conditional_edges(
        "hypothesis_validation",
        route_after_hypothesis_validation,
        {
            "constraint_add": "constraint_add",
            "behavioral_map": "behavioral_map",
        },
    )

    # Node 7 → Node 8
    graph.add_edge("constraint_add", "adaptive_hitl")

    # ── Strategy Pod: Fan-out (parallel) ─────────────────────────────
    # adaptive_hitl fans out to all three execution agents
    graph.add_edge("adaptive_hitl", "unit_economist")
    graph.add_edge("adaptive_hitl", "jtbd_specialist")
    graph.add_edge("adaptive_hitl", "growth_hacker")

    # All three fan-in to strategy_merge
    graph.add_edge("unit_economist", "strategy_merge")
    graph.add_edge("jtbd_specialist", "strategy_merge")
    graph.add_edge("growth_hacker", "strategy_merge")

    # Strategy merge → skeptic → simulation → critic
    graph.add_edge("strategy_merge", "strategy_skeptic")
    graph.add_edge("strategy_skeptic", "simulation")
    graph.add_edge("simulation", "strategy_critic")

    # Node 11 → conditional: approved/exhausted → evidence_dossier; else loop back
    graph.add_conditional_edges(
        "strategy_critic",
        route_after_strategy_critic,
        {
            "evidence_dossier": "evidence_dossier",
            "adaptive_hitl": "adaptive_hitl",
        },
    )

    # Node 11b → Node 12 → END
    graph.add_edge("evidence_dossier", "execution_architect")
    graph.add_edge("execution_architect", END)

    # ── Compile ──────────────────────────────────────────────────────
    return graph.compile()
