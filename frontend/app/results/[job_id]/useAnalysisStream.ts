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
  // eventKey (SSE event type) → backend ts_ms when that stage completed.
  stageEventTs?: Record<string, number>;
}

/* SSE — survives page refresh.
   Persistence model:
     - Every event mutates sessionStorage `job_${jobId}` with the latest
       stagesData + connectionStatus + errorInfo + hitlSubmitted + stageEventTs.
     - On mount we restore the snapshot first. If status is terminal
       (complete / error / cancelled) we never open a new SSE — backend
       has already cleaned up and would 404.
     - If status is non-terminal, we open SSE; the backend broadcasts the full
       event history from cursor 0, so a refresh replays everything.

   Stage durations come from each event's backend `ts_ms` (fixed wall-clock),
   NOT from client arrival time. That's the whole point: on a refresh the
   server replays the entire history in one burst, so client arrival times all
   collapse to ~now — using ts_ms keeps every duration correct across refreshes. */
export function useAnalysisStream(jobId: string) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [stagesData, setStagesData] = useState<StagesData>({});
  const [hitlSubmitted, setHitlSubmitted] = useState(false);
  const [forensicProgress, setForensicProgress] = useState<ForensicProgress | null>(null);
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);

  // Backend completion timestamp per stage event; durations derived from these.
  const [jobStartTs, setJobStartTs] = useState<number | null>(null);
  const [stageEventTs, setStageEventTs] = useState<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());

  const sseRef = useRef<EventSource | null>(null);
  // Cache latest snapshot pieces in refs so writeSnapshot() (called from SSE
  // handlers) always writes the freshest combined state, regardless of React
  // setState batching.
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
        // Restore stage timing (ts_ms per event + job start) so durations
        // survive refresh instead of resetting to 0s.
        if (typeof p.jobStartTs === "number") setJobStartTs(p.jobStartTs);
        if (p.stageEventTs) setStageEventTs(p.stageEventTs);
        if (p.connectionStatus === "complete" || p.connectionStatus === "error" || p.connectionStatus === "cancelled") {
          setConnectionStatus(p.connectionStatus);
          restoredStatus = p.connectionStatus;
        }
      } catch { /* ignore */ }
    }
    // Terminal state already cached — skip SSE so we don't 404 into a fake error.
    if (restoredStatus) return;

    const sse = new EventSource(`${API_BASE}/analyze/stream/${jobId}`);
    sseRef.current = sse;
    sse.onopen = () => setConnectionStatus("connected");
    sse.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        const evTs = typeof event.ts_ms === "number" ? event.ts_ms : Date.now();

        // Seed the job timer from the first event's backend timestamp.
        setJobStartTs((prev) => {
          if (prev != null) return prev;
          writeSnapshot({ jobStartTs: evTs });
          return evTs;
        });

        // Interim progress events — not stages, don't store in stagesData.
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

        // Record the stage completion timestamp (first occurrence wins, so
        // replay on refresh keeps the original backend time).
        setStageEventTs((prev) => {
          if (prev[event.type] !== undefined) return prev;
          const next = { ...prev, [event.type]: evTs };
          writeSnapshot({ stageEventTs: next });
          return next;
        });

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
    // EventSource auto-reconnects on transient drops; only declare error after
    // repeated failures AND only if the cached snapshot isn't already usable.
    let errorCount = 0;
    sse.onerror = () => {
      errorCount++;
      if (errorCount >= 5) {
        sse.close();
        sseRef.current = null;
        if (stagesDataRef.current?.solution_ready || stagesDataRef.current?.complete) {
          setConnectionStatus("complete");
          writeSnapshot({ connectionStatus: "complete" });
          return;
        }
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

  /* Derive per-stage [start, end] from backend event timestamps.
     Each stage's END = its completion event's ts_ms. Its START = the previous
     completed stage's ts_ms (or the job start). The active (not-yet-done) stage
     gets a start but no end, so the Sidebar ticks it against `now`. Pending
     stages get nothing. All refresh-proof because ts_ms is fixed server-side. */
  const { stageStartTs, stageEndTs } = useMemo(() => {
    const start: Record<string, number> = {};
    const end: Record<string, number> = {};
    let prevTs = jobStartTs ?? undefined;
    for (const step of PIPELINE_STEPS) {
      const evTs = stageEventTs[step.key];
      if (evTs !== undefined) {
        if (prevTs !== undefined) start[step.id] = prevTs;
        end[step.id] = evTs;
        prevTs = evTs;
      } else if (pipelineState[step.id] === "active") {
        if (prevTs !== undefined) start[step.id] = prevTs;
        // no end → ticks with `now`
      }
      // pending → no start, no timer shown
    }
    return { stageStartTs: start, stageEndTs: end };
  }, [stageEventTs, jobStartTs, pipelineState]);

  return {
    connectionStatus, errorInfo, stagesData, pipelineState, complete,
    hitlSubmitted, markHitlSubmitted, markCancelled,
    forensicProgress, retryInfo,
    jobStartTs, stageStartTs, stageEndTs, now,
  };
}
