# Agent — Growth Hacker

**File:** [`backend/app/graph/agents/execution/growth_hacker.py`](../../backend/app/graph/agents/execution/growth_hacker.py).

Strategy Pod agent. Design AARRR-style activation experiments and viral loops with real A/B sample sizes.

For node-level context: [`docs/nodes/growth-hacker.md`](../nodes/growth-hacker.md).

## Model

| | |
|---|---|
| Provider | Groq |
| Model ID | `openai/gpt-oss-120b` |
| Temp | `0.6` (warmest of the three strategy agents) |
| Keys | Round-robin via `FailoverLLM` |
| Quirks | Factory auto-applies `reasoning_effort="low"` + `method="json_schema"` for this model. |

## Pydantic schema

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

class AdditionalTactic(BaseModel):
    name: str
    description: str
    target_metric: str
    expected_lift: float
    implementation_timeline: str
    confidence: float = Field(default=0.8)
    # ...all F6 fields Optional[...]

class ExperimentDesign(BaseModel):
    test_name: str
    control: str
    variant: str
    metric: str
    sample_size: int
    duration_days: int

class ActivationImprovement(BaseModel):
    focus: str
    current_step: str
    improvement: str
    estimated_lift: float

class ViralLoop(BaseModel):
    loop: str
    trigger: str
    incentive: str
    estimated_impact: str

class SpeedToImpact(BaseModel):
    quick_wins: List[str]
    medium_term: List[str]
    long_term: List[str]
    prioritization_logic: str

class GrowthHackerResult(BaseModel):
    top_tactic: StrictTopTactic
    additional_tactics: List[AdditionalTactic] = Field(default_factory=list)
    experiment_designs: List[ExperimentDesign]
    activation_improvements: List[ActivationImprovement]
    viral_loops: List[ViralLoop]
    speed_to_impact: SpeedToImpact
```

## Public entry point

```python
def run_growth_hacker(state: RetentionGraphState) -> dict[str, Any]:
```

## Inputs (from state)

| Key | Used for |
|---|---|
| `verified_root_causes` | Each tactic addresses one. |
| `constrained_brief` | Feasibility floor. |
| `top_segments` | Real segment sizes feed `experiment_designs.sample_size`. |
| `questionnaire` | `business_model`, `timeline`, `can_ship_changes`, `priority_segment`, `retention_tactics`. |
| `human_clarification.responses` | HITL answers. |

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

Output rules (STRICT):
- top_tactic is your single highest-lift bet. It MUST include concrete, non-empty values
  for target_event, trigger_window, success_metric_formula, min_sample_size,
  expected_lift_pct_p50, expected_lift_pct_p90, copy_example.
  If can_ship is "No", copy_example must be real, ready-to-send copy.
```

The "sample size uses segment size" rule is why `top_segments` is fed in — without it the agent invents implausible sample sizes that exceed the target segment population. The strategy_skeptic explicitly checks for this and flags it as a weak_point.

## Output

```python
{
    "agent": "growth_hacker",
    "top_tactic": {...StrictTopTactic..., "is_top_ranked": True},
    "additional_tactics": [{...AdditionalTactic...}, ...],
    "proposed_tactics": [<top>, *additional],
    "experiment_designs": [{test_name, control, variant, metric, sample_size, duration_days}, ...],
    "activation_improvements": [{focus, current_step, improvement, estimated_lift}, ...],
    "viral_loops": [{loop, trigger, incentive, estimated_impact}, ...],
    "speed_to_impact": {quick_wins, medium_term, long_term, prioritization_logic},
    "framework": "Pirate Metrics (AARRR)",
    "confidence": <avg>,
}
```

## Failure handling

```python
except Exception as e:
    return {"agent": "growth_hacker", "error": str(e)}
```

## Wall time

~3–5 s.

## Why the warmest temperature

Experiment design rewards variance — the critic downstream is cold (0.1) and the skeptic (0.4) both kill anything that doesn't hold up. Creative exploration at this stage feeds them with options. Temp 0.6 is the upper bound before Llama starts producing actively wrong outputs (e.g. `sample_size: 9999999`).
