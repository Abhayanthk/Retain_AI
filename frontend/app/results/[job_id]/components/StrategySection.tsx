import { cn } from "@/lib/utils";
import type { Ctx, Playbook } from "../types";
import { Chip, MicroLabel, Section, Stat } from "./primitives";
import { Collapsible } from "./Collapsible";
import { ProblemCard } from "./ProblemCard";
import { ReasoningTrace } from "./ReasoningTrace";

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2.5 mt-5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">{children}</h3>;
}

function probChip(p: string) {
  const tone = p === "High" ? "red" : p === "Medium" ? "amber" : "emerald";
  return <Chip tone={tone} sm className="whitespace-nowrap">{p}</Chip>;
}

export function StrategySection({ data, ctx, visible }: { data: Playbook; ctx: Ctx; visible: boolean }) {
  const roadmap = data["30_60_90_roadmap"];
  const phases = [
    { key: "phase_1_30_days", label: "30 Days", p: roadmap?.phase_1_30_days, dim: false },
    { key: "phase_2_60_days", label: "60 Days", p: roadmap?.phase_2_60_days, dim: ctx.quickWins && !ctx.longTerm },
    { key: "phase_3_90_days", label: "90 Days", p: roadmap?.phase_3_90_days, dim: ctx.quickWins && !ctx.longTerm },
  ].filter(p => !!p.p);
  const successMetrics = ctx.wantNPS
    ? [...(data.success_metrics ?? [])].sort((a) => (/nps/i.test(a.metric) ? -1 : 1))
    : (data.success_metrics ?? []);
  const summary = data.executive_summary;
  const stats = [
    { label: "Problems identified", value: String(summary.total_problems_identified ?? "—"), tone: undefined, sub: "ranked by impact" },
    { label: "Projected lift", value: summary.total_projected_retention_lift ?? "—", tone: "emerald" as const, sub: `conf. ${summary.confidence_level}` },
    { label: "Timeline", value: summary.estimated_timeline ?? "—", tone: undefined, sub: "end-to-end" },
    { label: "Budget", value: (summary.estimated_budget ?? "—").replace(/(\d)\s*[-–—]\s*\$/, "$1–$$"), tone: undefined, sub: "people + tech + paid" },
  ];

  return (
    <Section
      tone="emerald"
      title={`Strategy · ${data.title}`}
      meta={`${data.created_date ? `created ${new Date(data.created_date).toLocaleDateString()} · ` : ""}${data.problems_and_solutions?.length ?? 0} problems`}
      visible={visible}
    >
      <div className="mb-[18px] grid grid-cols-4 gap-3">
        {stats.map((s) => (
          // Long values (e.g. budget ranges) drop a size so the row height
          // stays uniform across all four cards.
          <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} sub={s.sub} size={s.value.length > 12 ? "sm" : "md"} />
        ))}
      </div>

      <div className="mb-3.5">
        {(data.problems_and_solutions ?? []).map((p, i) => <ProblemCard key={i} p={p} ctx={ctx} defaultOpen={i === 0} />)}
      </div>

      {phases.length > 0 && (
        <>
          <SubHeading>30 / 60 / 90 Roadmap</SubHeading>
          <div className="mb-[18px] grid grid-cols-3 gap-3">
            {phases.map((ph) => (
              <div key={ph.key} className={cn("flex flex-col rounded-[10px] border border-white/6 bg-white/[0.02] px-[18px] py-4 transition-opacity duration-200", ph.dim && "opacity-50")}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[13px] font-bold tracking-[-0.01em]">{ph.label}</div>
                  {ph.dim && <Chip tone="zinc" sm>Optional</Chip>}
                </div>
                <div className={cn("mb-3 text-[11px] font-medium tracking-[0.02em]", ph.dim ? "text-zinc-400" : "text-emerald-500")}>{ph.p!.theme}</div>
                <ul className="mb-3 flex flex-col gap-1.5">
                  {(ph.p!.goals ?? []).map((g, i) => (
                    <li key={i} className="relative pl-3.5 text-xs leading-[1.45] text-zinc-300 before:absolute before:left-0 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-zinc-500">
                      {g}
                    </li>
                  ))}
                </ul>
                {ph.p!.key_milestones && ph.p!.key_milestones.length > 0 && (
                  <div className="mb-3 flex flex-col gap-[5px] border-t border-white/6 pt-2.5">
                    <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Milestones</div>
                    {ph.p!.key_milestones.map((m, i) => {
                      // Only treat the prefix as a day/week marker when it's
                      // short — plain-sentence milestones render full-width.
                      const ci = m.indexOf(":");
                      const day = ci > 0 ? m.slice(0, ci).trim() : "";
                      const hasDay = ci > 0 && day.length <= 10;
                      return (
                        <div key={i} className="flex gap-2 text-[11px] leading-normal text-zinc-400">
                          {hasDay ? (
                            <>
                              <span className="tnum w-12 flex-shrink-0 tracking-[0.02em] text-zinc-500">{day}</span>
                              <span>{m.slice(ci + 1).trim()}</span>
                            </>
                          ) : (
                            <span className="relative min-w-0 pl-4 before:absolute before:left-0 before:top-0 before:text-[10px] before:text-zinc-500 before:content-['✓']">{m}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Pinned to the card bottom so all three columns align. */}
                <div className="tnum mt-auto pt-1 text-xs font-semibold text-emerald-500">→ {ph.p!.expected_lift} lift</div>
              </div>
            ))}
          </div>
        </>
      )}

      {successMetrics.length > 0 && (
        <>
          <SubHeading>Success Metrics</SubHeading>
          <table className="mb-[18px] w-full border-collapse text-xs">
            <thead>
              <tr>
                {["Metric", "Current → Target", "How we measure", "Cadence"].map((h, i) => (
                  <th key={h} className={cn("border-b border-white/6 bg-white/[0.02] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500", i === 3 && "w-[100px]")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {successMetrics.map((m, i) => (
                <tr key={i} className="[&:last-child>td]:border-b-0">
                  <td className="border-b border-white/6 p-3 align-top"><b className="font-semibold text-zinc-50">{m.metric}</b></td>
                  <td className="tnum border-b border-white/6 p-3 align-top text-zinc-300">
                    <span className="text-zinc-400">{m.current_value}</span>
                    <span className="mx-1.5 text-zinc-500">→</span>
                    <span className="font-medium text-emerald-500">{m.target_value}</span>
                  </td>
                  <td className="border-b border-white/6 p-3 align-top text-zinc-400">{m.measurement_method ?? "—"}</td>
                  <td className="border-b border-white/6 p-3 align-top text-zinc-300">{m.review_frequency ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {data.risks_and_mitigations && data.risks_and_mitigations.length > 0 && (
        <Collapsible title="Risks & Mitigations" count={`${data.risks_and_mitigations.length} risks identified`}>
          {data.risks_and_mitigations.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] items-start gap-3.5 border-t border-white/6 py-3 first:border-t-0 first:pt-3.5">
              <div>
                <div className="mb-1 text-[13px] font-medium text-zinc-50">{r.risk}</div>
                <div className="text-xs leading-normal text-zinc-400"><b className="font-medium text-zinc-300">Mitigation:</b> {r.mitigation}</div>
                {r.contingency && (
                  <div className="mt-1 text-xs leading-normal text-zinc-400"><b className="font-medium text-zinc-300">Contingency:</b> {r.contingency}</div>
                )}
              </div>
              {probChip(r.probability)}
            </div>
          ))}
        </Collapsible>
      )}

      {/* Skip the "(reasoning-trace pass failed: …)" placeholder from F12. */}
      {data.reasoning_trace && !data.reasoning_trace.startsWith("(") && (
        <ReasoningTrace trace={data.reasoning_trace} />
      )}

      {data.resource_requirements && !ctx.quickWins && (
        <Collapsible title="Resource Requirements" count="team · tech · budget">
          <div className="grid grid-cols-3 gap-[18px] pt-3.5">
            {data.resource_requirements.team && (
              <div>
                <MicroLabel className="mb-2.5">Team</MicroLabel>
                <div className="flex flex-col gap-[5px] text-xs text-zinc-300">
                  {data.resource_requirements.team.map((t, i) => <div key={i}>· {t}</div>)}
                </div>
              </div>
            )}
            {data.resource_requirements.technology && (
              <div>
                <MicroLabel className="mb-2.5">Technology</MicroLabel>
                <div className="flex flex-col gap-[5px] text-xs text-zinc-300">
                  {data.resource_requirements.technology.map((t, i) => <div key={i}>· {t}</div>)}
                </div>
              </div>
            )}
            {data.resource_requirements.budget_breakdown && (
              <div>
                <MicroLabel className="mb-2.5">Budget</MicroLabel>
                <div className="flex flex-col text-xs text-zinc-300">
                  {Object.entries(data.resource_requirements.budget_breakdown).map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-white/6 py-[5px] last:border-b-0 last:pt-2 last:font-semibold last:text-zinc-50">
                      <span className="capitalize text-zinc-400">{k}</span>
                      <span className="tnum">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Collapsible>
      )}
    </Section>
  );
}
