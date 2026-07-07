import type { SimulationData } from "../types";
import { Section, Stat } from "./primitives";

export function SimulationSection({ data, visible }: { data: SimulationData; visible: boolean }) {
  const maxX = Math.max(...(data.interventions || []).map((i) => i.p90), data.expected_lift) + 4;
  return (
    <Section
      tone="teal"
      title="Monte Carlo Simulation"
      meta={`${data.iterations.toLocaleString()} iterations · ${data.interventions?.length ?? 0} interventions`}
      visible={visible}
    >
      <div className="mb-3.5 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3">
        <Stat label="Expected lift" tone="teal" size="lg" value={`+${data.expected_lift}%`} sub={`p10 ${data.confidence_low}% → p90 ${data.confidence_high}%`} />
        <Stat label="Range (90% CI)" value={`${data.confidence_low}% – ${data.confidence_high}%`} sub="retention lift" />
        <Stat label="Expected ROI" value={`${data.expected_roi}%`} sub="simulated" />
        <Stat label="Iterations" value={`${(data.iterations / 1000).toFixed(0)}K`} sub="parameter draws" />
      </div>

      {data.interventions?.length > 0 && (
        <div className="rounded-[10px] border border-white/6 bg-white/[0.02] px-5 py-[18px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Per-intervention lift · p10–p90</div>
            <div className="text-[10px] uppercase tracking-[0.04em] text-zinc-600">0% — {Math.round(maxX)}% retention lift</div>
          </div>
          {data.interventions.map((it, i) => {
            const startPct = (it.p10 / maxX) * 100;
            const endPct = (it.p90 / maxX) * 100;
            const meanPct = (it.mean / maxX) * 100;
            return (
              <div key={i} className="grid grid-cols-[200px_1fr_70px] items-center gap-3.5 border-t border-white/6 py-2.5 first:border-t-0 first:pt-1">
                <div className="text-[12.5px] text-zinc-50">{it.name || `Intervention ${i + 1}`}</div>
                <div>
                  <div className="relative h-2 rounded-full bg-white/4">
                    <div
                      className="absolute top-0 h-full rounded-full border border-teal-500/45 bg-teal-500/18 transition-[width] duration-800 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ left: `${startPct}%`, width: visible ? `${endPct - startPct}%` : "0%" }}
                    />
                    <div
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-500 shadow-[0_0_0_3px_rgba(20,184,166,0.18)] transition-[left] duration-800 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ left: visible ? `${meanPct}%` : "0%" }}
                    />
                  </div>
                  <div className="tnum mt-1 flex justify-between text-[10px] tracking-[0.02em] text-zinc-600">
                    <span>p10 · {it.p10}%</span>
                    <span>mean · {it.mean}%</span>
                    <span>p90 · {it.p90}%</span>
                  </div>
                </div>
                <div className="tnum text-right text-xs font-semibold text-teal-500">+{it.mean}%</div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
