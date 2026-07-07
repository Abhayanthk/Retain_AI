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

    # ── Attempt 1: Structured output (function calling) ──────────────
    fallback_reason = None
    try:
        structured_llm = llm.with_structured_output(schema)
        result = structured_llm.invoke(prompt_text)
        if result is not None:
            return result
        fallback_reason = "structured output returned None"
    except Exception as e:
        fallback_reason = f"{type(e).__name__}: {str(e)[:120]}"

    # ── Attempt 2: Raw invoke + JSON extraction ──────────────────────
    # This is a full second LLM call — log it so silent 2x latency/cost is visible.
    print(f"[safe_llm_invoke] {agent_name}: falling back to raw parse ({fallback_reason})", flush=True)
    raw_response = llm.invoke(prompt_text)
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
