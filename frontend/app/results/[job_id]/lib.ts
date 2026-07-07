import type { Ctx } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const pct = (n: number) => `${Math.round(n * 100)}%`;

/* Retention → tone. Single source for every green/amber/red threshold. */
export function retentionToneClass(r: number) {
  if (r >= 0.75) return "text-emerald-500";
  if (r >= 0.5) return "text-amber-500";
  return "text-red-500";
}

// Parse milestone dict (keys like "month_3") into sorted (month, retention)
// points. Backend chooses milestone months dynamically based on the observed
// tenure range, so we can't rely on a fixed [1,3,6,12,24,36] list.
export function parseMilestonePoints(ms: Record<string, number>): [number, number][] {
  return Object.entries(ms)
    .map(([k, v]) => [Number(k.replace(/^month_/, "")), v] as [number, number])
    .filter(([m, v]) => Number.isFinite(m) && v != null)
    .sort((a, b) => a[0] - b[0]);
}

export function interpolateRetention(month: number, ms: Record<string, number>) {
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

/* Feasibility badge for an implementation step, driven by questionnaire
   constraints (pricing locked, no eng capacity, self-serve support, …). */
export function getBadge(action: string, ctx: Ctx): { kind: "eng" | "have" | "price" | "csm"; label: string } | null {
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

/* ─── Pipeline ─────────────────────────────────────────────── */

export type StageStatus = "done" | "active" | "pending";

export const PIPELINE_STEPS = [
  { id: "signal",    label: "Signal",    color: "amber",   key: "risk_ready",            typical: "~3s"      },
  { id: "patterns",  label: "Patterns",  color: "blue",    key: "churn_profile_ready",   typical: "~5s"      },
  { id: "diagnosis", label: "Diagnosis", color: "purple",  key: "diagnosis_ready",       typical: "~25–40s"  },
  { id: "clarify",   label: "Clarify",   color: "violet",  key: "hitl_questions_ready",  typical: "human"    },
  { id: "simulate",  label: "Simulate",  color: "teal",    key: "simulation_ready",      typical: "~4s"      },
  { id: "strategy",  label: "Strategy",  color: "emerald", key: "solution_ready",        typical: "~30–60s · +retry" },
] as const;

export type PipelineColor = (typeof PIPELINE_STEPS)[number]["color"];

export function fmtElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export function derivePipelineState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stages: Record<string, any>,
  hitlSubmitted: boolean,
  complete: boolean,
): Record<string, StageStatus> {
  const out: Record<string, StageStatus> = {};
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

export function statusText(pipelineState: Record<string, string>, hitlOpen: boolean, complete: boolean) {
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
