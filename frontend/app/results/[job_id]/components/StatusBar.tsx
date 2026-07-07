import { cn } from "@/lib/utils";
import { fmtElapsed } from "../lib";
import type { ConnectionStatus, ErrorInfo } from "../useAnalysisStream";
import { StatusBtn, StatusDot } from "./primitives";

export function StatusBar({
  text, hitlOpen, complete, completedCount,
  jobStartTs, jobEndTs, now,
  onCancel, onRerun, isCancelling, isRerunning, connectionStatus,
}: {
  text: string; hitlOpen: boolean; complete: boolean; completedCount: number;
  jobStartTs: number | null; jobEndTs: number | undefined; now: number;
  onCancel: () => void; onRerun: () => void;
  isCancelling: boolean; isRerunning: boolean; connectionStatus: ConnectionStatus;
}) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-white/6 bg-zinc-950/86 px-10 py-2.5 text-xs text-zinc-400 backdrop-blur-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <StatusDot tone={complete ? "emerald" : hitlOpen ? "violet" : "amber"} pulse={!complete} />
        <span className="truncate">{text}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2.5">
        {jobStartTs !== null && (
          <span className="tnum inline-flex items-center gap-1.5 border-l border-white/6 pl-3 text-[11px] font-medium text-zinc-400" title="total job elapsed">
            <span className="text-[11px] opacity-50" aria-hidden="true">⏱</span>
            {fmtElapsed((complete && jobEndTs ? jobEndTs : now) - jobStartTs)}
          </span>
        )}
        <span className="text-[11px] uppercase tracking-[0.04em] text-zinc-500">SSE · {completedCount} / 6 events</span>
        {!complete && connectionStatus !== "cancelled" && connectionStatus !== "error" && (
          <StatusBtn variant="danger" onClick={onCancel} disabled={isCancelling} title="Cancel the running analysis">
            {isCancelling ? "■ Cancelling…" : "■ Cancel"}
          </StatusBtn>
        )}
        <StatusBtn onClick={onRerun} disabled={isRerunning}>
          {isRerunning ? "↻ Running…" : "↻ Rerun"}
        </StatusBtn>
      </div>
    </div>
  );
}

export function AnalysisStatusBanner({
  status, errorInfo, onRerun, isRerunning,
}: {
  status: "error" | "cancelled"; errorInfo: ErrorInfo | null;
  onRerun: () => void; isRerunning: boolean;
}) {
  const isError = status === "error";
  return (
    <div
      className={cn(
        "my-3 mb-1 flex items-center gap-3.5 rounded-lg border px-4 py-3 text-[12.5px]",
        isError ? "border-rose-500/40 bg-rose-500/6" : "border-slate-400/40 bg-slate-400/6",
      )}
      role="alert"
    >
      <span
        className={cn("h-2 w-2 flex-shrink-0 rounded-full", isError ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" : "bg-slate-400")}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className={cn("font-semibold tracking-[0.01em]", isError ? "text-rose-200" : "text-slate-200")}>
          {isError ? "Analysis failed" : "Analysis cancelled"}
        </strong>
        {isError && errorInfo && (
          <span className="text-[11.5px] text-zinc-400">
            {errorInfo.lastNode ? `at ${errorInfo.lastNode}` : null}
            {errorInfo.type ? ` · ${errorInfo.type}` : null}
            {errorInfo.message ? ` · ${errorInfo.message}` : null}
          </span>
        )}
        {!isError && <span className="text-[11.5px] text-zinc-400">Pipeline stopped at your request.</span>}
      </div>
      <StatusBtn onClick={onRerun} disabled={isRerunning}>
        {isRerunning ? "↻ Running…" : "↻ Retry"}
      </StatusBtn>
    </div>
  );
}
