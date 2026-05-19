# Node 10b — `simulation`

**File:** [`backend/app/graph/nodes/simulation.py`](../../backend/app/graph/nodes/simulation.py).

Monte Carlo (10k iterations) over the top-3 merged strategies. **F10 added RAG-anchored priors** — each strategy's μ comes from retrieved framework chunks when parseable, else falls back to self-reported lift.

## Why RAG-anchored

The pre-F10 simulation used each strategy's `expected_lift` field directly as μ. That field is whatever the strategy agent claimed, frequently overoptimistic. RAG-anchored priors pull empirical lift ranges from real case studies in the corpus (e.g. *"8-12% retention lift typical for activation nudges"*), giving the Monte Carlo a grounded base rate.

## Inputs (from state)

| Key | Used for |
|---|---|
| `strategy_outputs.merged_strategies` | Top 3 modeled. |
| `unit_economist_output.roi_projections` | ROI sampling fallback. |

## RAG-prior parsing (F10)

For each strategy:

```python
query = f"typical retention lift from {tactic_name}. Metric: {target_metric or 'retention'}. Cite percentage-point lift ranges from real case studies."
hits = rag_retrieve(query, k=2)
```

Regex extracts lift values from `hit.text`:

```python
_RANGE_PATTERN  = r"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:%|pp|percentage\s*points?)"
_SINGLE_PATTERN = r"(\d+(?:\.\d+)?)\s*(?:%|pp|percentage\s*points?)"
```

Matches `10-15%`, `10–15 pp`, `10 to 15 percentage points`, `8%`, `8 pp`. Each parsed value clamped to `[0.1, 30]` pp (`_LIFT_CLAMP_PCT = 30.0`).

If parseable values found → `μ = mean(values)`, `lift_prior_anchor = "rag"`, surface `lift_prior_citations` + `lift_prior_samples`.

If nothing parseable → fall back chain:

```python
self_reported_mu_pct = float(
    strategy.get("expected_lift_pct_p50")   # F6 strict-tier field
    or strategy.get("expected_lift")
    or strategy.get("expected_roi")
    or 20.0
)
mu_pct = self_reported_mu_pct
anchor = "self_reported"
```

Last-ditch fallback is `20.0` pp — never used in practice because F6 strict-tier guarantees `expected_lift_pct_p50`.

## σ scales with confidence

```python
sigma_factor = 0.15 + 0.45 * (1.0 - confidence)     # confidence in [0, 1]
sigma_decimal = mu_decimal * sigma_factor
```

- Confidence 1.0 → σ = 0.15·μ (tight band, narrow distribution).
- Confidence 0.0 → σ = 0.60·μ (wide band, the simulation hedges).

So a low-confidence strategy with μ=10% produces a much wider distribution than a high-confidence one — the critic's `lift_percent ≥ 8` threshold then trips more often.

## Sample draw

```python
np.random.seed(42)            # deterministic for repro
samples = np.random.normal(loc=mu_decimal, scale=sigma_decimal, size=10000)
samples = np.clip(samples, 0.0, _LIFT_CLAMP_PCT / 100.0)
```

Fixed seed means the same input CSV + same strategies always produce identical lift figures. Easier to reason about the critic threshold.

## ROI sampling

```python
roi_samples.extend((impact_samples * 200).tolist())
```

`200` is a flat heuristic conversion. Not data-driven — kept for backwards compat with the UI's "ROI" badge. Real ROI math is in `unit_economist.roi_projections`.

## Output (state key `simulations`)

```python
{
    "iterations": 10000,
    "expected_lift": float,                              # mean across 3 strategies' samples
    "confidence_interval_5_95": [low, high],             # 5th/95th percentile
    "expected_roi": float,
    "intervention_impacts": [
        {
            "intervention": str,
            "mean_lift": float,
            "std_dev": float,
            "percentile_10": float,
            "percentile_90": float,
            "lift_prior_pct": float,                     # μ used
            "lift_prior_anchor": "rag" | "self_reported",
            "lift_prior_citations": [chunk_id, ...],     # only when anchor == "rag"
            "lift_prior_samples": [parsed_value, ...],   # raw RAG-extracted numbers
        },
        ...
    ],
    "simulation_summary": {
        "strategies_modeled": int,
        "scenarios_analyzed": 10000,
        "confidence_level": "95% CI",
        "rag_anchored_count": int,    # how many of the 3 used "rag" anchor
    },
}
```

Also writes top-level `lift_percent = expected_lift` for convenience (the critic + architect read this).

## SSE event

After this node, `app/main.py` emits `simulation_ready`:

```json
{
  "type": "simulation_ready",
  "data": {
    "expected_lift": 11.4,
    "confidence_low": 6.8,
    "confidence_high": 16.2,
    "expected_roi": 22.8,
    "iterations": 10000,
    "interventions": [
      {"name": "...", "p10": 7.2, "mean": 10.5, "p90": 14.1,
       "lift_prior_anchor": "rag", "lift_prior_pct": 10.0,
       "lift_prior_citations": ["reforge_aha_001", "..."]}
    ],
    "rag_anchored_count": 2,
    "strategy_skeptic": {...full strategy_skeptic_output...}
  }
}
```

Frontend renders intervention rows with the `lift_prior_anchor` as a badge (`rag` = green checkmark, `self_reported` = yellow caution) and the citation chips on hover.

## Failure handling

Try/except. On failure returns `{simulations: {error: str(e)}, lift_percent: 0.0}`. Critic then sees `lift_percent: 0` → triggers `low_lift` verdict. Architect still runs with a degraded playbook.

## Wall time

3–8 s. RAG queries are local Chroma (1–5 ms each); the bulk is the 10k-sample NumPy draw × 3 strategies.

## Why fixed seed isn't a problem

The Monte Carlo is a confidence-band tool, not a stochastic decision-maker. Re-running with a different seed would produce subtly different `mean_lift` figures and confuse the critic threshold debugging. The seed is documented as fixed; if you need re-sampled variance, run with different `random_state`.
