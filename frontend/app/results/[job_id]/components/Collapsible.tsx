"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function Collapsible({
  title, count, children, defaultOpen,
}: {
  title: string; count?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-white/6 bg-white/[0.02]">
      <button
        className="flex w-full cursor-pointer items-center justify-between px-[18px] py-3.5 text-left text-[13px] font-medium text-zinc-50 hover:bg-white/[0.035]"
        onClick={() => setOpen(!open)}
      >
        <span>
          {title}
          {count !== undefined && <span className="ml-2 text-zinc-500">· {count}</span>}
        </span>
        <span className={cn("text-zinc-500 transition-transform duration-200", open && "rotate-180")}>▾</span>
      </button>
      {open && <div className="border-t border-white/6 px-[18px] pb-[18px]">{children}</div>}
    </div>
  );
}
