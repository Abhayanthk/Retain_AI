# LLM Factory — Round-Robin Keys + Failover

**File:** [`backend/app/config.py`](../backend/app/config.py).

Every LLM call in the pipeline goes through `get_llm(provider, model, temperature)`. Never instantiate `ChatGoogleGenerativeAI` or `ChatGroq` directly — the factory handles key rotation, dead-key cooldown, and 429 failover.

## Why this exists

Free-tier Gemini and Groq both rate-limit per key (RPM + TPM). One pipeline run fires ~10–15 Gemini calls and ~3 Groq calls; without rotation a single key would hit the RPM limit mid-run. The factory:

1. Discovers all `GOOGLE_API_KEY[_1..32]` and `GROQ_API_KEY[_1..32]` env vars.
2. Round-robins so each new `get_llm()` call grabs the next live key.
3. On a 429 / quota error, marks the key dead, rotates to the next, and retries — transparently to the caller.

The forensic detective's 3-way self-consistency vote runs concurrently in a `ThreadPoolExecutor`, so 3 different Gemini keys are in flight at once. With 8 keys configured, none of them hit the per-key RPM cap.

## Public API

```python
from app.config import get_llm

llm = get_llm("gemini", temperature=0.3)        # Gemini 3 Flash Preview (default)
llm = get_llm("groq",   temperature=0.5)        # Llama 3.3 70B (default)
llm = get_llm("gemini", model="gemini-3-flash-preview", temperature=0.2)

# Drop-in langchain interface:
response = llm.invoke(prompt_text)                                      # raw
structured = llm.with_structured_output(MyPydanticSchema).invoke(prompt) # function-calling
```

`get_llm()` returns a `FailoverLLM` wrapper. It forwards `.invoke()` and `.with_structured_output()` through `_call_with_failover`, which retries on rate-limit errors.

## Key discovery

```python
def _discover_keys(base: str, max_slots: int = 32) -> list[str]:
    keys = []
    plain = os.getenv(base)               # e.g. GOOGLE_API_KEY
    if plain: keys.append(plain)
    for i in range(1, max_slots + 1):
        v = os.getenv(f"{base}_{i}")      # GOOGLE_API_KEY_1, _2, ... _32
        if v and v not in keys: keys.append(v)
    return keys
```

`.env` example:

```
GOOGLE_API_KEY_1=...
GOOGLE_API_KEY_2=...
GOOGLE_API_KEY_3=...
GOOGLE_API_KEY_4=...
GOOGLE_API_KEY_5=...
GOOGLE_API_KEY_6=...
GOOGLE_API_KEY_7=...
GOOGLE_API_KEY_8=...
GROQ_API_KEY_1=...
GROQ_API_KEY_2=...
GROQ_API_KEY_3=...
```

Order matters only for the round-robin start point. Duplicates are deduped automatically.

## Round-robin + cooldown

```python
_counters: dict[str, int]      = {"gemini": 0, "groq": 0}
_dead_keys: dict[str, set[int]] = {"gemini": set(), "groq": set()}

def _next_live_idx(provider):
    pool = _pool(provider)
    with _lock:
        for _ in range(len(pool)):
            idx = _counters[provider] % len(pool)
            _counters[provider] += 1
            if idx not in _dead_keys[provider]:
                return idx
        # Whole pool exhausted — clear cooldown and try again
        _dead_keys[provider].clear()
        idx = _counters[provider] % len(pool)
        _counters[provider] += 1
        return idx
```

- `_counters` is monotonic — every `get_llm()` call advances the rotation by one regardless of which key it ends up on.
- `_dead_keys` is the cooldown set. Cleared automatically when every key in the pool has been marked dead (so the pipeline never gets stuck if every key happens to be rate-limited simultaneously).
- `threading.Lock` makes the counter+dead-set update atomic for concurrent thread-pool callers (forensic self-consistency, strategy pod fan-out).

## Failover

```python
def _call_with_failover(self, fn):
    pool_size = len(_pool(self.provider))
    for attempt in range(pool_size):
        try:
            return fn(self._llm)
        except Exception as e:
            if not _is_rate_limit_error(e):
                raise
            _dead_keys[self.provider].add(self._idx)
            print(f"[LLM Factory] {provider} slot {idx+1} hit rate limit → rotating ({attempt+1}/{pool_size})")
            self._rotate()
    raise RuntimeError(f"All {self.provider} API keys exhausted (rate-limited).")
```

Rate-limit detection (`_is_rate_limit_error`):

- Substring match on the exception message: `"rate limit"`, `"quota"`, `"exhausted"`, `"resourceexhausted"`, `"too many request"`, `"429"`, `"tokens per minute"`, `"requests per minute"`, `"tpm"`, `"rpm"`.
- Exception class name contains `"ratelimit"`, `"resourceexhausted"`, `"quotaexceeded"`.
- `e.status_code == 429` or `e.code == 429`.

Any other exception (timeout, malformed schema, network blip) is re-raised — failover only fires on actual rate-limit signals.

## Logs to look for

Every `_rotate()` prints:

```
[LLM Factory] gemini using slot 3/8
```

When a key 429s and we rotate:

```
[LLM Factory] gemini slot 3 hit rate limit → rotating (1/8)
[LLM Factory] gemini using slot 4/8
```

When every key is dead (pool exhausted):

```
RuntimeError: All gemini API keys exhausted (rate-limited).
```

## Adding a new provider

1. Update `_build_raw_llm(provider, api_key, model, temperature, **kwargs)` with an `elif provider == "anthropic": ...` branch.
2. Add the provider's keys to `_discover_keys()` (e.g. `ANTHROPIC_API_KEY[_N]`).
3. Update `_pool(provider)` to return the new list.
4. Add the provider literal to `get_llm`'s type hint.

## Debug helper

```python
from app.config import pool_status
print(pool_status())
# → {"gemini": {"size": 8, "counter": 42, "dead": [2, 5]}, "groq": {...}}
```

## Throughput vs latency

8 Gemini keys give 8× concurrent throughput but **no** improvement on single-call latency. The forensic self-consistency runs (`ThreadPoolExecutor(max_workers=3)`) benefit directly — 3 keys in flight = wall time = max(3 calls) instead of sum. Single sequential calls (e.g. the architect's two-pass synthesis) still take the full per-call time.

If forensic is the wall-time bottleneck, more keys won't help — shrink the prompt or output schema instead.
