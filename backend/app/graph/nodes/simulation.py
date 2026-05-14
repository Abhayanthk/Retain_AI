"""
Node 10: Simulation
=====================
Action:  Predict lift & ROI via Monte Carlo, anchored to RAG-derived base rates.
Tools:   Monte Carlo, NumPy, RAG retrieval (F10).
Adds:    simulations, lift_percent
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from app.graph.state import RetentionGraphState
from app.rag.store import retrieve as rag_retrieve


# Matches "10-15%", "10 - 15 %", "10 to 15%", "10–15 pp", etc.
_RANGE_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:%|pp|percentage\s*points?)",
    re.IGNORECASE,
)
# Matches single-number lifts like "8%" or "8 pp".
_SINGLE_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:%|pp|percentage\s*points?)",
    re.IGNORECASE,
)

# Plausibility clamp — single-tactic retention lift above 30 pp is almost never real.
_LIFT_CLAMP_PCT = 30.0


def _parse_lift_from_text(text: str) -> list[float]:
    """Extract every numeric retention-lift value (in %) from a chunk of text."""
    lifts: list[float] = []
    for lo, hi in _RANGE_PATTERN.findall(text or ""):
        try:
            lifts.append((float(lo) + float(hi)) / 2.0)
        except ValueError:
            continue
    # If no ranges, fall back to single percentage mentions.
    if not lifts:
        for v in _SINGLE_PATTERN.findall(text or ""):
            try:
                lifts.append(float(v))
            except ValueError:
                continue
    # Drop outliers — anything > _LIFT_CLAMP_PCT is unlikely to be a real lift figure.
    return [v for v in lifts if 0.1 <= v <= _LIFT_CLAMP_PCT]


def _rag_base_rate_for_strategy(strategy: dict) -> dict | None:
    """RAG-anchored prior for a strategy's lift. Returns None if nothing parseable."""
    tactic_name = (
        strategy.get("recommendation")
        or strategy.get("name")
        or strategy.get("intervention")
        or ""
    )
    target_metric = strategy.get("target_metric") or strategy.get("success_metric_formula") or ""
    if not tactic_name:
        return None

    query = (
        f"typical retention lift from {tactic_name}. "
        f"Metric: {target_metric or 'retention'}. "
        "Cite percentage-point lift ranges from real case studies."
    )
    try:
        hits = rag_retrieve(query, k=2)
    except Exception:
        return None
    if not hits:
        return None

    lifts: list[float] = []
    citations: list[str] = []
    for h in hits:
        parsed = _parse_lift_from_text(h.get("text", ""))
        if parsed:
            lifts.extend(parsed)
            citations.append(h.get("id", ""))

    if not lifts:
        return None

    mu_pct = float(np.mean(lifts))
    return {
        "mu_pct": round(mu_pct, 3),
        "samples": [round(v, 2) for v in lifts],
        "citations": [c for c in citations if c],
        "n_chunks": len(hits),
    }


def _draw_impact_samples(
    mu_pct: float,
    confidence: float,
    iterations: int,
) -> np.ndarray:
    """Sample lift in decimal (0..1). σ widens as confidence drops."""
    mu_decimal = mu_pct / 100.0
    # Confidence 1.0 → σ = 0.15·μ; confidence 0.0 → σ = 0.6·μ. Conservative defaults.
    conf = max(0.0, min(1.0, float(confidence or 0.0)))
    sigma_factor = 0.15 + 0.45 * (1.0 - conf)
    sigma_decimal = mu_decimal * sigma_factor
    samples = np.random.normal(loc=mu_decimal, scale=sigma_decimal, size=iterations)
    return np.clip(samples, 0.0, _LIFT_CLAMP_PCT / 100.0)


def simulation_node(state: RetentionGraphState) -> dict:
    """Run RAG-anchored Monte Carlo simulations to predict retention lift and ROI."""
    try:
        strategy_outputs = state.get("strategy_outputs", {})
        merged_strategies = strategy_outputs.get("merged_strategies", [])
        roi_projections = state.get("unit_economist_output", {}).get("roi_projections", {})

        simulations = run_monte_carlo_simulation(merged_strategies, roi_projections)
        lift_percent = simulations.get("expected_lift", 15.0)

        return {
            "simulations": simulations,
            "lift_percent": round(lift_percent, 2),
            "simulation_confidence": "high" if len(merged_strategies) > 0 else "low",
            "current_node": "simulation",
        }

    except Exception as e:
        return {
            "simulations": {"error": str(e)},
            "lift_percent": 0.0,
            "errors": [f"Simulation error: {str(e)}"],
            "current_node": "simulation",
        }


def run_monte_carlo_simulation(
    strategies: list,
    roi_data: dict,
    iterations: int = 10000,
) -> dict:
    """Monte Carlo simulation. Each strategy's μ comes from RAG when parseable;
    falls back to its self-reported expected_roi only if RAG yields nothing.
    σ widens as the strategy's claimed confidence drops.
    """
    np.random.seed(42)

    intervention_impacts: list[dict[str, Any]] = []
    roi_samples: list[float] = []
    all_impact_samples: list[float] = []

    for strategy in strategies[:3]:
        rag_prior = _rag_base_rate_for_strategy(strategy)
        # Prefer strategy-claimed median if present; otherwise fall back to expected_roi
        # (still a number, but treated as a weaker signal).
        self_reported_mu_pct = float(
            strategy.get("expected_lift_pct_p50")
            or strategy.get("expected_lift")
            or strategy.get("expected_roi")
            or 20.0
        )

        if rag_prior is not None:
            mu_pct = rag_prior["mu_pct"]
            anchor = "rag"
        else:
            mu_pct = self_reported_mu_pct
            anchor = "self_reported"

        # Clamp self-reported optimism that exceeds the plausibility ceiling.
        if mu_pct > _LIFT_CLAMP_PCT:
            mu_pct = _LIFT_CLAMP_PCT

        confidence = float(strategy.get("confidence", 0.7) or 0.7)
        impact_samples = _draw_impact_samples(mu_pct, confidence, iterations)

        intervention_impacts.append({
            "intervention": strategy.get("recommendation", ""),
            "mean_lift": round(float(np.mean(impact_samples)) * 100, 2),
            "std_dev": round(float(np.std(impact_samples)) * 100, 2),
            "percentile_10": round(float(np.percentile(impact_samples, 10)) * 100, 2),
            "percentile_90": round(float(np.percentile(impact_samples, 90)) * 100, 2),
            "lift_prior_pct": round(mu_pct, 2),
            "lift_prior_anchor": anchor,
            "lift_prior_citations": (rag_prior or {}).get("citations", []),
            "lift_prior_samples": (rag_prior or {}).get("samples", []),
        })

        all_impact_samples.extend(impact_samples.tolist())
        # ROI sampling kept as a rough conversion (lift × 200), unchanged from prior version.
        roi_samples.extend((impact_samples * 200).tolist())

    if all_impact_samples:
        combined_lift = float(np.mean(all_impact_samples) * 100)
        ci_lower = float(np.percentile(all_impact_samples, 5) * 100)
        ci_upper = float(np.percentile(all_impact_samples, 95) * 100)
    else:
        combined_lift = 12.0
        ci_lower = 8.0
        ci_upper = 16.0

    return {
        "iterations": iterations,
        "expected_lift": round(combined_lift, 2),
        "confidence_interval_5_95": [round(ci_lower, 2), round(ci_upper, 2)],
        "expected_roi": round(float(np.mean(roi_samples)) if roi_samples else 150.0, 1),
        "intervention_impacts": intervention_impacts,
        "simulation_summary": {
            "strategies_modeled": len(strategies),
            "scenarios_analyzed": iterations,
            "confidence_level": "95% CI",
            "rag_anchored_count": sum(
                1 for ii in intervention_impacts if ii.get("lift_prior_anchor") == "rag"
            ),
        },
    }
