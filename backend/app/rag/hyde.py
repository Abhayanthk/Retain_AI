"""
HyDE — Hypothetical Document Embedding for retention RAG.
============================================================
Given a priority segment + industry, ask the LLM to write a short
hypothetical answer. The embedding of that answer is closer to retrieved
framework chunks than the embedding of a bare keyword query, so retrieval
quality improves.

Used by: forensic_detective's broad retrieval pass.
"""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from app.config import get_llm
from app.graph.utils import extract_llm_text


_HYDE_PROMPT = ChatPromptTemplate.from_template(
    """Write a tight 3-sentence hypothetical answer to: why does the {priority_segment}
segment churn in a {industry} {business_model} company? Reference specific behaviors
(activation, integration, support load, pricing-tier mismatch) when plausible. Do NOT
hedge ('it may depend on'). Do NOT mention you are hypothesizing. Output prose only —
no bullet points, no JSON."""
)


def hypothetical_segment_answer(
    priority_segment: str,
    industry: str,
    business_model: str,
    temperature: float = 0.4,
) -> str:
    """Return a 3-sentence hypothetical answer for HyDE retrieval.

    Falls back to a deterministic keyword query if the LLM call fails — so the caller
    can always pass the result straight to `rag_retrieve`.
    """
    seg = (priority_segment or "all users").strip() or "all users"
    ind = (industry or "SaaS").strip() or "SaaS"
    bm = (business_model or "SaaS").strip() or "SaaS"

    try:
        # Low thinking: 3-sentence generation task, reasoning depth wasted here.
        llm = get_llm("gemini", temperature=temperature, thinking_level="low")
        raw = llm.invoke(
            _HYDE_PROMPT.format(priority_segment=seg, industry=ind, business_model=bm)
        )
        text = extract_llm_text(raw.content)
        if text and len(text) >= 40:
            return text
    except Exception:
        pass

    # Deterministic fallback — still better than a bare signals list.
    return (
        f"The {seg} segment churns in {ind} {bm} companies primarily because of "
        f"weak activation, mismatched plan-tier value, or unresolved early friction. "
        f"Retention recovers when the highest-friction step before first value is removed."
    )
