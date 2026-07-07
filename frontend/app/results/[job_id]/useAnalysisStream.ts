"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { API_BASE, PIPELINE_STEPS, derivePipelineState } from "./lib";

export type ConnectionStatus = "connecting" | "connected" | "complete" | "error" | "cancelled";
export interface ErrorInfo { type?: string; message?: string; lastNode?: string }
export interface ForensicProgress { run: number; total: number; status: "started" | "completed" | "failed" }
export interface RetryInfo { iteration: number; max: number; verdict: string; reason: string; weakPoints: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StagesData = Record<string, any>;

interface Snapshot {
  stagesData?: StagesData;
  connectionStatus?: string;
  errorInfo?: ErrorInfo | null;
  hitlSubmitted?: boolean;
  jobStartTs?: number;
  stageStartTs?: Record<string, number>;
  stageEndTs?: Record<string, number>;
}

/* SSE — survives page refresh.
   Persistence model:
     - Every event mutates sessionStorage `job_${jobId}` with the latest
       stagesData + connectionStatus + errorInfo + hitlSubmitted.
     - On mount we restore the snapshot first. If status is terminal
       (complete / error / cancelled) we never open a new SSE — backend
       has already cleaned up its queue and would return 404.
     - If status is non-terminal, we open SSE; on a hard 404 we fall back
       to whatever cached data we have rather than showing a fake error. */
export function useAnalysisStream(jobId: string) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [stagesData, setStagesData] = useState<StagesData>({});
  const [hitlSubmitted, setHitlSubmitted] = useState(false);
  const [forensicProgress, setForensicProgress] = useState<ForensicProgress | null>(null);
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);

  // Stage timing — visibility into "how long" + "is it stuck".
  const [jobStartTs, setJobStartTs] = useState<number | null>(null);
  const [stageStartTs, setStageStartTs] = useState<Record<string, number>>({});
  const [stageEndTs, setStageEndTs] = useState<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());

  const sseRef = useRef<EventSource | null>(null);
  // Cache the latest snapshot pieces in refs so writeSnapshot() (called from
  // SSE handlers) always writes the freshest combined state, regardless of
  // React's setState batching.
  const stagesDataRef = useRef<StagesData>({});
  const hitlSubmittedRef = useRef(false);

  const writeSnapshot = (patch: Snapshot) => {
    try {
      const existing = sessionStorage.getItem(`job_${jobId}`);
      const prev = existing ? JSON.parse(existing) : {};
      sessionStorage.setItem(`job_${jobId}`, JSON.stringify({ ...prev, ...patch }));
    } catch { /* quota or serialization — non-fatal */ }
  };

  const markHitlSubmitted = () => {
    setHitlSubmitted(true);
    hitlSubmittedRef.current = true;
    writeSnapshot({ hitlSubmitted: true });
  };

  const markCancelled = () => {
    setConnectionStatus((prev) => (prev === "cancelled" || prev === "complete") ? prev : "cancelled");
  };

  useEffect(() => {
    if (!jobId) return;
    const saved = sessionStorage.getItem(`job_${jobId}`);
    let restoredStatus: string | null = null;
    if (saved) {
      try {
        const p: Snapshot = JSON.parse(saved);
        if (p.stagesData) { setStagesData(p.stagesData); stagesDataRef.current = p.stagesData; }
        if (p.hitlSubmitted) { setHitlSubmitted(true); hitlSubmittedRef.current = true; }
        if (p.errorInfo) setErrorInfo(p.errorInfo);
        // Restore stage timers so a refresh doesn't reset durations to 0s /
        // restart the active stage's clock. Must land before the stamping
        // effect runs (same batched render as stagesData above).
        if (typeof p.jobStartTs === "number") setJobStartTs(p.jobStartTs);
        if (p.stageStartTs) setStageStartTs(p.stageStartTs);
        if (p.stageEndTs) setStageEndTs(p.stageEndTs);
        if (p.connectionStatus === "complete" || p.connectionStatus === "error" || p.connectionStatus === "cancelled") {
          setConnectionStatus(p.connectionStatus);
          restoredStatus = p.connectionStatus;
        }
      } catch { /* ignore */ }
    }
    // Terminal state already cached — backend job has been cleaned up.
    // Skip SSE entirely so we don't hit 404 and flip to a fake error banner.
    if (restoredStatus) return;

    const sse = new EventSource(`${API_BASE}/analyze/stream/${jobId}`);
    sseRef.current = sse;
    sse.onopen = () => setConnectionStatus("connected");
    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        // Seed the job timer on the first event we see.
        setJobStartTs((prev) => prev ?? Date.now());

        // Interim progress events — don't store in stagesData since they're not stages.
        if (event.type === "forensic_progress") {
          setForensicProgress({
            run: event.data?.run ?? 0,
            total: event.data?.total ?? 3,
            status: event.data?.status ?? "started",
          });
          return;
        }
        if (event.type === "critic_retry_started") {
          const info: RetryInfo = {
            iteration: Number(event.data?.iteration ?? 1),
            max: Number(event.data?.max ?? 2),
            verdict: String(event.data?.verdict ?? "low_lift"),
            reason: String(event.data?.reason ?? ""),
            weakPoints: Number(event.data?.weak_points_count ?? 0),
          };
          setRetryInfo(info);
          const summary = info.verdict === "violation"
            ? `Critic flagged constraint violations — agents revising (pass ${info.iteration + 1}/${info.max})`
            : `Critic flagged low lift — agents revising (${info.weakPoints} weak points)`;
          toast(summary, { icon: "↻", duration: 6000 });
          return;
        }

        if (event.type === "cancelled") {
          setConnectionStatus("cancelled");
          writeSnapshot({ connectionStatus: "cancelled" });
          toast("Analysis cancelled.", { icon: "■", duration: 4000 });
          sse.close(); sseRef.current = null;
          return;
        }

        if (event.type === "error") {
          const errInfo: ErrorInfo = {
            type: event.data?.error_type,
            message: event.data?.error_message,
            lastNode: event.data?.last_node,
          };
          setErrorInfo(errInfo);
          setConnectionStatus("error");
          writeSnapshot({ connectionStatus: "error", errorInfo: errInfo });
          toast.error(`Analysis failed at ${event.data?.last_node || "unknown stage"}.`, { duration: 8000 });
          sse.close(); sseRef.current = null;
          return;
        }

        setStagesData((prev) => {
          const updated = { ...prev, [event.type]: event.data };
          stagesDataRef.current = updated;
          writeSnapshot({
            stagesData: updated,
            hitlSubmitted: hitlSubmittedRef.current,
            connectionStatus: event.type === "complete" ? "complete" : "connected",
          });
          return updated;
        });
        if (event.type === "complete") { setConnectionStatus("complete"); sse.close(); sseRef.current = null; }
      } catch (err) { console.error("SSE parse error:", err); }
    };
    // EventSource auto-reconnects on transient drops; only declare error
    // after repeated failures AND only if the cached snapshot isn't already
    // in a usable terminal state. This prevents the classic "refresh after
    // pipeline completed → backend popped active_streams → SSE 404 → fake
    // 'ConnectionLost' banner overlaying perfectly-good cached results" bug.
    let errorCount = 0;
    sse.onerror = () => {
      errorCount++;
      if (errorCount >= 5) {
        sse.close();
        sseRef.current = null;
        // If we already have a final playbook cached, the job actually
        // finished — just mark complete and move on.
        if (stagesDataRef.current?.solution_ready || stagesDataRef.current?.complete) {
          setConnectionStatus("complete");
          writeSnapshot({ connectionStatus: "complete" });
          return;
        }
        // Truly lost — no cached terminal payload.
        const errInfo: ErrorInfo = { type: "ConnectionLost", message: "Lost connection to backend after multiple retries." };
        setErrorInfo(errInfo);
        setConnectionStatus("error");
        writeSnapshot({ connectionStatus: "error", errorInfo: errInfo });
      }
    };
    return () => { sse.close(); sseRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /* Live tick while job runs, freezes once complete. */
  useEffect(() => {
    if (connectionStatus === "complete") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [connectionStatus]);

  const complete = connectionStatus === "complete";
  const pipelineState = useMemo(
    () => derivePipelineState(stagesData, hitlSubmitted, complete),
    [stagesData, hitlSubmitted, complete],
  );

  /* Stamp each stage's first "active" + first "done" exactly once. */
  useEffect(() => {
    const ts = Date.now();
    let startChanged = false;
    const nextStart: Record<string, number> = { ...stageStartTs };
    let endChanged = false;
    const nextEnd: Record<string, number> = { ...stageEndTs };
    for (const s of PIPELINE_STEPS) {
      const status = pipelineState[s.id];
      if ((status === "active" || status === "done") && nextStart[s.id] === undefined) {
        nextStart[s.id] = ts; startChanged = true;
      }
      if (status === "done" && nextEnd[s.id] === undefined) {
        nextEnd[s.id] = ts; endChanged = true;
      }
    }
    if (startChanged) setStageStartTs(nextStart);
    if (endChanged) setStageEndTs(nextEnd);
    if (startChanged || endChanged) {
      writeSnapshot({
        ...(startChanged ? { stageStartTs: nextStart } : {}),
        ...(endChanged ? { stageEndTs: nextEnd } : {}),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineState]);

  /* Persist the job-start timestamp so total-elapsed survives refresh. */
  useEffect(() => {
    if (jobStartTs != null) writeSnapshot({ jobStartTs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStartTs]);

  return {
    connectionStatus, errorInfo, stagesData, pipelineState, complete,
    hitlSubmitted, markHitlSubmitted, markCancelled,
    forensicProgress, retryInfo,
    jobStartTs, stageStartTs, stageEndTs, now,
  };
}
