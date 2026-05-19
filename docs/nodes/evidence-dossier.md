# Node 11b — `evidence_dossier`

**File:** [`backend/app/graph/nodes/evidence_dossier.py`](../../backend/app/graph/nodes/evidence_dossier.py).

**Added in F11.** Pure Python — no LLM call. Inserted between `strategy_critic` (approval branch) and `execution_architect`.

## Why

The pre-F11 architect prompt was given root_causes, strategies, simulations, skeptic, critic — all as separate JSON blobs. The LLM had to "join" them itself, frequently producing playbooks where Problem #N referenced one cause but the solution belonged to a different cause's tactic. The dossier pre-builds the join — one row per top-3 problem with the stat / cause / tactic / outcome / risk / mitigation pre-paired.

The architect prompt now says: "Problem #N MUST correspond to dossier row #N". Deterministic mapping, no LLM join-by-vibes.

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Top 3 become problems 1..3. |
| `strategy_outputs.merged_strategies` | Tactic per problem (rank-aligned). |
| `forensic_detective_output.statistical_evidence` | Stat bucket lookup for each cause. |
| `simulations.intervention_impacts` | Simulated outcome per problem. |
| `strategy_skeptic_output.weak_points` | Risk per tactic (fuzzy match). |
| `strategy_skeptic_output.assumption_risks` | Mitigation per tactic (fuzzy match). |
| `criticism.weaknesses` | Risk fallback. |
| `criticism.recommendations` | Mitigation fallback. |

## Row shape

```python
{
    "rank": int,
    "stat": {
        "stat_id": str,          # e.g. "plan_tier::Starter"
        "source": str,           # bucket name, e.g. "churn_by_plan_tier"
        "churn_rate": float,
        "size": int,
        "label": str,
    },
    "cause": {
        "text": str,
        "confidence": float,
        "citations": [chunk_id, ...],
    },
    "tactic": {
        "recommendation": str,
        "framework": str,
        "target_event": str,         # F6
        "trigger_window": str,
        "success_metric_formula": str,
        "min_sample_size": int,
        "expected_lift_pct_p50": float,
        "expected_lift_pct_p90": float,
        "copy_example": str,
    },
    "simulated_outcome": {
        "mean_lift": float,
        "percentile_10": float,
        "percentile_90": float,
        "lift_prior_anchor": "rag" | "self_reported",
        "lift_prior_citations": [...],
    },
    "risk": {
        "source": "strategy_skeptic" | "strategy_critic" | "none",
        "severity": "low" | "medium" | "high",
        "description": str,
    },
    "mitigation": {
        "source": "strategy_skeptic" | "strategy_critic" | "none",
        "description": str,
    },
}
```

## Stat matching

`_best_stat_for_cause(cause_text, stats)`:

1. Tokenize cause text → keywords (length ≥ 5, drop stopwords like `the`, `users`, `churn`).
2. For each `(bucket_name, label)` pair across all stat buckets, compute keyword overlap with `f"{bucket_name} {label}"`.
3. Score = `overlap * 1000 + churn_rate * size`. Exact-keyword matches dominate raw impact.
4. Return the highest-scoring bucket.

This mirrors the F15 frontend evidence drawer's heuristic, so the stat shown in the playbook matches the stat surfaced in the drawer.

## Risk attribution

```python
risk_obj = _best_match_for_tactic(tactic_text, skeptic_weak, "tactic")
if risk_obj:
    risk = {"source": "strategy_skeptic", "severity": ..., "description": ...}
elif critic_weaknesses:
    risk = {"source": "strategy_critic", "severity": "medium", "description": critic_weaknesses[0]}
else:
    risk = {"source": "none", "severity": "low", "description": "No specific risk surfaced upstream."}
```

Priority: skeptic weak_point matching the tactic > first critic weakness > generic placeholder.

## Mitigation attribution

```python
mit_obj = _best_match_for_tactic(tactic_text, skeptic_assumptions, "assumption")
if mit_obj and mit_obj.get("mitigation"):
    mitigation = {"source": "strategy_skeptic", "description": mit_obj["mitigation"]}
elif critic_recommendations:
    mitigation = {"source": "strategy_critic", "description": critic_recommendations[0]}
else:
    mitigation = {"source": "none", "description": "Monitor success_metric for 2 review cycles before scaling."}
```

Priority: skeptic assumption_risk mitigation matching the tactic > first critic recommendation > generic placeholder.

## Output (state key `evidence_dossier`)

```python
[
    <row for rank 1>,
    <row for rank 2>,
    <row for rank 3>,
]
```

Length = `min(3, len(merged_strategies))`. If fewer than 3 strategies survived, the dossier is shorter. If fewer than 3 verified causes, the same cause is reused (with rank-aligned tactics).

## Architect integration

`execution_architect` reads the dossier and:

1. Injects it into both the pass-1 trace prompt AND the pass-2 structured prompt as a `## Evidence Dossier` section.
2. Tells the LLM: "Problem #N in your output MUST correspond to dossier row #N. Use the dossier `stat` for `current_impact`, `risk` for `risks_and_mitigations`, `mitigation` for `contingency`."
3. After Pydantic validation + de-dedupe, attaches `rationale_chain = evidence_dossier[idx]` to each `problems_and_solutions[idx]` dict. (Schema isn't extended — `rationale_chain` is grafted on the dumped dict.)

The frontend F16 RationaleChainStrip then renders this `rationale_chain` field as the tone-coloured strip inside each expanded ProblemCard.

## Failure handling

Try/except. On any error returns `{evidence_dossier: [], errors: [...]}`. Architect then operates without the dossier section (prompt says "(no dossier — fall back to root_causes + strategies)") and the playbook still ships, just without the rationale-chain join.

## Wall time

<50 ms. Just dict manipulation.

## Why pure Python

Every element of the dossier was already computed by an upstream node. There's no synthesis work here — only joining. LLM-driven joining is exactly the failure mode this node fixes.
