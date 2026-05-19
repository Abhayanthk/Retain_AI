# Node 8 — `adaptive_hitl` (Human-in-the-Loop)

**File:** [`backend/app/graph/nodes/adaptive_hitl.py`](../../backend/app/graph/nodes/adaptive_hitl.py).

The only node that **suspends** the graph. Generates 2–3 specific clarifying questions, pushes them over SSE, then `await`s a `asyncio.Event` until the user submits answers (or 5 minutes elapse).

Fan-out point for the Strategy Pod — after this node, three execution agents run in parallel.

## Inputs (from state)

| Key | Used for |
|---|---|
| `iteration_count` | Skip-on-retry guard (see "Idempotent on retry"). |
| `constrained_brief.applied_constraints` | Top 3 fed into prompt. |
| `verified_root_causes` | Top 4 fed into prompt. |
| `questionnaire.goal`, `priority_segment`, `retention_tactics`, `competitors` | Fed into prompt. |

## Model

Gemini 3 Flash Preview via `get_llm("gemini", temperature=0.3)`. Pydantic schema:

```python
class HitlQuestions(BaseModel):
    questions: List[str] = Field(description="2-3 specific, actionable clarification questions grounded in the data findings.")
```

## Prompt rules

```
1. Generate exactly 2-3 questions.
2. Each question must reference a specific data finding (e.g. "Your data shows a 30-day
   activation cliff — did you change your onboarding in the last 6 months?").
3. Ask only about things NOT already answered in the context above.
4. Prefer questions whose answers would change which intervention to prioritize.
5. If competitors are named, ask about them specifically — never ask generically
   "who are your competitors?".
6. Never ask about budget or pricing if pricing_flexibility is already locked.
```

The "grounded in a finding" rule keeps the questions from being generic LLM filler ("What's your timeline?", "What's your goal?").

## SSE / suspension flow

```python
stream = active_streams[job_id]

# Push the questions
await stream["queue"].put({
    "type": "hitl_questions_ready",
    "message": "Clarification needed before generating strategies.",
    "data": {"questions": hitl_questions},
})

# Wait
try:
    await asyncio.wait_for(stream["hitl_event"].wait(), timeout=HITL_TIMEOUT_SECONDS)  # 300s
    answers = stream.get("hitl_answers", {})
except asyncio.TimeoutError:
    answers = {}
```

The frontend renders a modal with the 2–3 questions. Submitting calls `POST /analyze/{job_id}/respond` (in `app/main.py`), which sets `stream["hitl_event"]` — the awaiting `wait_for` then resolves immediately and `human_clarification.responses` carries the submitted answers.

If the user doesn't answer within 300s, the graph proceeds with empty answers and `clarification_status: "timeout"`.

## Cancellation interaction

`POST /analyze/{job_id}/cancel` sets both `cancelled = True` AND `hitl_event.set()` so a paused graph unblocks immediately. The next node entry then raises `JobCancelled` via the wrapper in `builder.py`.

## Idempotent on retry (F8)

```python
if state.get("iteration_count", 0) >= 1:
    prior = state.get("human_clarification") or {
        "questions_asked": state.get("hitl_questions", []) or [],
        "responses": {},
        "clarification_status": "skipped_on_retry",
    }
    return {
        "hitl_questions": prior.get("questions_asked", []),
        "human_clarification": prior,
        "current_node": "adaptive_hitl",
    }
```

When the critic retries and the graph loops back through `adaptive_hitl`, the node short-circuits — reuses the prior `human_clarification` rather than re-prompting the user. Without this, every critic retry would force the user to re-answer the same questions.

(Note: this matters only if you raise `MAX_CRITIC_ITERATIONS` above 0 in `conditions.py`. Currently disabled on free tier.)

## Output

```python
{
    "hitl_questions": [str, str, ...],
    "human_clarification": {
        "questions_asked": [str, ...],
        "responses": {"<question text>": "<answer>", ...},
        "clarification_status": "provided" | "timeout" | "skipped_on_retry" | "error",
    },
    "current_node": "adaptive_hitl",
}
```

## Downstream consumers

All three strategy agents (`unit_economist`, `jtbd_specialist`, `growth_hacker`) read `state.human_clarification.responses` and JSON-dump it into their prompts under `## Human clarifications (HITL)`. The architect also reads it for context.

The strategy_critic also reads `human_clarification.responses` to know what the user said about their constraints.

## Failure handling

Wrapped in try/except. On LLM failure: returns `human_clarification: {questions_asked: [], responses: {}, clarification_status: "error"}` and appends to `errors`. Frontend never sees `hitl_questions_ready` so no modal appears; the graph continues to the strategy pod with empty HITL context. Strategy prompts handle that with `"None provided"` fallback.

## Wall time

5–30 s for question generation + up to 300 s waiting for the user. The actual "node done" log only fires once the user submits or times out — so the `[NODE✓] adaptive_hitl done in Xs` value depends entirely on user speed.

## Why this is a suspension, not a poll

Polling would require either:
- The frontend polling `/state/{job_id}` periodically (extra request load, lag).
- The backend background-polling for queue state (race conditions, extra threads).

`asyncio.Event` is the natural mechanism — `wait_for` releases the event loop, the queue keeps draining the SSE for other events, and the answers POST handler signals completion in a single line. Total cost: one `Event` per active job, stored in `active_streams[job_id]["hitl_event"]`.
