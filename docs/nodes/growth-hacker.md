# Node 9c — `growth_hacker`

**File:** [`backend/app/graph/nodes/growth_hacker_node.py`](../../backend/app/graph/nodes/growth_hacker_node.py) (thin wrapper) → [`backend/app/graph/agents/execution/growth_hacker.py`](../../backend/app/graph/agents/execution/growth_hacker.py).

Parallel sibling of `unit_economist` and `jtbd_specialist`. Fan-in at [`strategy_merge`](./strategy-merge.md).

## What it does

Design **AARRR-style** experiments and activation improvements: specific A/B tests with sample sizes, durations, control/variant descriptions, and viral loops.

## Model

Groq `llama-3.3-70b-versatile` via `get_llm("groq", temperature=0.6)`. Warmest of the strategy agents — experiment design rewards exploration.

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Primary input — each tactic addresses one. |
| `constrained_brief` | Feasibility floor. |
| `top_segments` | Real segment sizes feed A/B sample-size math. |
| `questionnaire` | `business_model`, `timeline`, `can_ship_changes`, `priority_segment`, `retention_tactics`. |
| `human_clarification.responses` | HITL answers. |
| `criticism` (via `build_critic_feedback_block`) | Retry-pass feedback. |

## Output schema

Same strict-top / relaxed-rest pattern:

```python
class StrictTopTactic(BaseModel):
    name: str
    description: str
    target_metric: str
    expected_lift: float
    implementation_timeline: str
    confidence: float = Field(default=0.8)
    target_event: str                # e.g. "no_login_d3", "activation_step_2_drop"
    trigger_window: str              # e.g. "within 24h of trigger event"
    success_metric_formula: str      # e.g. "d14_retention = returned_d14 / signups"
    min_sample_size: int
    expected_lift_pct_p50: float
    expected_lift_pct_p90: float
    copy_example: str

class GrowthHackerResult(BaseModel):
    top_tactic: StrictTopTactic
    additional_tactics: List[AdditionalTactic] = Field(default_factory=list)
    experiment_designs: List[ExperimentDesign]
    activation_improvements: List[ActivationImprovement]
    viral_loops: List[ViralLoop]
    speed_to_impact: SpeedToImpact
```

## Prompt rules

```
Instructions:
- If can_ship is "No", every tactic and quick_win must require zero product/engineering
  changes (email, copy, settings, campaigns only).
- If timeline is "Quick wins (30 days)", populate quick_wins with >= 3 tactics achievable
  in <= 30 days; set long_term to [].
- If timeline is "6-month strategic shift" or "Long-term", include a rich long_term list.
- Do NOT propose tactics already tried.
- For each top segment, design at least one experiment targeted at that segment specifically
  (trigger uses segment definition, sample size uses segment size).
```

The "sample size uses segment size" rule is why `top_segments` is fed into the prompt — without it the agent invents implausible sample sizes that exceed the target segment.

## Output (state key `growth_hacker_output`)

```python
{
    "agent": "growth_hacker",
    "top_tactic": {...StrictTopTactic..., "is_top_ranked": True},
    "additional_tactics": [{...AdditionalTactic...}, ...],
    "proposed_tactics": [<top>, <additional...>],
    "experiment_designs": [
        {"test_name", "control", "variant", "metric", "sample_size", "duration_days"},
        ...
    ],
    "activation_improvements": [{"focus", "current_step", "improvement", "estimated_lift"}, ...],
    "viral_loops": [{"loop", "trigger", "incentive", "estimated_impact"}, ...],
    "speed_to_impact": {
        "quick_wins": [...],
        "medium_term": [...],
        "long_term": [...],
        "prioritization_logic": str,
    },
    "framework": "Pirate Metrics (AARRR)",
    "confidence": <avg>,
}
```

## Failure handling

Try/except. On failure returns `{agent: "growth_hacker", error: str(e)}`.

## Wall time

5–10 s.

## Deep dive

Agent-level reference: [`docs/agents/growth-hacker.md`](../agents/growth-hacker.md).
