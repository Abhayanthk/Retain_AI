# Node — `retry_handler`

**File:** [`backend/app/graph/nodes/retry_handler.py`](../../backend/app/graph/nodes/retry_handler.py).

Fallback branch when `data_audit` scores below `DATA_QUALITY_THRESHOLD` (0.5). Currently functions as a pass-through node because `MAX_RETRIES = 0` in `conditions.py`.

## What it does (when retry is enabled)

1. Increments `retry_count`.
2. Inspects `data_quality_logs` to compile a list of `quality_issues` (high nulls, duplicates, insufficient volume).
3. Generates a `user_message` either asking for a cleaner dataset or declaring `FAILED_MAX_RETRIES`.
4. Calls `generate_data_quality_suggestions(logs)` → top 3 actionable suggestions ("Remove rows with >20% missing values", "Deduplicate by customer ID", …).

## Outputs

| Key | Shape |
|---|---|
| `retry_count` | int, incremented |
| `status` | `AWAITING_USER_DATA` / `FAILED_MAX_RETRIES` / `ERROR` |
| `user_message` | Long human-readable string with issues + attempt count. |
| `user_action` | Short next-step string ("Upload a cleaned CSV with fewer nulls"). |
| `suggestion` | Top 3 entries from `generate_data_quality_suggestions()`. |
| `quality_score`, `quality_issues` | Echoes from data_audit for convenience. |

## Routing

`route_after_retry` in `conditions.py`:

```python
if state.get("retry_count", 0) >= MAX_RETRIES:
    return "feature_engineering"
return "input_ingest"
```

With `MAX_RETRIES = 0`, retry_count after this node is 1 → `1 >= 0` → forwards to `feature_engineering`. No loop fires.

## Why the loop is disabled

The retry would loop `input_ingest → data_audit → retry_handler → input_ingest`. Each pass re-loads the full CSV into `state["normalized_df"]` and re-runs feature engineering downstream. On Render's 512 MB free tier this doubles RSS quickly. The retry only buys back signal if the user uploads a different file mid-session, which the UI doesn't currently support.

To re-enable: set `MAX_RETRIES = 1` (one retry) or higher and add a UI affordance that lets the user replace the CSV without restarting the whole pipeline.

## Failure handling

Any exception during message construction is caught and converted to `status: "ERROR"` with the exception text in `user_message`. The downstream `feature_engineering` node will still run.
