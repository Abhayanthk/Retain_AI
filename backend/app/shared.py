"""
Shared in-process state for SSE streaming and HITL coordination.
"""
from typing import Any, Dict

# job_id → {"queue": asyncio.Queue, "hitl_event": asyncio.Event, "hitl_answers": dict}
active_streams: Dict[str, Any] = {}
