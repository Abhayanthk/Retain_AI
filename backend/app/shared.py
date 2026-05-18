"""
Shared in-process state for SSE streaming, HITL coordination, and cancellation.
"""
from typing import Any, Dict

# job_id → {
#   "queue": asyncio.Queue,
#   "hitl_event": asyncio.Event,
#   "hitl_answers": dict,
#   "cancelled": bool,
# }
active_streams: Dict[str, Any] = {}


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
