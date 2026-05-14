"""
Node 9e: Strategy Skeptic
==========================
Adversarial review of merged_strategies BEFORE simulation.
Output consumed by strategy_critic (weak_points become additional violation triggers).
"""

from __future__ import annotations

from app.graph.state import RetentionGraphState
from app.graph.agents.discovery.strategy_skeptic import run_strategy_skeptic


def strategy_skeptic_node(state: RetentionGraphState) -> dict:
    skeptic_output = run_strategy_skeptic(state)
    return {
        "strategy_skeptic_output": skeptic_output,
        "current_node": "strategy_skeptic",
    }
