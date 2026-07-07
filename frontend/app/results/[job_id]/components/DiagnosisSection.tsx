import { cn } from "@/lib/utils";
import { retentionToneClass } from "../lib";
import type { Ctx, DiagnosisData } from "../types";
import { Chip, Section } from "./primitives";

function HypTag({ strength, children }: { strength?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded border border-white/6 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-zinc-500",
        strength === "high" && "border-emerald-500/30 text-emerald-500",
        strength === "medium" && "border-amber-500/30 text-amber-500",
      )}
    >
      {children}
    </span>
  );
}

function DxCard({ title, badge, className, children }: { title: string; badge: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-[10px] border border-white/6 bg-white/[0.02] px-4 py-3.5", className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{title}</div>
        {badge}
      </div>
      {children}
    </div>
  );
}

export function DiagnosisSection({
  data, ctx, visible, onOpenEvidence,
}: {
  data: DiagnosisData; ctx: Ctx; visible: boolean; onOpenEvidence: (idx: number) => void;
}) {
  const hyps = data.merged_hypotheses ?? [];
  const forensicArr = Array.isArray(data.forensic_findings) ? data.forensic_findings : [];
  const patternArr = data.pattern_findings ?? [];
  const skepticArr = Array.isArray(data.skeptic_findings) ? (data.skeptic_findings as Array<{ caveat?: string; counter_argument?: string }>) : [];
  const competitorText = ctx.competitors || (Array.isArray(data.competitors) ? data.competitors.join(", ") : data.competitors) || "";
  return (
    <Section
      tone="purple"
      title="Root Cause"
      meta={`${data.total_patterns_identified != null ? `${data.total_patterns_identified} patterns · ` : ""}${hyps.length} ranked hypotheses`}
      visible={visible}
    >
      <div className="flex flex-col gap-2">
        {hyps.slice(0, 3).map((h, i) => (
          <button
            type="button"
            key={i}
            onClick={() => onOpenEvidence(i)}
            aria-label={`Open evidence drawer for hypothesis ${i + 1}`}
            className="group block w-full cursor-pointer rounded-[10px] border border-white/6 bg-white/[0.02] px-4 py-3.5 text-left transition-[border-color,background,transform] duration-[180ms] hover:-translate-y-px hover:border-purple-500/32 hover:bg-white/[0.035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500/60"
          >
            <div className="mb-2.5 flex items-start gap-3.5">
              <div className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full bg-purple-500/14 text-[11px] font-bold text-purple-500">{i + 1}</div>
              <div className="flex-1 text-[13.5px] leading-[1.45] text-zinc-50">{h.hypothesis}</div>
              <div className="tnum ml-3 text-[13px] font-semibold tracking-[-0.01em] text-purple-500">{Math.round(h.confidence * 100)}%</div>
            </div>
            <div className="mb-2 h-[3px] overflow-hidden rounded-full bg-purple-500/12">
              <div
                className="h-full rounded-full bg-purple-500 transition-[width] duration-800 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ width: visible ? `${h.confidence * 100}%` : "0%" }}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(h.supported_by ?? []).map((t) => <HypTag key={t}>supported by · {t}</HypTag>)}
                {(h.citations?.length ?? 0) > 0 && <HypTag>{h.citations!.length} citations</HypTag>}
              </div>
              <span className="translate-x-[-4px] text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 opacity-0 transition-[opacity,transform,color] duration-200 group-hover:translate-x-0 group-hover:text-purple-500 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:text-purple-500 group-focus-visible:opacity-100">
                open evidence&nbsp;→
              </span>
            </div>
          </button>
        ))}
      </div>

      {competitorText && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2.5 text-xs">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-amber-500">Losing to</span>
          <span className="text-zinc-50">{competitorText}</span>
          <span className="text-[11px] text-zinc-500">· dominant cancellation destination</span>
        </div>
      )}

      {(forensicArr.length > 0 || patternArr.length > 0) && (
        <div className="mt-3.5 grid grid-cols-2 gap-3">
          {forensicArr.length > 0 && (
            <DxCard title="Forensic findings" badge={<Chip tone="zinc" sm>{forensicArr.length} citations</Chip>}>
              <div className="flex flex-col gap-2">
                {forensicArr.slice(0, 6).map((f, i) => (
                  <div key={i} className="flex items-start justify-between gap-2.5 border-t border-white/6 py-2 text-xs first:border-t-0 first:pt-0">
                    <div>
                      <div className="leading-[1.45] text-zinc-50">{f.signal}</div>
                      {f.citation && <div className="tnum mt-[3px] text-[10px] tracking-[0.02em] text-zinc-500">{f.citation}</div>}
                    </div>
                    {f.strength && <HypTag strength={f.strength}>{f.strength}</HypTag>}
                  </div>
                ))}
              </div>
            </DxCard>
          )}
          {patternArr.length > 0 && (
            <DxCard title="Pattern segments" badge={<Chip tone="zinc" sm>{patternArr.length} segments</Chip>}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {["Segment", "Size", "Retention"].map((h, i) => (
                      <th key={h} className={cn("border-b border-white/6 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500", i === 0 ? "text-left" : "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {patternArr.slice(0, 6).map((p, i) => (
                    <tr key={i} className="[&:last-child>td]:border-b-0">
                      <td className="border-b border-white/6 p-2 text-zinc-300">
                        <div>{p.segment}</div>
                        {p.signature && <div className="mt-0.5 text-[10px] text-zinc-500">{p.signature}</div>}
                      </td>
                      <td className="tnum border-b border-white/6 p-2 text-right text-zinc-300">{(p.size ?? 0).toLocaleString()}</td>
                      <td className={cn("tnum border-b border-white/6 p-2 text-right", retentionToneClass(p.retention ?? 0))}>
                        {Math.round((p.retention ?? 0) * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DxCard>
          )}
        </div>
      )}

      {skepticArr.length > 0 && (
        <DxCard className="mt-3" title="Skeptic caveats" badge={<Chip tone="zinc" sm>disclosed assumptions</Chip>}>
          <div className="flex flex-col gap-2">
            {skepticArr.slice(0, 5).map((s, i) => (
              <div key={i} className="border-t border-white/6 py-2 first:border-t-0 first:pt-0">
                <div className="text-xs leading-[1.45] text-zinc-400">
                  · {s.caveat ?? s.counter_argument ?? JSON.stringify(s).slice(0, 200)}
                </div>
              </div>
            ))}
          </div>
        </DxCard>
      )}
    </Section>
  );
}
