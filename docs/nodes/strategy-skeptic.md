# Node 10a — `strategy_skeptic`

**File:** [`backend/app/graph/nodes/strategy_skeptic.py`](../../backend/app/graph/nodes/strategy_skeptic.py) (thin wrapper) → [`backend/app/graph/agents/discovery/strategy_skeptic.py`](../../backend/app/graph/agents/discovery/strategy_skeptic.py).

**Added in F9.** Adversarial pre-simulation review of `merged_strategies`. Inserted between `strategy_merge` and `simulation`.

## Why

Without this node, weak strategies (vague `target_event`, missing copy when `can_ship: "No"`, wildly overclaimed `expected_lift_pct`) reach the simulation and critic with no challenge. The simulation will still produce a number; the critic can catch some violations but not subtle plausibility issues. The skeptic is the dedicated "break it" pass.

## Model

Gemini 3 Flash Preview via `get_llm("gemini", temperature=0.4)`. Single call, structured output.

## Inputs (from state)

| Key | Used for |
|---|---|
| `strategy_outputs.merged_strategies` | Primary input — the target of review. |
| `verified_root_causes` | Each tactic must address one. |
| `top_segments` | Strategies should target these. |
| `constrained_brief` | Feasibility hard floor. |
| `questionnaire` | `priority_segment`, `timeline`, `can_ship_changes`, `support_model`, `pricing_flexibility`, `retention_tactics`. |

## What it flags

```
For EACH strategy that has issues, produce at least one WeakPoint. Look for:
- Missing or vague target_event / trigger_window / success_metric_formula.
- expected_lift_pct numbers that wildly diverge from typical SaaS retention lifts
  (>30 pp on a single tactic is almost always overclaimed).
- Tactics that ignore the priority_segment or top_segments table.
- Tactics that quietly require product/eng work when can_ship is "No".
- Tactics that quietly require CSM motions when support_model is self-serve.
- Tactics that re-tread already-tried items.
- A min_sample_size that's bigger than the entire targeted segment.
- copy_example missing or filler ("TBD", "n/a") when can_ship is "No".
```

The over-claim threshold (`>30 pp on a single tactic`) matches the `_LIFT_CLAMP_PCT = 30.0` in simulation.py — if the skeptic flags it and the simulation clamps it, they agree.

## Output (state key `strategy_skeptic_output`)

```python
{
    "agent": "strategy_skeptic",
    "weak_points": [
        {"tactic": str, "weakness": str, "severity": "low"|"medium"|"high"},
        ...
    ],
    "assumption_risks": [
        {"assumption": str, "why_risky": str, "mitigation": str},
        ...
    ],
    "alternative_tactics": [
        {"instead_of": str, "alternative": str, "why_better": str},
        ...
    ],
    "overall_robustness": float,        # 0..1 — <0.55 means "do not ship without changes"
    "headline_critique": str,           # one-sentence verdict for the critic to read
}
```

Empty-strategies fallback: if `merged_strategies` is empty (all three agents errored), returns a synthetic high-severity weak_point and `overall_robustness: 0.0`.

## Critic integration

`strategy_critic` reads `strategy_skeptic_output` and applies two gates:

1. **Hard gate.** Any `weak_point` with `severity == "high"` adds to `constraint_violations`. The critic's verdict is forced to `"violation"` regardless of LLM verdict.
2. **Soft gate.** `overall_robustness < 0.5` is an additional `"low_lift"` trigger.

The skeptic's `weak_points` are also merged into `criticism.weaknesses` as `[skeptic:<severity>] <tactic>: <weakness>` strings, so the F8 critic-feedback block (in `build_critic_feedback_block`) propagates them to retry agents when retries are enabled.

## Failure handling

Try/except. On failure returns `{agent: "strategy_skeptic", error: str(e), weak_points: [], ..., overall_robustness: 0.0, headline_critique: f"Skeptic error: {e}"}`. The downstream critic sees zero weak_points and zero robustness — it falls back to the LLM verdict alone (and `robustness < 0.5` will still trigger `low_lift`).

## Wall time

10–20 s. Single Gemini structured-output call.

## Deep dive

Agent-level reference: [`docs/agents/strategy-skeptic.md`](../agents/strategy-skeptic.md).
