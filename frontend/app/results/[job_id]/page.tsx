"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { API_BASE, statusText } from "./lib";
import {
  buildCtx,
  type ChurnProfile, type Ctx, type DiagnosisData, type ForensicFindingsRich,
  type Playbook, type ProfessionalSkepticOutput, type RiskData, type SimulationData,
} from "./types";
import { useAnalysisStream } from "./useAnalysisStream";
import { ChurnProfileSection } from "./components/ChurnProfileSection";
import { DiagnosisSection } from "./components/DiagnosisSection";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { HITLModal } from "./components/HITLModal";
import { PendingSection } from "./components/PendingSection";
import { Section, StatusBtn, StatusDot } from "./components/primitives";
import { SignalSection } from "./components/SignalSection";
import { Sidebar } from "./components/Sidebar";
import { SimulationSection } from "./components/SimulationSection";
import { AnalysisStatusBanner, StatusBar } from "./components/StatusBar";
import { StrategySection } from "./components/StrategySection";

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.job_id as string;

  const stream = useAnalysisStream(jobId);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [hitlSubmitting, setHitlSubmitting] = useState(false);
  const [ctx, setCtx] = useState<Ctx>(() => buildCtx({}));
  const [evidenceOpenIdx, setEvidenceOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("latest_form_payload");
      if (raw) setCtx(buildCtx(JSON.parse(raw).questionnaire ?? {}));
    } catch { /* keep defaults */ }
  }, []);

  /* Derived stage payloads */
  const { stagesData, pipelineState, complete, connectionStatus, errorInfo } = stream;
  const risk: RiskData | null = stagesData.risk_ready ?? null;
  const churn: ChurnProfile | null = stagesData.churn_profile_ready ?? null;
  const dx: DiagnosisData | null = stagesData.diagnosis_ready ?? null;
  const hitlData = stagesData.hitl_questions_ready;
  const sim: SimulationData | null = stagesData.simulation_ready ?? null;
  const playbook: Playbook | null = stagesData.solution_ready?.final_playbook ?? null;
  const hitlOpen = !!hitlData && !stream.hitlSubmitted;
  const completedCount = Object.values(pipelineState).filter(v => v === "done").length;

  /* Actions */
  const respondToHitl = async (answers: Record<string, string>) => {
    setHitlSubmitting(true);
    try {
      await fetch(`${API_BASE}/analyze/${jobId}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      stream.markHitlSubmitted();
    } finally { setHitlSubmitting(false); }
  };
  const handleHitlSubmit = (answers: string[]) =>
    respondToHitl(Object.fromEntries(answers.map((a, i) => [String(i), a])));
  const handleSkipAll = () => respondToHitl({});

  const handleRefine = () => router.push("/form");

  const handleCancel = async () => {
    if (isCancelling || connectionStatus === "complete" || connectionStatus === "cancelled") return;
    if (!confirm("Cancel this analysis? In-flight work will be discarded.")) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`${API_BASE}/analyze/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Backend pushes a `cancelled` SSE event; UI updates from that handler.
      // If SSE already dropped, force-set state here so user gets feedback.
      setTimeout(() => {
        stream.markCancelled();
        setIsCancelling(false);
      }, 3000);
    } catch {
      toast.error("Failed to cancel analysis. Check backend connectivity.");
      setIsCancelling(false);
    }
  };

  const handleRerun = async () => {
    const payloadStr = sessionStorage.getItem("latest_form_payload");
    if (!payloadStr) return toast.error("No previous form data found to rerun.");
    setIsRerunning(true);
    try {
      const res = await fetch(`${API_BASE}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payloadStr });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success("Rerun started!");
      router.push(`/results/${data.job_id}`);
    } catch { toast.error("Failed to rerun analysis."); setIsRerunning(false); }
  };

  return (
    <div className='min-h-screen bg-zinc-950 text-[13px] leading-normal tracking-[-0.005em] text-zinc-50 antialiased [font-feature-settings:"cv11","ss01","ss03"]'>
      <div className="flex min-h-screen bg-zinc-950">
        <Sidebar
          pipelineState={pipelineState}
          jobId={jobId}
          ctx={ctx}
          onRefine={handleRefine}
          onRerun={handleRerun}
          stageStartTs={stream.stageStartTs}
          stageEndTs={stream.stageEndTs}
          now={stream.now}
          forensicProgress={stream.forensicProgress}
          retryInfo={stream.retryInfo}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          <StatusBar
            text={statusText(pipelineState, hitlOpen, complete)}
            hitlOpen={hitlOpen}
            complete={complete}
            completedCount={completedCount}
            jobStartTs={stream.jobStartTs}
            jobEndTs={stream.stageEndTs.strategy}
            now={stream.now}
            onCancel={handleCancel}
            onRerun={handleRerun}
            isCancelling={isCancelling}
            isRerunning={isRerunning}
            connectionStatus={connectionStatus}
          />

          {(connectionStatus === "error" || connectionStatus === "cancelled") && (
            <AnalysisStatusBanner
              status={connectionStatus}
              errorInfo={errorInfo}
              onRerun={handleRerun}
              isRerunning={isRerunning}
            />
          )}

          <div className="mx-auto w-full max-w-[1180px] px-10 pb-20">
            <div className="flex items-end justify-between gap-6 pb-7 pt-9">
              <div>
                <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Retention Intelligence</h1>
                <div className="mt-1 flex items-center gap-2.5 text-xs text-zinc-400">
                  <span className="tnum">job · {jobId?.split("-")[0]}</span>
                  <span>·</span>
                  <span>{ctx.businessModel}</span>
                  <span>·</span>
                  <span>{ctx.segment}</span>
                </div>
              </div>
              <StatusBtn onClick={handleRefine}>⤓ Refine context</StatusBtn>
            </div>

            {risk ? <SignalSection data={risk} ctx={ctx} visible={true} />
                  : <PendingSection title="Signal" tone="amber" label="Stage 1 · awaiting risk_ready" />}

            {churn ? <ChurnProfileSection data={churn} ctx={ctx} visible={true} />
                   : <PendingSection title="Churn Profile" tone="blue" label="Stage 2 · awaiting churn_profile_ready" />}

            {dx ? <DiagnosisSection data={dx} ctx={ctx} visible={true} onOpenEvidence={(i) => setEvidenceOpenIdx(i)} />
                : <PendingSection title="Root Cause" tone="purple" label="Stage 3 · awaiting diagnosis_ready" />}

            {hitlData && stream.hitlSubmitted && (
              <Section tone="violet" title="Clarify" meta="Stage 4 · human in the loop">
                <div className="flex animate-fade-in items-center gap-3 rounded-[10px] border border-violet-600/25 bg-violet-600/6 px-[18px] py-3.5 text-[13px] text-zinc-300 opacity-0">
                  <StatusDot tone="teal" />
                  <span>✓ Answers routed — strategies generating from your inputs.</span>
                </div>
              </Section>
            )}

            {sim ? <SimulationSection data={sim} visible={true} />
                 : <PendingSection title="Monte Carlo Simulation" tone="teal" label="Stage 5 · awaiting simulation_ready" />}

            {playbook ? <StrategySection data={playbook} ctx={ctx} visible={true} />
                      : <PendingSection title="Strategy" tone="emerald" label="Stage 6 · awaiting solution_ready" />}
          </div>
        </main>

        {hitlOpen && (
          <HITLModal
            questions={(hitlData.questions ?? []) as string[]}
            onSubmit={handleHitlSubmit}
            onSkipAll={handleSkipAll}
            submitting={hitlSubmitting}
          />
        )}

        {evidenceOpenIdx !== null && dx?.merged_hypotheses?.[evidenceOpenIdx] && (
          <EvidenceDrawer
            hypothesis={dx.merged_hypotheses[evidenceOpenIdx]}
            rank={evidenceOpenIdx + 1}
            forensic={
              dx.forensic_findings && !Array.isArray(dx.forensic_findings)
                ? (dx.forensic_findings as ForensicFindingsRich)
                : undefined
            }
            skeptic={
              dx.skeptic_findings && !Array.isArray(dx.skeptic_findings)
                ? (dx.skeptic_findings as ProfessionalSkepticOutput)
                : undefined
            }
            driverFeatures={dx.driver_features ?? (
              dx.forensic_findings && !Array.isArray(dx.forensic_findings)
                ? (dx.forensic_findings as ForensicFindingsRich).driver_features
                : undefined
            )}
            topSegments={dx.top_segments}
            onClose={() => setEvidenceOpenIdx(null)}
          />
        )}
      </div>
    </div>
  );
}
