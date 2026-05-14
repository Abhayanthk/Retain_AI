"""
Stream utilities — push interim progress events into the SSE queue
from inside agent code, without going through main.py.

The SSE queue is an asyncio.Queue created in main.py and stored in
app.shared.active_streams. Agent code runs sync inside the LangGraph
node, but the event loop is alive (main.py awaits `graph.astream`),
so `queue.put_nowait(...)` works without scheduling.

Use sparingly — most stage transitions are already covered by main.py
emitting on node completion. Reserve this for high-value mid-node
progress (forensic self-consistency, critic retry decision).
"""

from __future__ import annotations

import time
from typing import Any

from app.shared import active_streams


def push_progress(job_id: str | None, event_type: str, data: dict[str, Any] | None = None) -> None:
    """Push an SSE event into the active stream for `job_id`. No-op if queue is gone."""
    if not job_id:
        return
    stream = active_streams.get(job_id)
    if not stream:
        return
    queue = stream.get("queue")
    if queue is None:
        return
    payload = {
        "type": event_type,
        "data": data or {},
        "ts_ms": int(time.time() * 1000),
    }
    try:
        queue.put_nowait(payload)
    except Exception:
        # Queue full or closed — interim progress is best-effort, never fail the pipeline for it.
        pass
