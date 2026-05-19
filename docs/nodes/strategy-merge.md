# Node 9d — `strategy_merge`

**File:** [`backend/app/graph/nodes/strategy_merge.py`](../../backend/app/graph/nodes/strategy_merge.py).

Fan-in after the three parallel Strategy Pod agents. Pure Python — no LLM call.

## What it does

Pull each agent's strict top intervention into a single ranked `merged_strategies` list, forwarding F6 operational fields so downstream consumers (simulation / critic / dossier / architect) don't have to walk per-agent outputs.

## Merge rule

For each agent that didn't error:

| Agent | Top pulled from | Agent-specific fields surfaced |
|---|---|---|
| Unit Economist | `top_intervention` or `top_roi_intervention` or `proposed_interventions[0]` | `expected_roi`, `estimated_cost`, `cost_usd` |
| JTBD Specialist | `top_intervention` or `proposed_interventions[0]` | `expected_impact`, `job_focus`, `implementation_effort` |
| Growth Hacker | `top_tactic` or `proposed_tactics[0]` | `expected_lift`, `target_metric`, `implementation_timeline` |

All entries share: `rank`, `recommendation`, `framework`, `confidence`, `rationale`.

## F6 operational fields forwarded

```python
_OPS_FIELDS = (
    "target_event", "trigger_window", "success_metric_formula",
    "min_sample_size", "expected_lift_pct_p50", "expected_lift_pct_p90",
    "copy_example", "is_top_ranked",
)

def _ops(src: dict) -> dict:
    return {k: src.get(k) for k in _OPS_FIELDS if src.get(k) is not None}
```

Each merged entry gets `**_ops(best)` spread in. Downstream nodes can read e.g. `merged_strategies[0].target_event` without walking back to `unit_economist_output.top_intervention.target_event`.

## Output

```python
{
    "strategy_outputs": {
        "unit_economics_strategy": <full unit_economist_output>,
        "jtbd_strategy":           <full jtbd_specialist_output>,
        "growth_strategy":         <full growth_hacker_output>,
        "merged_strategies": [
            {
                "rank": 1,
                "recommendation": str,
                "framework": str,
                "confidence": float,
                "rationale": str,
                "expected_roi": float,       # unit_economist only
                "estimated_cost": str,
                "cost_usd": float,
                "target_event": str,         # F6
                "trigger_window": str,       # F6
                "success_metric_formula": str,
                "min_sample_size": int,
                "expected_lift_pct_p50": float,
                "expected_lift_pct_p90": float,
                "copy_example": str,
                "is_top_ranked": True,
            },
            {rank: 2, ...JTBD...},
            {rank: 3, ...Growth Hacker...},
        ],
        "strategy_summary": {
            "total_recommendations": int,
            "frameworks_applied": [...],
            "consensus_recommendation": merged_strategies[0],
        },
    },
    "current_node": "strategy_merge",
}
```

## Iteration count — NOT incremented here

Earlier versions of this node incremented `iteration_count`, double-counting with `strategy_critic`. That caused `MAX_CRITIC_ITERATIONS` to exit one pass too early. Fix: only `strategy_critic` increments now. `strategy_merge` is observation-only on the count.

## Failure handling

Try/except. On failure returns `{strategy_outputs: {merged_strategies: [], error: str(e)}}` and appends to `errors`. Downstream simulation sees zero strategies and produces a fallback `expected_lift = 12.0` constant.

## Wall time

<100 ms. Just dict manipulation.

## Why not LLM-merge

The three agents are intentionally redundant — each frames the same problem differently. Picking the "best" combined strategy by LLM would just paraphrase one of the three with extra cost. The downstream `strategy_skeptic` then adversarially reviews this merged list before simulation.
