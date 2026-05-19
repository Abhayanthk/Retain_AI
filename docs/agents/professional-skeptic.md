# Agent — Professional Skeptic

**File:** [`backend/app/graph/agents/discovery/professional_skeptic.py`](../../backend/app/graph/agents/discovery/professional_skeptic.py).

Called inline from `diagnosis_merge_node` — **not a standalone graph node**. Adversarial reviewer of the forensic + pattern findings.

For node-level context: [`docs/nodes/diagnosis-merge.md`](../nodes/diagnosis-merge.md).

## Model

| | |
|---|---|
| Provider | Google Gemini |
| Model ID | `gemini-3-flash-preview` |
| Temp | `0.4` (warmest discovery agent — encourages counter-arguments) |
| Keys | Round-robin via `FailoverLLM` |

## Pydantic schema

```python
class CounterArgument(BaseModel):
    hypothesis: str
    counter_argument: str
    strength: str               # "low" | "medium" | "high"

class AlternativeExplanation(BaseModel):
    hypothesis: str
    alternative: str
    testability: str            # "low" | "medium" | "high"

class BiasFlag(BaseModel):
    issue: str
    risk: str
    recommendation: str

class OverallQuality(BaseModel):
    forensic_quality: float
    pattern_quality: float
    combined_confidence: float
    recommendation: str

class SkepticResult(BaseModel):
    counter_arguments: List[CounterArgument]
    robustness_scores: Dict[str, float]
    alternative_explanations: List[AlternativeExplanation]
    bias_flags: List[BiasFlag]
    overall_quality: OverallQuality
```

## Public entry point

```python
def run_professional_skeptic(
    state: RetentionGraphState,
    forensic_findings: dict[str, Any],
    pattern_findings: dict[str, Any],
) -> dict[str, Any]:
```

The two finding dicts are passed explicitly (not pulled from state) so the function is independently testable.

## Inputs

| Source | Field |
|---|---|
| `forensic_findings` | `suspected_causes`, `confidence_scores`, `statistical_evidence`. |
| `pattern_findings` | `churn_sequences` (top 3), `patterns_found` (top 5). |
| `state.questionnaire` | `priority_segment`, `goal`, `retention_tactics`. |

## Prompt

```
You are a Professional Skeptic reviewing churn analysis findings.
Your job is to challenge assumptions, find flaws, and stress-test hypotheses against the actual data.

## Business context
Priority segment: {priority_segment}
Goal: {goal}
Tactics already tried (so retread proposals are suspect): {already_tried}

## Forensic Findings
Suspected causes: {causes}
Confidence scores: {confidence}

## Underlying data the forensic agent used (use this to cross-check)
Statistical evidence: {evidence}

## Pattern Findings
Churn sequences: {sequences}
Patterns found: {patterns}

For EACH suspected cause:
1. Specific counter-argument — reference the actual cause AND the statistical_evidence above.
2. Robustness score (0.0-1.0) — penalize if the evidence is weak or the cause overlaps with already-tried tactics.
3. One alternative explanation.

Also flag cognitive biases (confirmation, survivorship, overfitting, channel-attribution bias).
strength / testability / risk values: "low", "medium", or "high".
robustness_scores keys: the suspected cause strings. All numeric scores in [0, 1].
```

The "reference the actual cause" rule prevents generic skepticism. The "penalize if overlaps with already-tried tactics" rule lets the user's `retention_tactics` list veto proposals that won't add new signal.

## Output

```python
{
    "agent": "professional_skeptic",
    "counter_arguments": [{hypothesis, counter_argument, strength}, ...][:5],
    "bias_flags": [{issue, risk, recommendation}, ...],
    "robustness_scores": {cause: float, ...},
    "alternative_explanations": [{hypothesis, alternative, testability}, ...][:3],
    "overall_quality_assessment": {forensic_quality, pattern_quality, combined_confidence, recommendation},
    "approval_status": "conditional_proceed",
}
```

`approval_status` is always `"conditional_proceed"` — the skeptic doesn't block, only critiques. Gating happens in `hypothesis_validation`.

## How its output flows

| Consumer | How |
|---|---|
| `hypothesis_validation` | `robustness_scores[cause]` is the second-factor gate (`confidence > 0.50 AND robustness > 0.35` = strong gate). |
| `diagnosis_merge` | Embeds full output in `diagnosis_results.skeptic_findings`. Surfaced in `diagnosis_ready` SSE event. |
| Frontend F15 evidence drawer | `counter_arguments` and `alternative_explanations` rendered as the per-hypothesis "skeptic caveat" + "alternative" chain nodes. |

## How robustness scoring works in practice

The LLM produces scores like:

```python
{
    "Newest customers churn due to onboarding friction": 0.72,
    "Pricing too high vs competitors": 0.31,
    "Support quality issues": 0.58,
}
```

Then `hypothesis_validation` applies `robustness > 0.35`:
- Cause 1 (0.72) — passes strong gate (assuming confidence > 0.5).
- Cause 2 (0.31) — fails both gates → dropped.
- Cause 3 (0.58) — passes strong gate.

Cause 2 might still be the "right" answer but the skeptic didn't see enough corroborating evidence in `statistical_evidence` to score it higher. The user's HITL answers can override this in subsequent runs.

## Failure handling

```python
except Exception as e:
    return {"agent": "professional_skeptic", "error": str(e)}
```

Downstream `hypothesis_validation` reads `robustness_scores.get(cause, 0.5)` so a missing skeptic falls back to `robustness = 0.5` — hypotheses with `confidence > 0.50` still pass the strong gate. Skeptic absence weakens the filter but doesn't stall the graph.

## Wall time

10–20 s. Single Gemini structured-output call.

## Why not part of the discovery pod fan-out

Could be — it would run concurrently with forensic + pattern. But the skeptic needs **both** forensic and pattern outputs to do its job. Adding it to the pod would require either:

- Waiting for forensic + pattern via a barrier (defeats the parallelism).
- Running on partial state (skeptic would see only one or zero finished agents).

Running inline in `diagnosis_merge` after the fan-in is the cleanest mapping to what the skeptic actually needs.

## Naming

This is the **Professional Skeptic** (cross-checks diagnosis). Don't confuse with the [**Strategy Skeptic**](./strategy-skeptic.md), which adversarially reviews proposed strategies later in the pipeline. Different agents, different inputs, different prompts.
