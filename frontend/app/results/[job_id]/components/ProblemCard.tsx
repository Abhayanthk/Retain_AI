"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getBadge } from "../lib";
import type { Ctx, ImplStep, ProblemSolution } from "../types";
import { Chip } from "./primitives";
import { RationaleChainStrip } from "./RationaleChainStrip";

function ImplStepRow({ s, ctx }: { s: ImplStep; ctx: Ctx }) {
  const b = getBadge(s.action, ctx);
  const badgeTone = b?.kind === "price" ? "red" : b?.kind === "have" ? "emerald" : "amber";
  return (
    <div className="grid grid-cols-[24px_1fr_auto_auto] items-start gap-3.5 border-t border-white/6 py-3 first:border-t-0">
      <div className="tnum grid h-[22px] w-[22px] place-items-center rounded-md bg-white/4 text-[11px] font-semibold text-zinc-300">{s.step}</div>
      <div className="min-w-0">
        <div className="mb-1 text-[13px] leading-[1.45] text-zinc-50">{s.action}</div>
        <div className="flex flex-wrap gap-x-3.5 gap-y-2.5 text-[11px] text-zinc-500">
          {s.owner && <span><b className="font-medium text-zinc-400">Owner:</b> {s.owner}</span>}
          {s.effort && <span><b className="font-medium text-zinc-400">Effort:</b> {s.effort}</span>}
          {s.deliverable && <span><b className="font-medium text-zinc-400">Deliverable:</b> {s.deliverable}</span>}
          {s.dependencies && s.dependencies.length > 0 && <span><b className="font-medium text-zinc-400">Deps:</b> {s.dependencies.join(", ")}</span>}
        </div>
      </div>
      <div className="tnum self-center whitespace-nowrap text-[11px] tracking-[0.02em] text-zinc-300">{s.timeline}</div>
      <div className="flex flex-shrink-0 gap-1 self-center">
        {b && <Chip tone={badgeTone} sm>{b.label}</Chip>}
      </div>
    </div>
  );
}

export function ProblemCard({ p, ctx, defaultOpen }: { p: ProblemSolution; ctx: Ctx; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const edge = p.priority === 1 ? "border-l-emerald-500" : p.priority === 2 ? "border-l-amber-500" : "border-l-zinc-500";
  const tagColor = p.priority === 1 ? "text-emerald-500" : p.priority === 2 ? "text-amber-500" : "text-zinc-500";
  const tag = p.priority === 1 ? "Priority Fix" : `Priority ${p.priority}`;
  return (
    <div className={cn("mb-3 rounded-[10px] border border-white/6 border-l-[3px] bg-white/[0.02] px-5 py-[18px] transition-colors duration-200", edge)}>
      <div className={cn("mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em]", tagColor)}>{tag}</div>
      <h4 className="mb-1 text-[17px] font-semibold tracking-[-0.015em]">{p.problem.title}</h4>
      <p className="mb-3 text-[12.5px] leading-[1.55] text-zinc-400">{p.problem.description}</p>
      <div className="mb-3.5 text-[11px] tracking-[0.02em] text-zinc-500">
        <b className="font-medium text-zinc-50">Affects:</b> {p.problem.affected_segment} · <b className="font-medium text-zinc-50">Current impact:</b> {p.problem.current_impact}
      </div>
      <div className="mb-3.5 grid grid-cols-4 gap-2.5 border-y border-white/6 py-3">
        {[
          { label: "Lift", val: `+${p.retention_impact.estimated_lift_percent}%`, emerald: true },
          { label: "Revenue", val: p.retention_impact.estimated_revenue_impact },
          { label: "Time to impact", val: p.retention_impact.time_to_impact },
          { label: "Confidence", val: `${Math.round(p.retention_impact.confidence * 100)}%` },
        ].map((s) => (
          <div key={s.label}>
            <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{s.label}</div>
            <div className={cn("tnum text-[15px] font-semibold tracking-[-0.01em]", s.emerald && "text-emerald-500")}>{s.val}</div>
          </div>
        ))}
      </div>
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 py-1 text-xs text-zinc-400 transition-colors duration-150 hover:text-zinc-50"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide actions ▴" : "View actions ▾"}
      </button>
      {open && (
        <div className="mt-3 overflow-hidden border-t border-white/6 pt-3.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Solution · {p.solution.title}</div>
          <div className="mb-1.5 text-[13px] font-medium text-zinc-50">{p.solution.description}</div>
          <div className="mb-3.5 text-[11px] tracking-[0.02em] text-violet-600">Framework · {p.solution.framework_used}</div>
          {p.rationale_chain && <RationaleChainStrip chain={p.rationale_chain} />}
          <div className="flex flex-col">
            {(p.implementation_steps ?? []).map((s) => <ImplStepRow key={s.step} s={s} ctx={ctx} />)}
          </div>
        </div>
      )}
    </div>
  );
}
