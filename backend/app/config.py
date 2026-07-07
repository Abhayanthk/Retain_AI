"""
Centralized LLM Factory with Round-Robin + Failover
====================================================
Provides `get_llm()` returning a `FailoverLLM` wrapper:
- Picks next key via round-robin on each new instance.
- On `invoke()`, retries with the next available key when the current key
  hits a rate-limit / quota / 429 error.
- Auto-discovers all keys named `GOOGLE_API_KEY[_N]` and `GROQ_API_KEY[_N]`.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Literal

from dotenv import load_dotenv

load_dotenv()

# ── Key discovery ────────────────────────────────────────────────────────

def _discover_keys(base: str, max_slots: int = 32) -> list[str]:
    """Find all env vars matching BASE, BASE_1 .. BASE_N (in numeric order)."""
    keys: list[str] = []
    seen: set[str] = set()
    plain = os.getenv(base)
    if plain and plain not in seen:
        keys.append(plain)
        seen.add(plain)
    for i in range(1, max_slots + 1):
        v = os.getenv(f"{base}_{i}")
        if v and v not in seen:
            keys.append(v)
            seen.add(v)
    return keys


_GEMINI_KEYS: list[str] = _discover_keys("GOOGLE_API_KEY")
_GROQ_KEYS:   list[str] = _discover_keys("GROQ_API_KEY")

# ── Model selection ──────────────────────────────────────────────────────
# Bench 2026-07-07 (see CLAUDE.md "LLM latency bench"): gemini-3-flash-preview
# had 15s–350s tail latency on structured calls; 3.1-flash-lite does the same
# call in ~2s. Lite thinks OFF by default — do NOT pass thinking_level to it.
GEMINI_FAST_MODEL = "gemini-3.1-flash-lite"   # default: every structured/shallow call
GEMINI_DEEP_MODEL = "gemini-3.5-flash"        # deep mode only: reasoning-heavy calls
# Groq shootout 2026-07-07: gpt-oss-120b beat llama-3.3-70b on answer depth
# (cites HR/p/significance correctly) at ~3s for 4k-token prompts. It rejects
# forced tool-choice, so structured output must use method="json_schema" —
# FailoverLLM injects that automatically for gpt-oss models.
GROQ_MODEL = "openai/gpt-oss-120b"


def gemini_model(depth: str | None = None, deep_call: bool = False) -> str:
    """Pick the Gemini model for a call site.

    `deep_call=True` marks reasoning-heavy sites (forensic runs, skeptics,
    critic, architect). They get GEMINI_DEEP_MODEL only when the user chose
    depth="deep" in the questionnaire; everything else stays on the fast model.
    """
    if deep_call and (depth or "").strip().lower() == "deep":
        return GEMINI_DEEP_MODEL
    return GEMINI_FAST_MODEL

# ── State ────────────────────────────────────────────────────────────────

# Rate-limited keys revive after this many seconds — provider RPM windows
# reset in ~60s, so a permanently-dead key just shrinks the pool for nothing.
_DEAD_KEY_COOLDOWN_SECONDS = 75.0

_lock = threading.Lock()
_counters: dict[str, int] = {"gemini": 0, "groq": 0}
_dead_keys: dict[str, dict[int, float]] = {"gemini": {}, "groq": {}}  # idx → death timestamp


def _is_dead(provider: str, idx: int) -> bool:
    """True if key is inside its cool-down window; expired entries are purged."""
    died_at = _dead_keys[provider].get(idx)
    if died_at is None:
        return False
    if time.monotonic() - died_at >= _DEAD_KEY_COOLDOWN_SECONDS:
        del _dead_keys[provider][idx]
        return False
    return True


def _pool(provider: str) -> list[str]:
    return _GEMINI_KEYS if provider == "gemini" else _GROQ_KEYS if provider == "groq" else []


def _next_live_idx(provider: str) -> int:
    """Round-robin index, skipping keys marked dead (cool-down)."""
    pool = _pool(provider)
    if not pool:
        raise ValueError(f"No API keys configured for provider '{provider}'. Check your .env file.")
    with _lock:
        for _ in range(len(pool)):
            idx = _counters[provider] % len(pool)
            _counters[provider] += 1
            if not _is_dead(provider, idx):
                return idx
        # All inside cool-down — reset and try fresh
        _dead_keys[provider].clear()
        idx = _counters[provider] % len(pool)
        _counters[provider] += 1
        return idx


def _build_raw_llm(provider: str, api_key: str, model: str | None, temperature: float, **kwargs):
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model or GEMINI_FAST_MODEL,
            google_api_key=api_key,
            temperature=temperature,
            **kwargs,
        )
    if provider == "groq":
        from langchain_groq import ChatGroq
        resolved = model or GROQ_MODEL
        # gpt-oss at reasoning_effort medium/high intermittently leaks the JSON
        # schema into the content channel (bench 2026-07-07: 2/4 structured
        # failures at medium, 4/4 pass at low). Low is also faster (~3s).
        if "gpt-oss" in resolved and "reasoning_effort" not in kwargs:
            kwargs["reasoning_effort"] = "low"
        return ChatGroq(
            model=resolved,
            groq_api_key=api_key,
            temperature=temperature,
            **kwargs,
        )
    raise ValueError(f"Unknown provider: {provider}")


# ── Rate-limit detection ─────────────────────────────────────────────────

_RATE_LIMIT_SIGNALS = (
    "rate limit", "ratelimit", "rate-limit",
    "quota", "exhausted", "resourceexhausted",
    "too many request", "429",
    "tokens per minute", "requests per minute",
    "tpm", "rpm",
)


def _is_rate_limit_error(e: Exception) -> bool:
    msg = str(e).lower()
    if any(s in msg for s in _RATE_LIMIT_SIGNALS):
        return True
    # langchain wraps errors — also check class name + nested status
    cls = type(e).__name__.lower()
    if "ratelimit" in cls or "resourceexhausted" in cls or "quotaexceeded" in cls:
        return True
    status = getattr(e, "status_code", None) or getattr(e, "code", None)
    if status == 429:
        return True
    return False


# ── Failover wrapper ─────────────────────────────────────────────────────

class FailoverLLM:
    """Drop-in LLM that retries with next API key on rate-limit errors.

    Supports the subset of the langchain LLM interface used here:
    - `.invoke(prompt)`
    - `.with_structured_output(schema).invoke(prompt)`
    """

    def __init__(self, provider: str, model: str | None = None, temperature: float = 0.3, **kwargs):
        self.provider = provider
        self.model = model
        self.temperature = temperature
        self.kwargs = kwargs
        self._idx: int | None = None
        self._llm = None
        self._rotate()

    def _rotate(self) -> None:
        pool = _pool(self.provider)
        self._idx = _next_live_idx(self.provider)
        self._llm = _build_raw_llm(self.provider, pool[self._idx], self.model, self.temperature, **self.kwargs)
        print(f"[LLM Factory] {self.provider} using slot {self._idx + 1}/{len(pool)}")

    def _call_with_failover(self, fn):
        """Execute fn(llm), rotating on rate-limit until pool exhausted."""
        pool_size = len(_pool(self.provider))
        last_err: Exception | None = None
        for attempt in range(pool_size):
            try:
                return fn(self._llm)
            except Exception as e:
                last_err = e
                if not _is_rate_limit_error(e):
                    raise
                with _lock:
                    if self._idx is not None:
                        _dead_keys[self.provider][self._idx] = time.monotonic()
                print(f"[LLM Factory] {self.provider} slot {self._idx + 1} hit rate limit → rotating ({attempt + 1}/{pool_size})")
                self._rotate()
        raise RuntimeError(f"All {self.provider} API keys exhausted (rate-limited).") from last_err

    # ── langchain-compatible surface ──────────────────────────────────
    def invoke(self, *args, **kwargs):
        return self._call_with_failover(lambda llm: llm.invoke(*args, **kwargs))

    def with_structured_output(self, schema, **so_kwargs):
        # gpt-oss models on Groq 400 on the default forced tool-choice method;
        # they support strict json_schema response format instead.
        effective_model = self.model or (GROQ_MODEL if self.provider == "groq" else GEMINI_FAST_MODEL)
        if self.provider == "groq" and "gpt-oss" in effective_model and "method" not in so_kwargs:
            so_kwargs["method"] = "json_schema"
        return _StructuredFailoverProxy(self, schema, so_kwargs)

    # Forward unknown attribute access (e.g. .bind_tools) to current llm
    def __getattr__(self, name: str) -> Any:
        return getattr(self._llm, name)


class _StructuredFailoverProxy:
    """Returned from FailoverLLM.with_structured_output(); retries the whole structured call."""

    def __init__(self, parent: FailoverLLM, schema, so_kwargs: dict):
        self.parent = parent
        self.schema = schema
        self.so_kwargs = so_kwargs

    def invoke(self, *args, **kwargs):
        def call(llm):
            return llm.with_structured_output(self.schema, **self.so_kwargs).invoke(*args, **kwargs)
        return self.parent._call_with_failover(call)


# ── Public API ───────────────────────────────────────────────────────────

def get_llm(
    provider: Literal["gemini", "groq"] = "gemini",
    model: str | None = None,
    temperature: float = 0.3,
    **kwargs,
) -> FailoverLLM:
    """Return a FailoverLLM. Picks key via round-robin, rotates on rate-limit."""
    return FailoverLLM(provider, model=model, temperature=temperature, **kwargs)


def pool_status() -> dict[str, dict[str, Any]]:
    """Debug helper — current pool size, counters, dead keys."""
    return {
        "gemini": {"size": len(_GEMINI_KEYS), "counter": _counters["gemini"], "dead": sorted(_dead_keys["gemini"].keys())},
        "groq":   {"size": len(_GROQ_KEYS),   "counter": _counters["groq"],   "dead": sorted(_dead_keys["groq"].keys())},
    }
