# Node 1 — `input_ingest`

**File:** [`backend/app/graph/nodes/input_ingest.py`](../../backend/app/graph/nodes/input_ingest.py).

Entry point of the graph. Loads the CSV via DuckDB, detects key columns heuristically, and packages `input_context` + `input_constraints` for downstream nodes.

## Inputs (from state)

| Key | Used for |
|---|---|
| `raw_csv_path` | File to load. May be a basename — resolved against `/tmp/retain_ai_uploads/` first, then `os.getcwd()/data/`. |
| `questionnaire` | Pull-through to `input_context` (business_context, industry, company_size) and `input_constraints` (time_range, product_lines, market_segment, budget, legal_constraints). |

## Logic

```python
df = duckdb.connect(":memory:").execute(f"SELECT * FROM read_csv_auto('{path}')").df()

# Case-insensitive heuristic column detection
cols_lower = {col.lower(): col for col in df.columns}
customer_id_col = next((cols_lower[k] for k in cols_lower if 'id' in k or 'user' in k), None)
tenure_col      = next((cols_lower[k] for k in cols_lower if 'tenure' in k or 'months_active' in k or k == 'months'), None)
usage_col       = next((cols_lower[k] for k in cols_lower if 'usage' in k or 'logins' in k), None)
support_col     = next((cols_lower[k] for k in cols_lower if 'support' in k or 'tickets' in k), None)
plan_col        = next((cols_lower[k] for k in cols_lower if 'plan' in k or 'contract' in k), None)
churn_col       = get_churn_column(df)  # in app/graph/utils.py
```

`get_churn_column()` is stricter: dtype must be int/float AND values must be a subset of `{0, 1}`. Falls back to columns literally named `is_churned` / `churned`.

## Outputs (to state)

```python
{
    "raw_csv_path": <resolved absolute path>,            # rewritten so downstream nodes don't depend on cwd
    "normalized_df": [{...row dict...}, ...],            # whole CSV
    "input_context": {
        "source": path,
        "row_count": int,
        "column_count": int,
        "detected_columns": {
            "customer_id", "tenure", "usage", "support", "plan", "churn"  # values or None
        },
        "business_context": str,
        "industry": str,
        "company_size": str,
    },
    "input_constraints": {
        "time_range": str,
        "product_lines": list,
        "market_segment": str,
        "budget_constraints": str,
        "legal_constraints": list,
    },
    "current_node": "input_ingest",
    "retry_count": int,
}
```

## Why DuckDB

`read_csv_auto` figures out delimiters, header rows, and dtypes without configuration. Cheaper than Pandas' inference for the 50–10k-row datasets the pipeline targets.

## Failure handling

On any exception (file not found, malformed CSV, encoding error) the node returns:

```python
{
    "errors": [*state.get("errors", []), f"Input ingest error: {e}"],
    "current_node": "input_ingest",
    "retry_count": state.get("retry_count", 0) + 1,
}
```

The graph continues with a missing `normalized_df`. `data_audit` will then fail similarly and `route_after_data_audit` will route to `retry_handler` (which currently exits immediately since `MAX_RETRIES=0`).

## Called by

- Graph entry point (`graph.set_entry_point("input_ingest")`).
- Re-entered from [`retry_handler`](./retry-handler.md) if `retry_count < MAX_RETRIES`.

## Gotchas

- `normalized_df` is the **entire CSV** as a list of row dicts. For a 10k-row file that's measurable RSS pressure on Render's free tier. Downstream nodes re-read the CSV from `raw_csv_path` via DuckDB instead of pulling from state — this state key exists for completeness but is essentially write-only.
- `detected_columns` values may be `None`. Every downstream node guards with `next((c for c in df.columns if ...), None)` as a fallback heuristic in case ingest missed.
- The case-insensitive scan is greedy and order-dependent — if your CSV has both `customer_id` and `user_id` columns, the first match wins (dict iteration order).
