# Node 2 — `data_audit`

**File:** [`backend/app/graph/nodes/data_audit.py`](../../backend/app/graph/nodes/data_audit.py).

Compute a single `data_quality_score ∈ [0, 1]` and log what was checked. The conditional edge after this node routes to `feature_engineering` if score ≥ `DATA_QUALITY_THRESHOLD` (0.5), else to [`retry_handler`](./retry-handler.md).

## Inputs

`raw_csv_path`. Re-reads via DuckDB rather than using `state["normalized_df"]` so it can run independently of `input_ingest`.

## Scoring formula

```python
null_penalty = max_null_pct_any_column / 100 * 0.3
dup_penalty  = min(dup_count / row_count, 0.2)
size_penalty = 0 if row_count >= 50 else (1 - row_count/50) * 0.2
score        = max(0, 1 - null_penalty - dup_penalty - size_penalty)
```

Three penalties, each capped:

- **Nulls** — up to 30 percentage points. Penalty kicks in proportional to the worst column. A column 50% null costs 15 points; 100% null costs 30.
- **Duplicates** — up to 20 percentage points. Penalty is `dup_count / row_count` clamped at 0.2 (so 20% duplicate rows fully consumes the budget).
- **Size** — up to 20 percentage points. Datasets under 50 rows are penalized linearly down to size 0. Above 50 rows there is no penalty (more is not better for the score; it's a floor check).

So a clean 1000-row dataset with zero nulls and zero duplicates scores 1.0. A 100-row file with 30% nulls in one column and 5% duplicates scores `1 - 0.09 - 0.05 - 0 = 0.86`.

## Outputs

| Key | Shape |
|---|---|
| `data_quality_score` | float, rounded to 3 decimals |
| `data_quality_logs` | `list[str]` — human-readable lines ("Null values: max 12% in any column", …). Surfaced in the `risk_ready` SSE event. |
| `quality_metrics` | `{null_percentages: {col: pct}, duplicates, row_count, column_count, dtypes}` — internal, not displayed to user. |

## Thresholds

`backend/app/graph/conditions.py`:

```python
DATA_QUALITY_THRESHOLD = 0.5
MAX_RETRIES = 0   # one-shot — retry_handler always forwards to feature_engineering
```

`0.5` is intentionally lenient — the depth-improvement work assumed the user is uploading the best dataset they have, not their cleanest test slice. Tight thresholds previously caused unnecessary retries that doubled state RSS on Render's free tier.

## Failure handling

```python
return {
    "data_quality_score": 0.0,
    "data_quality_logs": [f"Audit failed: {e}"],
    "errors": [..., f"Data audit error: {e}"],
}
```

Score 0.0 forces routing to `retry_handler` which (with `MAX_RETRIES=0`) immediately forwards to `feature_engineering` anyway. Downstream nodes will see an empty `feature_store` and a degraded but completed playbook.

## Why it doesn't validate column semantics

`input_ingest` already detected columns; this node only checks data hygiene. Semantic validation (e.g. "tenure column has implausible values") would require business-context-aware rules and is out of scope.
