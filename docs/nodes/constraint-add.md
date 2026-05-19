# Node 7 — `constraint_add`

**File:** [`backend/app/graph/nodes/constraint_add.py`](../../backend/app/graph/nodes/constraint_add.py).

Pure-Python feasibility filter. Applies budget + legal constraints to verified root causes and produces a ranked list of feasible interventions for downstream consumption.

## Inputs

| Key | Used for |
|---|---|
| `verified_root_causes` | From `hypothesis_validation`. |
| `input_constraints.budget_constraints` | `"low"` / `"medium"` / anything else. |
| `input_constraints.legal_constraints` | List of strings. GDPR is the only one with rules wired in. |
| `input_context.business_context` | Pull-through into the brief. |

## Intervention cost heuristic

Keyword match on the cause text:

| If cause contains... | `intervention_cost` |
|---|---|
| `cheap`, `feature adoption` | `low` |
| `pricing`, `support` | `medium` |
| anything else | `high` |

## Budget filter

```python
if budget == "low" and intervention_cost in ["medium", "high"]: blocked
elif budget == "medium" and intervention_cost == "high":        blocked
else:                                                            ok
```

Blocked entries go into `applied_constraints` with reason `"Budget constraint (low budget)"` and outcome `"Eliminated"`.

## Legal filter

```python
for legal_issue in legal_constraints:
    if "gdpr" in legal_issue.lower() and "tracking" in cause_text.lower():
        blocked → applied_constraints {outcome: "Requires legal review"}
```

Only `GDPR + tracking` is wired in. Other legal regimes pass through. Extend by adding more `if` branches with the relevant keyword pair.

## Confidence floor

After cost + legal pass, drop anything with `confidence < 0.45`. This is the second time low-confidence causes get filtered (the first was in `hypothesis_validation` at 0.35) — `constraint_add` enforces a higher bar specifically for **actionable** items.

## Ranking

```python
key = confidence * (1.0 if cost == "low" else 0.8)
feasible_interventions.sort(key=key, descending=True)
```

Slight tilt toward low-cost interventions at equal confidence.

## Output

```python
constrained_brief = {
    "verified_causes": <original list>,                # unfiltered, for reference
    "applied_constraints": [
        {"constraint": str, "cause": str, "outcome": "Eliminated"|"Requires legal review"},
        ...
    ],
    "feasible_interventions": [
        {
            "cause": str,
            "confidence": float,
            "estimated_cost": "low"|"medium"|"high",
            "implementation_timeline": "30-60 days",
            "expected_lift": round(confidence * 25, 1),   # rough estimate, overridden later by simulation
        },
        ...
    ],
    "priority_ranking": [
        {"rank": 1, "intervention": str, "impact_score": round(confidence * 100, 1)},
        ...top 5
    ],
    "constraint_summary": {
        "total_constraints_applied": int,
        "causes_eliminated": int,
        "feasible_count": int,
    },
    "business_context": str,
}
```

## Why pure Python (no LLM)

Deterministic filtering with explicit business rules. An LLM here adds variance without value — the rules need to be auditable, especially the legal ones. The LLM re-enters at the Strategy Pod where it can be creative within the feasibility window this node defines.

## Downstream consumers

| Consumer | Reads |
|---|---|
| `adaptive_hitl` | `constrained_brief.applied_constraints` + `feasible_interventions` to craft clarifying questions. |
| All three strategy agents | `constrained_brief` is fed into every prompt verbatim (JSON-dumped, ~1000 chars). |
| `strategy_critic` | Fed in to ground constraint-violation detection. |
| `execution_architect` | Fed in for hard constraint enforcement. |

## Limitations

- The cost heuristic is a 3-bucket keyword match. A cause like `"pricing tier mismatch for enterprise"` is tagged `medium` cost; arguably it could be `high` if it requires plan-tier restructuring. Improve by adding more keywords or replace with an LLM cost-estimation step.
- The `expected_lift` estimate (`confidence × 25`) is a placeholder — the actual lift comes from the RAG-anchored simulation downstream. This field is mostly cosmetic.
