"use client";

import { cn } from "@/lib/utils";
import { PIPELINE_STEPS, fmtElapsed } from "../lib";
import type { Ctx } from "../types";
import type { ForensicProgress, RetryInfo } from "../useAnalysisStream";
import { Btn, MicroLabel, StatusDot, type Tone } from "./primitives";

function ContextChip({ k, v, why }: { k: string; v: string; why: React.ReactNode }) {
  return (
    <div className="group relative inline-flex">
      <span className="inline-flex max-w-full cursor-help items-center gap-1.5 rounded-full border border-white/6 bg-white/[0.02] px-[9px] py-1 text-[10px] font-medium uppercase tracking-[0.04em] text-zinc-400 transition-colors group-hover:border-white/12 group-hover:text-zinc-50">
        <span className="text-zinc-500">{k}</span>
        <span className="text-[11px] font-medium normal-case tracking-normal text-zinc-50">{v}</span>
      </span>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-[100] w-60 -translate-x-1/2 translate-y-[2px] rounded-md border border-white/12 bg-zinc-900 px-2.5 py-2 text-[11px] font-normal normal-case leading-[1.45] tracking-normal text-zinc-300 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100">
        <b className="font-semibold text-zinc-50">Why this matters</b>
        <br />
        {why}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-[5px] border-transparent border-t-zinc-900" aria-hidden="true" />
      </div>
    </div>
  );
}

export function Sidebar({
  pipelineState, jobId, ctx, onRefine, onRerun,
  stageStartTs, stageEndTs, now, forensicProgress, retryInfo,
}: {
  pipelineState: Record<string, string>; jobId: string; ctx: Ctx;
  onRefine: () => void; onRerun: () => void;
  stageStartTs: Record<string, number>;
  stageEndTs: Record<string, number>;
  now: number;
  forensicProgress: ForensicProgress | null;
  retryInfo: RetryInfo | null;
}) {
  const stageTime = (id: string): string | null => {
    const start = stageStartTs[id];
    if (start === undefined) return null;
    const end = stageEndTs[id];
    return fmtElapsed((end ?? now) - start);
  };
  const chips = [
    { k: "Goal",      v: ctx.goal.split(" ").slice(0, 3).join(" "), why: <>Drives selection of <em className="not-italic text-violet-600">retention-focused</em> playbooks. Filters out off-goal interventions.</> },
    { k: "Segment",   v: ctx.segment.length > 18 ? ctx.segment.slice(0, 16) + "…" : ctx.segment, why: <>Diagnosis and roadmap focus on the <em className="not-italic text-violet-600">{ctx.segment}</em> cohort.</> },
    { k: "Timeline",  v: ctx.quickWins ? "Quick · 30d" : ctx.longTerm ? "Long-term" : "Standard", why: <>{ctx.quickWins ? <>30-day phase rendered <em className="not-italic text-violet-600">full opacity</em>; 60/90-day phases dimmed.</> : <>Full 30/60/90 roadmap rendered.</>}</> },
    { k: "Model",     v: ctx.businessModel, why: <>Hypothesis priors and strategy framing tuned for <em className="not-italic text-violet-600">{ctx.businessModel}</em>.</> },
    ...(ctx.pricingLocked ? [{ k: "Pricing", v: "Locked", why: <>Pricing experiments <em className="not-italic text-violet-600">removed</em> from feasible interventions.</> }] : []),
    ...(ctx.noCSM ? [{ k: "Support", v: "Self-serve", why: <>CSM-led playbooks deprioritized; behavioral triggers favored.</> }] : []),
    ...(!ctx.canShip ? [{ k: "Can ship", v: "No", why: <>Steps requiring engineering get <em className="not-italic text-violet-600">&quot;Needs eng&quot;</em> badges.</> }] : []),
  ];
  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/6 bg-[#0d0d10] px-[18px] py-5">
      <div className="flex items-center gap-2.5">
        <div className="grid h-[22px] w-[22px] place-items-center rounded-[5px] bg-white text-[13px] font-extrabold tracking-[-0.04em] text-black">R</div>
        <div>
          <div className="text-sm font-semibold tracking-[-0.01em]">Retain AI</div>
          <div className="tnum text-[10px] tracking-[0.05em] text-zinc-500">job · {jobId?.split("-")[0]}</div>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        {PIPELINE_STEPS.map((s, idx) => {
          const status = pipelineState[s.id] || "pending";
          const t = stageTime(s.id);
          const showSubsteps = s.id === "diagnosis" && status === "active" && forensicProgress !== null;
          const showRetry = (s.id === "strategy" || s.id === "simulate") && retryInfo !== null;
          const isLast = idx === PIPELINE_STEPS.length - 1;
          return (
            <div
              key={s.id}
              className={cn(
                "relative flex items-center gap-2.5 rounded-md px-1.5 py-2 text-[13px] transition-colors duration-150",
                status === "done" && "text-zinc-300",
                status === "active" && "bg-white/[0.03] text-zinc-50",
                status === "pending" && "text-zinc-600",
                // Vertical connector between rows.
                !isLast && "before:absolute before:left-2.5 before:top-[calc(50%+6px)] before:h-[calc(100%-4px)] before:w-px before:bg-white/6",
                !isLast && status === "done" && "before:bg-emerald-500/30",
              )}
            >
              <div className="flex w-full flex-col gap-[3px]">
                <div className="flex min-h-[18px] items-center gap-2.5">
                  <StatusDot
                    size="md"
                    tone={status === "done" ? "emerald" : status === "active" ? (s.color as Tone) : "zinc"}
                    pulse={status === "active"}
                    className={status === "pending" ? "bg-zinc-600" : undefined}
                  />
                  <span className="flex-1">{s.label}</span>
                  <span className="ml-auto inline-flex items-center gap-2">
                    {status === "active" && t && (
                      <span className="tnum text-[11px] font-medium tracking-normal text-zinc-50 opacity-90">{t}</span>
                    )}
                    {status === "done" && t && (
                      <span className="tnum text-[10px] tracking-normal text-zinc-500">{t}</span>
                    )}
                    {status === "done" && <span className="text-[11px] text-emerald-500">✓</span>}
                  </span>
                </div>

                <div className="flex min-h-[12px] flex-wrap items-center gap-2.5 pl-[18px]">
                  {(status === "active" || status === "pending") && (
                    <span className={cn("tnum text-[9px] font-medium uppercase tracking-[0.08em]", status === "pending" ? "text-zinc-600/55" : "text-zinc-600")}>
                      {s.typical}
                    </span>
                  )}

                  {showSubsteps && forensicProgress && (
                    <span
                      className="inline-flex items-center gap-1.5 border-l border-white/6 pl-2"
                      aria-label={`forensic run ${forensicProgress.run} of ${forensicProgress.total}`}
                    >
                      {Array.from({ length: forensicProgress.total }).map((_, i) => {
                        const n = i + 1;
                        const filled =
                          n < forensicProgress.run ||
                          (n === forensicProgress.run && forensicProgress.status === "completed");
                        const active = n === forensicProgress.run && forensicProgress.status === "started";
                        return (
                          <span
                            key={i}
                            aria-hidden="true"
                            className={cn(
                              "h-1.5 w-1.5 rounded-full border transition-all duration-300",
                              filled
                                ? "border-purple-500 bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.45)]"
                                : "border-purple-500/32 bg-purple-500/16",
                              active && "animate-pulse",
                            )}
                          />
                        );
                      })}
                      <span className="ml-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-purple-500">
                        run {forensicProgress.run}/{forensicProgress.total}
                      </span>
                    </span>
                  )}

                  {showRetry && retryInfo && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.1em]",
                        retryInfo.verdict === "violation"
                          ? "border-red-500/42 bg-red-500/7 text-red-500"
                          : "border-amber-500/40 bg-amber-500/8 text-amber-500",
                      )}
                    >
                      <span className="inline-block animate-spin text-[11px] [animation-direction:reverse] [animation-duration:2.4s]">↻</span>
                      retry {Math.min(retryInfo.iteration + 1, retryInfo.max)}/{retryInfo.max}
                      {retryInfo.weakPoints > 0 && (
                        <span className="tnum text-[9px] tracking-[0.02em] opacity-85">· {retryInfo.weakPoints} weak pts</span>
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
        <MicroLabel className="mb-2.5">Your Context</MicroLabel>
        <div className="flex flex-col items-start gap-1.5">
          {chips.map((c) => <ContextChip key={c.k} k={c.k} v={c.v || "—"} why={c.why} />)}
        </div>
      </div>

      <div className="mt-auto flex gap-1.5 border-t border-white/6 pt-3">
        <Btn variant="ghost" className="h-[30px] flex-1 text-xs" onClick={onRefine}>Refine →</Btn>
        <Btn variant="ghost" className="h-[30px] flex-1 text-xs" onClick={onRerun}>Rerun</Btn>
      </div>
    </aside>
  );
}
