"""
Shared in-process state for SSE streaming, HITL coordination, and cancellation.
"""
import time
from typing import Any, Dict

# job_id → {
#   "events": list[dict],                # append-only history; SSE readers keep their own cursor
#   "subscribers": list[asyncio.Event],  # wake signals, one per open SSE connection
#   "hitl_event": asyncio.Event,
#   "hitl_answers": dict,
#   "cancelled": bool,
# }
# Events are broadcast, not consumed: each SSE connection replays history from
# its own cursor, so a page refresh never loses events. (The old single-consumer
# asyncio.Queue design let the dying connection steal events — e.g.
# hitl_questions_ready vanished into a dead socket after a refresh.)
active_streams: Dict[str, Any] = {}


def push_event(job_id: str | None, event: dict) -> None:
    """Append an event to the job's history and wake all SSE subscribers.

    Sync + non-blocking; safe from worker coroutines and from sync node code
    running while the event loop is alive.
    """
    if not job_id:
        return
    stream = active_streams.get(job_id)
    if not stream:
        return
    event.setdefault("ts_ms", int(time.time() * 1000))
    stream.setdefault("events", []).append(event)
    for wake in list(stream.get("subscribers", [])):
        try:
            wake.set()
        except Exception:
            pass


class JobCancelled(Exception):
    """Raised when a cancellation flag is detected mid-pipeline."""
    def __init__(self, job_id: str):
        super().__init__(f"Job {job_id} cancelled by user")
        self.job_id = job_id


def is_cancelled(job_id: str | None) -> bool:
    if not job_id:
        return False
    stream = active_streams.get(job_id)
    return bool(stream and stream.get("cancelled"))
