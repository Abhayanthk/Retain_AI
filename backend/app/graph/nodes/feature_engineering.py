"""
Node 3: Feature Engineering
=============================
Action:  Compute RFM, LTV, Velocity metrics
Tools:   Pandas, NumPy
Adds:    feature_store
"""

from __future__ import annotations

import duckdb
import numpy as np
from app.graph.state import RetentionGraphState
from app.graph.utils import get_churn_column
from lifelines import CoxPHFitter
import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="lifelines")


def feature_engineering_node(state: RetentionGraphState) -> dict:
    """Engineer retention-relevant features: RFM, LTV, velocity."""
    try:
        raw_csv_path = state.get("raw_csv_path", "")
        conn = duckdb.connect(":memory:")
        df = conn.execute(f"SELECT * FROM read_csv_auto('{raw_csv_path}')").df()

        feature_store = {
            "rfm_scores": {},
            "ltv_estimates": {},
            "velocity_metrics": {},
            "engagement_cohorts": {},
            "feature_count": 0,
            "feature_list": [],
        }


        # Resolve detected columns from input_ingest state
        input_context = state.get("input_context", {})
        detected = input_context.get("detected_columns", {})
        numeric_cols = df.select_dtypes(include=['int64', 'float64']).columns.tolist()

        tenure_col = detected.get("tenure") or next((c for c in df.columns if any(x in c.lower() for x in ['month', 'tenure'])), None)
        usage_col = detected.get("usage") or next((c for c in df.columns if any(x in c.lower() for x in ['login', 'usage'])), None)
        ltv_col = next((c for c in df.columns if any(x in c.lower() for x in ['ltv', 'revenue', 'monetary', 'value'])), None)

        # 1. RFM Scores using semantically correct columns
        rfm_map = {"recency": tenure_col, "frequency": usage_col, "monetary": ltv_col}
        for label, col in rfm_map.items():
            if col and col in df.columns:
                try:
                    col_data = df[col].dropna()
                    col_std = float(col_data.std())
                    if col_std > 0:
                        feature_store["rfm_scores"][f"{label}_zscore"] = {
                            "column": col,
                            "mean": round(float(col_data.mean()), 3),
                            "std": round(col_std, 3),
                        }
                except:
                    pass

        # 2. Engagement velocity (avg logins per month vs population mean)
        if usage_col and usage_col in df.columns:
            try:
                usage_data = df[usage_col].dropna()
                feature_store["velocity_metrics"]["avg_logins_per_month"] = round(float(usage_data.mean()), 2)
                feature_store["velocity_metrics"]["logins_std"] = round(float(usage_data.std()), 2)
                feature_store["velocity_metrics"]["low_engagement_threshold"] = round(float(usage_data.quantile(0.25)), 2)
            except:
                pass

        # 3. LTV estimates from actual LTV column
        if ltv_col and ltv_col in df.columns:
            try:
                ltv_data = df[ltv_col].dropna()
                feature_store["ltv_estimates"]["mean_ltv"] = round(float(ltv_data.mean()), 2)
                feature_store["ltv_estimates"]["median_ltv"] = round(float(ltv_data.median()), 2)
                feature_store["ltv_estimates"]["ltv_col"] = ltv_col
            except:
                pass

        # 4. Engagement cohorts split by logins (actual engagement signal)
        if usage_col and usage_col in df.columns:
            try:
                col_percentiles = df[usage_col].quantile([0.25, 0.5, 0.75]).to_dict()
                feature_store["engagement_cohorts"] = {
                    "low": float(col_percentiles.get(0.25, 0)),
                    "medium": float(col_percentiles.get(0.5, 0)),
                    "high": float(col_percentiles.get(0.75, 0)),
                    "column": usage_col,
                }
            except:
                pass

        # 5. Predictive Churn Modeling (Survival Analysis - CoxPH)
        try:
            churn_col = detected.get("churn") or get_churn_column(df)
            if churn_col and tenure_col and numeric_cols:
                # Ensure churn and tenure are not duplicated in our numeric features list.
                # Also drop ID-like columns: the detected customer_id plus any numeric
                # column that is near-unique (>90% distinct) — those are identifiers,
                # not behavior, and produce garbage hazard ratios.
                id_col = detected.get("customer_id")
                features = []
                for c in numeric_cols:
                    if c in (churn_col, tenure_col, id_col):
                        continue
                    nunique = df[c].nunique(dropna=True)
                    if len(df) > 20 and nunique / max(1, df[c].count()) > 0.9:
                        continue
                    features.append(c)

                # One-hot encode low-cardinality categoricals (plan tier, contract
                # length, ...) so CoxPH surfaces hazard ratios like
                # "Contract Length=Monthly" — pure feature engineering, no LLM cost.
                import pandas as pd
                cat_cols = [
                    c for c in df.select_dtypes(include=["object", "category"]).columns
                    if c not in (churn_col, tenure_col, id_col)
                    and 2 <= df[c].nunique(dropna=True) <= 6
                ]
                df_model = df[features + cat_cols + [churn_col, tenure_col]].copy()
                if cat_cols:
                    df_model = pd.get_dummies(
                        df_model, columns=cat_cols, drop_first=True, dtype=float,
                        prefix_sep="=",
                    )
                features = [c for c in df_model.columns if c not in (churn_col, tenure_col)]

                # We need some variance for CoxPH to work
                df_ml = df_model.dropna()
                # Drop features that became constant after dropna (zero variance
                # breaks CoxPH convergence).
                constant = [c for c in features if df_ml[c].nunique() <= 1]
                if constant:
                    df_ml = df_ml.drop(columns=constant)
                    features = [c for c in features if c not in constant]

                if features and len(df_ml) > 10 and df_ml[churn_col].nunique() > 1:
                    # CoxPH requires a single dataframe combining features, duration, and event.
                    cph = CoxPHFitter(penalizer=0.1) # Add small penalizer for convergence stability
                    cph.fit(df_ml, duration_col=tenure_col, event_col=churn_col)

                    # Predict for active users (where churn == 0)
                    active_users = df_ml[df_ml[churn_col] == 0]
                    if not active_users.empty:
                        # Extract the features for prediction
                        X_active = active_users[features]

                        # Predict median survival time for active users
                        # If a user's risk is so low they outlive the model, it returns inf.
                        median_survival_times = cph.predict_median(X_active)

                        # A user is "high risk" if their expected remaining median survival time is < 6 periods
                        current_tenures = active_users[tenure_col]
                        expected_remaining_time = median_survival_times - current_tenures

                        # Count those whose expected remaining time is very low (< 6 units)
                        high_risk_indices = np.where(expected_remaining_time < 6)[0]
                        high_risk_count = int(len(high_risk_indices))

                        # Identify the lowest predicted survival time
                        # Ignore -inf or inf
                        valid_remaining = expected_remaining_time[np.isfinite(expected_remaining_time)]
                        lowest_remaining_time = float(np.min(valid_remaining)) if len(valid_remaining) > 0 else 999.0

                        # Extract per-feature hazard ratios — the strongest driver signal CoxPH provides.
                        # exp(coef) > 1 means the feature increases churn hazard; < 1 means it protects.
                        try:
                            summary_df = cph.summary.copy()
                            summary_df["abs_log_hr"] = np.abs(summary_df["coef"])
                            summary_df = summary_df.sort_values("abs_log_hr", ascending=False)
                            driver_features = []
                            for feat_name, row in summary_df.head(5).iterrows():
                                hr = float(row.get("exp(coef)", np.exp(row.get("coef", 0))))
                                p_val = float(row.get("p", 1.0))
                                coef_val = float(row.get("coef", 0))
                                direction = "raises_churn" if coef_val > 0 else "protects"
                                driver_features.append({
                                    "feature": str(feat_name),
                                    "hazard_ratio": round(hr, 3),
                                    "coef": round(coef_val, 3),
                                    "p_value": round(p_val, 4),
                                    "direction": direction,
                                    "significant": p_val < 0.05,
                                })
                        except Exception:
                            driver_features = []

                        feature_store["predictive_churn_risk"] = {
                            "model_applied": "CoxProportionalHazards",
                            "total_active_evaluated": len(active_users),
                            "high_risk_customers_count": high_risk_count,
                            "lowest_forecasted_survival_time": round(lowest_remaining_time, 1),
                            "risk_segment_pct": round(high_risk_count / len(active_users), 3) if len(active_users) > 0 else 0.0,
                            "concordance_index": round(cph.concordance_index_, 3),
                            "driver_features": driver_features,
                        }
        except Exception as e:
            feature_store["predictive_churn_risk"] = {"error": f"Model failed to train: {str(e)}"}

        feature_store["feature_list"] = list(feature_store.keys())
        feature_store["feature_count"] = len(feature_store["feature_list"])

        return {
            "feature_store": feature_store,
            "current_node": "feature_engineering",
        }

    except Exception as e:
        return {
            "feature_store": {
                "rfm_scores": {},
                "ltv_estimates": {},
                "velocity_metrics": {},
                "feature_count": 0,
            },
            "errors": [*state.get("errors", []), f"Feature engineering error: {str(e)}"],
            "current_node": "feature_engineering",
        }
