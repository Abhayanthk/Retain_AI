"""
Discovery Agent: Forensic Detective
=====================================
Investigates data anomalies and traces root causes.
Called by: forensic_detective_node (parallel with pattern_matcher, fan-in at diagnosis_merge)
"""

from __future__ import annotations

import re
import numpy as np
from typing import Any, List, Dict, Tuple
from pydantic import BaseModel, Field
from app.graph.utils import get_churn_column, safe_llm_invoke
from app.config import get_llm
from langchain_core.prompts import ChatPromptTemplate
from app.graph.state import RetentionGraphState
from app.rag.store import retrieve as rag_retrieve
from app.rag.hyde import hypothetical_segment_answer


# Self-consistency: run the candidate-cause prompt this many times, at these temps.
# Causes appearing in >= SELF_CONSISTENCY_VOTE_THRESHOLD runs survive the vote.
SELF_CONSISTENCY_TEMPS: List[float] = [0.2, 0.5, 0.7]
SELF_CONSISTENCY_VOTE_THRESHOLD: int = 2


class DetectiveResult(BaseModel):
    suspected_causes: List[str]
    confidence_scores: Dict[str, float]
    citations: Dict[str, List[str]] = Field(default_factory=dict)


def _normalize_cause(s: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace, for cross-run cause matching."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (s or "").lower())).strip()


def _aggregate_detective_runs(
    runs: List[DetectiveResult],
) -> Tuple[List[str], Dict[str, float], Dict[str, List[str]], Dict[str, Any]]:
    """Vote causes across self-consistency runs.

    Winner = cause whose normalized text appears in >= SELF_CONSISTENCY_VOTE_THRESHOLD runs.
    Canonical phrasing = phrasing from the highest-confidence run that produced it.
    Confidence = mean over runs that produced it. Citations = union across runs.
    Falls back to top-3 by max-confidence if vote yields nothing (e.g. only 1 run survived).
    """
    norm_to_records: Dict[str, List[Tuple[str, float, List[str]]]] = {}
    for run in runs:
        for cause in run.suspected_causes:
            norm = _normalize_cause(cause)
            if not norm:
                continue
            conf = float(run.confidence_scores.get(cause, 0.0) or 0.0)
            cites = list(run.citations.get(cause, []) or [])
            norm_to_records.setdefault(norm, []).append((cause, conf, cites))

    voted = [
        (norm, recs) for norm, recs in norm_to_records.items()
        if len(recs) >= SELF_CONSISTENCY_VOTE_THRESHOLD
    ]
    fallback_used = False
    if voted:
        # rank by vote count desc, then mean conf desc
        voted.sort(key=lambda kv: (-len(kv[1]), -(sum(r[1] for r in kv[1]) / len(kv[1]))))
        chosen = voted
    else:
        fallback_used = True
        chosen = sorted(
            norm_to_records.items(),
            key=lambda kv: -max((r[1] for r in kv[1]), default=0.0),
        )[:3]

    causes_out: List[str] = []
    conf_out: Dict[str, float] = {}
    cite_out: Dict[str, List[str]] = {}
    vote_meta: List[Dict[str, Any]] = []
    for norm, recs in chosen[:3]:
        canonical = max(recs, key=lambda r: r[1])[0]
        causes_out.append(canonical)
        conf_out[canonical] = round(sum(r[1] for r in recs) / len(recs), 3)
        merged_cites: set[str] = set()
        for _, _, cites in recs:
            merged_cites.update(cites)
        cite_out[canonical] = sorted(merged_cites)
        vote_meta.append({
            "cause": canonical,
            "votes": len(recs),
            "mean_confidence": conf_out[canonical],
            "phrasings": [r[0] for r in recs],
        })

    metadata = {
        "runs_total": len(runs),
        "runs_temps": SELF_CONSISTENCY_TEMPS[: len(runs)],
        "vote_threshold": SELF_CONSISTENCY_VOTE_THRESHOLD,
        "fallback_used": fallback_used,
        "votes": vote_meta,
    }
    return causes_out, conf_out, cite_out, metadata


def _extract_rates(bucket_dict: dict) -> List[float]:
    """Extract churn_rate floats from a {label: {churn_rate, size}} mapping."""
    rates = []
    for v in (bucket_dict or {}).values():
        if isinstance(v, dict) and "churn_rate" in v:
            rates.append(float(v["churn_rate"]))
        elif isinstance(v, (int, float)):
            rates.append(float(v))
    return rates


def _derive_signals(stats: dict, behavior_curves: dict) -> List[str]:
    """Translate detected data patterns into RAG signal tags."""
    signals: List[str] = []

    churn_rate = stats.get("churn_rate", 0) or 0
    if churn_rate > 0.25:
        signals.append("high_churn")

    channel_rates = _extract_rates(stats.get("churn_by_channel"))
    if channel_rates and (max(channel_rates) - min(channel_rates)) > 0.15:
        signals.extend(["channel_churn", "channel_variance", "bad_fit"])

    if stats.get("churn_by_integration"):
        signals.extend(["low_integration", "integration_failure", "b2b_churn"])

    plan_rates = _extract_rates(stats.get("churn_by_plan_tier"))
    if plan_rates and (max(plan_rates) - min(plan_rates)) > 0.15:
        signals.extend(["plan_tier_churn", "price_sensitivity"])

    support_buckets = stats.get("churn_by_support_volume", {}) or {}
    high_support = support_buckets.get("high_4_plus", {})
    no_support = support_buckets.get("none_0", {})
    if isinstance(high_support, dict) and isinstance(no_support, dict):
        if (high_support.get("churn_rate", 0) - no_support.get("churn_rate", 0)) > 0.1:
            signals.extend(["high_support_volume", "early_friction"])

    usage_buckets = stats.get("churn_by_usage_decile", {}) or {}
    low_usage = usage_buckets.get("q1_lowest", {})
    high_usage = usage_buckets.get("q4_highest", {})
    if isinstance(low_usage, dict) and isinstance(high_usage, dict):
        if (low_usage.get("churn_rate", 0) - high_usage.get("churn_rate", 0)) > 0.15:
            signals.extend(["engagement_decay", "low_usage", "shallow_engagement"])

    tenure_buckets = stats.get("churn_rate_by_tenure_bucket", {}) or {}
    early_bucket = tenure_buckets.get("0_1mo", {})
    if isinstance(early_bucket, dict) and early_bucket.get("churn_rate", 0) > 0.15:
        signals.extend(["30_day_cliff", "onboarding_friction"])

    median = behavior_curves.get("median_survival_time")
    max_tenure = behavior_curves.get("max_tenure", 0) or 0
    if median and max_tenure:
        if median <= 3:
            signals.extend(["short_tenure_churn", "30_day_cliff", "onboarding_friction"])
        elif median <= 9:
            signals.extend(["mid_tenure_churn", "90_day_cliff", "engagement_decay"])
        else:
            signals.append("long_tenure_churn")

    milestones = behavior_curves.get("milestone_retention", {}) or {}
    if milestones.get("month_1") is not None and milestones["month_1"] < 0.85:
        signals.append("new_user_drop_off")

    return list(dict.fromkeys(signals))  # dedupe, preserve order

def _churn_rate_for_subset(df, mask, churn_col):
    """Helper — mean churn rate within a boolean mask, rounded; None if empty."""
    if mask.sum() == 0:
        return None
    return round(float(df.loc[mask, churn_col].mean()), 3)


def _bucket_churn(df, col, churn_col, buckets):
    """Compute churn rate for each (label, lo, hi) bucket of a numeric column."""
    out = {}
    series = df[col]
    for label, lo, hi in buckets:
        if hi is None:
            mask = series >= lo
        else:
            mask = (series >= lo) & (series < hi)
        rate = _churn_rate_for_subset(df, mask, churn_col)
        if rate is not None:
            out[label] = {"churn_rate": rate, "size": int(mask.sum())}
    return out


def run_forensic_detective(state: RetentionGraphState) -> dict[str, Any]:
    """Deep forensic investigation of retention patterns."""
    try:
        import duckdb

        raw_csv_path = state.get("raw_csv_path", "")
        q = state.get("questionnaire", {})

        # Load CSV for actual statistical analysis
        conn = duckdb.connect(":memory:")
        df = conn.execute(f"SELECT * FROM read_csv_auto('{raw_csv_path}')").df()

        # Calculate actual statistics from data
        churn_col = get_churn_column(df)

        # Detected columns from input_ingest — reuse what feature_engineering already mapped
        input_context = state.get("input_context", {}) or {}
        detected = input_context.get("detected_columns", {}) or {}
        tenure_col = detected.get("tenure")
        usage_col = detected.get("usage")
        support_col = detected.get("support")
        plan_col = detected.get("plan")

        stats = {
            "churn_rate": 0,
            "churn_by_channel": {},
            "churn_by_integration": {},
            "churn_by_plan_tier": {},
            "churn_by_support_volume": {},
            "churn_by_usage_decile": {},
            "time_to_churn_distribution": {},
            "churn_rate_by_tenure_bucket": {},
            "feature_count_used": 0,
        }

        if churn_col:
            stats["churn_rate"] = round(float(df[churn_col].mean()), 3)

            # 1. Churn by acquisition channel (already existed)
            acq_col = next((c for c in df.columns if 'acquisition' in c.lower() or 'channel' in c.lower()), None)
            if acq_col:
                for channel in df[acq_col].unique():
                    rate = df[df[acq_col] == channel][churn_col].mean()
                    size = int((df[acq_col] == channel).sum())
                    stats["churn_by_channel"][str(channel)] = {"churn_rate": round(float(rate), 3), "size": size}

            # 2. Churn by integration status (already existed)
            int_col = next((c for c in df.columns if 'integration' in c.lower()), None)
            if int_col:
                for status in df[int_col].unique():
                    rate = df[df[int_col] == status][churn_col].mean()
                    size = int((df[int_col] == status).sum())
                    stats["churn_by_integration"][str(status)] = {"churn_rate": round(float(rate), 3), "size": size}

            # 3. Churn by plan tier — pricing-tier concentration is a key diagnostic
            if plan_col and plan_col in df.columns:
                for plan in df[plan_col].dropna().unique():
                    mask = df[plan_col] == plan
                    rate = _churn_rate_for_subset(df, mask, churn_col)
                    if rate is not None:
                        stats["churn_by_plan_tier"][str(plan)] = {"churn_rate": rate, "size": int(mask.sum())}

            # 4. Churn by support ticket volume (0 / 1-3 / 4+) — friction signal
            if support_col and support_col in df.columns:
                try:
                    df_supp = df.copy()
                    df_supp[support_col] = df_supp[support_col].fillna(0).astype(float)
                    stats["churn_by_support_volume"] = _bucket_churn(
                        df_supp, support_col, churn_col,
                        [("none_0", 0, 1), ("low_1_3", 1, 4), ("high_4_plus", 4, None)],
                    )
                except Exception:
                    pass

            # 5. Churn by usage decile — engagement-driven churn signal
            if usage_col and usage_col in df.columns:
                try:
                    usage_data = df[usage_col].dropna()
                    if len(usage_data) > 10:
                        # 4 quartiles: low/med-low/med-high/high
                        q1, q2, q3 = usage_data.quantile([0.25, 0.5, 0.75])
                        usage_buckets = [
                            ("q1_lowest", -np.inf, q1),
                            ("q2_low", q1, q2),
                            ("q3_high", q2, q3),
                            ("q4_highest", q3, np.inf),
                        ]
                        for label, lo, hi in usage_buckets:
                            mask = (df[usage_col] >= lo) & (df[usage_col] < hi)
                            rate = _churn_rate_for_subset(df, mask, churn_col)
                            if rate is not None:
                                stats["churn_by_usage_decile"][label] = {
                                    "churn_rate": rate,
                                    "size": int(mask.sum()),
                                    "usage_range": [round(float(lo), 2) if np.isfinite(lo) else None,
                                                    round(float(hi), 2) if np.isfinite(hi) else None],
                                }
                except Exception:
                    pass

            # 6. Time-to-churn distribution — when do users actually leave?
            if tenure_col and tenure_col in df.columns:
                try:
                    churned_tenures = df.loc[df[churn_col] == 1, tenure_col].dropna()
                    if len(churned_tenures) > 0:
                        stats["time_to_churn_distribution"] = {
                            "mean": round(float(churned_tenures.mean()), 2),
                            "median": round(float(churned_tenures.median()), 2),
                            "p25": round(float(churned_tenures.quantile(0.25)), 2),
                            "p75": round(float(churned_tenures.quantile(0.75)), 2),
                            "p90": round(float(churned_tenures.quantile(0.90)), 2),
                            "churned_count": int(len(churned_tenures)),
                        }

                    # Churn rate by tenure bucket — surfaces 30/90-day cliffs
                    tenure_buckets = [
                        ("0_1mo", 0, 1),
                        ("1_3mo", 1, 3),
                        ("3_6mo", 3, 6),
                        ("6_12mo", 6, 12),
                        ("12_24mo", 12, 24),
                        ("24plus_mo", 24, None),
                    ]
                    stats["churn_rate_by_tenure_bucket"] = _bucket_churn(
                        df, tenure_col, churn_col, tenure_buckets,
                    )
                except Exception:
                    pass

        # Pull CoxPH driver features computed in feature_engineering — biggest depth win
        feature_store = state.get("feature_store", {}) or {}
        driver_features = (feature_store.get("predictive_churn_risk", {}) or {}).get("driver_features", []) or []
        stats["feature_count_used"] = len(driver_features)

        # Build signals + initial broad RAG retrieval.
        # F13: HyDE — embed a hypothetical answer for the priority segment instead of a
        # bare keyword query. Retrieval quality jumps because the embedding lands closer
        # to actual framework chunks than the signal-tag list does.
        behavior_curves = state.get("behavior_curves", {}) or {}
        signals = _derive_signals(stats, behavior_curves)
        priority_segment = q.get("priority_segment", "all users")
        industry = q.get("business_context", q.get("industry", "SaaS"))
        business_model = q.get("business_model", "SaaS")
        hyde_answer = hypothetical_segment_answer(priority_segment, industry, business_model)
        broad_query = (
            f"{hyde_answer}\n\nObserved patterns: {', '.join(signals) or 'general churn'}. "
            f"Churn rate {stats['churn_rate']:.1%}. "
            f"Median survival {behavior_curves.get('median_survival_time')}."
        )
        broad_retrieved = rag_retrieve(broad_query, k=6, signals=signals)
        broad_evidence_block = "\n\n".join(
            f"[{i+1}] Source: {c['source']} (id: {c['id']}, topic: {c['topic']})\n{c['text']}"
            for i, c in enumerate(broad_retrieved)
        ) or "(no retrieved frameworks — reason from stats alone)"

        # Format CoxPH drivers for prompt — quantitative anchor for each cause
        if driver_features:
            drivers_str = "\n".join(
                f"- {d['feature']}: hazard_ratio={d['hazard_ratio']} (coef={d['coef']}, p={d['p_value']}, "
                f"direction={d['direction']}{', significant' if d.get('significant') else ''})"
                for d in driver_features
            )
        else:
            drivers_str = "(no CoxPH driver features available)"

        import json

        # ── Pass 1: Generate candidate causes with broad evidence (self-consistency) ─
        candidate_prompt = ChatPromptTemplate.from_template(
            """You are a retention analyst for a {business_model} company. Diagnose the 3 most likely root causes of churn, ranked by evidence strength.

── Business context ──
Goal: {goal}
Priority segment: {priority_segment}
Named competitors: {competitors}
Churn destination: {churn_destination}

── Dataset statistics ──
Overall Churn Rate: {churn_rate}
Churn by Acquisition Channel: {churn_by_channel}
Churn by Integration Status: {churn_by_integration}
Churn by Plan Tier: {churn_by_plan_tier}
Churn by Support Ticket Volume: {churn_by_support_volume}
Churn by Usage Decile: {churn_by_usage_decile}
Churn Rate by Tenure Bucket: {churn_rate_by_tenure_bucket}
Time-to-Churn Distribution: {time_to_churn_distribution}
Detected Signals: {signals}

── CoxPH Driver Features (quantitative hazard ratios) ──
{drivers_str}

── Retrieved retention frameworks (broad sweep) ──
{evidence_block}

Requirements:
- Each suspected cause must be a concrete, specific phrase (not "users churn"; instead "users on Starter plan with <2 integrations churn at 38% by month 3").
- Reference the highest-signal numeric evidence — CoxPH hazard ratio, tenure-bucket cliff, support-volume jump.
- If churn_destination names a competitor, weight a "losing to {{competitor}}" hypothesis accordingly.
- Bias causes toward the priority segment when its tenure window matches the data signal.
- Reference frameworks by source id in citations map (e.g., {{"cause text": ["reforge_aha_001"]}}).
- Confidence in [0.7, 1.0]."""
        )

        competitors_val = q.get("competitors", [])
        competitors_str = ", ".join(competitors_val) if isinstance(competitors_val, list) else str(competitors_val or "")

        formatted_prompt = candidate_prompt.format(
            business_model=q.get("business_model", "SaaS"),
            goal=q.get("goal", "Reduce churn"),
            priority_segment=q.get("priority_segment", "all users"),
            competitors=competitors_str or "None named",
            churn_destination=q.get("churn_destination", "Unknown"),
            churn_rate=f"{stats['churn_rate']:.1%}",
            churn_by_channel=json.dumps(stats["churn_by_channel"]),
            churn_by_integration=json.dumps(stats["churn_by_integration"]),
            churn_by_plan_tier=json.dumps(stats["churn_by_plan_tier"]),
            churn_by_support_volume=json.dumps(stats["churn_by_support_volume"]),
            churn_by_usage_decile=json.dumps(stats["churn_by_usage_decile"]),
            churn_rate_by_tenure_bucket=json.dumps(stats["churn_rate_by_tenure_bucket"]),
            time_to_churn_distribution=json.dumps(stats["time_to_churn_distribution"]),
            signals=", ".join(signals) or "none",
            drivers_str=drivers_str,
            evidence_block=broad_evidence_block,
        )

        # Self-consistency: 3 runs at different temps, vote on causes appearing in >=2/3 runs.
        # Free-tier safe — Gemini round-robin in get_llm handles rate limits.
        runs: List[DetectiveResult] = []
        run_errors: List[str] = []
        for t in SELF_CONSISTENCY_TEMPS:
            try:
                llm_t = get_llm("gemini", temperature=t)
                resp = safe_llm_invoke(
                    llm_t, DetectiveResult, formatted_prompt,
                    agent_name=f"ForensicDetective(t={t})",
                )
                runs.append(resp)
            except Exception as run_err:
                run_errors.append(f"temp={t}: {run_err}")

        if not runs:
            raise RuntimeError(
                "All self-consistency runs failed: " + " | ".join(run_errors)
            )

        candidate_causes, candidate_conf, candidate_citations, consensus_metadata = (
            _aggregate_detective_runs(runs)
        )
        if run_errors:
            consensus_metadata["partial_failures"] = run_errors

        # ── Pass 2: Per-cause RAG — each cause gets its own focused retrieval ──
        per_cause_evidence: Dict[str, List[dict]] = {}
        all_cause_sources: List[dict] = list(broad_retrieved)
        seen_ids = {c["id"] for c in broad_retrieved}
        for cause in candidate_causes[:3]:
            cause_query = f"Specific intervention frameworks and root cause patterns for: {cause}. Industry: {q.get('business_model', 'SaaS')}."
            cause_hits = rag_retrieve(cause_query, k=3, signals=signals)
            per_cause_evidence[cause] = [
                {"id": c["id"], "source": c["source"], "topic": c["topic"], "score": c["score"]}
                for c in cause_hits
            ]
            for c in cause_hits:
                if c["id"] not in seen_ids:
                    all_cause_sources.append(c)
                    seen_ids.add(c["id"])

        # Merge citations — per-cause retrieval supplements LLM-self-cited ones
        merged_citations: Dict[str, List[str]] = {}
        for cause in candidate_causes:
            ids = set()
            for cited_id in candidate_citations.get(cause, []) or []:
                ids.add(cited_id)
            for hit in per_cause_evidence.get(cause, []):
                ids.add(hit["id"])
            merged_citations[cause] = sorted(ids)

        return {
            "agent": "forensic_detective",
            "suspected_causes": candidate_causes,
            "confidence_scores": candidate_conf,
            "citations": merged_citations,
            "per_cause_evidence": per_cause_evidence,
            "retrieved_sources": [
                {"id": c["id"], "source": c["source"], "topic": c["topic"], "score": c["score"]}
                for c in all_cause_sources
            ],
            "statistical_evidence": stats,
            "driver_features": driver_features,
            "consensus_metadata": consensus_metadata,
            "hyde_answer": hyde_answer,
            "analysis_depth": "high",
        }

    except Exception as e:
        return {
            "agent": "forensic_detective",
            "error": str(e),
        }
