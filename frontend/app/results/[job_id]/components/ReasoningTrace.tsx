"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/* F16 — pass-1 freeform reasoning trace. Editorial sidenote feel:
   vertical margin marker + italic serif prose with a violet drop cap. */
export function ReasoningTrace({ trace }: { trace: string }) {
  const [open, setOpen] = useState(false);
  const cleaned = trace.replace(/\r\n/g, "\n").trim();
  const paragraphs = cleaned.split(/\n{2,}/);
  return (
    <div
      className={cn(
        "mb-1 mt-6 rounded-[10px] border bg-white/[0.02] transition-colors duration-200",
        open ? "border-violet-600/28 bg-violet-600/[0.025]" : "border-white/6",
      )}
    >
      <button className="flex w-full cursor-pointer items-center gap-4 px-[18px] py-3.5 text-left text-zinc-50" onClick={() => setOpen(!open)}>
        <span className="h-7 w-[2px] flex-shrink-0 rounded-[1px] bg-violet-600" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-violet-600">reasoning trace · pass 1</span>
          <span className="font-heading text-[14.5px] font-semibold italic tracking-[-0.01em] text-zinc-50">Why this playbook</span>
        </span>
        <span className="tnum text-[10px] tracking-[0.04em] text-zinc-500">
          {cleaned.length.toLocaleString()} chars · {paragraphs.length} paragraphs
        </span>
        <span className={cn("text-xs transition-[transform,color] duration-200", open ? "text-violet-600" : "text-zinc-500")}>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-[60px_1fr] border-t border-dotted border-white/8 px-[18px] pb-[22px] pt-1">
          <div className="mr-3.5 flex flex-col items-center gap-2.5 border-r border-dotted border-white/8 pt-[18px]" aria-hidden="true">
            <span className="text-base leading-none text-violet-600">↳</span>
            <span className="rotate-180 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-zinc-500 [writing-mode:vertical-rl]">reasoning trace</span>
          </div>
          <div className="pr-1 pt-[18px] font-serif text-sm leading-[1.72] tracking-[-0.003em] text-zinc-300">
            {paragraphs.map((para, i) => (
              <p
                key={i}
                className={cn(
                  "mb-3.5 italic last:mb-0",
                  i === 0 && "first-letter:float-left first-letter:pr-2.5 first-letter:pt-1 first-letter:font-heading first-letter:text-[38px] first-letter:font-semibold first-letter:not-italic first-letter:leading-[0.92] first-letter:text-violet-600",
                )}
              >
                {para.trim()}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
