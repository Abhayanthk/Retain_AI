# Agent — Strategy Skeptic

**File:** [`backend/app/graph/agents/discovery/strategy_skeptic.py`](../../backend/app/graph/agents/discovery/strategy_skeptic.py).

**Added in F9.** Adversarial reviewer of `merged_strategies`. Distinct from the [Professional Skeptic](./professional-skeptic.md) — that one reviews diagnoses, this one reviews **strategies** before they reach simulation.

For node-level context: [`docs/nodes/strategy-skeptic.md`](../nodes/strategy-skeptic.md).

## Why two skeptics

| | Professional Skeptic | Strategy Skeptic |
|---|---|---|
| Reviews | Forensic + pattern findings (causes, segments, sequences) | `merged_strategies` (tactics, copy, lift claims) |
| When | Inside `diagnosis_merge` | After `strategy_merge`, before `simulation` |
| Gates | `hypothesis_validation` robustness threshold | `strategy_critic` hard + soft gates |
| Naming | "Are these causes real?" | "Will these tactics actually ship and work?" |

Different review stages need different adversarial questions. Folding both into one agent would dilute both prompts.

## Model

| | |
|---|---|
| Provider | Google Gemini |
| Model ID | `gemini_model(depth, deep_call=True)` — fast tier (`gemini-3.1-flash-lite`) by default, deep tier (`gemini-3.5-flash`) when `analysis_depth == "deep"` |
| Temp | `0.4` |
| Keys | Round-robin via `FailoverLLM` |

## Pydantic schema

```python
class WeakPoint(BaseModel):
    tactic: str
    weakness: str
    severity: str            # "low" | "medium" | "high"

class AssumptionRisk(BaseModel):
    assumption: str
    why_risky: str
    mitigation: str

class AlternativeTactic(BaseModel):
    instead_of: str
    alternative: str
    why_better: str

class StrategySkepticResult(BaseModel):
    weak_points: List[WeakPoint]
    assumption_risks: List[AssumptionRisk]
    alternative_tactics: List[AlternativeTactic]
    overall_robustness: float        # 0..1
    headline_critique: str
```

## Public entry point

```python
def run_strategy_skeptic(state: RetentionGraphState) -> dict[str, Any]:
```

Pulled directly from state — no separate args.

## Inputs (from state)

| Key | Used for |
|---|---|
| `strategy_outputs.merged_strategies` | Primary input — target of review. |
| `verified_root_causes` | Cross-reference each tactic. |
| `top_segments` | Strategies should target these. |
| `constrained_brief` | Feasibility floor. |
| `questionnaire` | `priority_segment`, `timeline`, `can_ship_changes`, `support_model`, `pricing_flexibility`, `retention_tactics`. |

## Empty-strategies fallback

```python
if not merged_strategies:
    return {
        "agent": "strategy_skeptic",
        "weak_points": [{
            "tactic": "(no strategies)",
            "weakness": "Strategy merge produced no recommendations — upstream agent failure.",
            "severity": "high",
        }],
        "assumption_risks": [],
        "alternative_tactics": [],
        "overall_robustness": 0.0,
        "headline_critique": "No strategies to evaluate.",
    }
```

A high-severity weak_point on no-strategies forces the critic into `violation` verdict immediately. The architect then operates with no merged strategies and produces a degraded playbook based on root_causes alone.

## Prompt

```
You are a Strategy Skeptic — an adversarial reviewer hired to break weak strategies BEFORE they ship.
Your job is to challenge the proposed strategies against the actual data and constraints,
NOT to produce them. Be specific. Generic doubt is useless.

## Hard constraints (a tactic that violates these is automatically a high-severity weak_point)
- Priority segment: {priority_segment}
- Timeline: {timeline}
- Can ship product changes: {can_ship}
- Support model: {support_model}
- Pricing flexibility: {pricing_flex}
- Already tried (re-proposing = automatic weak_point): {already_tried}

## Verified Root Causes
{causes}

## Top Segments (size + churn — strategies should target these)
{top_segments}

## Proposed Strategies (review these one by one)
{strategies}

For EACH strategy that has issues, produce at least one WeakPoint. Look for:
- Missing or vague target_event / trigger_window / success_metric_formula.
- expected_lift_pct numbers that wildly diverge from typical SaaS retention lifts (>30 pp
  on a single tactic is almost always overclaimed).
- Tactics that ignore the priority_segment or top_segments table.
- Tactics that quietly require product/eng work when can_ship is "No".
- Tactics that quietly require CSM motions when support_model is self-serve.
- Tactics that re-tread already-tried items.
- A min_sample_size that's bigger than the entire targeted segment.
- copy_example missing or filler ("TBD", "n/a") when can_ship is "No".

For assumption_risks, surface implicit dependencies (e.g. "assumes day-1 push notifications
drive day-7 retention — has not been shown for this audience").

For alternative_tactics, propose 1-3 concrete swaps (one per the weakest proposed strategies). Each must:
- Target the same root cause.
- Be MORE evidence-grounded or operationally cheaper than the original.

Constraints on output values:
- severity: "low" | "medium" | "high".
- overall_robustness in [0.0, 1.0]. < 0.55 means "do not ship without changes".
```

## Output (state key `strategy_skeptic_output`)

```python
{
    "agent": "strategy_skeptic",
    "weak_points": [{tactic, weakness, severity}, ...],
    "assumption_risks": [{assumption, why_risky, mitigation}, ...],
    "alternative_tactics": [{instead_of, alternative, why_better}, ...],
    "overall_robustness": float,
    "headline_critique": str,
}
```

## How its output flows downstream

| Consumer | How |
|---|---|
| `strategy_critic` (hard gate) | High-severity weak_points → `constraint_violations += len(skeptic_high_severity)`; verdict forced to `violation` if any exist. |
| `strategy_critic` (soft gate) | `overall_robustness < 0.5` → additional `low_lift` trigger. |
| `strategy_critic` (prompt) | `headline_critique`, `overall_robustness`, `weak_points`, `assumption_risks` all injected into critic prompt. |
| `strategy_critic` (merge) | Weak_points appended to `criticism.weaknesses` as `[skeptic:<severity>] <tactic>: <weakness>`. Propagates to F8 critic-feedback block on retry. |
| `evidence_dossier` | `weak_points` matched against tactic text for per-problem `risk`. `assumption_risks` matched for `mitigation`. |
| `execution_architect` | Indirectly via the dossier's `risk` / `mitigation` and via critic's merged weaknesses. |
| Frontend simulation panel | Surfaced as a chip strip under each intervention via `simulation_ready` SSE payload. |

## Output examples (realistic shapes)

```python
weak_points = [
    {
        "tactic": "Trigger upgrade email on day 7",
        "weakness": "copy_example missing despite can_ship='No' — agent claimed product nudge",
        "severity": "high",
    },
    {
        "tactic": "Add CSM check-in for Starter plan",
        "weakness": "support_model is 'Self-serve only' — proposes CSM motion",
        "severity": "high",
    },
    {
        "tactic": "Activate users via day-3 webinar invite",
        "weakness": "expected_lift_pct_p50=35 — exceeds typical 5-15pp range for single nudge",
        "severity": "medium",
    },
]

assumption_risks = [
    {
        "assumption": "Day-7 trigger captures inactive users",
        "why_risky": "Median time-to-first-value in this dataset is 11 days — most users haven't hit aha by day 7",
        "mitigation": "Move trigger to day 14 or condition on activation_event=False",
    },
]

alternative_tactics = [
    {
        "instead_of": "Add CSM check-in for Starter plan",
        "alternative": "Automated email digest summarizing this week's usage gaps",
        "why_better": "Zero CSM headcount needed; aligns with self-serve support_model",
    },
]
```

## Failure handling

```python
except Exception as e:
    return {
        "agent": "strategy_skeptic",
        "error": str(e),
        "weak_points": [],
        "assumption_risks": [],
        "alternative_tactics": [],
        "overall_robustness": 0.0,
        "headline_critique": f"Skeptic error: {e}",
    }
```

`overall_robustness: 0.0` will trigger the critic's `low_lift` soft gate. So a skeptic failure still produces a downstream effect — the critic gets a "do not approve" signal even if it can't read specific weak_points.

## Wall time

10–20 s. Single Gemini structured-output call with `merged_strategies` JSON (~2000 char) in prompt.
