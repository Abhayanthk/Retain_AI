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
}
interface Hypothesis { hypothesis: string; confidence: number; supported_by: string[]; }
interface DiagnosisData {
  merged_hypotheses: Hypothesis[];
  forensic_findings?: { signal?: string; citation?: string; strength?: string }[] | { suspected_causes?: string[]; citations?: Record<string, string[]> };
  pattern_findings?: { segment?: string; size?: number; retention?: number; signature?: string }[];
  skeptic_findings?: { caveat?: string }[] | unknown;
  total_patterns_identified?: number;
  competitors?: string[] | string;
  churn_destination?: string;
}
interface SimIntervention { name: string; p10: number; mean: number; p90: number; }
interface SimulationData {
  expected_lift: number; confidence_low: number; confidence_high: number;
  expected_roi: number; iterations: number; interventions: SimIntervention[];
}
interface ImplStep { step: number; action: string; owner: string; effort?: string; timeline: string; deliverable?: string; dependencies?: string[]; }
interface ProblemSolution {
  priority: number;
  problem: { title: string; description: string; affected_segment: string; current_impact: string };
  solution: { title: string; description: string; framework_used: string; key_actions: string[] };
  retention_impact: { estimated_lift_percent: number; estimated_users_retained: number; estimated_revenue_impact: string; confidence: number; time_to_impact: string };
  implementation_steps: ImplStep[];
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
function interpolateRetention(month: number, ms: Record<string, number>) {
  const pts: [number, number][] = [
    [1, ms.month_1], [3, ms.month_3], [6, ms.month_6],
    [12, ms.month_12], [24, ms.month_24], [36, ms.month_36],
  ].filter(([, v]) => v != null) as [number, number][];
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
  { id: "signal",    label: "Signal",    color: "amber",   key: "risk_ready" },
  { id: "patterns",  label: "Patterns",  color: "blue",    key: "churn_profile_ready" },
  { id: "diagnosis", label: "Diagnosis", color: "purple",  key: "diagnosis_ready" },
  { id: "clarify",   label: "Clarify",   color: "violet",  key: "hitl_questions_ready" },
  { id: "simulate",  label: "Simulate",  color: "teal",    key: "simulation_ready" },
  { id: "strategy",  label: "Strategy",  color: "emerald", key: "solution_ready" },
];

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

function Sidebar({ pipelineState, jobId, ctx, onRefine, onRerun }: {
  pipelineState: Record<string, string>; jobId: string; ctx: Ctx;
  onRefine: () => void; onRerun: () => void;
}) {
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
          return (
            <div key={s.id} className={cls}>
              <span className="pipe-dot"></span>
              <span className="pipe-label">{s.label}</span>
              {status === "done" && <span className="pipe-check">✓</span>}
              {status === "active" && <span className="pipe-meta">running…</span>}
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

function ChurnProfileSection({ data, ctx, visible }: { data: ChurnProfile; ctx: Ctx; visible: boolean }) {
  const [month, setMonth] = useState(12);
  useEffect(() => { if (data.max_tenure && month === 12 && data.max_tenure < 12) setMonth(data.max_tenure); }, [data.max_tenure]);
  const retention = interpolateRetention(month, data.milestone_retention);
  const churn = (1 - retention) * 100;
  const milestones = [
    { key: "month_1",  label: "Mo. 1",  val: data.milestone_retention.month_1 },
    { key: "month_3",  label: "Mo. 3",  val: data.milestone_retention.month_3 },
    { key: "month_6",  label: "Mo. 6",  val: data.milestone_retention.month_6 },
    { key: "month_12", label: "Mo. 12", val: data.milestone_retention.month_12 },
    { key: "month_24", label: "Mo. 24", val: data.milestone_retention.month_24 },
    { key: "month_36", label: "Mo. 36", val: data.milestone_retention.month_36 },
  ].filter(m => m.val != null);
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
        </div>
        <div className="milestone">
          <div className="milestone-lbl">Milestone retention</div>
          <div className="milestone-grid">
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

function DiagnosisSection({ data, ctx, visible }: { data: DiagnosisData; ctx: Ctx; visible: boolean }) {
  const hyps = data.merged_hypotheses ?? [];
  const forensicArr = Array.isArray(data.forensic_findings) ? data.forensic_findings : [];
  const patternArr = data.pattern_findings ?? [];
  const skepticArr = Array.isArray(data.skeptic_findings) ? (data.skeptic_findings as any[]) : [];
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
          <div className="hyp" key={i}>
            <div className="hyp-row">
              <div className="hyp-num">{i + 1}</div>
              <div className="hyp-text">{h.hypothesis}</div>
              <div className="hyp-conf tnum">{Math.round(h.confidence * 100)}%</div>
            </div>
            <div className="hyp-bar"><div className="hyp-bar-fill" style={{ width: visible ? `${h.confidence * 100}%` : "0%" }} /></div>
            <div className="hyp-tags">
              {(h.supported_by ?? []).map((t) => <span key={t} className="hyp-tag">supported by · {t}</span>)}
            </div>
          </div>
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

  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "complete" | "error">("connecting");
  const [stagesData, setStagesData] = useState<Record<string, any>>({});
  const [isRerunning, setIsRerunning] = useState(false);
  const [hitlSubmitted, setHitlSubmitted] = useState(false);
  const [hitlSubmitting, setHitlSubmitting] = useState(false);
  const [ctx, setCtx] = useState<Ctx>(() => buildCtx({}));

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("latest_form_payload");
      if (raw) setCtx(buildCtx(JSON.parse(raw).questionnaire ?? {}));
    } catch { /* keep defaults */ }
  }, []);

  /* SSE */
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const saved = sessionStorage.getItem(`job_${jobId}`);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setStagesData(p.stagesData || {});
        setHitlSubmitted(!!p.hitlSubmitted);
        if (p.connectionStatus === "complete") { setConnectionStatus("complete"); return; }
      } catch { }
    }
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const sse = new EventSource(`${API_BASE}/analyze/stream/${jobId}`);
    sseRef.current = sse;
    sse.onopen = () => setConnectionStatus("connected");
    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        setStagesData((prev) => {
          const updated = { ...prev, [event.type]: event.data };
          sessionStorage.setItem(`job_${jobId}`, JSON.stringify({
            stagesData: updated, hitlSubmitted,
            connectionStatus: event.type === "complete" ? "complete" : "connected"
          }));
          return updated;
        });
        if (event.type === "complete") { setConnectionStatus("complete"); sse.close(); sseRef.current = null; }
      } catch (err) { console.error("SSE parse error:", err); }
    };
    sse.onerror = () => { sse.close(); sseRef.current = null; setConnectionStatus("error"); };
    return () => { sse.close(); sseRef.current = null; };
  }, [jobId]);

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
    } finally { setHitlSubmitting(false); }
  };

  const handleRefine = () => router.push("/form");
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
        <Sidebar pipelineState={pipelineState} jobId={jobId} ctx={ctx} onRefine={handleRefine} onRerun={handleRerun} />

        <main className="main">
          <div className="status-bar">
            <div className="status-left">
              <span className={`status-dot ${complete ? "" : hitlOpen ? "violet" : "amber"} ${complete ? "" : "pulse"}`}></span>
              <span>{statusText(pipelineState, hitlOpen, complete)}</span>
            </div>
            <div className="status-right">
              <span style={{ fontSize: 11, color: "var(--text-zinc)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                SSE · {completedCount} / 6 events
              </span>
              <button className="status-btn" onClick={handleRerun} disabled={isRerunning}>
                {isRerunning ? "↻ Running…" : "↻ Rerun"}
              </button>
            </div>
          </div>

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

            {dx ? <DiagnosisSection data={dx} ctx={ctx} visible={true} />
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
      </div>
    </div>
  );
}
