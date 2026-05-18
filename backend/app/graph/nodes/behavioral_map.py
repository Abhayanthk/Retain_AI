"""
Node 4: Behavioral Map
========================
Action:  Survival curves & behavioral cohorts
Tools:   DuckDB, Pandas
Adds:    behavior_curves, behavior_cohorts
"""

from __future__ import annotations

import duckdb
import numpy as np
from lifelines import KaplanMeierFitter
from app.graph.state import RetentionGraphState
from app.graph.utils import get_churn_column


def behavioral_map_node(state: RetentionGraphState) -> dict:
    """Build behavioral models: KM survival curves and cohort segmentation."""
    try:
        raw_csv_path = state.get("raw_csv_path", "")
        conn = duckdb.connect(":memory:")
        df = conn.execute(f"SELECT * FROM read_csv_auto('{raw_csv_path}')").df()

        behavior_curves = {
            "survival_curve": {},
            "retention_by_period": {},
            "drop_off_points": [],
            "churn_probability": 0.0,
        }

        behavior_cohorts = []

        # Use detected tenure/churn columns from input_ingest; fall back to heuristics
        input_context = state.get("input_context", {})
        detected = input_context.get("detected_columns", {})
        numeric_cols = df.select_dtypes(include=['int64', 'float64']).columns.tolist()
        tenure_col = detected.get("tenure") or (numeric_cols[0] if numeric_cols else None)
        churn_col = detected.get("churn") or get_churn_column(df)

        if tenure_col and tenure_col in df.columns:
            valid_idx = df[tenure_col].dropna().index

            if len(valid_idx) > 0:
                durations = df.loc[valid_idx, tenure_col].astype(float)

                # event_observed=1 means churned, 0 means still active (censored)
                if churn_col and churn_col in df.columns:
                    events = df.loc[valid_idx, churn_col].fillna(0).astype(int)
                else:
                    # No churn label: treat all as observed events
                    events = np.ones(len(valid_idx), dtype=int)

                kmf = KaplanMeierFitter()
                kmf.fit(durations, event_observed=events, label="retention")

                sf = kmf.survival_function_
                times = sf.index.tolist()
                km_values = sf["retention"].tolist()

                # Downsample to at most 20 evenly-spaced points for frontend
                step = max(1, len(times) // 20)
                sampled_indices = list(range(0, len(times), step))
                if sampled_indices[-1] != len(times) - 1:
                    sampled_indices.append(len(times) - 1)

                for i in sampled_indices:
                    t = int(round(times[i]))
                    s = round(km_values[i], 3)
                    behavior_curves["survival_curve"][f"month_{t}"] = s
                    behavior_curves["retention_by_period"][f"period_{t}"] = s

                # churn_probability = 1 - KM estimate at the final observed time
                behavior_curves["churn_probability"] = round(1.0 - km_values[-1], 3)
                behavior_curves["max_tenure"] = int(round(times[-1]))

                # Median survival time: month when 50% of users have churned
                median = kmf.median_survival_time_
                behavior_curves["median_survival_time"] = (
                    int(round(float(median))) if median is not None and not np.isinf(float(median)) else None
                )

                # Retention at milestones — chosen dynamically from the actual
                # tenure range so the UI doesn't show a row of identical "66%"
                # cells for months past the observed data. Three rules:
                #   1. Milestones must be <= the largest observed tenure.
                #   2. Candidate set scales with data range (months_5/month if
                #      we don't have years of history, real targets if we do).
                #   3. Drop a milestone if the KM value equals the previous
                #      retained milestone within 0.5 percentage points — flat
                #      curve = no new information.
                max_t = float(times[-1])

                if max_t <= 6:
                    candidate_milestones = [1, 2, 3, 4, 5, 6]
                elif max_t <= 12:
                    candidate_milestones = [1, 2, 3, 6, 9, 12]
                elif max_t <= 24:
                    candidate_milestones = [1, 3, 6, 9, 12, 18, 24]
                else:
                    candidate_milestones = [1, 3, 6, 12, 18, 24, 36]

                # Make sure we always include the max observed point so user
                # sees the end of the curve.
                max_observed = int(round(max_t))
                if max_observed not in candidate_milestones:
                    candidate_milestones.append(max_observed)

                milestone_retention = {}
                milestone_metadata = {
                    "max_observed_month": max_observed,
                    "skipped_flat": [],
                }
                last_value = None
                for m in sorted(set(candidate_milestones)):
                    if m > max_t:
                        continue
                    idx = max((i for i, t in enumerate(times) if t <= m), default=0)
                    val = round(km_values[idx], 3)
                    # Skip milestone if KM hasn't moved more than 0.5pp from
                    # the previous retained value (purely-flat region).
                    if last_value is not None and abs(val - last_value) < 0.005:
                        milestone_metadata["skipped_flat"].append(m)
                        continue
                    milestone_retention[f"month_{m}"] = val
                    last_value = val

                behavior_curves["milestone_retention"] = milestone_retention
                behavior_curves["milestone_metadata"] = milestone_metadata

        # Create behavioral cohorts with real retention rates from data
        if tenure_col and tenure_col in df.columns:
            col_data = df[tenure_col].dropna()
            if len(col_data) > 0:
                quantile_25 = col_data.quantile(0.25)
                quantile_75 = col_data.quantile(0.75)

                # Calculate actual retention per cohort using churn data
                low_mask = col_data < quantile_25
                med_mask = (col_data >= quantile_25) & (col_data < quantile_75)
                high_mask = col_data >= quantile_75

                for cohort_id, mask, label in [
                    ("low_tenure", low_mask, "Short tenure"),
                    ("medium_tenure", med_mask, "Medium tenure"),
                    ("high_tenure", high_mask, "Long tenure"),
                ]:
                    cohort_size = int(mask.sum())
                    # Calculate real retention rate from churn column if available
                    if churn_col and cohort_size > 0:
                        cohort_churn = df.loc[mask.index[mask], churn_col].mean()
                        retention_rate = round(1.0 - cohort_churn, 3)
                    else:
                        retention_rate = None  # No churn data to calculate from

                    behavior_cohorts.append({
                        "cohort_id": cohort_id,
                        "size": cohort_size,
                        "retention_rate": retention_rate,
                        "characteristics": label,
                        "tenure_range": {
                            "min": round(float(df.loc[mask.index[mask], tenure_col].min()), 2) if cohort_size > 0 else 0,
                            "max": round(float(df.loc[mask.index[mask], tenure_col].max()), 2) if cohort_size > 0 else 0,
                        },
                    })

        return {
            "behavior_curves": behavior_curves,
            "behavior_cohorts": behavior_cohorts,
            "current_node": "behavioral_map",
        }

    except Exception as e:
        return {
            "behavior_curves": {"error": str(e)},
            "behavior_cohorts": [],
            "errors": [f"Behavioral map error: {str(e)}"],
            "current_node": "behavioral_map",
        }
