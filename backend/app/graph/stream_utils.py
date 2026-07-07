"""
Stream utilities — push interim progress events into the SSE event history
from inside agent code, without going through main.py.

Events go through app.shared.push_event (append-only history + subscriber
wake), so they survive reconnects. Agent code runs sync inside the LangGraph
node, but the event loop is alive (main.py awaits `graph.astream`), so the
sync append + Event.set() works without scheduling.

Use sparingly — most stage transitions are already covered by main.py
emitting on node completion. Reserve this for high-value mid-node
progress (forensic self-consistency, critic retry decision).
"""

from __future__ import annotations

from typing import Any

from app.shared import push_event


def push_progress(job_id: str | None, event_type: str, data: dict[str, Any] | None = None) -> None:
    """Push an SSE event into the active stream for `job_id`. No-op if stream is gone."""
    try:
        push_event(job_id, {"type": event_type, "data": data or {}})
    except Exception:
        # Interim progress is best-effort — never fail the pipeline for it.
        pass
