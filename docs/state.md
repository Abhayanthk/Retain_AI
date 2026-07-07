# State Schema

The LangGraph pipeline uses a single shared `RetentionGraphState` ([TypedDict](https://peps.python.org/pep-0589/), `total=False`) that every node reads from and writes to. Keys are added progressively as the pipeline runs — no node ever clears another's keys.

Source: [`backend/app/graph/state.py`](../backend/app/graph/state.py).

## Why a TypedDict (not Pydantic)

LangGraph requires the state object to be a dict-compatible reducer target. Nodes return partial dicts and LangGraph merges them into the next state. Pydantic would force exhaustive validation at every merge; `TypedDict` with `total=False` lets each node return only the keys it owns.

## Reducers

Two keys are `Annotated` with reducers so parallel nodes can write to them without overwriting each other:

```python
errors: Annotated[list[str], operator.add]     # parallel nodes append; lists concatenate
current_node: Annotated[str, _last_value]      # parallel nodes overwrite; latest wins
```

Everything else uses the LangGraph default merge (last write wins per key). Parallel nodes (the Discovery and Strategy pods) write into **different** keys precisely to avoid the merge fighting.

## Lifecycle — keys by writing node

### Initial state (constructed in `main.py` before `graph.astream`)

| Key | Type | Notes |
|---|---|---|
| `raw_csv_path` | `str` | File path. Resolved to absolute by `input_ingest`. |
| `questionnaire` | `dict` | The 5-phase form payload (business_model, can_ship_changes, pricing_flexibility, retention_tactics, priority_segment, churn_destination, competitors, timeline, `analysis_depth` ("quick"/"deep"), `edge_cases`, `churn_definition`, `top_channels`, `has_completion_point`, `revenue_model`, …). Many downstream prompts read keys directly off this. |
| `job_id` | `str` | UUID. Used by the cancellation wrapper and `push_progress`. |
| `iteration_count` | `int` | Initialized to 0. Incremented by `strategy_critic` once per pass. |
| `discovery_attempts` | `int` | Initialized to 0. Incremented by `diagnosis_merge` once per pass. |
| `retry_count` | `int` | Initialized to 0. Incremented by `retry_handler` and `input_ingest` on failure. |
| `errors` | `list[str]` | Empty initially. Concatenated via `operator.add` as nodes raise. |

### Node 1 — `input_ingest`

| Key | Type | Notes |
|---|---|---|
| `normalized_df` | `list[dict]` | Whole CSV as a list of row dicts. DuckDB-parsed. Used by `data_audit`, `feature_engineering`, `behavioral_map`. |
| `input_context` | `dict` | `{source, row_count, column_count, detected_columns: {customer_id, tenure, usage, support, plan, churn}, business_context, industry, company_size}`. The `detected_columns` map is consumed everywhere a node needs to find the churn/tenure column without re-detecting. |
| `input_constraints` | `dict` | `{time_range, product_lines, market_segment, budget_constraints, legal_constraints}`. Used by `constraint_add`. |

### Node 2 — `data_audit`

| Key | Type | Notes |
|---|---|---|
| `data_quality_score` | `float` | 0.0–1.0. Composite of null/dup/size penalties. Gates `route_after_data_audit` (threshold = 0.5). |
| `data_quality_logs` | `list[str]` | Human-readable findings ("Null values: max 12% in any column", …). Surfaced in `risk_ready` SSE event. |
| `quality_metrics` | `dict` | Raw `null_percentages`, `duplicates`, `row_count`, `column_count`, `dtypes`. Internal — not displayed. |

### Node 3 — `feature_engineering`

`feature_store: dict` with sub-keys:

| Sub-key | Notes |
|---|---|
| `rfm_scores` | `{recency_zscore, frequency_zscore, monetary_zscore: {column, mean, std}}`. |
| `ltv_estimates` | `{mean_ltv, median_ltv, ltv_col}`. |
| `velocity_metrics` | `{avg_logins_per_month, logins_std, low_engagement_threshold}`. |
| `engagement_cohorts` | Quartile thresholds for the usage column. |
| `predictive_churn_risk` | `{model_applied, total_active_evaluated, high_risk_customers_count, lowest_forecasted_survival_time, risk_segment_pct, concordance_index, driver_features[]}`. `driver_features` = top-5 CoxPH hazard ratios — `[{feature, hazard_ratio, coef, p_value, direction, significant}, ...]`. Consumed by `pattern_matcher`, `unit_economist`, `execution_architect`, and the F15 evidence drawer in the frontend. |
| `feature_count`, `feature_list` | Self-describing meta. |

### Node 4 — `behavioral_map`

| Key | Type | Notes |
|---|---|---|
| `behavior_curves` | `dict` | `{survival_curve: {month_N: retention_pct}, retention_by_period, drop_off_points, churn_probability, max_tenure, median_survival_time, milestone_retention: {month_N: pct}, milestone_metadata: {max_observed_month, skipped_flat[]}}`. Downsampled to ≤20 points for the frontend slider. |
| `behavior_cohorts` | `list[dict]` | Tenure-quartile cohorts: `[{cohort_id, size, retention_rate, characteristics, tenure_range: {min, max}}, ...]`. Used by `pattern_matcher` and `diagnosis_merge` to build `top_segments`. |

### Node 5 — Discovery Pod (parallel)

| Key | Type | Written by |
|---|---|---|
| `forensic_detective_output` | `dict` | `forensic_detective` — see [agents/forensic-detective.md](./agents/forensic-detective.md) for the full shape. Includes `suspected_causes`, `confidence_scores`, `citations`, `statistical_evidence` (every bucket carries `p_value`/`significant` from a two-proportion z-test), `per_cause_evidence`, `driver_features`, `consensus_metadata` (self-consistency vote details — 1 run quick mode, 3 runs deep mode), `hyde_answer`. |
| `pattern_matcher_output` | `dict` | `pattern_matcher` — `patterns_found`, `user_segments`, `topic_clusters`, `churn_sequences`, `pattern_confidence`. |
| `competitor_research_output` | `dict` | `competitor_research` — `matched`, `competitor`, `churn_destination`, `evidence`, `counter_positioning`. `matched: False` when destination is not in `KNOWN_COMPETITORS`. |
| `professional_skeptic_output` | `dict` | `diagnosis_merge` (runs the skeptic inline) — `counter_arguments`, `robustness_scores`, `alternative_explanations`, `bias_flags`, `overall_quality_assessment`. |
| `diagnosis_results` | `dict` | `diagnosis_merge` — `{forensic_findings, pattern_findings, skeptic_findings, competitor_research, merged_hypotheses, highest_confidence, total_patterns_identified}`. |
| `top_segments` | `list[dict]` | `diagnosis_merge` — unified segment table merging forensic stat buckets, pattern_matcher `user_segments`, and tenure cohorts. Ranked by `churn_rate × size` (rows failing the z-test are demoted ×0.6 before ranking), top 8. Consumed by every strategy agent. Each row: `{segment_id, source, label, size, retention_rate, churn_rate, descriptor, dominant_cause, p_value, significant}`. |
| `discovery_attempts` | `int` | Incremented by `diagnosis_merge`. |

### Node 6 — `hypothesis_validation`

| Key | Type | Notes |
|---|---|---|
| `hypothesis_status` | `str` | `"verified"` / `"weak_proof"` / `"unverified"`. Gates `route_after_hypothesis_validation`. |
| `verified_root_causes` | `list[dict]` | `[{cause, confidence, robustness, evidence, p_value, recommendation, citations?}, ...]`. Consumed by `constraint_add`, `adaptive_hitl`, `strategy_skeptic`, the three strategy agents, `strategy_critic`, `evidence_dossier`, `execution_architect`. |
| `validation_metrics` | `dict` | `{hypotheses_tested, hypotheses_verified, validation_quality}`. |

### Node 7 — `constraint_add`

| Key | Type | Notes |
|---|---|---|
| `constrained_brief` | `dict` | `{verified_causes, applied_constraints, feasible_interventions, priority_ranking, constraint_summary, business_context}`. Fed to all strategy agents + critic. |

### Node 8 — `adaptive_hitl`

| Key | Type | Notes |
|---|---|---|
| `hitl_questions` | `list[str]` | 2–3 clarifying questions surfaced over SSE. |
| `human_clarification` | `dict` | `{questions_asked, responses: {q1: a1, ...}, clarification_status: "provided" / "timeout" / "skipped_on_retry" / "error"}`. On critic-retry, this is reused — the node returns the prior dict instead of re-prompting. |

### Node 9 — Strategy Pod (parallel)

| Key | Type | Notes |
|---|---|---|
| `unit_economist_output` | `dict` | Strict top + relaxed `additional_interventions`. Carries `top_intervention`, `additional_interventions`, `proposed_interventions` (flat), `roi_projections`, `cac_ltv_impact`, `cost_estimates`, `top_roi_intervention`, `framework`, `confidence`. |
| `jtbd_specialist_output` | `dict` | `identified_jobs`, `satisfaction_gaps`, `top_intervention`, `additional_interventions`, `proposed_interventions`, `job_priority_ranking`, `framework`, `confidence`. |
| `growth_hacker_output` | `dict` | `top_tactic`, `additional_tactics`, `proposed_tactics`, `experiment_designs`, `viral_loops`, `activation_improvements`, `speed_to_impact`, `framework`, `confidence`. |
| `strategy_outputs` | `dict` | `strategy_merge` — `{unit_economics_strategy, jtbd_strategy, growth_strategy, merged_strategies[], strategy_summary}`. `merged_strategies[]` is the canonical ranked list with the F6 operational fields (`target_event`, `trigger_window`, `success_metric_formula`, `min_sample_size`, `expected_lift_pct_p50/p90`, `copy_example`, `is_top_ranked`) flattened from each agent's `top_intervention`. |
| `strategy_skeptic_output` | `dict` | `strategy_skeptic` — `{agent, weak_points: [{tactic, weakness, severity}], assumption_risks: [{assumption, why_risky, mitigation}], alternative_tactics: [{instead_of, alternative, why_better}], overall_robustness, headline_critique}`. |

### Node 10 — `simulation`

| Key | Type | Notes |
|---|---|---|
| `simulations` | `dict` | `{iterations, expected_lift, confidence_interval_5_95, expected_roi, intervention_impacts: [{intervention, mean_lift, std_dev, percentile_10, percentile_90, lift_prior_pct, lift_prior_anchor, lift_prior_citations[], lift_prior_samples[]}], simulation_summary: {strategies_modeled, scenarios_analyzed, confidence_level, rag_anchored_count}}`. `lift_prior_anchor` is `"rag"` or `"self_reported"`. |
| `lift_percent` | `float` | Pulled from `simulations.expected_lift` for convenience. Used by the critic + architect. |
| `simulation_confidence` | `str` | `"high"` or `"low"`. |

### Node 11 — `strategy_critic`

| Key | Type | Notes |
|---|---|---|
| `critic_verdict` | `str` | `"approved"` / `"low_lift"` / `"violation"`. Gates `route_after_strategy_critic`. |
| `iteration_count` | `int` | Incremented here (not in `strategy_merge`). |
| `criticism` | `dict` | `{quality_score, lift_assessment, constraint_violations, critical_feedback, strengths, weaknesses, recommendations, skeptic_high_severity_count, skeptic_robustness}`. `weaknesses` is merged with skeptic weak_points so retry agents see them via `build_critic_feedback_block`. |
| `feedback` | `str` | Short prose verdict reason. |

### Node 11b — `evidence_dossier`

| Key | Type | Notes |
|---|---|---|
| `evidence_dossier` | `list[dict]` | Top-3 problems, each row: `{rank, stat: {stat_id, source, churn_rate, size, label}, cause: {text, confidence, citations}, tactic: {recommendation, framework, target_event, trigger_window, success_metric_formula, min_sample_size, expected_lift_pct_p50/p90, copy_example}, simulated_outcome, risk: {source, severity, description}, mitigation: {source, description}}`. Architect maps Problem #N → dossier row #N. |

### Node 12 — `execution_architect`

| Key | Type | Notes |
|---|---|---|
| `final_playbook` | `dict` | Pydantic `Playbook` model dumped (with the `30_60_90_roadmap` alias). Has `title`, `executive_summary`, `problems_and_solutions[]` (each with embedded `rationale_chain` from the dossier), `30_60_90_roadmap`, `success_metrics`, `risks_and_mitigations`, `resource_requirements`, plus `reasoning_trace` (pass-1 freeform prose), `created_date`, `company`, `estimated_total_lift`. |
| `playbook_status` | `str` | `"approved_for_execution"` or `"error"`. |

### Metadata / Control

| Key | Type | Reducer | Notes |
|---|---|---|---|
| `errors` | `list[str]` | `operator.add` | Parallel-safe append. Nodes write `{"errors": [...]}` when they catch exceptions. |
| `current_node` | `str` | `_last_value` | Latest write wins. Read in `app/main.py` to decide which SSE event to emit. |
| `retry_count` | `int` | default | `route_after_data_audit` / `route_after_retry`. |
| `discovery_attempts` | `int` | default | `route_after_hypothesis_validation`. |
| `iteration_count` | `int` | default | `route_after_strategy_critic`. |

## Routing thresholds

`backend/app/graph/conditions.py`:

```python
DATA_QUALITY_THRESHOLD = 0.5    # data_audit gate
MAX_RETRIES = 0                  # data-quality retry budget (0 = no retry)
MAX_DISCOVERY_ATTEMPTS = 0       # hypothesis-validation retry budget (0 = no retry on Render free tier)
MAX_CRITIC_ITERATIONS = 0        # critic retry budget (0 = no retry on Render free tier)
```

`MAX_DISCOVERY_ATTEMPTS` and `MAX_CRITIC_ITERATIONS` are set to 0 because every retry doubles state RSS on the 512 MB Render free tier (the new pass's agent outputs stack on top of the prior pass's). On a larger instance, raise to 1 to enable a single retry pass — `build_critic_feedback_block()` in `app/graph/utils.py` already wires the prior critic's verdict/weaknesses/recommendations into every retry agent's prompt.

## Adding a new key

1. Add the typed key to `RetentionGraphState` in `state.py`.
2. The node that produces it returns `{"<key>": value, "current_node": "<node_name>"}`.
3. Every downstream node reads with `state.get("<key>", default)` — never `state["<key>"]` (the dict is `total=False` so the key may not exist mid-pipeline).
4. If the key needs to be surfaced to the frontend, add an SSE emit in `app/main.py` and a corresponding render in `frontend/app/results/[job_id]/page.tsx`.

## Parallel-write safety

The two parallel pods (Discovery: forensic_detective + pattern_matcher + competitor_research; Strategy: unit_economist + jtbd_specialist + growth_hacker) each write into **disjoint** keys (`<agent>_output`), so the LangGraph merge never collides. The merge nodes (`diagnosis_merge`, `strategy_merge`) then read those individual keys and synthesize the merged dicts.

If you add a new parallel agent, give it its own state key — do **not** make it write into the merge output directly.
