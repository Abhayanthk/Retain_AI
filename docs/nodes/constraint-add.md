# Node 7 — `constraint_add`

**File:** [`backend/app/graph/nodes/constraint_add.py`](../../backend/app/graph/nodes/constraint_add.py).

Pure-Python feasibility filter. Tags each verified root cause with a rough cost bucket and drops anything below a confidence floor.

## Removed: budget + legal filtering (2026-07)

Earlier versions of this node filtered causes by `input_constraints.budget_constraints` and applied a GDPR-specific legal rule. Both branches were **deleted** after an audit found the form never actually collects a budget or legal-constraint answer — `budget` and `legal_constraints` arrive as empty defaults from `input_ingest`, so `budget == "low"` / `"medium"` never matched anything and the code paths could never fire. Real operational constraints (`can_ship_changes`, `pricing_flexibility`, `support_model`, `retention_tactics`) are enforced downstream by the strategy agents, `strategy_skeptic`, and `strategy_critic` directly from the questionnaire — this node no longer duplicates that (badly, since it was reading fields that don't exist).

If you want real budget/legal filtering, the form would need to actually ask those questions first — see `frontend/app/form/page.tsx` for the current question set and [ui-flow.md](../ui-flow.md) for a note on which payload keys are dead weight.

## Inputs

| Key | Used for |
|---|---|
| `verified_root_causes` | From `hypothesis_validation`. |
| `input_context.business_context` | Pull-through into the brief. |

## Intervention cost heuristic

Keyword match on the cause text — informational only now, not a filter:

| If cause contains... | `intervention_cost` |
|---|---|
| `cheap`, `feature adoption` | `low` |
| `pricing`, `support` | `medium` |
| anything else | `high` |

## Confidence floor

Drop anything with `confidence < 0.45`. This is the second time low-confidence causes get filtered (the first was in `hypothesis_validation` at 0.35) — `constraint_add` enforces a higher bar specifically for **actionable** items.

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
    "applied_constraints": [],                          # always empty now — see "Removed" section above
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

Deterministic filtering with explicit business rules. An LLM here adds variance without value. The LLM re-enters at the Strategy Pod where it can be creative within the feasibility window the *questionnaire* (not this node) defines.

## Downstream consumers

| Consumer | Reads |
|---|---|
| `adaptive_hitl` | `constrained_brief.feasible_interventions` to craft clarifying questions. |
| All three strategy agents | `constrained_brief` is fed into every prompt verbatim (JSON-dumped, ~1000 chars). |
| `strategy_critic` | Fed in to ground constraint-violation detection. |
| `execution_architect` | Fed in for hard constraint enforcement. |

## Limitations

- The cost heuristic is a 3-bucket keyword match. A cause like `"pricing tier mismatch for enterprise"` is tagged `medium` cost; arguably it could be `high` if it requires plan-tier restructuring. Improve by adding more keywords or replace with an LLM cost-estimation step.
- The `expected_lift` estimate (`confidence × 25`) is a placeholder — the actual lift comes from the RAG-anchored simulation downstream. This field is mostly cosmetic.
