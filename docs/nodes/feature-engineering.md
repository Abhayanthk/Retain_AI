# Node 3 — `feature_engineering`

**File:** [`backend/app/graph/nodes/feature_engineering.py`](../../backend/app/graph/nodes/feature_engineering.py).

Compute retention-relevant features: RFM z-scores, LTV aggregates, engagement velocity, engagement cohorts, and the **Cox Proportional Hazards** survival regression that produces per-user risk + top-5 hazard-ratio drivers.

## Inputs

- `raw_csv_path` (re-read via DuckDB).
- `input_context.detected_columns` for `tenure`, `usage`, `churn`.
- Any other numeric column becomes a candidate CoxPH feature.

## Outputs — `feature_store`

| Sub-key | Notes |
|---|---|
| `rfm_scores` | For each of `recency` (tenure), `frequency` (usage), `monetary` (LTV column): `{column, mean, std}`. |
| `velocity_metrics` | `avg_logins_per_month`, `logins_std`, `low_engagement_threshold` (p25). |
| `ltv_estimates` | `mean_ltv`, `median_ltv`, `ltv_col`. |
| `engagement_cohorts` | `{low: p25, medium: p50, high: p75, column}`. |
| `predictive_churn_risk` | See below. |
| `feature_count`, `feature_list` | Self-describing meta. |

## CoxPH survival model

Feature selection now excludes identifier-like columns and one-hot encodes low-cardinality categoricals, rather than throwing every numeric column at CoxPH raw:

```python
# Drop the detected customer_id plus any numeric column that's near-unique
# (>90% distinct) — those are identifiers, not behavior, and used to show up
# as the #1 "hazard driver" purely from row-index noise.
id_col = detected.get("customer_id")
features = [
    c for c in numeric_cols
    if c not in (churn_col, tenure_col, id_col)
    and not (len(df) > 20 and df[c].nunique() / max(1, df[c].count()) > 0.9)
]

# One-hot encode low-cardinality categoricals (plan tier, contract length, ...)
# so CoxPH can surface hazard ratios like "Contract Length=Monthly" instead of
# ignoring the column entirely.
cat_cols = [
    c for c in df.select_dtypes(include=["object", "category"]).columns
    if c not in (churn_col, tenure_col, id_col) and 2 <= df[c].nunique() <= 6
]
df_model = pd.get_dummies(df[features + cat_cols + [churn_col, tenure_col]],
                           columns=cat_cols, drop_first=True, dtype=float, prefix_sep="=")
features = [c for c in df_model.columns if c not in (churn_col, tenure_col)]

df_ml = df_model.dropna()
# Drop any feature that became constant after dropna — zero variance breaks CoxPH.
df_ml = df_ml.drop(columns=[c for c in features if df_ml[c].nunique() <= 1])

cph = CoxPHFitter(penalizer=0.1)             # small L2 for convergence stability
cph.fit(df_ml, duration_col=tenure_col, event_col=churn_col)

active_users          = df_ml[df_ml[churn_col] == 0]
median_survival_times = cph.predict_median(active_users[features])
expected_remaining_time = median_survival_times - active_users[tenure_col]

high_risk_count = np.sum(expected_remaining_time < 6)
```

A user is **high risk** if their predicted median remaining lifetime is under 6 tenure units. The cutoff is hard-coded — adjust if your tenure unit isn't months.

### Top-5 hazard drivers (F1)

After fitting, extract the top-5 features by `|coef|` from `cph.summary`:

```python
summary_df["abs_log_hr"] = np.abs(summary_df["coef"])
summary_df = summary_df.sort_values("abs_log_hr", ascending=False)

for feat_name, row in summary_df.head(5).iterrows():
    driver_features.append({
        "feature":       str(feat_name),
        "hazard_ratio":  round(float(row["exp(coef)"]), 3),
        "coef":          round(float(row["coef"]), 3),
        "p_value":       round(float(row["p"]), 4),
        "direction":     "raises_churn" if coef > 0 else "protects",
        "significant":   p_val < 0.05,
    })
```

These flow into `feature_store.predictive_churn_risk.driver_features` and are consumed by:

- `forensic_detective` — injected into the candidate-cause prompt as quantitative anchors.
- `pattern_matcher` — segment naming references driver features.
- `unit_economist`, `execution_architect` — quantitative hazard rationale.
- F15 evidence drawer in the frontend — renders HR / p / direction / significance per driver.

## Output shape — `predictive_churn_risk`

```python
{
    "model_applied": "CoxProportionalHazards",
    "total_active_evaluated": int,
    "high_risk_customers_count": int,
    "lowest_forecasted_survival_time": float,
    "risk_segment_pct": float,                # high_risk_count / total_active
    "concordance_index": float,               # Harrell's C — model quality
    "driver_features": [{feature, hazard_ratio, coef, p_value, direction, significant}, ...],
}
```

`concordance_index` (Harrell's C, 0.5 = random, 1.0 = perfect ranking) is the model-quality signal surfaced to the UI as `confidence`.

## Failure handling

CoxPH can fail on:
- Insufficient variance in features.
- Too few rows (<10 after `dropna()`).
- Single-class churn (only churned OR only active).
- Convergence issues.

The whole CoxPH block is wrapped in try/except — failures write `predictive_churn_risk: {error: "Model failed to train: ..."}` and the rest of the feature store still populates. The frontend then renders the risk card with `has_model: False` and a "could not be trained" message.

## SSE event

After this node, `app/main.py` emits `risk_ready`:

```json
{
  "type": "risk_ready",
  "data": {
    "high_risk_count": 47,
    "total_active": 320,
    "risk_pct": 14.7,
    "confidence": 73,
    "insight": "47 users (15%) show high churn probability in the near term",
    "has_model": true,
    "feature_store": {"ltv_estimates": ..., "velocity_metrics": ..., "engagement_cohorts": ..., "rfm_scores": ...},
    "data_quality_score": 0.92,
    "data_quality_logs": [...],
    "input_context": {...}
  }
}
```

The `insight` string is selected by threshold from `risk_pct` and `high_risk_count` — see lines ~120-140 of `app/main.py`.

## Why exclude IDs and one-hot encode categoricals

Before this, `CustomerID`-shaped columns regularly won "top hazard driver" purely because they're a unique-per-row number CoxPH could fit *something* to — a data artifact, not a signal. And plan-tier / contract-length columns (strings) were silently dropped since CoxPH only takes numeric features, so the model never saw the single strongest churn split in most subscription datasets (e.g. `Contract Length=Monthly`). Both are fixed by the exclusion + one-hot-encoding step above; verified on the demo dataset, where `Contract Length=Monthly` now surfaces as the #1 driver (HR≈1.78, p<0.001) instead of `CustomerID` noise.

## Why CoxPH (not logistic regression)

CoxPH directly models time-to-event and handles censored (still-active) users correctly. Logistic regression would have to discard censored users or treat them as non-events, both of which bias the result. The hazard ratio interpretation also gives the LLM a numeric "effect size" per feature that's more useful than a logit coefficient.
