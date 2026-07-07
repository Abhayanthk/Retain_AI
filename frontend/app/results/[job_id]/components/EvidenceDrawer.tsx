"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type {
  DriverFeature, ForensicFindingsRich, Hypothesis, ProfessionalSkepticOutput,
  SkepticAltExplanation, SkepticCounterArg, StatBucketEntry, TopSegment,
} from "../types";

/* ─── Hypothesis ↔ evidence matching heuristics ────────────── */

function tokens(s: string | undefined, minLen = 5): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= minLen),
  );
}

// Mirrors the backend dossier heuristic: highest-impact (churn_rate × size)
// statistical bucket whose label keywords overlap the hypothesis text.
function bestStatForHypothesis(
  hypText: string,
  forensic: ForensicFindingsRich | undefined,
): { stat_id: string; source: string; label: string; churn_rate: number; size: number } | null {
  if (!forensic?.statistical_evidence) return null;
  const stats = forensic.statistical_evidence;
  const hypKw = tokens(hypText);
  const buckets: [string, Record<string, StatBucketEntry> | undefined][] = [
    ["churn_by_plan_tier", stats.churn_by_plan_tier],
    ["churn_by_contract", stats.churn_by_contract],
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
        best = { stat_id: `${name}::${label}`, source: name, label, churn_rate: payload.churn_rate, size: payload.size, score };
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

/* ─── Drawer building blocks ───────────────────────────────── */

type NodeTone = "amber" | "purple" | "violet" | "blue";

const nodeEdge: Record<NodeTone, string> = {
  amber: "border-l-amber-500",
  purple: "border-l-purple-500",
  violet: "border-l-violet-600",
  blue: "border-l-blue-500",
};
const nodeKind: Record<NodeTone, string> = {
  amber: "text-amber-500",
  purple: "text-purple-500",
  violet: "text-violet-300",
  blue: "text-blue-500",
};

function ChainNode({ n, tone, kind, children }: { n: string; tone: NodeTone; kind: string; children: React.ReactNode }) {
  return (
    <article className={cn("relative rounded-lg border border-white/6 border-l-2 bg-white/[0.02] py-3.5 pl-7 pr-4 transition-colors duration-200", nodeEdge[tone])}>
      <div className="tnum absolute right-3.5 top-3 text-[9px] font-bold tracking-[0.2em] text-zinc-600" aria-hidden="true">{n}</div>
      <div className={cn("mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]", nodeKind[tone])}>{kind}</div>
      {children}
    </article>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="text-xs italic leading-normal text-zinc-600">{children}</div>;
}

function SevChip({ level, children }: { level?: string; children: React.ReactNode }) {
  const l = (level ?? "medium").toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border border-white/6 px-2 py-0.5 text-[9.5px] font-semibold text-zinc-400",
        l === "high" && "border-red-500/40 bg-red-500/6 text-red-500",
        l === "medium" && "border-amber-500/35 bg-amber-500/6 text-amber-500",
        l === "low" && "border-emerald-500/35 bg-emerald-500/5 text-emerald-500",
      )}
    >
      {children}
    </span>
  );
}

const dirClass = (direction: string) =>
  /positive|protective/.test(direction) ? "border-emerald-500/30 text-emerald-500"
  : /negative|risk/.test(direction) ? "border-red-500/30 text-red-500"
  : "text-zinc-400";

/* ─── Drawer (F15) ─────────────────────────────────────────── */

export function EvidenceDrawer({
  hypothesis, rank, forensic, skeptic, driverFeatures, topSegments, onClose,
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
  const matchedSegment = stat && topSegments
    ? topSegments.find((s) => s.segment_id === stat.stat_id) ?? null
    : null;
  const confPct = Math.round(hypothesis.confidence * 100);

  return (
    <div
      className="fixed inset-0 z-[70] flex animate-fade-in justify-end bg-[rgba(4,4,6,0.62)] opacity-0 backdrop-blur-[14px] backdrop-saturate-110 [background-image:radial-gradient(70%_90%_at_80%_30%,rgba(124,58,237,0.10),transparent_70%)]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="relative flex h-screen w-[min(560px,92vw)] animate-drawer-in flex-col overflow-x-hidden overflow-y-auto border-l border-white/12 bg-[linear-gradient(180deg,#0c0c10_0%,#0a0a0d_100%)] shadow-[-32px_0_64px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Full-height accent spine running the page's section-color spectrum. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[2px] opacity-85 [background-image:linear-gradient(180deg,#f59e0b_0%,#a855f7_33%,#7c3aed_55%,#3b82f6_78%,#10b981_100%)]"
          aria-hidden="true"
        />

        <header className="border-b border-white/6 px-7 pb-4 pt-[22px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="tnum text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">
              EVIDENCE&nbsp;·&nbsp;HYPOTHESIS&nbsp;{rank.toString().padStart(2, "0")}
            </span>
            <button
              className="tnum rounded border border-white/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-50"
              onClick={onClose}
              aria-label="Close evidence drawer"
            >
              esc&nbsp;✕
            </button>
          </div>
          <h3 className="mb-3.5 font-heading text-lg font-semibold leading-[1.35] tracking-[-0.015em] text-zinc-50">{hypothesis.hypothesis}</h3>
          <div className="flex items-center gap-3">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-500">confidence</span>
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-purple-500/12">
              <div className="h-full rounded-full bg-purple-500 transition-[width] duration-600 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${confPct}%` }} />
            </div>
            <span className="tnum text-xs font-semibold text-purple-500">{confPct}%</span>
          </div>
        </header>

        {/* Vertical evidence chain with a dotted connector rail. */}
        <div className="relative flex flex-col gap-3 px-7 pb-3 pt-[18px] before:pointer-events-none before:absolute before:bottom-[22px] before:left-[38px] before:top-7 before:w-px before:bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.06)_0_4px,transparent_4px_8px)]">
          <ChainNode n="01" tone="amber" kind="Triggering stat">
            {stat ? (
              <>
                <div className="tnum mb-3 inline-block rounded border border-amber-500/25 bg-amber-500/8 px-2 py-1 text-[11px] text-zinc-50">{stat.stat_id}</div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mb-[5px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Churn rate</div>
                    <div className="tnum text-lg font-bold tracking-[-0.02em] text-amber-500">{(stat.churn_rate * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="mb-[5px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Segment size</div>
                    <div className="tnum text-lg font-bold tracking-[-0.02em] text-zinc-50">{stat.size.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="mb-[5px] text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Lost users (est.)</div>
                    <div className="tnum text-lg font-bold tracking-[-0.02em] text-red-500">≈ {Math.round(stat.churn_rate * stat.size).toLocaleString()}</div>
                  </div>
                </div>
                {matchedSegment && (
                  <div className="mt-2.5 border-t border-white/6 pt-2 text-[11px] text-zinc-400">descriptor · {matchedSegment.descriptor}</div>
                )}
              </>
            ) : (
              <EmptyNote>No statistical bucket overlapped this hypothesis. Heuristic match was below threshold.</EmptyNote>
            )}
          </ChainNode>

          <ChainNode n="02" tone="purple" kind="RAG citations">
            {evSources.length > 0 || citationIds.length > 0 ? (
              <ul className="flex flex-col">
                {evSources.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-2 border-b border-dotted border-white/6 py-1.5 text-[11.5px] text-zinc-300 last:border-b-0">
                    <span className="tnum text-[10.5px] font-semibold text-purple-500">{e.id}</span>
                    <span className="text-zinc-50">{e.source}</span>
                    {e.topic && <span className="text-[10.5px] text-zinc-500">· {e.topic}</span>}
                    {typeof e.score === "number" && <span className="tnum ml-auto text-[10px] text-zinc-600">{e.score.toFixed(3)}</span>}
                  </li>
                ))}
                {citationIds
                  .filter((id) => !evSources.some((s) => s.id === id))
                  .map((id) => (
                    <li key={id} className="flex flex-wrap items-baseline gap-2 border-b border-dotted border-white/6 py-1.5 text-[11.5px] text-zinc-300 last:border-b-0">
                      <span className="tnum text-[10.5px] font-semibold text-purple-500">{id}</span>
                      <span className="text-zinc-50">cited</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyNote>No framework citations attached to this hypothesis.</EmptyNote>
            )}
          </ChainNode>

          <ChainNode n="03" tone="amber" kind="Skeptic caveat">
            {counter ? (
              <>
                <div className="text-[13px] leading-[1.55] text-zinc-300">{counter.counter_argument}</div>
                {counter.strength && (
                  <div className="mt-2 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.12em]">
                    <SevChip level={counter.strength}>{counter.strength}</SevChip>
                    <span className="text-[9.5px] normal-case text-zinc-600">— evidence challenge from professional_skeptic</span>
                  </div>
                )}
              </>
            ) : (
              <EmptyNote>Skeptic did not register a directed counter-argument against this hypothesis.</EmptyNote>
            )}
          </ChainNode>

          <ChainNode n="04" tone="violet" kind="Alternative explanation">
            {alt ? (
              <>
                <div className="text-[13px] leading-[1.55] text-zinc-300">{alt.alternative}</div>
                {alt.testability && (
                  <div className="mt-2 flex items-center gap-2.5 text-[10px] uppercase tracking-[0.12em]">
                    <SevChip level={alt.testability}>testability · {alt.testability}</SevChip>
                  </div>
                )}
              </>
            ) : (
              <EmptyNote>No alternative explanation was generated for this hypothesis.</EmptyNote>
            )}
          </ChainNode>

          <ChainNode n="05" tone="blue" kind="CoxPH hazard drivers">
            {driverFeatures && driverFeatures.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {driverFeatures.slice(0, 5).map((d) => (
                  <li key={d.feature} className="flex items-baseline justify-between gap-3 border-b border-dotted border-white/6 py-[7px] last:border-b-0">
                    <div className="text-xs font-medium text-zinc-50">{d.feature}</div>
                    <div className="tnum flex items-center gap-2.5 text-[10.5px] text-zinc-500">
                      <span>HR <b className="font-semibold text-zinc-50">{d.hazard_ratio.toFixed(2)}</b></span>
                      <span>p {d.p_value.toFixed(3)}</span>
                      <span className={cn("rounded-[3px] border border-white/6 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em]", dirClass(d.direction))}>{d.direction}</span>
                      {d.significant && <span className="text-[9.5px] tracking-[0.06em] text-purple-500">significant</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>No quantitative driver features available from CoxPH.</EmptyNote>
            )}
          </ChainNode>
        </div>

        <footer className="mt-auto flex items-center justify-between gap-3 border-t border-white/6 px-7 pb-[22px] pt-3.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">esc · click backdrop · or</span>
          <button
            className="rounded-md border border-zinc-50 bg-zinc-50 px-4 py-2 text-xs font-semibold tracking-[-0.005em] text-black transition-colors hover:bg-white"
            onClick={onClose}
          >
            close drawer
          </button>
        </footer>
      </aside>
    </div>
  );
}
