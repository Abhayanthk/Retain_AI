"""
Shared utilities for LLM response handling.
=============================================
"""

from __future__ import annotations


def extract_llm_text(content) -> str:
    """Safely extract text from LLM response content.
    
    Handles cases where response.content is:
    - A plain string
    - A list of content blocks (common with newer Gemini models)
    - A list of dicts with 'text' keys
    """
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get("text", ""))
        return "".join(parts).strip()
    return str(content).strip()


def get_churn_column(df) -> str | None:
    """Robustly identify the binary churn column in a DataFrame."""
    churn_candidates = [c for c in df.columns if 'churn' in c.lower()]
    for c in churn_candidates:
        if df[c].dtype in ['int64', 'float64'] and set(df[c].dropna().unique()).issubset({0, 1, 0.0, 1.0}):
            return c
    # Fall back to any column explicitly named is_churned or churned
    return next((c for c in churn_candidates if 'is_churn' in c.lower() or c.lower() == 'churned'), None)


def build_critic_feedback_block(state, label_singular: str = "intervention") -> str:
    """Build prompt-ready critic feedback when this is a retry pass.

    Returns "" on the first pass so prompts stay clean. On retry, embeds the
    verdict reason, weaknesses, and recommendations from state.criticism so the
    strategy agent can revise instead of regenerating from scratch.
    """
    import json as _json

    iteration_count = state.get("iteration_count", 0) or 0
    if iteration_count < 1:
        return ""

    criticism = state.get("criticism", {}) or {}
    verdict = state.get("critic_verdict", "")
    feedback = state.get("feedback", "") or ""
    recs = criticism.get("recommendations", []) or []
    weaknesses = criticism.get("weaknesses", []) or []
    prior_strategies = (state.get("strategy_outputs", {}) or {}).get("merged_strategies", []) or []
    prior_recs = [s.get("recommendation") for s in prior_strategies if isinstance(s, dict)]

    if not (recs or weaknesses or feedback or prior_recs):
        return ""

    return (
        "── PRIOR CRITIC FEEDBACK (this is retry pass {iter} — REVISE, do not repeat) ──\n"
        "Critic verdict: {verdict}\n"
        "Verdict reason: {reason}\n"
        "Weaknesses to fix: {weak}\n"
        "Required improvements: {recs}\n"
        "Prior {label} that was rejected: {prior}\n"
        "Your output must materially differ from the rejected {label} and explicitly "
        "address each weakness above.\n"
    ).format(
        iter=iteration_count,
        verdict=verdict or "unspecified",
        reason=feedback or "(none)",
        weak=_json.dumps(weaknesses)[:600],
        recs=_json.dumps(recs)[:600],
        prior=_json.dumps(prior_recs)[:400],
        label=label_singular,
    )


def safe_llm_invoke(llm, schema, prompt_text: str, agent_name: str = "Unknown"):
    """Invoke LLM with structured output, falling back to raw JSON parsing.
    
    Strategy:
      1. Try with_structured_output() — cleanest path (function calling)
      2. If that returns None, fall back to raw invoke + manual JSON extraction
      3. Validate through Pydantic either way
    
    This guarantees a valid Pydantic model or raises a clear exception.
    """
    import json
    import re

    # ── Attempt 1: Structured output, up to 2 tries ───────────────────
    # Some models occasionally emit garbage on a structured call (e.g. gpt-oss
    # echoing the schema at higher temps) — one immediate retry usually lands.
    fallback_reason = None
    structured_llm = llm.with_structured_output(schema)
    for attempt in (1, 2):
        try:
            result = structured_llm.invoke(prompt_text)
            if result is not None:
                return result
            fallback_reason = "structured output returned None"
        except Exception as e:
            fallback_reason = f"{type(e).__name__}: {str(e)[:120]}"
        print(f"[safe_llm_invoke] {agent_name}: structured attempt {attempt} failed ({fallback_reason})", flush=True)

    # ── Attempt 3: Raw invoke + JSON extraction ──────────────────────
    # This is a full extra LLM call — log it so silent 2x latency/cost is visible.
    # Append an explicit JSON-only instruction with the full schema: the original
    # prompt has no such hint, so without it the raw fallback tends to produce
    # markdown prose that can never parse.
    print(f"[safe_llm_invoke] {agent_name}: falling back to raw parse", flush=True)
    schema_hint = json.dumps(schema.model_json_schema())
    raw_response = llm.invoke(
        prompt_text
        + "\n\nReturn ONLY a valid JSON object matching this schema — no markdown fences, no prose. "
        + "Every required field must be present:\n"
        + schema_hint
    )
    content = extract_llm_text(raw_response.content)

    # Strip markdown code fences
    content = re.sub(r'^```(?:json)?\s*', '', content.strip())
    content = re.sub(r'\s*```\s*$', '', content.strip())

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"[{agent_name}] LLM produced neither valid structured output "
            f"nor parseable JSON. Raw content: {content[:300]}..."
        ) from e

    return schema(**data)
