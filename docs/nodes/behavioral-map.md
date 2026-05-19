# Node 4 — `behavioral_map`

**File:** [`backend/app/graph/nodes/behavioral_map.py`](../../backend/app/graph/nodes/behavioral_map.py).

Fit a **Kaplan-Meier** survival estimator on the population and derive the artefacts the UI's churn cards consume: survival curve, median survival time, retention at adaptive milestones, and tenure-based cohort splits.

This is the last node before the Discovery Pod fan-out — `forensic_detective`, `pattern_matcher`, and `competitor_research` all consume its outputs.

## Inputs

- `raw_csv_path` (re-read via DuckDB).
- `input_context.detected_columns` for `tenure` and `churn`.

## KM fit

```python
kmf = KaplanMeierFitter()
kmf.fit(durations=tenure_col, event_observed=churn_col, label="retention")
```

`event_observed=1` means the user churned, `0` means censored (still active). If the CSV has no churn label, all rows are treated as observed events.

## Downsampling for the frontend

The raw `kmf.survival_function_` can have hundreds of steps. The node downsamples to at most 20 roughly-evenly-spaced points and always includes the final point:

```python
step = max(1, len(times) // 20)
sampled_indices = list(range(0, len(times), step))
if sampled_indices[-1] != len(times) - 1:
    sampled_indices.append(len(times) - 1)
```

This keeps the SSE payload small and the slider responsive.

## Adaptive milestones

Rather than hard-coding `[1, 3, 6, 12, 24, 36]` regardless of data range, milestones scale to the observed tenure:

```python
if max_t <= 6:    candidate_milestones = [1, 2, 3, 4, 5, 6]
elif max_t <= 12: candidate_milestones = [1, 2, 3, 6, 9, 12]
elif max_t <= 24: candidate_milestones = [1, 3, 6, 9, 12, 18, 24]
else:             candidate_milestones = [1, 3, 6, 12, 18, 24, 36]
```

Then two filters:

1. **Drop milestones past `max_t`** — don't display months the data can't speak to.
2. **Drop flat milestones** — if KM hasn't moved >0.5 pp from the previous retained value, skip this milestone and record it in `milestone_metadata.skipped_flat`. Prevents the UI from showing a row of identical "66%" cells.

Always include the actual `max_observed` month so users see the end of the curve.

## Outputs

### `behavior_curves`

| Key | Shape |
|---|---|
| `survival_curve` | `{ "month_1": 0.95, "month_2": 0.91, ... }` |
| `retention_by_period` | legacy alias of `survival_curve` |
| `churn_probability` | `1 - km_at_final_time` |
| `max_tenure` | last observed time |
| `median_survival_time` | `kmf.median_survival_time_` rounded to int, or `None` if ∞ (i.e. >50% of users still active at end) |
| `milestone_retention` | adaptive milestone retention dict |
| `milestone_metadata` | `{max_observed_month, skipped_flat: [...]}` |
| `drop_off_points` | reserved (currently always `[]`) |

### `behavior_cohorts`

Three tenure-quartile cohorts:

```python
[
  {"cohort_id": "low_tenure",    "size": ..., "retention_rate": ..., "characteristics": "Short tenure", "tenure_range": {min, max}},
  {"cohort_id": "medium_tenure", ...},
  {"cohort_id": "high_tenure",   ...},
]
```

`retention_rate` is computed from the **actual** churn column for that cohort (`1 - mean(churn)`), not derived from KM. `None` when no churn column is present.

## Frontend consumption

- **Survival slider** uses `parseSurvivalCurve` + `getChurnAtPeriod` (nearest-lower lookup) in `frontend/app/results/[job_id]/page.tsx` to turn `survival_curve` into a live "X% by month Y" readout.
- **Milestone strip** displays `milestone_retention` color-coded: green ≥80%, yellow ≥60%, red below.
- **Median Survival card** displays `median_survival_time`. `None` renders as "≥ max_tenure mo".
- **Tenure cohort chips** display `behavior_cohorts`.

## SSE event

Emits `churn_profile_ready`:

```json
{
  "type": "churn_profile_ready",
  "data": {
    "churn_probability": 41.2,
    "survival_curve": {...},
    "max_tenure": 24,
    "median_survival_time": 11,
    "milestone_retention": {...},
    "milestone_metadata": {...},
    "behavior_cohorts": [...]
  }
}
```

## Fan-out

After this node the graph fans out to `forensic_detective`, `pattern_matcher`, AND `competitor_research` in parallel. All three consume `behavior_curves` and `behavior_cohorts`.

## Failure handling

Wrapped in try/except. On failure, writes `behavior_curves: {error: str(e)}` and `behavior_cohorts: []`. Downstream nodes (especially `forensic_detective`'s `_derive_signals`) tolerate missing `median_survival_time` / `milestone_retention` — the signal list will simply be shorter.
