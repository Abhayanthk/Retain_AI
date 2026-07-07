import { cn } from "@/lib/utils";
import type { RationaleChain } from "../types";

/* F11/F16 — dossier row rendered as a vertical chain:
   stat → cause → tactic → outcome → risk → mitigation. */

type StepTone = "amber" | "purple" | "emerald" | "teal" | "red" | "violet";

const dotBg: Record<StepTone, string> = {
  amber: "bg-amber-500", purple: "bg-purple-500", emerald: "bg-emerald-500",
  teal: "bg-teal-500", red: "bg-red-500", violet: "bg-violet-600",
};
const labelColor: Record<StepTone, string> = {
  amber: "text-amber-500", purple: "text-purple-500", emerald: "text-emerald-500",
  teal: "text-teal-500", red: "text-red-500", violet: "text-violet-300",
};

function Line({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("text-xs leading-[1.55] text-zinc-300", className)}>{children}</div>;
}
function Meta({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mt-[3px] text-[10px] tracking-[0.02em] text-zinc-500", className)}>{children}</div>;
}

export function RationaleChainStrip({ chain }: { chain: RationaleChain }) {
  const steps: { label: string; body: React.ReactNode; tone: StepTone }[] = [];
  if (chain.stat?.stat_id) {
    const cr = chain.stat.churn_rate;
    const sz = chain.stat.size;
    steps.push({
      label: "stat",
      tone: "amber",
      body: (
        <>
          <div className="tnum mb-[3px] inline-block rounded-[3px] border border-white/6 bg-white/4 px-[7px] py-0.5 text-[10.5px] text-zinc-50">{chain.stat.stat_id}</div>
          {(cr != null || sz != null) && (
            <Meta className="tnum">
              {cr != null && <>{(cr * 100).toFixed(1)}%</>}
              {cr != null && sz != null && <> · </>}
              {sz != null && <>{sz.toLocaleString()} users</>}
            </Meta>
          )}
        </>
      ),
    });
  }
  if (chain.cause?.text) {
    steps.push({ label: "cause", tone: "purple", body: <Line>{chain.cause.text}</Line> });
  }
  if (chain.tactic?.recommendation) {
    steps.push({
      label: "tactic",
      tone: "emerald",
      body: (
        <>
          <Line>{chain.tactic.recommendation}</Line>
          {(chain.tactic.target_event || chain.tactic.trigger_window) && (
            <Meta className="tnum">
              {chain.tactic.target_event && <>event · {chain.tactic.target_event}</>}
              {chain.tactic.target_event && chain.tactic.trigger_window && <> · </>}
              {chain.tactic.trigger_window && <>window · {chain.tactic.trigger_window}</>}
            </Meta>
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
          <Line className="tnum">
            +{Number(chain.simulated_outcome.mean_lift).toFixed(1)}% mean lift
            {chain.simulated_outcome.percentile_10 != null && chain.simulated_outcome.percentile_90 != null && (
              <> · p10–p90 {Number(chain.simulated_outcome.percentile_10).toFixed(1)}–{Number(chain.simulated_outcome.percentile_90).toFixed(1)}%</>
            )}
          </Line>
          {anchor && <Meta>prior · {anchor === "rag" ? "RAG-anchored" : "self-reported"}</Meta>}
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
          <Line>{chain.risk.description}</Line>
          {chain.risk.severity && <Meta>severity · {chain.risk.severity}</Meta>}
        </>
      ),
    });
  }
  if (chain.mitigation?.description) {
    steps.push({ label: "mitigation", tone: "violet", body: <Line>{chain.mitigation.description}</Line> });
  }
  if (steps.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-white/6 bg-white/[0.015] px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-50">Rationale chain</span>
        <span className="text-[10px] tracking-[0.04em] text-zinc-500">stat → cause → tactic → outcome → risk → mitigation</span>
      </div>
      <ol className="relative flex flex-col before:absolute before:bottom-1.5 before:left-[5px] before:top-1.5 before:w-px before:bg-white/6">
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className="relative grid grid-cols-[22px_1fr] items-start gap-3 py-2">
            <div className={cn("mt-[3px] h-[11px] w-[11px] rounded-full border-2 border-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]", dotBg[step.tone])} aria-hidden="true" />
            <div>
              <div className={cn("mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em]", labelColor[step.tone])}>{step.label}</div>
              {step.body}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
