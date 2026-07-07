import type { SimulationData } from "../types";
import { Section, Stat } from "./primitives";

/* Plain-language framing: the reader is a founder/PM, not an analyst.
   p10/mean/p90 become "cautious / likely / best case"; methodology (Monte
   Carlo, iterations, percentiles) lives in a footnote instead of the headline. */
export function SimulationSection({ data, visible }: { data: SimulationData; visible: boolean }) {
  const maxX = Math.max(...(data.interventions || []).map((i) => i.p90), data.expected_lift) + 4;
  const nInterventions = data.interventions?.length ?? 0;
  return (
    <Section
      tone="teal"
      title="Projected Impact"
      meta={`stress-tested in ${data.iterations.toLocaleString()} simulations`}
      visible={visible}
    >
      <p className="mb-3.5 max-w-[70ch] text-[12.5px] leading-[1.65] text-zinc-500">
        We ran your top {nInterventions} intervention{nInterventions === 1 ? "" : "s"} through{" "}
        {data.iterations.toLocaleString()} simulated versions of your customer base. The numbers
        below are realistic ranges — not best-case guesses.
      </p>

      <div className="mb-3.5 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3">
        <Stat
          label="Likely retention lift"
          tone="teal"
          size="lg"
          value={`+${data.expected_lift}%`}
          sub="most likely combined outcome"
        />
        <Stat
          label="If things go poorly"
          value={`+${data.confidence_low}%`}
          sub="19 in 20 simulations beat this"
        />
        <Stat
          label="If things go well"
          value={`+${data.confidence_high}%`}
          sub="best 1-in-20 outcome"
        />
        <Stat
          label="Estimated return"
          value={`${data.expected_roi}%`}
          sub="vs. program cost"
        />
      </div>

      {nInterventions > 0 && (
        <div className="rounded-[10px] border border-white/6 bg-white/[0.02] px-5 py-[18px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
              What each intervention could realistically add
            </div>
            <div className="text-[10px] uppercase tracking-[0.04em] text-zinc-600">0% — {Math.round(maxX)}% retention lift</div>
          </div>
          {data.interventions.map((it, i) => {
            const startPct = (it.p10 / maxX) * 100;
            const endPct = (it.p90 / maxX) * 100;
            const meanPct = (it.mean / maxX) * 100;
            return (
              <div key={i} className="grid grid-cols-[200px_1fr_70px] items-center gap-3.5 border-t border-white/6 py-2.5 first:border-t-0 first:pt-1">
                <div>
                  <div className="text-[12.5px] text-zinc-50">{it.name || `Intervention ${i + 1}`}</div>
                  {it.lift_prior_anchor === "rag" && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[9.5px] uppercase tracking-[0.06em] text-teal-600">
                      <span className="h-1 w-1 rounded-full bg-teal-600" />
                      grounded in published case studies
                    </div>
                  )}
                </div>
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
                    <span>cautious · +{it.p10}%</span>
                    <span>likely · +{it.mean}%</span>
                    <span>best case · +{it.p90}%</span>
                  </div>
                </div>
                <div className="tnum text-right text-xs font-semibold text-teal-500">+{it.mean}%</div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2.5 text-[10.5px] leading-[1.6] text-zinc-600">
        Method: Monte Carlo simulation — {data.iterations.toLocaleString()} random draws per
        intervention. &ldquo;Cautious&rdquo; and &ldquo;best case&rdquo; are the 10th and 90th percentile of
        simulated outcomes; the combined range uses the 5th–95th percentile.
        {typeof data.rag_anchored_count === "number" && data.rag_anchored_count > 0 &&
          ` ${data.rag_anchored_count} of ${nInterventions} estimates are anchored to lift figures from published retention case studies.`}
      </p>
    </Section>
  );
}
