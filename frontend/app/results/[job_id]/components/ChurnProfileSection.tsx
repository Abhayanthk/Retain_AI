"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { interpolateRetention, parseMilestonePoints, pct, retentionToneClass } from "../lib";
import type { ChurnProfile, Ctx } from "../types";
import { Chip, MicroLabel, Section } from "./primitives";

// Inline SVG sparkline of the KM survival curve. No charting lib — keeps
// bundle slim and renders crisply on any background. Highlights the slider's
// current month as a vertical guide so the big number above feels anchored
// to a real point on the curve. flex-1 lets it absorb whatever height the
// right column forces on the card (preserveAspectRatio="none" stretches the
// SVG cleanly), so there is never dead space above the bottom stats row.
function SurvivalSparkline({ data, currentMonth }: { data: ChurnProfile; currentMonth: number }) {
  const W = 320;
  const H = 72;
  const PAD_X = 4;
  const PAD_Y = 6;

  // Prefer the dense survival_curve for shape; fall back to milestone points.
  const rawPts: [number, number][] = data.survival_curve
    ? Object.entries(data.survival_curve)
        .map(([k, v]) => [Number(k.replace(/^month_/, "")), v] as [number, number])
        .filter(([m, v]) => Number.isFinite(m) && v != null)
        .sort((a, b) => a[0] - b[0])
    : parseMilestonePoints(data.milestone_retention);

  if (rawPts.length < 2) return null;

  const maxX = Math.max(rawPts[rawPts.length - 1][0], data.max_tenure || 1);
  const toX = (m: number) => PAD_X + (m / maxX) * (W - PAD_X * 2);
  const toY = (r: number) => PAD_Y + (1 - r) * (H - PAD_Y * 2);

  const linePath = rawPts.map(([m, r], i) => `${i === 0 ? "M" : "L"}${toX(m).toFixed(1)},${toY(r).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${toX(rawPts[rawPts.length - 1][0]).toFixed(1)},${(H - PAD_Y).toFixed(1)} L${toX(rawPts[0][0]).toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`;
  const cx = toX(currentMonth);
  const cy = toY(interpolateRetention(currentMonth, data.milestone_retention));

  return (
    <svg
      className="my-[18px] mb-3.5 block h-auto min-h-[88px] w-full flex-1"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="km-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(59,130,246,0.32)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={PAD_X} y1={PAD_Y + t * (H - PAD_Y * 2)} x2={W - PAD_X} y2={PAD_Y + t * (H - PAD_Y * 2)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={areaPath} fill="url(#km-fill)" />
      <path d={linePath} fill="none" stroke="rgba(96,165,250,0.95)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <line x1={cx} y1={PAD_Y} x2={cx} y2={H - PAD_Y} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <circle cx={cx} cy={cy} r="3.5" fill="#60a5fa" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
    </svg>
  );
}

/* Balanced column counts for common milestone counts; anything else falls
   back to auto-fit. Backend chooses milestone months dynamically, so the
   count can be anything from 2 to ~9. */
const MILESTONE_COLS: Record<number, number> = { 4: 4, 5: 5, 6: 3, 7: 4, 8: 4, 9: 3 };

const SLIDER_CLASSES = cn(
  "h-1 w-full cursor-pointer appearance-none rounded-full bg-white/8 outline-none",
  "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-zinc-950 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-115",
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-zinc-950 [&::-moz-range-thumb]:bg-blue-500",
);

export function ChurnProfileSection({ data, ctx, visible }: { data: ChurnProfile; ctx: Ctx; visible: boolean }) {
  const [month, setMonth] = useState(12);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (data.max_tenure && month === 12 && data.max_tenure < 12) setMonth(data.max_tenure); }, [data.max_tenure]);
  const retention = interpolateRetention(month, data.milestone_retention);
  const churn = (1 - retention) * 100;
  // Render whatever milestones the backend chose (dynamic — see
  // behavioral_map.py `candidate_milestones` block). Flat-region milestones
  // are dropped server-side so the UI never shows a row of identical %.
  const milestones = parseMilestonePoints(data.milestone_retention).map(([m, val]) => ({
    key: `month_${m}`,
    label: `Mo. ${m}`,
    val,
  }));
  const skippedFlat = data.milestone_metadata?.skipped_flat ?? [];
  const maxObserved = data.milestone_metadata?.max_observed_month ?? data.max_tenure;
  const focusId = ctx.focusNewUsers ? "low_tenure" : ctx.focusEnterprise ? "high_tenure" : null;
  const milestoneCols = MILESTONE_COLS[milestones.length];

  return (
    <Section
      tone="blue"
      title="Churn Profile"
      meta={data.median_survival_time != null ? `median survival · mo. ${data.median_survival_time}` : undefined}
      visible={visible}
    >
      {/* Two columns of equal height: probability card left, milestone grid +
          stacked cohort rows right. Cohort rows flex-grow to absorb any height
          difference so neither column ever shows a dead zone. */}
      <div className="grid grid-cols-[1.1fr_1fr] items-stretch gap-3">
        <div className="flex flex-col rounded-[10px] border border-white/6 bg-white/[0.02] p-5">
          <MicroLabel className="mb-2.5 text-blue-500">Churn probability at month {month}</MicroLabel>
          <div className="tnum text-[44px] font-bold leading-none tracking-[-0.03em] text-zinc-50">
            {churn.toFixed(1)}%
            <small className="ml-2 text-sm font-medium text-zinc-500">· {pct(retention)} still active</small>
          </div>
          <div className="mt-[18px]">
            <input
              type="range"
              className={SLIDER_CLASSES}
              min={1}
              max={data.max_tenure || 36}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
            <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.04em] text-zinc-500">
              <span>Month 1</span>
              <span className="tnum">Month {month}</span>
              <span>Month {data.max_tenure}</span>
            </div>
          </div>
          <SurvivalSparkline data={data} currentMonth={month} />
          <div className="mt-auto flex items-stretch justify-between border-t border-white/6 pt-3.5">
            {[
              { label: "Median survival", val: data.median_survival_time != null ? `mo. ${data.median_survival_time}` : "—" },
              { label: "Observed window", val: `1–${data.max_tenure} mo.` },
              { label: "Final retention", val: `${Math.round((1 - data.churn_probability / 100) * 100)}%` },
            ].map((s, i) => (
              <div key={s.label} className={cn("flex min-w-0 flex-1 flex-col gap-[3px]", i > 0 && "ml-3.5 border-l border-white/6 pl-3.5")}>
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{s.label}</span>
                <span className="tnum whitespace-nowrap text-[13px] font-semibold text-zinc-50">{s.val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="rounded-[10px] border border-white/6 bg-white/[0.02] p-[18px]">
            <MicroLabel className="mb-3 flex flex-wrap items-center gap-2">
              Milestone retention
              {skippedFlat.length > 0 && (
                <span
                  className="cursor-help text-[10px] font-medium normal-case tracking-[0.04em] text-zinc-400"
                  title={`Months ${skippedFlat.join(", ")} skipped — KM curve is flat past month ${maxObserved} (no new churn events observed beyond that point).`}
                >
                  · curve flat past mo. {maxObserved}
                </span>
              )}
            </MicroLabel>
            <div
              className={cn("grid gap-1.5", !milestoneCols && "grid-cols-[repeat(auto-fit,minmax(74px,1fr))]")}
              style={milestoneCols ? { gridTemplateColumns: `repeat(${milestoneCols}, 1fr)` } : undefined}
            >
              {milestones.map((m) => (
                <div key={m.key} className="rounded-md border border-white/6 bg-white/[0.015] px-1.5 py-2.5 text-center">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.04em] text-zinc-500">{m.label}</div>
                  <div className={cn("tnum text-[17px] font-bold tracking-[-0.02em]", retentionToneClass(m.val))}>
                    {Math.round(m.val * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cohorts: compact rows that flex-grow so the three of them soak up
              whatever height the milestone card leaves over. */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            {data.behavior_cohorts.slice(0, 3).map((c, i) => {
              const cid = c.cohort_id ?? (i === 0 ? "low_tenure" : i === 1 ? "medium_tenure" : "high_tenure");
              const isFocus = cid === focusId;
              const label = c.label ?? (cid === "low_tenure" ? "Short tenure" : cid === "high_tenure" ? "Long tenure" : "Medium tenure");
              // characteristics often just repeats the label — only show it
              // when it adds information.
              const desc = c.characteristics && c.characteristics.trim().toLowerCase() !== label.trim().toLowerCase() ? c.characteristics : null;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-between gap-3.5 rounded-[10px] border border-white/6 bg-white/[0.02] px-4 py-3",
                    isFocus && "border-purple-500/50 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.15)]",
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{label}</span>
                      {isFocus && <Chip tone="violet" sm>Your focus</Chip>}
                    </div>
                    <div className="tnum truncate text-[11px] text-zinc-500" title={desc ?? undefined}>
                      {c.tenure_range && `${c.tenure_range.min}–${c.tenure_range.max} mo.`}
                      {c.tenure_range && desc && " · "}
                      {desc}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-baseline gap-2.5">
                    <span className="tnum text-xl font-bold tracking-[-0.025em]">{c.size.toLocaleString()}</span>
                    <span className={cn("tnum text-xs", c.retention_rate < 0.7 ? "text-amber-500" : "text-emerald-500")}>
                      {Math.round(c.retention_rate * 100)}% retention
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}
