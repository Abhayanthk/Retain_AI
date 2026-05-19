# Node 6 — `hypothesis_validation`

**File:** [`backend/app/graph/nodes/hypothesis_validation.py`](../../backend/app/graph/nodes/hypothesis_validation.py).

Pure-Python gate. Combines each merged hypothesis's confidence (from the forensic vote) with the professional skeptic's robustness score, then sets `hypothesis_status` to one of `"verified"` / `"weak_proof"` / `"unverified"`.

## Inputs

| Key | Used for |
|---|---|
| `diagnosis_results.merged_hypotheses` | Top 3 causes. |
| `professional_skeptic_output.robustness_scores` | Per-cause robustness from the skeptic. |

## Gate logic

For each hypothesis:

| Condition | Outcome |
|---|---|
| `confidence > 0.50 AND robustness > 0.35` | Strong gate. `evidence: "Statistical validation passed"`. Sets `hypothesis_status = "verified"`. |
| `confidence > 0.35` | Weak gate. `evidence: "Weak statistical support"`. Sets `hypothesis_status = "weak_proof"` (if not already verified). |
| Both fail | Hypothesis dropped. Doesn't appear in `verified_root_causes`. |

If no hypothesis passes either gate, `hypothesis_status = "unverified"`.

## Output

### `verified_root_causes`

```python
[
    {
        "cause": str,
        "confidence": float,
        "robustness": float,
        "evidence": "Statistical validation passed" | "Weak statistical support",
        "p_value": 1 - confidence,            # rough approximation
        "recommendation": "Proceed to constraint-aware strategy design" | "Require additional discovery iterations",
    },
    ...
]
```

Note `citations` is **not** carried into this output — downstream consumers (strategy agents) read them from `state.diagnosis_results.merged_hypotheses[*].citations` if needed.

### `validation_metrics`

```python
{
    "hypotheses_tested": int,
    "hypotheses_verified": int,              # only strong-gate passes
    "validation_quality": float,             # mean robustness of all retained
}
```

## Routing

`route_after_hypothesis_validation` in `conditions.py`:

```python
if state.get("hypothesis_status") == "verified":
    return "constraint_add"
if state.get("discovery_attempts", 0) >= MAX_DISCOVERY_ATTEMPTS:
    return "constraint_add"
return "behavioral_map"               # loop back through Discovery Pod
```

With `MAX_DISCOVERY_ATTEMPTS = 0` and `discovery_attempts` already at 1 after the first diagnosis_merge pass, the condition `1 >= 0` is always true → **always forwards to constraint_add**. The retry-on-weak-proof loop is currently disabled to avoid doubling state RSS on Render's free tier.

To enable: set `MAX_DISCOVERY_ATTEMPTS = 1` (one retry) or higher. The loop will then re-run the entire Discovery Pod with the same inputs — slightly randomized LLM output may produce different causes.

## Why the gate values

- **0.50 confidence cutoff:** the forensic vote's mean confidence rarely drops below 0.5 for causes that survived the ≥2/3 vote, so the strong-gate confidence filter is mostly a sanity check. The robustness filter is the more discriminating one.
- **0.35 robustness cutoff:** skeptic robustness scores cluster around 0.4–0.7 for plausible causes. Anything below 0.35 typically means the skeptic flagged the cause as confounded or contradicted.
- **0.35 weak-gate confidence:** retains low-confidence causes so the playbook still has *something* to work with even when forensic was uncertain. Better to ship a degraded playbook than to fail open.

## Failure handling

Wrapped in try/except. On failure returns `{hypothesis_status: "unverified", verified_root_causes: []}`. Downstream constraint_add will see no causes and produce an empty `constrained_brief.feasible_interventions`. The strategy agents then operate on an empty list and produce minimal output. Not a crash, just a degraded playbook.
