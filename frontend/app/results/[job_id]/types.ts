/* SSE payload shapes for the results dashboard. One interface per backend
   event data block — see backend/app/main.py for the emitting side. */

export interface FeatureStore {
  ltv_estimates?: { mean_ltv?: number; median_ltv?: number; mean?: number; median?: number; p90?: number };
  velocity_metrics?: { avg_logins_per_month?: number; low_engagement_threshold?: number; drop_off_at_day?: number };
  engagement_cohorts?: Record<string, number>;
  rfm_scores?: Record<string, number>;
}
export interface RiskData {
  high_risk_count: number; total_active: number; risk_pct: number;
  confidence: number; insight: string; has_model: boolean;
  feature_store?: FeatureStore; data_quality_score?: number;
  input_context?: { detected_columns?: string[] | Record<string, string>; industry?: string; stage?: string };
}
export interface Cohort {
  cohort_id?: string; label?: string; characteristics: string;
  size: number; retention_rate: number;
  tenure_range?: { min: number; max: number };
}
export interface ChurnProfile {
  churn_probability: number; max_tenure: number; median_survival_time: number | null;
  milestone_retention: Record<string, number>; behavior_cohorts: Cohort[];
  survival_curve?: Record<string, number>;
  milestone_metadata?: { max_observed_month: number; skipped_flat: number[] };
}
export interface EvidenceSource { id: string; source: string; topic: string; score?: number; }
export interface Hypothesis {
  hypothesis: string;
  confidence: number;
  supported_by: string[];
  citations?: string[];
  evidence_sources?: EvidenceSource[];
}
export interface TopSegment {
  segment_id: string; source: string; label: string;
  size: number; retention_rate: number; churn_rate: number;
  descriptor: string; dominant_cause?: string | null;
}
export interface DriverFeature {
  feature: string; hazard_ratio: number; coef: number;
  p_value: number; direction: string; significant?: boolean;
}
export interface StatBucketEntry {
  churn_rate: number; size: number;
  churned?: number; p_value?: number | null; significant?: boolean;
}
export type StatBuckets = Record<string, Record<string, StatBucketEntry>>;
export interface ForensicFindingsRich {
  suspected_causes?: string[];
  confidence_scores?: Record<string, number>;
  citations?: Record<string, string[]>;
  per_cause_evidence?: Record<string, EvidenceSource[]>;
  statistical_evidence?: {
    churn_rate?: number;
    churn_by_channel?: Record<string, StatBucketEntry>;
    churn_by_plan_tier?: Record<string, StatBucketEntry>;
    churn_by_contract?: Record<string, StatBucketEntry>;
    churn_by_support_volume?: Record<string, StatBucketEntry>;
    churn_by_usage_decile?: Record<string, StatBucketEntry>;
    churn_rate_by_tenure_bucket?: Record<string, StatBucketEntry>;
    time_to_churn_distribution?: Record<string, number>;
    [key: string]: unknown;
  };
  driver_features?: DriverFeature[];
  consensus_metadata?: {
    runs_total: number; runs_temps: number[]; vote_threshold: number;
    fallback_used: boolean;
    votes?: { cause: string; votes: number; mean_confidence: number; phrasings?: string[] }[];
  };
  hyde_answer?: string;
}
export interface SkepticAltExplanation { hypothesis?: string; alternative?: string; testability?: string; }
export interface SkepticCounterArg { hypothesis?: string; counter_argument?: string; strength?: string; }
export interface SkepticBiasFlag { issue?: string; risk?: string; recommendation?: string; }
export interface ProfessionalSkepticOutput {
  counter_arguments?: SkepticCounterArg[];
  alternative_explanations?: SkepticAltExplanation[];
  bias_flags?: SkepticBiasFlag[];
  robustness_scores?: Record<string, number>;
}
export interface CompetitorResearch {
  matched: boolean; competitor?: string | null; churn_destination?: string;
  evidence?: { id: string; source: string; topic: string; score?: number; snippet?: string }[];
  counter_positioning?: string[];
  error?: string;
}
export interface DiagnosisData {
  merged_hypotheses: Hypothesis[];
  forensic_findings?: ForensicFindingsRich | { signal?: string; citation?: string; strength?: string }[];
  pattern_findings?: { segment?: string; size?: number; retention?: number; signature?: string }[];
  skeptic_findings?: ProfessionalSkepticOutput | { caveat?: string }[] | unknown;
  total_patterns_identified?: number;
  competitors?: string[] | string;
  churn_destination?: string;
  top_segments?: TopSegment[];
  driver_features?: DriverFeature[];
  competitor_research?: CompetitorResearch;
}
export interface SimIntervention {
  name: string; p10: number; mean: number; p90: number;
  lift_prior_anchor?: "rag" | "self_reported" | null;
  lift_prior_pct?: number;
  lift_prior_citations?: string[];
}
export interface StrategySkepticWeakPoint { tactic: string; weakness: string; severity: "low" | "medium" | "high"; }
export interface StrategySkepticAssumption { assumption: string; why_risky: string; mitigation: string; }
export interface StrategySkepticAlternative { instead_of: string; alternative: string; why_better: string; }
export interface StrategySkepticOutput {
  weak_points?: StrategySkepticWeakPoint[];
  assumption_risks?: StrategySkepticAssumption[];
  alternative_tactics?: StrategySkepticAlternative[];
  overall_robustness?: number;
  headline_critique?: string;
}
export interface SimulationData {
  expected_lift: number; confidence_low: number; confidence_high: number;
  expected_roi: number; iterations: number; interventions: SimIntervention[];
  rag_anchored_count?: number;
  strategy_skeptic?: StrategySkepticOutput;
}
export interface ImplStep { step: number; action: string; owner: string; effort?: string; timeline: string; deliverable?: string; dependencies?: string[]; }
export interface RationaleChainStat { stat_id?: string; source?: string; churn_rate?: number | null; size?: number | null; label?: string; }
export interface RationaleChainCause { text?: string; confidence?: number | null; citations?: string[]; }
export interface RationaleChainTactic {
  recommendation?: string; framework?: string;
  target_event?: string | null; trigger_window?: string | null;
  success_metric_formula?: string | null; min_sample_size?: number | null;
  expected_lift_pct_p50?: number | null; expected_lift_pct_p90?: number | null;
  copy_example?: string | null;
}
export interface RationaleChainOutcome {
  mean_lift?: number | null; percentile_10?: number | null; percentile_90?: number | null;
  lift_prior_anchor?: string | null;
}
export interface RationaleChainRisk { source?: string; severity?: string; description?: string; }
export interface RationaleChainMitigation { source?: string; description?: string; }
export interface RationaleChain {
  rank?: number;
  stat?: RationaleChainStat;
  cause?: RationaleChainCause;
  tactic?: RationaleChainTactic;
  simulated_outcome?: RationaleChainOutcome;
  risk?: RationaleChainRisk;
  mitigation?: RationaleChainMitigation;
}
export interface ProblemSolution {
  priority: number;
  problem: { title: string; description: string; affected_segment: string; current_impact: string };
  solution: { title: string; description: string; framework_used: string; key_actions: string[] };
  retention_impact: { estimated_lift_percent: number; estimated_users_retained: number; estimated_revenue_impact: string; confidence: number; time_to_impact: string };
  implementation_steps: ImplStep[];
  rationale_chain?: RationaleChain;
}
export interface PhaseSummary { theme: string; goals: string[]; key_milestones?: string[]; expected_lift: string; }
export interface SuccessMetric { metric: string; current_value: string; target_value: string; measurement_method?: string; review_frequency?: string; }
export interface PlaybookRisk { risk: string; probability: string; mitigation: string; contingency?: string; }
export interface Playbook {
  title: string; created_date?: string;
  executive_summary: { total_problems_identified: number; total_projected_retention_lift: string; estimated_timeline: string; estimated_budget: string; confidence_level: string; };
  problems_and_solutions: ProblemSolution[];
  "30_60_90_roadmap": { phase_1_30_days: PhaseSummary; phase_2_60_days: PhaseSummary; phase_3_90_days: PhaseSummary; };
  success_metrics?: SuccessMetric[];
  risks_and_mitigations?: PlaybookRisk[];
  resource_requirements?: { team?: string[]; technology?: string[]; budget_breakdown?: Record<string, string> };
  reasoning_trace?: string;
}

/* Questionnaire-derived render context — tunes copy, badges, and emphasis
   across every section. Built once from the form payload snapshot. */
export interface Ctx {
  focusNewUsers: boolean; focusEnterprise: boolean; pricingLocked: boolean;
  canShip: boolean; noCSM: boolean; quickWins: boolean; longTerm: boolean;
  wantLTV: boolean; wantNPS: boolean; alreadyHave: string[]; competitors: string;
  goal: string; segment: string; timeline: string; businessModel: string; support: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCtx(q: Record<string, any>): Ctx {
  return {
    focusNewUsers:   (q.priority_segment ?? "").includes("90 days") || (q.priority_segment ?? "").includes("Newest"),
    focusEnterprise: (q.priority_segment ?? "").toLowerCase().includes("enterprise"),
    pricingLocked:   (q.pricing_flexibility ?? []).includes("None — pricing is locked"),
    canShip:         q.can_ship_changes === "Yes",
    noCSM:           q.support_model === "Self-serve only",
    quickWins:       q.timeline === "Quick wins (30 days)",
    longTerm:        ["6-month strategic shift", "Long-term (12+ months)"].includes(q.timeline ?? ""),
    wantLTV:         (q.goal ?? "") === "Increase LTV / expansion",
    wantNPS:         (q.goal ?? "") === "Improve NPS / satisfaction",
    alreadyHave:     (q.retention_tactics ?? []) as string[],
    competitors:     Array.isArray(q.competitors) ? q.competitors.join(", ") : (q.competitors ?? ""),
    goal:            q.goal ?? "Reduce churn",
    segment:         q.priority_segment ?? "All users",
    timeline:        q.timeline ?? "Unspecified",
    businessModel:   q.business_model ?? "SaaS",
    support:         q.support_model ?? "Unknown",
  };
}
