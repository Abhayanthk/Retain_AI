"""
Node 5a: Forensic Detective (Discovery Agent)
===============================================
Runs as a standalone LangGraph node for native parallel execution.
"""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from app.graph.state import RetentionGraphState
from app.graph.agents.discovery.forensic_detective import run_forensic_detective


def forensic_detective_node(state: RetentionGraphState, config: RunnableConfig) -> dict:
    """Run the Forensic Detective agent. Config carries job_id for interim progress events."""
    job_id = (config.get("configurable") or {}).get("job_id") if config else None
    output = run_forensic_detective(state, job_id=job_id)
    return {
        "forensic_detective_output": output,
        "current_node": "forensic_detective",
    }
