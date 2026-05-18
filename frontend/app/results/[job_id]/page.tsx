"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import "./dashboard.css";

/* ─── Types ─────────────────────────────────────────────────── */
interface FeatureStore {
  ltv_estimates?: { mean_ltv?: number; median_ltv?: number; mean?: number; median?: number; p90?: number };
  velocity_metrics?: { avg_logins_per_month?: number; low_engagement_threshold?: number; drop_off_at_day?: number };
  engagement_cohorts?: Record<string, number>;
  rfm_scores?: Record<string, number>;
}
interface RiskData {
  high_risk_count: number; total_active: number; risk_pct: number;
  confidence: number; insight: string; has_model: boolean;
  feature_store?: FeatureStore; data_quality_score?: number;
  input_context?: { detected_columns?: string[] | Record<string, string>; industry?: string; stage?: string };
}
interface Cohort {
  cohort_id?: string; label?: string; characteristics: string;
  size: number; retention_rate: number;
  tenure_range?: { min: number; max: number };
}
interface ChurnProfile {
  churn_probability: number; max_tenure: number; median_survival_time: number | null;
  milestone_retention: Record<string, number>; behavior_cohorts: Cohort[];
  survival_curve?: Record<string, number>;
  milestone_metadata?: { max_observed_month: number; skipped_flat: number[] };
}
interface EvidenceSource { id: string; source: string; topic: string; score?: number; }
interface Hypothesis {
  hypothesis: string;
  confidence: number;
  supported_by: string[];
  citations?: string[];
  evidence_sources?: EvidenceSource[];
}
interface TopSegment {
  segment_id: string; source: string; label: string;
  size: number; retention_rate: number; churn_rate: number;
  descriptor: string; dominant_cause?: string | null;
}
interface DriverFeature {
  feature: string; hazard_ratio: number; coef: number;
  p_value: number; direction: string; significant?: boolean;
}
interface StatBucketEntry { churn_rate: number; size: number; }
type StatBuckets = Record<string, Record<string, StatBucketEntry>>;
interface ForensicFindingsRich {
  suspected_causes?: string[];
  confidence_scores?: Record<string, number>;
  citations?: Record<string, string[]>;
  per_cause_evidence?: Record<string, EvidenceSource[]>;
  statistical_evidence?: {
    churn_rate?: number;
    churn_by_channel?: Record<string, StatBucketEntry>;
    churn_by_plan_tier?: Record<string, StatBucketEntry>;
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
interface SkepticAltExplanation { hypothesis?: string; alternative?: string; testability?: string; }
interface SkepticCounterArg { hypothesis?: string; counter_argument?: string; strength?: string; }
interface SkepticBiasFlag { issue?: string; risk?: string; recommendation?: string; }
interface ProfessionalSkepticOutput {
  counter_arguments?: SkepticCounterArg[];
  alternative_explanations?: SkepticAltExplanation[];
  bias_flags?: SkepticBiasFlag[];
  robustness_scores?: Record<string, number>;
}
interface CompetitorResearch {
  matched: boolean; competitor?: string | null; churn_destination?: string;
  evidence?: { id: string; source: string; topic: string; score?: number; snippet?: string }[];
  counter_positioning?: string[];
  error?: string;
}
interface DiagnosisData {
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
interface SimIntervention {
  name: string; p10: number; mean: number; p90: number;
  lift_prior_anchor?: "rag" | "self_reported" | null;
  lift_prior_pct?: number;
  lift_prior_citations?: string[];
}
interface StrategySkepticWeakPoint { tactic: string; weakness: string; severity: "low" | "medium" | "high"; }
interface StrategySkepticAssumption { assumption: string; why_risky: string; mitigation: string; }
interface StrategySkepticAlternative { instead_of: string; alternative: string; why_better: string; }
interface StrategySkepticOutput {
  weak_points?: StrategySkepticWeakPoint[];
  assumption_risks?: StrategySkepticAssumption[];
  alternative_tactics?: StrategySkepticAlternative[];
  overall_robustness?: number;
  headline_critique?: string;
}
interface SimulationData {
  expected_lift: number; confidence_low: number; confidence_high: number;
  expected_roi: number; iterations: number; interventions: SimIntervention[];
  rag_anchored_count?: number;
  strategy_skeptic?: StrategySkepticOutput;
}
interface ImplStep { step: number; action: string; owner: string; effort?: string; timeline: string; deliverable?: string; dependencies?: string[]; }
interface RationaleChainStat { stat_id?: string; source?: string; churn_rate?: number | null; size?: number | null; label?: string; }
interface RationaleChainCause { text?: string; confidence?: number | null; citations?: string[]; }
interface RationaleChainTactic {
  recommendation?: string; framework?: string;
  target_event?: string | null; trigger_window?: string | null;
  success_metric_formula?: string | null; min_sample_size?: number | null;
  expected_lift_pct_p50?: number | null; expected_lift_pct_p90?: number | null;
  copy_example?: string | null;
}
interface RationaleChainOutcome {
  mean_lift?: number | null; percentile_10?: number | null; percentile_90?: number | null;
  lift_prior_anchor?: string | null;
}
interface RationaleChainRisk { source?: string; severity?: string; description?: string; }
interface RationaleChainMitigation { source?: string; description?: string; }
interface RationaleChain {
  rank?: number;
  stat?: RationaleChainStat;
  cause?: RationaleChainCause;
  tactic?: RationaleChainTactic;
  simulated_outcome?: RationaleChainOutcome;
  risk?: RationaleChainRisk;
  mitigation?: RationaleChainMitigation;
}
interface ProblemSolution {
  priority: number;
  problem: { title: string; description: string; affected_segment: string; current_impact: string };
  solution: { title: string; description: string; framework_used: string; key_actions: string[] };
  retention_impact: { estimated_lift_percent: number; estimated_users_retained: number; estimated_revenue_impact: string; confidence: number; time_to_impact: string };
  implementation_steps: ImplStep[];
  rationale_chain?: RationaleChain;
}
interface PhaseSummary { theme: string; goals: string[]; key_milestones?: string[]; expected_lift: string; }
interface SuccessMetric { metric: string; current_value: string; target_value: string; measurement_method?: string; review_frequency?: string; }
interface PlaybookRisk { risk: string; probability: string; mitigation: string; contingency?: string; }
interface Playbook {
  title: string; created_date?: string;
  executive_summary: { total_problems_identified: number; total_projected_retention_lift: string; estimated_timeline: string; estimated_budget: string; confidence_level: string; };
  problems_and_solutions: ProblemSolution[];
  "30_60_90_roadmap": { phase_1_30_days: PhaseSummary; phase_2_60_days: PhaseSummary; phase_3_90_days: PhaseSummary; };
  success_metrics?: SuccessMetric[];
  risks_and_mitigations?: PlaybookRisk[];
  resource_requirements?: { team?: string[]; technology?: string[]; budget_breakdown?: Record<string, string> };
  reasoning_trace?: string;
}

/* ─── ctx ───────────────────────────────────────────────────── */
interface Ctx {
  focusNewUsers: boolean; focusEnterprise: boolean; pricingLocked: boolean;
  canShip: boolean; noCSM: boolean; quickWins: boolean; longTerm: boolean;
  wantLTV: boolean; wantNPS: boolean; alreadyHave: string[]; competitors: string;
  goal: string; segment: string; timeline: string; businessModel: string; support: string;
}
function buildCtx(q: Record<string, any>): Ctx {
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

/* ─── Helpers ───────────────────────────────────────────────── */
const pct = (n: number) => `${Math.round(n * 100)}%`;
function retClass(r: number) { if (r >= 0.75) return "ret-good"; if (r >= 0.5) return "ret-mid"; return "ret-bad"; }
function milestoneColor(r: number) {
  if (r >= 0.75) return { color: "var(--emerald)" };
  if (r >= 0.5) return { color: "var(--amber)" };
  return { color: "var(--red)" };
}
// Parse milestone dict (keys like "month_3") into sorted (month, retention)
// points. Backend now chooses milestone months dynamically based on the
// observed tenure range, so we can't rely on a fixed [1,3,6,12,24,36] list.
function parseMilestonePoints(ms: Record<string, number>): [number, number][] {
  return Object.entries(ms)
    .map(([k, v]) => [Number(k.replace(/^month_/, "")), v] as [number, number])
    .filter(([m, v]) => Number.isFinite(m) && v != null)
    .sort((a, b) => a[0] - b[0]);
}

function interpolateRetention(month: number, ms: Record<string, number>) {
  const pts = parseMilestonePoints(ms);
  if (!pts.length) return 1;
  if (month <= pts[0][0]) return pts[0][1];
  if (month >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (month <= pts[i][0]) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      return y1 + (y2 - y1) * ((month - x1) / (x2 - x1));
    }
  }
  return pts[pts.length - 1][1];
}

function getBadge(action: string, ctx: Ctx): { kind: "eng" | "have" | "price" | "csm"; label: string } | null {
  const a = action.toLowerCase();
  if (ctx.pricingLocked && /\b(discount|price|plan|tier|pricing)\b/.test(a))
    return { kind: "price", label: "🔒 Pricing locked" };
  if (!ctx.canShip && /(build|ship|feature|product|redesign|engineer|integration|a\/b test|trigger|scope)/.test(a))
    return { kind: "eng", label: "⚠ Needs eng" };
  if (ctx.noCSM && /(csm|outreach|account manager|customer success|1:1)/.test(a))
    return { kind: "csm", label: "⚠ Needs CSM" };
  if (ctx.alreadyHave.some(x => /onboarding/i.test(x)) && /(onboard|tutorial|walkthrough|tour)/.test(a))
    return { kind: "have", label: "↩ In place" };
  if (ctx.alreadyHave.some(x => /win.?back/i.test(x)) && /(win.?back|reactivat)/.test(a))
    return { kind: "have", label: "↩ In place" };
  if (ctx.alreadyHave.some(x => /nps|feedback/i.test(x)) && /(nps|survey|feedback|csat)/.test(a))
    return { kind: "have", label: "↩ In place" };
  return null;
}

/* ─── Pipeline state ───────────────────────────────────────── */
const PIPELINE_STEPS = [
  { id: "signal",    label: "Signal",    color: "amber",   key: "risk_ready",            typical: "~3s"      },
  { id: "patterns",  label: "Patterns",  color: "blue",    key: "churn_profile_ready",   typical: "~5s"      },
  { id: "diagnosis", label: "Diagnosis", color: "purple",  key: "diagnosis_ready",       typical: "~25–40s"  },
  { id: "clarify",   label: "Clarify",   color: "violet",  key: "hitl_questions_ready",  typical: "human"    },
  { id: "simulate",  label: "Simulate",  color: "teal",    key: "simulation_ready",      typical: "~4s"      },
  { id: "strategy",  label: "Strategy",  color: "emerald", key: "solution_ready",        typical: "~30–60s · +retry" },
];

/* ─── Time formatting ───────────────────────────────────────── */
function fmtElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

function derivePipelineState(stages: Record<string, any>, hitlSubmitted: boolean, complete: boolean): Record<string, "done" | "active" | "pending"> {
  const out: Record<string, "done" | "active" | "pending"> = {};
  let activeAssigned = false;
  for (const s of PIPELINE_STEPS) {
    const arrived = !!stages[s.key];
    const isClarifyArrivedNotSubmitted = s.id === "clarify" && arrived && !hitlSubmitted;
    if (isClarifyArrivedNotSubmitted) {
      out[s.id] = "active";
      activeAssigned = true;
    } else if (arrived) {
      out[s.id] = "done";
    } else if (!activeAssigned) {
      out[s.id] = "active";
      activeAssigned = true;
    } else {
      out[s.id] = "pending";
    }
  }
  if (complete) for (const s of PIPELINE_STEPS) out[s.id] = "done";
  return out;
}

/* ─── Sidebar ───────────────────────────────────────────────── */
function ContextChip({ k, v, why }: { k: string; v: string; why: React.ReactNode }) {
  return (
    <div className="tt-wrap">
      <span className="ctx-chip">
        <span className="ctx-k">{k}</span>
        <span className="ctx-v">{v}</span>
      </span>
      <div className="tt"><b>Why this matters</b><br />{why}</div>
    </div>
  );
}

function Sidebar({
  pipelineState, jobId, ctx, onRefine, onRerun,
  stageStartTs, stageEndTs, now, forensicProgress, retryInfo,
}: {
  pipelineState: Record<string, string>; jobId: string; ctx: Ctx;
  onRefine: () => void; onRerun: () => void;
  stageStartTs: Record<string, number>;
  stageEndTs: Record<string, number>;
  now: number;
  forensicProgress: { run: number; total: number; status: string } | null;
  retryInfo: { iteration: number; max: number; verdict: string; reason: string; weakPoints: number } | null;
}) {
  const stageTime = (id: string): string | null => {
    const start = stageStartTs[id];
    if (start === undefined) return null;
    const end = stageEndTs[id];
    const ms = (end ?? now) - start;
    return fmtElapsed(ms);
  };
  const chips = [
    { k: "Goal",      v: ctx.goal.split(" ").slice(0, 3).join(" "), why: <>Drives selection of <em>retention-focused</em> playbooks. Filters out off-goal interventions.</> },
    { k: "Segment",   v: ctx.segment.length > 18 ? ctx.segment.slice(0, 16) + "…" : ctx.segment, why: <>Diagnosis and roadmap focus on the <em>{ctx.segment}</em> cohort.</> },
    { k: "Timeline",  v: ctx.quickWins ? "Quick · 30d" : ctx.longTerm ? "Long-term" : "Standard", why: <>{ctx.quickWins ? <>30-day phase rendered <em>full opacity</em>; 60/90-day phases dimmed.</> : <>Full 30/60/90 roadmap rendered.</>}</> },
    { k: "Model",     v: ctx.businessModel, why: <>Hypothesis priors and strategy framing tuned for <em>{ctx.businessModel}</em>.</> },
    ...(ctx.pricingLocked ? [{ k: "Pricing", v: "Locked", why: <>Pricing experiments <em>removed</em> from feasible interventions.</> }] : []),
    ...(ctx.noCSM ? [{ k: "Support", v: "Self-serve", why: <>CSM-led playbooks deprioritized; behavioral triggers favored.</> }] : []),
    ...(!ctx.canShip ? [{ k: "Can ship", v: "No", why: <>Steps requiring engineering get <em>"Needs eng"</em> badges.</> }] : []),
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <div className="brand-name">Retain AI</div>
          <div className="brand-job tnum">job · {jobId?.split("-")[0]}</div>
        </div>
      </div>
      <div className="pipeline">
        {PIPELINE_STEPS.map((s) => {
          const status = pipelineState[s.id] || "pending";
          const cls = `pipe-row ${status} ${status === "active" ? s.color + "-active" : ""}`;
          const t = stageTime(s.id);
          const showSubsteps =
            s.id === "diagnosis" && status === "active" && forensicProgress !== null;
          const showRetry =
            (s.id === "strategy" || s.id === "simulate") && retryInfo !== null;
          return (
            <div key={s.id} className={cls}>
              {/* Inner column flex — preserves existing .pipe-row coloring while
                  letting us stack a sub-row of typical/substeps/retry below.   */}
              <div className="flex w-full flex-col gap-[3px]">
                <div className="flex items-center gap-2.5 min-h-[18px]">
                  <span className="pipe-dot" />
                  <span className="pipe-label">{s.label}</span>
                  <span className="ml-auto inline-flex items-center gap-2">
                    {status === "active" && t && (
                      <span className="tnum text-[11px] font-medium tracking-normal text-[var(--text)] opacity-90">
                        {t}
                      </span>
                    )}
                    {status === "done" && t && (
                      <span className="tnum text-[10px] tracking-normal text-[var(--text-zinc)]">
                        {t}
                      </span>
                    )}
                    {status === "done" && <span className="pipe-check">✓</span>}
                  </span>
                </div>

                <div className="pl-[18px] min-h-[12px] flex items-center gap-2.5 flex-wrap">
                  {(status === "active" || status === "pending") && (
                    <span
                      className={[
                        "text-[9px] uppercase tracking-[0.08em] font-medium tnum",
                        status === "pending"
                          ? "text-[rgba(82,82,91,0.55)]"
                          : "text-[var(--text-dim)]",
                      ].join(" ")}
                    >
                      {s.typical}
                    </span>
                  )}

                  {showSubsteps && forensicProgress && (
                    <span
                      className="inline-flex items-center gap-1.5 pl-2 border-l border-[var(--border)]"
                      aria-label={`forensic run ${forensicProgress.run} of ${forensicProgress.total}`}
                    >
                      {Array.from({ length: forensicProgress.total }).map((_, i) => {
                        const idx = i + 1;
                        const filled =
                          idx < forensicProgress.run ||
                          (idx === forensicProgress.run && forensicProgress.status === "completed");
                        const active =
                          idx === forensicProgress.run && forensicProgress.status === "started";
                        return (
                          <span
                            key={i}
                            aria-hidden="true"
                            className={[
                              "w-1.5 h-1.5 rounded-full border transition-all duration-300",
                              filled
                                ? "bg-[var(--purple)] border-[var(--purple)] shadow-[0_0_6px_rgba(168,85,247,0.45)]"
                                : "bg-[rgba(168,85,247,0.16)] border-[rgba(168,85,247,0.32)]",
                              active ? "animate-pulse" : "",
                            ].join(" ")}
                          />
                        );
                      })}
                      <span className="text-[9px] uppercase tracking-[0.06em] font-semibold text-[var(--purple)] ml-0.5">
                        run {forensicProgress.run}/{forensicProgress.total}
                      </span>
                    </span>
                  )}

                  {showRetry && retryInfo && (
                    <span
                      className={[
                        "inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full",
                        "text-[9px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap border",
                        retryInfo.verdict === "violation"
                          ? "border-[rgba(239,68,68,0.42)] bg-[rgba(239,68,68,0.07)] text-[var(--red)]"
                          : "border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.08)] text-[var(--amber)]",
                      ].join(" ")}
                    >
                      <span className="inline-block text-[11px] animate-spin [animation-direction:reverse] [animation-duration:2.4s]">
                        ↻
                      </span>
                      retry {Math.min(retryInfo.iteration + 1, retryInfo.max)}/{retryInfo.max}
                      {retryInfo.weakPoints > 0 && (
                        <span className="tnum text-[9px] opacity-85 tracking-[0.02em]">
                          · {retryInfo.weakPoints} weak pts
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <div className="ctx-title">Your Context</div>
        <div className="ctx-chips">
          {chips.map((c) => <ContextChip key={c.k} k={c.k} v={c.v || "—"} why={c.why} />)}
        </div>
      </div>
      <div className="sidebar-bottom">
        <button className="btn ghost" style={{ flex: 1, height: 30, fontSize: 12 }} onClick={onRefine}>Refine →</button>
        <button className="btn ghost" style={{ flex: 1, height: 30, fontSize: 12 }} onClick={onRerun}>Rerun</button>
      </div>
    </aside>
  );
}

/* ─── Sections ──────────────────────────────────────────────── */
function SignalSection({ data, ctx, visible }: { data: RiskData; ctx: Ctx; visible: boolean }) {
  const fs = data.feature_store;
  const ltvMean = fs?.ltv_estimates?.mean_ltv ?? fs?.ltv_estimates?.mean;
  const ltvMed = fs?.ltv_estimates?.median_ltv ?? fs?.ltv_estimates?.median;
  const cols = fs ? "cols-5" : "cols-3";
  const detectedCols = data.input_context?.detected_columns;
  const colCount = Array.isArray(detectedCols) ? detectedCols.length : detectedCols ? Object.values(detectedCols).filter(Boolean).length : 0;
  return (
    <section className={`section ${visible ? "visible" : ""}`}>
      <div className="section-head">
        <h2 className="section-title amber">Signal</h2>
        <span className="section-meta tnum">{data.total_active.toLocaleString()} active users · risk model {data.confidence}% conf.</span>
      </div>
      <div className={`stat-row ${cols}`}>
        <div className="stat">
          <div className="stat-label">High risk users</div>
          <div className="stat-value amber tnum">{data.high_risk_count.toLocaleString()}</div>
          <div className="stat-sub tnum">of {data.total_active.toLocaleString()} active</div>
        </div>
        <div className="stat">
          <div className="stat-label">At risk</div>
          <div className="stat-value amber tnum">{data.risk_pct.toFixed(1)}%</div>
          <div className="stat-sub">of user base</div>
        </div>
        <div className="stat">
          <div className="stat-label">Confidence</div>
          <div className="stat-value tnum">{data.confidence}%</div>
          <div className="stat-sub">concordance index</div>
        </div>
        {ltvMean != null && (
          <div className="stat">
            <div className="stat-label">Mean LTV</div>
            <div className="stat-value tnum">${Math.round(ltvMean).toLocaleString()}</div>
            {ltvMed != null && <div className="stat-sub tnum">median ${Math.round(ltvMed).toLocaleString()}</div>}
          </div>
        )}
        {fs?.velocity_metrics?.avg_logins_per_month != null && (
          <div className="stat">
            <div className="stat-label">Avg logins / mo</div>
            <div className="stat-value blue tnum">{fs.velocity_metrics.avg_logins_per_month}</div>
            {fs.velocity_metrics.drop_off_at_day != null && (
              <div className="stat-sub tnum">drop-off day {fs.velocity_metrics.drop_off_at_day}</div>
            )}
          </div>
        )}
      </div>
      <div className="insight">{data.insight}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {data.data_quality_score != null && <span className="chip zinc">data quality {Math.round(data.data_quality_score * 100)}%</span>}
        {colCount > 0 && <span className="chip zinc">{colCount} columns detected</span>}
        {data.input_context?.industry && <span className="chip zinc">industry · {data.input_context.industry}</span>}
        {data.input_context?.stage && <span className="chip zinc">stage · {data.input_context.stage}</span>}
      </div>
    </section>
  );
}

// Inline SVG sparkline of the KM survival curve. No charting lib — keeps
// bundle slim and renders crisply on any background. Highlights the slider's
// current month as a vertical guide so the big number above feels anchored
// to a real point on the curve.
function SurvivalSparkline({ data, currentMonth }: { data: ChurnProfile; currentMonth: number }) {
  const W = 320;
  const H = 72;
  const PAD_X = 4;
  const PAD_Y = 6;

  // Prefer the dense survival_curve for shape; fall back to milestone points.
  const rawPts: [number, number][] = data.survival_curve
    ? Object.entries(data.survival_curve)
        .map(([k, v]) => [Number(k.replace(/^month_/, "")), v] as [number, number])
        .filter(([m, v]) => Number.isFinite(m) && v != null)
        .sort((a, b) => a[0] - b[0])
    : parseMilestonePoints(data.milestone_retention);

  if (rawPts.length < 2) return null;

  const maxX = Math.max(rawPts[rawPts.length - 1][0], data.max_tenure || 1);
  const toX = (m: number) => PAD_X + (m / maxX) * (W - PAD_X * 2);
  const toY = (r: number) => PAD_Y + (1 - r) * (H - PAD_Y * 2);

  const linePath = rawPts.map(([m, r], i) => `${i === 0 ? "M" : "L"}${toX(m).toFixed(1)},${toY(r).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${toX(rawPts[rawPts.length - 1][0]).toFixed(1)},${(H - PAD_Y).toFixed(1)} L${toX(rawPts[0][0]).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`;
  const cx = toX(currentMonth);
  const cy = toY(interpolateRetention(currentMonth, data.milestone_retention));

  return (
    <svg className="km-sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="km-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(59,130,246,0.32)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={PAD_X} y1={PAD_Y + t * (H - PAD_Y * 2)} x2={W - PAD_X} y2={PAD_Y + t * (H - PAD_Y * 2)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}
      <path d={areaPath} fill="url(#km-fill)" />
      <path d={linePath} fill="none" stroke="rgba(96,165,250,0.95)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1={cx} y1={PAD_Y} x2={cx} y2={H - PAD_Y} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2 3" />
      <circle cx={cx} cy={cy} r="3.5" fill="#60a5fa" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
    </svg>
  );
}

function ChurnProfileSection({ data, ctx, visible }: { data: ChurnProfile; ctx: Ctx; visible: boolean }) {
  const [month, setMonth] = useState(12);
  useEffect(() => { if (data.max_tenure && month === 12 && data.max_tenure < 12) setMonth(data.max_tenure); }, [data.max_tenure]);
  const retention = interpolateRetention(month, data.milestone_retention);
  const churn = (1 - retention) * 100;
  // Render whatever milestones the backend chose (dynamic — see
  // behavioral_map.py `candidate_milestones` block). Flat-region milestones
  // are dropped server-side so the UI never shows a row of identical %.
  const milestones = parseMilestonePoints(data.milestone_retention).map(([m, val]) => ({
    key: `month_${m}`,
    label: `Mo. ${m}`,
    val,
  }));
  const skippedFlat = data.milestone_metadata?.skipped_flat ?? [];
  const maxObserved = data.milestone_metadata?.max_observed_month ?? data.max_tenure;
  const focusId = ctx.focusNewUsers ? "low_tenure" : ctx.focusEnterprise ? "high_tenure" : null;
  return (
    <section className={`section ${visible ? "visible" : ""}`}>
      <div className="section-head">
        <h2 className="section-title blue">Churn Profile</h2>
        {data.median_survival_time != null && <span className="section-meta tnum">median survival · mo. {data.median_survival_time}</span>}
      </div>
      <div className="churn-grid">
        <div className="churn-prob">
          <div className="churn-prob-lbl">Churn probability at month {month}</div>
          <div className="churn-prob-num tnum">{churn.toFixed(1)}%<small>· {pct(retention)} still active</small></div>
          <div className="slider-wrap">
            <input type="range" className="slider" min={1} max={data.max_tenure || 36} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
            <div className="slider-labels">
              <span>Month 1</span>
              <span className="tnum">Month {month}</span>
              <span>Month {data.max_tenure}</span>
            </div>
          </div>
          <SurvivalSparkline data={data} currentMonth={month} />
          <div className="churn-prob-stats">
            <div className="cps-stat">
              <span className="cps-label">Median survival</span>
              <span className="cps-val tnum">
                {data.median_survival_time != null ? `mo. ${data.median_survival_time}` : "—"}
              </span>
            </div>
            <div className="cps-divider" />
            <div className="cps-stat">
              <span className="cps-label">Observed window</span>
              <span className="cps-val tnum">1–{data.max_tenure} mo.</span>
            </div>
            <div className="cps-divider" />
            <div className="cps-stat">
              <span className="cps-label">Final retention</span>
              <span className="cps-val tnum">{Math.round((1 - data.churn_probability / 100) * 100)}%</span>
            </div>
          </div>
        </div>
        <div className="milestone">
          <div className="milestone-lbl">
            Milestone retention
            {skippedFlat.length > 0 && (
              <span
                className="milestone-flat-note"
                title={`Months ${skippedFlat.join(", ")} skipped — KM curve is flat past month ${maxObserved} (no new churn events observed beyond that point).`}
              >
                · curve flat past mo. {maxObserved}
              </span>
            )}
          </div>
          <div className="milestone-grid" data-count={milestones.length}>
            {milestones.map((m) => (
              <div key={m.key} className="milestone-cell">
                <div className="milestone-cell-label">{m.label}</div>
                <div className="milestone-cell-val tnum" style={milestoneColor(m.val)}>{Math.round(m.val * 100)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cohorts">
        {data.behavior_cohorts.slice(0, 3).map((c, i) => {
          const cid = c.cohort_id ?? (i === 0 ? "low_tenure" : i === 1 ? "medium_tenure" : "high_tenure");
          const isFocus = cid === focusId;
          return (
            <div key={i} className={`cohort ${isFocus ? "focus" : ""}`}>
              {isFocus && <span className="chip violet chip-sm focus-pill">Your focus</span>}
              <div className="cohort-head">
                <div className="cohort-name">{c.label ?? (cid === "low_tenure" ? "Short tenure" : cid === "high_tenure" ? "Long tenure" : "Medium tenure")}</div>
                {c.tenure_range && <div className="cohort-meta tnum">{c.tenure_range.min}–{c.tenure_range.max} mo.</div>}
              </div>
              <div className="cohort-stats">
                <span className="cohort-size tnum">{c.size.toLocaleString()}</span>
                <span className={`cohort-retention tnum ${c.retention_rate < 0.7 ? "warn" : ""}`}>{Math.round(c.retention_rate * 100)}% retention</span>
              </div>
              <div className="cohort-desc">{c.characteristics}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DiagnosisSection({ data, ctx, visible, onOpenEvidence }: { data: DiagnosisData; ctx: Ctx; visible: boolean; onOpenEvidence: (idx: number) => void }) {
  const hyps = data.merged_hypotheses ?? [];
  const forensicArr = Array.isArray(data.forensic_findings) ? data.forensic_findings : [];
  const patternArr = data.pattern_findings ?? [];
  const skepticArr = Array.isArray(data.skeptic_findings) ? (data.skeptic_findings as Array<{ caveat?: string; counter_argument?: string }>) : [];
  const competitorText = ctx.competitors || (Array.isArray(data.competitors) ? data.competitors.join(", ") : data.competitors) || "";
  return (
    <section className={`section ${visible ? "visible" : ""}`}>
      <div className="section-head">
        <h2 className="section-title purple">Root Cause</h2>
        <span className="section-meta tnum">
          {data.total_patterns_identified != null && `${data.total_patterns_identified} patterns · `}
          {hyps.length} ranked hypotheses
        </span>
      </div>
      <div className="hyp-list">
        {hyps.slice(0, 3).map((h, i) => (
          <button
            type="button"
            className="hyp hyp-clickable"
            key={i}
            onClick={() => onOpenEvidence(i)}
            aria-label={`Open evidence drawer for hypothesis ${i + 1}`}
          >
            <div className="hyp-row">
              <div className="hyp-num">{i + 1}</div>
              <div className="hyp-text">{h.hypothesis}</div>
              <div className="hyp-conf tnum">{Math.round(h.confidence * 100)}%</div>
            </div>
            <div className="hyp-bar"><div className="hyp-bar-fill" style={{ width: visible ? `${h.confidence * 100}%` : "0%" }} /></div>
            <div className="hyp-bottom">
              <div className="hyp-tags">
                {(h.supported_by ?? []).map((t) => <span key={t} className="hyp-tag">supported by · {t}</span>)}
                {(h.citations?.length ?? 0) > 0 && (
                  <span className="hyp-tag">{h.citations!.length} citations</span>
                )}
              </div>
              <span className="hyp-open">open evidence&nbsp;→</span>
            </div>
          </button>
        ))}
      </div>
      {competitorText && (
        <div className="compete-strip">
          <span className="lbl">Losing to</span>
          <span style={{ color: "var(--text)" }}>{competitorText}</span>
          <span style={{ color: "var(--text-zinc)", fontSize: 11 }}>· dominant cancellation destination</span>
        </div>
      )}
      {(forensicArr.length > 0 || patternArr.length > 0) && (
        <div className="dx-grid">
          {forensicArr.length > 0 && (
            <div className="dx-card">
              <div className="dx-card-head">
                <div className="dx-card-title">Forensic findings</div>
                <span className="chip zinc chip-sm">{forensicArr.length} citations</span>
              </div>
              <div className="dx-list">
                {forensicArr.slice(0, 6).map((f, i) => (
                  <div className="dx-item" key={i}>
                    <div>
                      <div className="dx-sig">{f.signal}</div>
                      {f.citation && <div className="dx-cite tnum">{f.citation}</div>}
                    </div>
                    {f.strength && <span className={`hyp-tag ${f.strength}`}>{f.strength}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {patternArr.length > 0 && (
            <div className="dx-card">
              <div className="dx-card-head">
                <div className="dx-card-title">Pattern segments</div>
                <span className="chip zinc chip-sm">{patternArr.length} segments</span>
              </div>
              <table className="dx-table">
                <thead><tr><th>Segment</th><th style={{ textAlign: "right" }}>Size</th><th style={{ textAlign: "right" }}>Retention</th></tr></thead>
                <tbody>
                  {patternArr.slice(0, 6).map((p, i) => (
                    <tr key={i}>
                      <td>
                        <div>{p.segment}</div>
                        {p.signature && <div style={{ fontSize: 10, color: "var(--text-zinc)", marginTop: 2 }}>{p.signature}</div>}
                      </td>
                      <td className="num">{(p.size ?? 0).toLocaleString()}</td>
                      <td className={`num ${retClass(p.retention ?? 0)}`}>{Math.round((p.retention ?? 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {skepticArr.length > 0 && (
        <div className="dx-card" style={{ marginTop: 12 }}>
          <div className="dx-card-head">
            <div className="dx-card-title">Skeptic caveats</div>
            <span className="chip zinc chip-sm">disclosed assumptions</span>
          </div>
          <div className="dx-list">
            {skepticArr.slice(0, 5).map((s: any, i: number) => (
              <div className="dx-item" key={i} style={{ display: "block" }}>
                <div className="dx-sig" style={{ fontSize: 12, color: "var(--text-muted)" }}>· {s.caveat ?? s.counter_argument ?? JSON.stringify(s).slice(0, 200)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SimulationSection({ data, visible }: { data: SimulationData; visible: boolean }) {
  const maxX = Math.max(...(data.interventions || []).map((i) => i.p90), data.expected_lift) + 4;
  return (
    <section className={`section ${visible ? "visible" : ""}`}>
      <div className="section-head">
        <h2 className="section-title teal">Monte Carlo Simulation</h2>
        <span className="section-meta tnum">{data.iterations.toLocaleString()} iterations · {data.interventions?.length ?? 0} interventions</span>
      </div>
      <div className="sim-summary">
        <div className="stat">
          <div className="stat-label">Expected lift</div>
          <div className="stat-value teal lg tnum">+{data.expected_lift}%</div>
          <div className="stat-sub tnum">p10 {data.confidence_low}% → p90 {data.confidence_high}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Range (90% CI)</div>
          <div className="stat-value tnum">{data.confidence_low}% – {data.confidence_high}%</div>
          <div className="stat-sub">retention lift</div>
        </div>
        <div className="stat">
          <div className="stat-label">Expected ROI</div>
          <div className="stat-value tnum">{data.expected_roi}%</div>
          <div className="stat-sub">simulated</div>
        </div>
        <div className="stat">
          <div className="stat-label">Iterations</div>
          <div className="stat-value tnum">{(data.iterations / 1000).toFixed(0)}K</div>
          <div className="stat-sub">parameter draws</div>
        </div>
      </div>
      {data.interventions?.length > 0 && (
        <div className="sim-bars">
          <div className="sim-bars-head">
            <div className="sim-bars-title">Per-intervention lift · p10–p90</div>
            <div className="sim-bars-axis">0% — {Math.round(maxX)}% retention lift</div>
          </div>
          {data.interventions.map((it, i) => {
            const startPct = (it.p10 / maxX) * 100;
            const endPct = (it.p90 / maxX) * 100;
            const meanPct = (it.mean / maxX) * 100;
            return (
              <div className="sim-row" key={i}>
                <div className="sim-row-name">{it.name || `Intervention ${i + 1}`}</div>
                <div>
                  <div className="sim-row-track">
                    <div className="sim-row-range" style={{ left: `${startPct}%`, width: visible ? `${endPct - startPct}%` : "0%", transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
                    <div className="sim-row-mean" style={{ left: visible ? `${meanPct}%` : "0%", transition: "left 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
                  </div>
                  <div className="sim-row-p-labels">
                    <span>p10 · {it.p10}%</span>
                    <span>mean · {it.mean}%</span>
                    <span>p90 · {it.p90}%</span>
                  </div>
                </div>
                <div className="sim-row-mean-label">+{it.mean}%</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ImplStepRow({ s, ctx }: { s: ImplStep; ctx: Ctx }) {
  const b = getBadge(s.action, ctx);
  return (
    <div className="impl-step">
      <div className="impl-step-n tnum">{s.step}</div>
      <div className="impl-step-body">
        <div className="impl-step-action">{s.action}</div>
        <div className="impl-step-meta">
          {s.owner && <span><b>Owner:</b> {s.owner}</span>}
          {s.effort && <span><b>Effort:</b> {s.effort}</span>}
          {s.deliverable && <span><b>Deliverable:</b> {s.deliverable}</span>}
          {s.dependencies && s.dependencies.length > 0 && <span><b>Deps:</b> {s.dependencies.join(", ")}</span>}
        </div>
      </div>
      <div className="impl-step-time tnum">{s.timeline}</div>
      <div className="impl-step-badges">
        {b?.kind === "eng"   && <span className="chip amber chip-sm">{b.label}</span>}
        {b?.kind === "csm"   && <span className="chip amber chip-sm">{b.label}</span>}
        {b?.kind === "price" && <span className="chip red chip-sm">{b.label}</span>}
        {b?.kind === "have"  && <span className="chip emerald chip-sm">{b.label}</span>}
      </div>
    </div>
  );
}

function RationaleChainStrip({ chain }: { chain: RationaleChain }) {
  const steps: { label: string; body: React.ReactNode; tone: string }[] = [];
  if (chain.stat?.stat_id) {
    const cr = chain.stat.churn_rate;
    const sz = chain.stat.size;
    steps.push({
      label: "stat",
      tone: "amber",
      body: (
        <>
          <div className="rc-id tnum">{chain.stat.stat_id}</div>
          {(cr != null || sz != null) && (
            <div className="rc-meta tnum">
              {cr != null && <>{(cr * 100).toFixed(1)}%</>}
              {cr != null && sz != null && <> · </>}
              {sz != null && <>{sz.toLocaleString()} users</>}
            </div>
          )}
        </>
      ),
    });
  }
  if (chain.cause?.text) {
    steps.push({
      label: "cause",
      tone: "purple",
      body: <div className="rc-line">{chain.cause.text}</div>,
    });
  }
  if (chain.tactic?.recommendation) {
    steps.push({
      label: "tactic",
      tone: "emerald",
      body: (
        <>
          <div className="rc-line">{chain.tactic.recommendation}</div>
          {(chain.tactic.target_event || chain.tactic.trigger_window) && (
            <div className="rc-meta tnum">
              {chain.tactic.target_event && <>event · {chain.tactic.target_event}</>}
              {chain.tactic.target_event && chain.tactic.trigger_window && <> · </>}
              {chain.tactic.trigger_window && <>window · {chain.tactic.trigger_window}</>}
            </div>
          )}
        </>
      ),
    });
  }
  if (chain.simulated_outcome?.mean_lift != null) {
    const anchor = chain.simulated_outcome.lift_prior_anchor;
    steps.push({
      label: "outcome",
      tone: "teal",
      body: (
        <>
          <div className="rc-line tnum">
            +{Number(chain.simulated_outcome.mean_lift).toFixed(1)}% mean lift
            {chain.simulated_outcome.percentile_10 != null && chain.simulated_outcome.percentile_90 != null && (
              <> · p10–p90 {Number(chain.simulated_outcome.percentile_10).toFixed(1)}–{Number(chain.simulated_outcome.percentile_90).toFixed(1)}%</>
            )}
          </div>
          {anchor && <div className="rc-meta">prior · {anchor === "rag" ? "RAG-anchored" : "self-reported"}</div>}
        </>
      ),
    });
  }
  if (chain.risk?.description) {
    steps.push({
      label: "risk",
      tone: "red",
      body: (
        <>
          <div className="rc-line">{chain.risk.description}</div>
          {chain.risk.severity && <div className="rc-meta">severity · {chain.risk.severity}</div>}
        </>
      ),
    });
  }
  if (chain.mitigation?.description) {
    steps.push({
      label: "mitigation",
      tone: "violet",
      body: <div className="rc-line">{chain.mitigation.description}</div>,
    });
  }
  if (steps.length === 0) return null;
  return (
    <div className="rc-strip">
      <div className="rc-strip-head">
        <span className="rc-strip-title">Rationale chain</span>
        <span className="rc-strip-sub">stat → cause → tactic → outcome → risk → mitigation</span>
      </div>
      <ol className="rc-list">
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className={`rc-step rc-${step.tone}`}>
            <div className="rc-dot" aria-hidden="true" />
            <div className="rc-step-body">
              <div className="rc-step-label">{step.label}</div>
              {step.body}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProblemCard({ p, ctx, defaultOpen }: { p: ProblemSolution; ctx: Ctx; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const cls = p.priority === 1 ? "priority" : p.priority === 2 ? "p2" : "p3";
  const tag = p.priority === 1 ? "Priority Fix" : `Priority ${p.priority}`;
  return (
    <div className={`problem-card ${cls}`}>
      <div className={`problem-tag ${cls}`}>{tag}</div>
      <h4 className="problem-title">{p.problem.title}</h4>
      <p className="problem-desc">{p.problem.description}</p>
      <div className="problem-segment"><b>Affects:</b> {p.problem.affected_segment} · <b>Current impact:</b> {p.problem.current_impact}</div>
      <div className="problem-stats">
        <div><div className="problem-stat-label">Lift</div><div className="problem-stat-val emerald tnum">+{p.retention_impact.estimated_lift_percent}%</div></div>
        <div><div className="problem-stat-label">Revenue</div><div className="problem-stat-val tnum">{p.retention_impact.estimated_revenue_impact}</div></div>
        <div><div className="problem-stat-label">Time to impact</div><div className="problem-stat-val tnum">{p.retention_impact.time_to_impact}</div></div>
        <div><div className="problem-stat-label">Confidence</div><div className="problem-stat-val tnum">{Math.round(p.retention_impact.confidence * 100)}%</div></div>
      </div>
      <button className="expand-btn" onClick={() => setOpen(!open)}>{open ? "Hide actions ▴" : "View actions ▾"}</button>
      {open && (
        <div className="problem-expanded">
          <div className="problem-solution-title">Solution · {p.solution.title}</div>
          <div className="problem-solution-body">{p.solution.description}</div>
          <div className="problem-framework">Framework · {p.solution.framework_used}</div>
          {p.rationale_chain && <RationaleChainStrip chain={p.rationale_chain} />}
          <div className="impl-list">
            {(p.implementation_steps ?? []).map((s) => <ImplStepRow key={s.step} s={s} ctx={ctx} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Collapsible({ title, count, children, defaultOpen }: { title: string; count?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`collapsible ${open ? "open" : ""}`}>
      <button className="collapsible-head" onClick={() => setOpen(!open)}>
        <span>{title}{count !== undefined && <span style={{ color: "var(--text-zinc)", marginLeft: 8 }}>· {count}</span>}</span>
        <span className="chev">▾</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

/* ─── Evidence Drawer (F15) ─────────────────────────────────── */
function tokens(s: string | undefined, minLen = 5): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= minLen),
  );
}

function bestStatForHypothesis(
  hypText: string,
  forensic: ForensicFindingsRich | undefined,
): { stat_id: string; source: string; label: string; churn_rate: number; size: number } | null {
  if (!forensic?.statistical_evidence) return null;
  const stats = forensic.statistical_evidence;
  const hypKw = tokens(hypText);
  const buckets: [string, Record<string, StatBucketEntry> | undefined][] = [
    ["churn_by_plan_tier", stats.churn_by_plan_tier],
    ["churn_by_channel", stats.churn_by_channel],
    ["churn_by_support_volume", stats.churn_by_support_volume],
    ["churn_by_usage_decile", stats.churn_by_usage_decile],
    ["churn_rate_by_tenure_bucket", stats.churn_rate_by_tenure_bucket],
  ];
  let best: { stat_id: string; source: string; label: string; churn_rate: number; size: number; score: number } | null = null;
  for (const [name, bucket] of buckets) {
    if (!bucket) continue;
    for (const [label, payload] of Object.entries(bucket)) {
      if (!payload || typeof payload.churn_rate !== "number" || !payload.size) continue;
      const labelKw = tokens(`${name} ${label}`);
      let overlap = 0;
      labelKw.forEach((t) => { if (hypKw.has(t)) overlap += 1; });
      const score = overlap * 1000 + payload.churn_rate * payload.size;
      if (!best || score > best.score) {
        best = {
          stat_id: `${name}::${label}`,
          source: name,
          label,
          churn_rate: payload.churn_rate,
          size: payload.size,
          score,
        };
      }
    }
  }
  if (!best) return null;
  const { score: _drop, ...rest } = best;
  void _drop;
  return rest;
}

function matchSkepticForHypothesis(
  hypText: string,
  skeptic: ProfessionalSkepticOutput | undefined,
): { counter: SkepticCounterArg | null; alt: SkepticAltExplanation | null } {
  if (!skeptic) return { counter: null, alt: null };
  const hypKw = tokens(hypText);
  const scoreText = (t: string | undefined): number => {
    if (!t) return 0;
    let s = 0;
    tokens(t).forEach((tok) => { if (hypKw.has(tok)) s += 1; });
    return s;
  };
  const counter = (skeptic.counter_arguments ?? [])
    .map((c) => ({ c, s: scoreText(c.hypothesis) + scoreText(c.counter_argument) }))
    .sort((a, b) => b.s - a.s)[0]?.c ?? null;
  const alt = (skeptic.alternative_explanations ?? [])
    .map((a) => ({ a, s: scoreText(a.hypothesis) + scoreText(a.alternative) }))
    .sort((x, y) => y.s - x.s)[0]?.a ?? null;
  return { counter, alt };
}

function EvidenceDrawer({
  hypothesis,
  rank,
  forensic,
  skeptic,
  driverFeatures,
  topSegments,
  onClose,
}: {
  hypothesis: Hypothesis;
  rank: number;
  forensic?: ForensicFindingsRich;
  skeptic?: ProfessionalSkepticOutput;
  driverFeatures?: DriverFeature[];
  topSegments?: TopSegment[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const stat = bestStatForHypothesis(hypothesis.hypothesis, forensic);
  const { counter, alt } = matchSkepticForHypothesis(hypothesis.hypothesis, skeptic);
  const evSources = hypothesis.evidence_sources ?? [];
  const citationIds = hypothesis.citations ?? [];

  // Try to find a matching top_segment with the same source family.
  const matchedSegment = stat && topSegments
    ? topSegments.find((s) => s.segment_id === stat.stat_id) ?? null
    : null;

  return (
    <div className="ed-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <aside className="ed-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ed-spine" aria-hidden="true" />
        <header className="ed-head">
          <div className="ed-eyebrow">
            <span className="ed-rank tnum">EVIDENCE&nbsp;·&nbsp;HYPOTHESIS&nbsp;{rank.toString().padStart(2, "0")}</span>
            <button className="ed-close" onClick={onClose} aria-label="Close evidence drawer">esc&nbsp;✕</button>
          </div>
          <h3 className="ed-title">{hypothesis.hypothesis}</h3>
          <div className="ed-confidence">
            <span className="ed-conf-label">confidence</span>
            <div className="ed-conf-bar"><div className="ed-conf-fill" style={{ width: `${Math.round(hypothesis.confidence * 100)}%` }} /></div>
            <span className="ed-conf-pct tnum">{Math.round(hypothesis.confidence * 100)}%</span>
          </div>
        </header>

        <div className="ed-chain">
          {/* 1 — Triggering stat */}
          <article className="ed-node ed-node-amber">
            <div className="ed-node-mark" aria-hidden="true">01</div>
            <div className="ed-node-kind">Triggering stat</div>
            {stat ? (
              <>
                <div className="ed-stat-id tnum">{stat.stat_id}</div>
                <div className="ed-stat-row">
                  <div>
                    <div className="ed-stat-k">Churn rate</div>
                    <div className="ed-stat-v amber tnum">{(stat.churn_rate * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="ed-stat-k">Segment size</div>
                    <div className="ed-stat-v tnum">{stat.size.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="ed-stat-k">Lost users (est.)</div>
                    <div className="ed-stat-v red tnum">≈ {Math.round(stat.churn_rate * stat.size).toLocaleString()}</div>
                  </div>
                </div>
                {matchedSegment && (
                  <div className="ed-stat-foot">descriptor · {matchedSegment.descriptor}</div>
                )}
              </>
            ) : (
              <div className="ed-empty">No statistical bucket overlapped this hypothesis. Heuristic match was below threshold.</div>
            )}
          </article>

          {/* 2 — RAG citations */}
          <article className="ed-node ed-node-purple">
            <div className="ed-node-mark" aria-hidden="true">02</div>
            <div className="ed-node-kind">RAG citations</div>
            {evSources.length > 0 || citationIds.length > 0 ? (
              <ul className="ed-cite-list">
                {evSources.map((e) => (
                  <li key={e.id} className="ed-cite">
                    <span className="ed-cite-id tnum">{e.id}</span>
                    <span className="ed-cite-source">{e.source}</span>
                    {e.topic && <span className="ed-cite-topic">· {e.topic}</span>}
                    {typeof e.score === "number" && <span className="ed-cite-score tnum">{e.score.toFixed(3)}</span>}
                  </li>
                ))}
                {citationIds
                  .filter((id) => !evSources.some((s) => s.id === id))
                  .map((id) => (
                    <li key={id} className="ed-cite">
                      <span className="ed-cite-id tnum">{id}</span>
                      <span className="ed-cite-source">cited</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="ed-empty">No framework citations attached to this hypothesis.</div>
            )}
          </article>

          {/* 3 — Skeptic caveat */}
          <article className="ed-node ed-node-amber2">
            <div className="ed-node-mark" aria-hidden="true">03</div>
            <div className="ed-node-kind">Skeptic caveat</div>
            {counter ? (
              <>
                <div className="ed-skeptic-text">{counter.counter_argument}</div>
                {counter.strength && (
                  <div className="ed-skeptic-meta">
                    <span className={`ed-sev ed-sev-${(counter.strength ?? "medium").toLowerCase()}`}>{counter.strength}</span>
                    <span className="ed-skeptic-pin">— evidence challenge from professional_skeptic</span>
                  </div>
                )}
              </>
            ) : (
              <div className="ed-empty">Skeptic did not register a directed counter-argument against this hypothesis.</div>
            )}
          </article>

          {/* 4 — Alternative explanation */}
          <article className="ed-node ed-node-violet">
            <div className="ed-node-mark" aria-hidden="true">04</div>
            <div className="ed-node-kind">Alternative explanation</div>
            {alt ? (
              <>
                <div className="ed-skeptic-text">{alt.alternative}</div>
                {alt.testability && (
                  <div className="ed-skeptic-meta">
                    <span className={`ed-sev ed-sev-${(alt.testability ?? "medium").toLowerCase()}`}>testability · {alt.testability}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="ed-empty">No alternative explanation was generated for this hypothesis.</div>
            )}
          </article>

          {/* 5 — Driver features */}
          <article className="ed-node ed-node-blue">
            <div className="ed-node-mark" aria-hidden="true">05</div>
            <div className="ed-node-kind">CoxPH hazard drivers</div>
            {driverFeatures && driverFeatures.length > 0 ? (
              <ul className="ed-driver-list">
                {driverFeatures.slice(0, 5).map((d) => (
                  <li key={d.feature} className="ed-driver">
                    <div className="ed-driver-name">{d.feature}</div>
                    <div className="ed-driver-stats tnum">
                      <span>HR <b>{d.hazard_ratio.toFixed(2)}</b></span>
                      <span>p {d.p_value.toFixed(3)}</span>
                      <span className={`ed-dir ed-dir-${d.direction}`}>{d.direction}</span>
                      {d.significant && <span className="ed-sig">significant</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ed-empty">No quantitative driver features available from CoxPH.</div>
            )}
          </article>
        </div>

        <footer className="ed-foot">
          <span className="ed-foot-hint">esc · click backdrop · or</span>
          <button className="ed-foot-btn" onClick={onClose}>close drawer</button>
        </footer>
      </aside>
    </div>
  );
}

function ReasoningTrace({ trace }: { trace: string }) {
  const [open, setOpen] = useState(false);
  const cleaned = trace.replace(/\r\n/g, "\n").trim();
  const paragraphs = cleaned.split(/\n{2,}/);
  return (
    <div className={`rt-shell ${open ? "open" : ""}`}>
      <button className="rt-toggle" onClick={() => setOpen(!open)}>
        <span className="rt-rule" aria-hidden="true" />
        <span className="rt-toggle-label">
          <span className="rt-eyebrow">Pass 1 · freeform synthesis</span>
          <span className="rt-title">Why this playbook</span>
        </span>
        <span className="rt-toggle-meta tnum">{cleaned.length.toLocaleString()} chars · {paragraphs.length} paragraphs</span>
        <span className="rt-chev">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="rt-body">
          <div className="rt-margin" aria-hidden="true">
            <span className="rt-margin-mark">↳</span>
            <span className="rt-margin-text">reasoning trace</span>
          </div>
          <div className="rt-prose">
            {paragraphs.map((para, i) => (
              <p key={i} className="rt-para">{para.trim()}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategySection({ data, ctx, visible }: { data: Playbook; ctx: Ctx; visible: boolean }) {
  const roadmap = data["30_60_90_roadmap"];
  const phases = [
    { key: "phase_1_30_days", label: "30 Days", p: roadmap?.phase_1_30_days, dim: false },
    { key: "phase_2_60_days", label: "60 Days", p: roadmap?.phase_2_60_days, dim: ctx.quickWins && !ctx.longTerm },
    { key: "phase_3_90_days", label: "90 Days", p: roadmap?.phase_3_90_days, dim: ctx.quickWins && !ctx.longTerm },
  ].filter(p => !!p.p);
  const probChip = (p: string) => {
    if (p === "High")   return <span className="chip red chip-sm risk-badge">{p}</span>;
    if (p === "Medium") return <span className="chip amber chip-sm risk-badge">{p}</span>;
    return <span className="chip emerald chip-sm risk-badge">{p}</span>;
  };
  const successMetrics = ctx.wantNPS
    ? [...(data.success_metrics ?? [])].sort((a) => (/nps/i.test(a.metric) ? -1 : 1))
    : (data.success_metrics ?? []);
  return (
    <section className={`section ${visible ? "visible" : ""}`}>
      <div className="section-head">
        <h2 className="section-title emerald">Strategy · {data.title}</h2>
        <span className="section-meta tnum">
          {data.created_date && `created ${new Date(data.created_date).toLocaleDateString()} · `}
          {data.problems_and_solutions?.length ?? 0} problems
        </span>
      </div>
      <div className="exec-summary">
        <div className="stat">
          <div className="stat-label">Problems identified</div>
          <div className="stat-value tnum">{data.executive_summary.total_problems_identified}</div>
          <div className="stat-sub">ranked by impact</div>
        </div>
        <div className="stat">
          <div className="stat-label">Projected lift</div>
          <div className="stat-value emerald tnum">{data.executive_summary.total_projected_retention_lift}</div>
          <div className="stat-sub tnum">conf. {data.executive_summary.confidence_level}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Timeline</div>
          <div className="stat-value tnum">{data.executive_summary.estimated_timeline}</div>
          <div className="stat-sub">end-to-end</div>
        </div>
        <div className="stat">
          <div className="stat-label">Budget</div>
          <div className="stat-value tnum">{data.executive_summary.estimated_budget}</div>
          <div className="stat-sub">people + tech + paid</div>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        {(data.problems_and_solutions ?? []).map((p, i) => <ProblemCard key={i} p={p} ctx={ctx} defaultOpen={i === 0} />)}
      </div>
      {phases.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-zinc)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "20px 0 10px" }}>30 / 60 / 90 Roadmap</h3>
          <div className="roadmap">
            {phases.map((ph) => (
              <div key={ph.key} className={`roadmap-col ${ph.dim ? "dim" : ""}`}>
                <div className="roadmap-col-head">
                  <div className="roadmap-phase">{ph.label}</div>
                  {ph.dim && <span className="chip zinc chip-sm">Optional</span>}
                </div>
                <div className="roadmap-theme">{ph.p!.theme}</div>
                <ul className="roadmap-goals">{(ph.p!.goals ?? []).map((g, i) => <li key={i}>{g}</li>)}</ul>
                {ph.p!.key_milestones && ph.p!.key_milestones.length > 0 && (
                  <div className="roadmap-milestones">
                    {ph.p!.key_milestones.map((m, i) => {
                      const parts = m.split(":");
                      return (
                        <div className="roadmap-milestone" key={i}>
                          <span className="roadmap-milestone-day">{parts[0]}</span>
                          <span>{parts.slice(1).join(":").trim()}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="roadmap-lift">→ {ph.p!.expected_lift} lift</div>
              </div>
            ))}
          </div>
        </>
      )}
      {successMetrics.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: "var(--text-zinc)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "20px 0 10px" }}>Success Metrics</h3>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Current → Target</th>
                <th>How we measure</th>
                <th style={{ width: 100 }}>Cadence</th>
              </tr>
            </thead>
            <tbody>
              {successMetrics.map((m, i) => (
                <tr key={i}>
                  <td><b style={{ color: "var(--text)" }}>{m.metric}</b></td>
                  <td className="num">
                    <span style={{ color: "var(--text-muted)" }}>{m.current_value}</span>
                    <span className="arrow">→</span>
                    <span className="target">{m.target_value}</span>
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{m.measurement_method ?? "—"}</td>
                  <td>{m.review_frequency ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.risks_and_mitigations && data.risks_and_mitigations.length > 0 && (
        <Collapsible title="Risks & Mitigations" count={`${data.risks_and_mitigations.length} risks identified`}>
          {data.risks_and_mitigations.map((r, i) => (
            <div className="risk-item" key={i}>
              <div>
                <div className="risk-title">{r.risk}</div>
                <div className="risk-mit"><b>Mitigation:</b> {r.mitigation}</div>
                {r.contingency && <div className="risk-mit" style={{ marginTop: 4 }}><b>Contingency:</b> {r.contingency}</div>}
              </div>
              {probChip(r.probability)}
            </div>
          ))}
        </Collapsible>
      )}
      {data.reasoning_trace && (
        <ReasoningTrace trace={data.reasoning_trace} />
      )}
      {data.resource_requirements && !ctx.quickWins && (
        <Collapsible title="Resource Requirements" count="team · tech · budget">
          <div className="res-grid">
            {data.resource_requirements.team && (
              <div>
                <div className="res-col-title">Team</div>
                <div className="res-list">
                  {data.resource_requirements.team.map((t, i) => <div key={i}>· {t}</div>)}
                </div>
              </div>
            )}
            {data.resource_requirements.technology && (
              <div>
                <div className="res-col-title">Technology</div>
                <div className="res-list">
                  {data.resource_requirements.technology.map((t, i) => <div key={i}>· {t}</div>)}
                </div>
              </div>
            )}
            {data.resource_requirements.budget_breakdown && (
              <div>
                <div className="res-col-title">Budget</div>
                <div className="res-list">
                  {Object.entries(data.resource_requirements.budget_breakdown).map(([k, v]) => (
                    <div key={k} className="res-budget"><span className="k" style={{ textTransform: "capitalize" }}>{k}</span><span className="v">{v}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Collapsible>
      )}
    </section>
  );
}

/* ─── HITL Modal ────────────────────────────────────────────── */
function HITLModal({ questions, onSubmit, onSkipAll, submitting }: { questions: string[]; onSubmit: (answers: string[]) => void; onSkipAll: () => void; submitting: boolean }) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ""));
  const filled = answers.filter(a => a.trim().length > 0).length;
  return (
    <div className="hitl-backdrop">
      <div className="hitl-modal">
        <div className="hitl-violet-rail" />
        <div className="hitl-head">
          <div className="hitl-eyebrow"><span className="status-dot violet pulse"></span>Human in the loop · pipeline paused</div>
          <h3 className="hitl-title">Before we build your strategy — answer these to sharpen the playbook.</h3>
          <div className="hitl-sub">{questions.length} questions · ~30 seconds · all optional</div>
        </div>
        <div className="hitl-body">
          {questions.map((q, i) => (
            <div className="hitl-q" key={i}>
              <div className="hitl-q-num tnum">{i + 1}</div>
              <div className="hitl-q-body">
                <div className="hitl-q-text">{q}</div>
                <input className="hitl-input" placeholder="Your answer (or skip)…"
                  value={answers[i]} disabled={submitting}
                  onChange={(e) => setAnswers(prev => prev.map((a, j) => j === i ? e.target.value : a))} />
              </div>
            </div>
          ))}
        </div>
        <div className="hitl-foot">
          <div className="hitl-foot-left">
            <span className="hitl-counter tnum">{filled} / {questions.length} answered</span>
            <button className="link" onClick={onSkipAll} disabled={submitting}>skip all →</button>
          </div>
          <button className="btn" onClick={() => onSubmit(answers)} disabled={submitting}>
            {submitting ? <><span className="spinner" />Routing answers…</> : <>Generate strategies →</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Pending placeholder ───────────────────────────────────── */
function PendingSection({ title, color, label }: { title: string; color: string; label: string }) {
  return (
    <section className="section visible" style={{ opacity: 0.35 }}>
      <div className="section-head">
        <h2 className={`section-title ${color}`} style={{ color: "var(--text-zinc)" }}>{title}</h2>
        <span className="section-meta">{label}</span>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="skeleton-line" style={{ width: "60%" }} />
          <div className="skeleton-line" style={{ width: "85%" }} />
          <div className="skeleton-line" style={{ width: "40%" }} />
        </div>
      </div>
    </section>
  );
}

/* ─── Page ──────────────────────────────────────────────────── */
function statusText(pipelineState: Record<string, string>, hitlOpen: boolean, complete: boolean) {
  if (complete) return "Analysis complete · 6 / 6 stages";
  if (hitlOpen) return "Paused for human input · stage 4 / 6";
  const active = PIPELINE_STEPS.find(s => pipelineState[s.id] === "active");
  if (!active) return "Initializing…";
  const idx = PIPELINE_STEPS.findIndex(s => s.id === active.id);
  const labels: Record<string, string> = {
    signal: "Detecting risk signal…", patterns: "Profiling churn patterns…",
    diagnosis: "Diagnosing root causes…", clarify: "Awaiting clarification…",
    simulate: "Running Monte Carlo simulation…", strategy: "Composing strategy playbook…",
  };
  return `Analyzing · stage ${idx + 1} / 6 — ${labels[active.id]}`;
}

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.job_id as string;

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "complete" | "error" | "cancelled">("connecting");
  const [errorInfo, setErrorInfo] = useState<{ type?: string; message?: string; lastNode?: string } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [stagesData, setStagesData] = useState<Record<string, any>>({});
  const [isRerunning, setIsRerunning] = useState(false);
  const [hitlSubmitted, setHitlSubmitted] = useState(false);
  const [hitlSubmitting, setHitlSubmitting] = useState(false);
  const [ctx, setCtx] = useState<Ctx>(() => buildCtx({}));
  const [evidenceOpenIdx, setEvidenceOpenIdx] = useState<number | null>(null);

  // Streaming UX state — visibility into "how long" + "is it stuck" + "did it retry"
  const [jobStartTs, setJobStartTs] = useState<number | null>(null);
  const [stageStartTs, setStageStartTs] = useState<Record<string, number>>({});
  const [stageEndTs, setStageEndTs] = useState<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());
  const [forensicProgress, setForensicProgress] = useState<{
    run: number; total: number; status: "started" | "completed" | "failed";
  } | null>(null);
  const [retryInfo, setRetryInfo] = useState<{
    iteration: number; max: number; verdict: string; reason: string; weakPoints: number;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("latest_form_payload");
      if (raw) setCtx(buildCtx(JSON.parse(raw).questionnaire ?? {}));
    } catch { /* keep defaults */ }
  }, []);

  /* SSE — survives page refresh.
     Persistence model:
       - Every event mutates sessionStorage `job_${jobId}` with the latest
         stagesData + connectionStatus + errorInfo + hitlSubmitted.
       - On mount we restore the snapshot first. If status is terminal
         (complete / error / cancelled) we never open a new SSE — backend
         has already cleaned up its queue and would return 404.
       - If status is non-terminal, we open SSE; on a hard 404 we fall back
         to whatever cached data we have rather than showing a fake error. */
  const sseRef = useRef<EventSource | null>(null);
  // Cache the latest snapshot pieces in refs so persistEvent() (called from
  // SSE handlers) always writes the freshest combined state, regardless of
  // React's setState batching.
  const stagesDataRef = useRef<Record<string, any>>({});
  const hitlSubmittedRef = useRef(false);

  const writeSnapshot = (patch: {
    stagesData?: Record<string, any>;
    connectionStatus?: string;
    errorInfo?: typeof errorInfo;
    hitlSubmitted?: boolean;
  }) => {
    try {
      const existing = sessionStorage.getItem(`job_${jobId}`);
      const prev = existing ? JSON.parse(existing) : {};
      sessionStorage.setItem(`job_${jobId}`, JSON.stringify({ ...prev, ...patch }));
    } catch { /* quota or serialization — non-fatal */ }
  };

  useEffect(() => {
    if (!jobId) return;
    const saved = sessionStorage.getItem(`job_${jobId}`);
    let restoredStatus: string | null = null;
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p.stagesData) { setStagesData(p.stagesData); stagesDataRef.current = p.stagesData; }
        if (p.hitlSubmitted) { setHitlSubmitted(true); hitlSubmittedRef.current = true; }
        if (p.errorInfo) setErrorInfo(p.errorInfo);
        if (p.connectionStatus === "complete" || p.connectionStatus === "error" || p.connectionStatus === "cancelled") {
          setConnectionStatus(p.connectionStatus);
          restoredStatus = p.connectionStatus;
        }
      } catch { /* ignore */ }
    }
    // Terminal state already cached — backend job has been cleaned up.
    // Skip SSE entirely so we don't hit 404 and flip to a fake error banner.
    if (restoredStatus) return;

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const sse = new EventSource(`${API_BASE}/analyze/stream/${jobId}`);
    sseRef.current = sse;
    sse.onopen = () => setConnectionStatus("connected");
    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        // Seed the job timer on the first event we see.
        setJobStartTs((prev) => prev ?? Date.now());

        // Interim progress events — don't store in stagesData since they're not stages.
        if (event.type === "forensic_progress") {
          setForensicProgress({
            run: event.data?.run ?? 0,
            total: event.data?.total ?? 3,
            status: event.data?.status ?? "started",
          });
          return;
        }
        if (event.type === "critic_retry_started") {
          const info = {
            iteration: Number(event.data?.iteration ?? 1),
            max: Number(event.data?.max ?? 2),
            verdict: String(event.data?.verdict ?? "low_lift"),
            reason: String(event.data?.reason ?? ""),
            weakPoints: Number(event.data?.weak_points_count ?? 0),
          };
          setRetryInfo(info);
          const summary = info.verdict === "violation"
            ? `Critic flagged constraint violations — agents revising (pass ${info.iteration + 1}/${info.max})`
            : `Critic flagged low lift — agents revising (${info.weakPoints} weak points)`;
          toast(summary, { icon: "↻", duration: 6000 });
          return;
        }

        if (event.type === "cancelled") {
          setConnectionStatus("cancelled");
          writeSnapshot({ connectionStatus: "cancelled" });
          toast("Analysis cancelled.", { icon: "■", duration: 4000 });
          sse.close(); sseRef.current = null;
          return;
        }

        if (event.type === "error") {
          const errInfo = {
            type: event.data?.error_type,
            message: event.data?.error_message,
            lastNode: event.data?.last_node,
          };
          setErrorInfo(errInfo);
          setConnectionStatus("error");
          writeSnapshot({ connectionStatus: "error", errorInfo: errInfo });
          toast.error(`Analysis failed at ${event.data?.last_node || "unknown stage"}.`, { duration: 8000 });
          sse.close(); sseRef.current = null;
          return;
        }

        setStagesData((prev) => {
          const updated = { ...prev, [event.type]: event.data };
          stagesDataRef.current = updated;
          writeSnapshot({
            stagesData: updated,
            hitlSubmitted: hitlSubmittedRef.current,
            connectionStatus: event.type === "complete" ? "complete" : "connected",
          });
          return updated;
        });
        if (event.type === "complete") { setConnectionStatus("complete"); sse.close(); sseRef.current = null; }
      } catch (err) { console.error("SSE parse error:", err); }
    };
    // EventSource auto-reconnects on transient drops; only declare error
    // after repeated failures AND only if the cached snapshot isn't already
    // in a usable terminal state. This prevents the classic "refresh after
    // pipeline completed → backend popped active_streams → SSE 404 → fake
    // 'ConnectionLost' banner overlaying perfectly-good cached results" bug.
    let errorCount = 0;
    sse.onerror = () => {
      errorCount++;
      if (errorCount >= 5) {
        sse.close();
        sseRef.current = null;
        // If we already have a final playbook cached, the job actually
        // finished — just mark complete and move on.
        if (stagesDataRef.current?.solution_ready || stagesDataRef.current?.complete) {
          setConnectionStatus("complete");
          writeSnapshot({ connectionStatus: "complete" });
          return;
        }
        // Truly lost — no cached terminal payload.
        const errInfo = { type: "ConnectionLost", message: "Lost connection to backend after multiple retries." };
        setErrorInfo(errInfo);
        setConnectionStatus("error");
        writeSnapshot({ connectionStatus: "error", errorInfo: errInfo });
      }
    };
    return () => { sse.close(); sseRef.current = null; };
  }, [jobId]);

  /* Streaming UX — live tick while job runs, freezes once complete. */
  useEffect(() => {
    if (connectionStatus === "complete") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [connectionStatus]);

  /* Derived */
  const risk: RiskData | null = stagesData.risk_ready ?? null;
  const churn: ChurnProfile | null = stagesData.churn_profile_ready ?? null;
  const dx: DiagnosisData | null = stagesData.diagnosis_ready ?? null;
  const hitlData = stagesData.hitl_questions_ready;
  const sim: SimulationData | null = stagesData.simulation_ready ?? null;
  const playbook: Playbook | null = stagesData.solution_ready?.final_playbook ?? null;
  const complete = connectionStatus === "complete";
  const hitlOpen = !!hitlData && !hitlSubmitted;
  const pipelineState = useMemo(
    () => derivePipelineState(stagesData, hitlSubmitted, complete),
    [stagesData, hitlSubmitted, complete]
  );

  /* Streaming UX — stamp each stage's first "active" + first "done" exactly once. */
  useEffect(() => {
    const ts = Date.now();
    let startChanged = false;
    const nextStart: Record<string, number> = { ...stageStartTs };
    let endChanged = false;
    const nextEnd: Record<string, number> = { ...stageEndTs };
    for (const s of PIPELINE_STEPS) {
      const status = pipelineState[s.id];
      if ((status === "active" || status === "done") && nextStart[s.id] === undefined) {
        nextStart[s.id] = ts; startChanged = true;
      }
      if (status === "done" && nextEnd[s.id] === undefined) {
        nextEnd[s.id] = ts; endChanged = true;
      }
    }
    if (startChanged) setStageStartTs(nextStart);
    if (endChanged) setStageEndTs(nextEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineState]);

  /* Actions */
  const handleHitlSubmit = async (answers: string[]) => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    setHitlSubmitting(true);
    try {
      const body: Record<string, string> = {};
      answers.forEach((a, i) => { body[String(i)] = a; });
      await fetch(`${API_BASE}/analyze/${jobId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: body }),
      });
      setHitlSubmitted(true);
      hitlSubmittedRef.current = true;
      writeSnapshot({ hitlSubmitted: true });
    } finally { setHitlSubmitting(false); }
  };

  const handleSkipAll = async () => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    setHitlSubmitting(true);
    try {
      await fetch(`${API_BASE}/analyze/${jobId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: {} }),
      });
      setHitlSubmitted(true);
      hitlSubmittedRef.current = true;
      writeSnapshot({ hitlSubmitted: true });
    } finally { setHitlSubmitting(false); }
  };

  const handleRefine = () => router.push("/form");
  const handleCancel = async () => {
    if (isCancelling || connectionStatus === "complete" || connectionStatus === "cancelled") return;
    if (!confirm("Cancel this analysis? In-flight work will be discarded.")) return;
    setIsCancelling(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${API_BASE}/analyze/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Backend pushes a `cancelled` SSE event; UI updates from that handler.
      // If SSE already dropped, force-set state here so user gets feedback.
      setTimeout(() => {
        setConnectionStatus((prev) => (prev === "cancelled" || prev === "complete") ? prev : "cancelled");
        setIsCancelling(false);
      }, 3000);
    } catch (err) {
      toast.error("Failed to cancel analysis. Check backend connectivity.");
      setIsCancelling(false);
    }
  };
  const handleRerun = async () => {
    const payloadStr = sessionStorage.getItem("latest_form_payload");
    if (!payloadStr) return toast.error("No previous form data found to rerun.");
    setIsRerunning(true);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${API_BASE}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payloadStr });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success("Rerun started!");
      router.push(`/results/${data.job_id}`);
    } catch { toast.error("Failed to rerun analysis."); setIsRerunning(false); }
  };

  const completedCount = Object.values(pipelineState).filter(v => v === "done").length;

  return (
    <div className="retain-shell">
      <div className={`app ${hitlOpen ? "pipeline-paused" : ""}`}>
        <Sidebar
          pipelineState={pipelineState}
          jobId={jobId}
          ctx={ctx}
          onRefine={handleRefine}
          onRerun={handleRerun}
          stageStartTs={stageStartTs}
          stageEndTs={stageEndTs}
          now={now}
          forensicProgress={forensicProgress}
          retryInfo={retryInfo}
        />

        <main className="main">
          <div className="status-bar">
            <div className="status-left">
              <span className={`status-dot ${complete ? "" : hitlOpen ? "violet" : "amber"} ${complete ? "" : "pulse"}`}></span>
              <span>{statusText(pipelineState, hitlOpen, complete)}</span>
            </div>
            <div className="status-right">
              {jobStartTs !== null && (
                <span
                  className="tnum inline-flex items-center gap-1.5 pl-3 text-[11px] font-medium text-[var(--text-muted)] border-l border-[var(--border)]"
                  title="total job elapsed"
                >
                  <span className="text-[11px] opacity-50" aria-hidden="true">⏱</span>
                  {fmtElapsed((complete && stageEndTs.strategy ? stageEndTs.strategy : now) - jobStartTs)}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--text-zinc)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                SSE · {completedCount} / 6 events
              </span>
              {!complete && connectionStatus !== "cancelled" && connectionStatus !== "error" && (
                <button
                  className="status-btn status-btn--danger"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  title="Cancel the running analysis"
                >
                  {isCancelling ? "■ Cancelling…" : "■ Cancel"}
                </button>
              )}
              <button className="status-btn" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? "↻ Running…" : "↻ Rerun"}
              </button>
            </div>
          </div>

          {(connectionStatus === "error" || connectionStatus === "cancelled") && (
            <div
              className={`analysis-status-banner analysis-status-banner--${connectionStatus}`}
              role="alert"
            >
              <span className="banner-dot" aria-hidden="true"></span>
              <div className="banner-body">
                <strong className="banner-title">
                  {connectionStatus === "cancelled" ? "Analysis cancelled" : "Analysis failed"}
                </strong>
                {connectionStatus === "error" && errorInfo && (
                  <span className="banner-detail">
                    {errorInfo.lastNode ? `at ${errorInfo.lastNode}` : null}
                    {errorInfo.type ? ` · ${errorInfo.type}` : null}
                    {errorInfo.message ? ` · ${errorInfo.message}` : null}
                  </span>
                )}
                {connectionStatus === "cancelled" && (
                  <span className="banner-detail">Pipeline stopped at your request.</span>
                )}
              </div>
              <button className="status-btn" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? "↻ Running…" : "↻ Retry"}
              </button>
            </div>
          )}

          <div className="main-inner">
            <div className="page-head">
              <div>
                <h1 className="page-title">Retention Intelligence</h1>
                <div className="page-sub">
                  <span className="tnum">job · {jobId?.split("-")[0]}</span>
                  <span>·</span>
                  <span>{ctx.businessModel}</span>
                  <span>·</span>
                  <span>{ctx.segment}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="status-btn" onClick={handleRefine}>⤓ Refine context</button>
              </div>
            </div>

            {risk ? <SignalSection data={risk} ctx={ctx} visible={true} />
                  : <PendingSection title="Signal" color="amber" label="Stage 1 · awaiting risk_ready" />}

            {churn ? <ChurnProfileSection data={churn} ctx={ctx} visible={true} />
                   : <PendingSection title="Churn Profile" color="blue" label="Stage 2 · awaiting churn_profile_ready" />}

            {dx ? <DiagnosisSection data={dx} ctx={ctx} visible={true} onOpenEvidence={(i) => setEvidenceOpenIdx(i)} />
                : <PendingSection title="Root Cause" color="purple" label="Stage 3 · awaiting diagnosis_ready" />}

            {hitlData && hitlSubmitted && (
              <section className="section visible">
                <div className="section-head">
                  <h2 className="section-title violet">Clarify</h2>
                  <span className="section-meta">Stage 4 · human in the loop</span>
                </div>
                <div className="hitl-collapsed">
                  <span className="status-dot teal"></span>
                  <span>✓ Answers routed — strategies generating from your inputs.</span>
                </div>
              </section>
            )}

            {sim ? <SimulationSection data={sim} visible={true} />
                 : <PendingSection title="Monte Carlo Simulation" color="teal" label="Stage 5 · awaiting simulation_ready" />}

            {playbook ? <StrategySection data={playbook} ctx={ctx} visible={true} />
                      : <PendingSection title="Strategy" color="emerald" label="Stage 6 · awaiting solution_ready" />}
          </div>
        </main>

        {hitlOpen && (
          <HITLModal
            questions={(hitlData.questions ?? []) as string[]}
            onSubmit={handleHitlSubmit}
            onSkipAll={handleSkipAll}
            submitting={hitlSubmitting}
          />
        )}

        {evidenceOpenIdx !== null && dx?.merged_hypotheses?.[evidenceOpenIdx] && (
          <EvidenceDrawer
            hypothesis={dx.merged_hypotheses[evidenceOpenIdx]}
            rank={evidenceOpenIdx + 1}
            forensic={
              dx.forensic_findings && !Array.isArray(dx.forensic_findings)
                ? (dx.forensic_findings as ForensicFindingsRich)
                : undefined
            }
            skeptic={
              dx.skeptic_findings && !Array.isArray(dx.skeptic_findings)
                ? (dx.skeptic_findings as ProfessionalSkepticOutput)
                : undefined
            }
            driverFeatures={dx.driver_features ?? (
              dx.forensic_findings && !Array.isArray(dx.forensic_findings)
                ? (dx.forensic_findings as ForensicFindingsRich).driver_features
                : undefined
            )}
            topSegments={dx.top_segments}
            onClose={() => setEvidenceOpenIdx(null)}
          />
        )}
      </div>
    </div>
  );
}
