"use client";

import { useState } from "react";
import { Btn, StatusDot } from "./primitives";

export function HITLModal({
  questions, onSubmit, onSkipAll, submitting,
}: {
  questions: string[]; onSubmit: (answers: string[]) => void; onSkipAll: () => void; submitting: boolean;
}) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ""));
  const filled = answers.filter(a => a.trim().length > 0).length;
  return (
    <div className="fixed inset-0 z-[60] grid animate-fade-in place-items-center bg-[rgba(5,5,7,0.55)] p-10 opacity-0 backdrop-blur-[14px] backdrop-saturate-120">
      <div className="w-full max-w-[720px] animate-rise-in overflow-hidden rounded-2xl border border-white/12 bg-[#0d0d10] opacity-0 shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(124,58,237,0.15)]">
        <div className="h-[3px] animate-rail-slide bg-[linear-gradient(90deg,transparent,#7c3aed,#7c3aed,transparent)] bg-[length:200%_100%]" />
        <div className="border-b border-white/6 px-8 pb-[18px] pt-7">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-600">
            <StatusDot tone="violet" pulse />
            Human in the loop · pipeline paused
          </div>
          <h3 className="mb-1.5 text-[22px] font-semibold leading-[1.25] tracking-[-0.02em]">
            Before we build your strategy — answer these to sharpen the playbook.
          </h3>
          <div className="text-[13px] text-zinc-400">{questions.length} questions · ~30 seconds · all optional</div>
        </div>
        <div className="px-8 py-2">
          {questions.map((q, i) => (
            <div key={i} className="flex gap-4 border-t border-white/6 py-[18px] first:border-t-0">
              <div className="tnum mt-px grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-violet-600/18 text-[11px] font-bold text-violet-300">{i + 1}</div>
              <div className="flex-1">
                <div className="mb-2.5 text-sm leading-normal text-zinc-50">{q}</div>
                <input
                  className="w-full border-0 border-b border-white/12 bg-transparent px-0 pb-2 pt-1.5 text-[13.5px] text-zinc-50 outline-none transition-colors duration-200 placeholder:text-zinc-600 focus:border-violet-600"
                  placeholder="Your answer (or skip)…"
                  value={answers[i]}
                  disabled={submitting}
                  onChange={(e) => setAnswers(prev => prev.map((a, j) => j === i ? e.target.value : a))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/6 bg-violet-600/[0.025] px-8 pb-6 pt-[18px]">
          <div className="flex items-center gap-3.5">
            <span className="tnum text-[11px] uppercase tracking-[0.04em] text-zinc-500">{filled} / {questions.length} answered</span>
            <button className="cursor-pointer text-xs text-zinc-400 transition-colors duration-150 hover:text-zinc-50 disabled:opacity-50" onClick={onSkipAll} disabled={submitting}>
              skip all →
            </button>
          </div>
          <Btn onClick={() => onSubmit(answers)} disabled={submitting}>
            {submitting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                Routing answers…
              </>
            ) : (
              <>Generate strategies →</>
            )}
          </Btn>
        </div>
      </div>
    </div>
  );
}
