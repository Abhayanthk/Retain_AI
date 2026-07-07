"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  FileSpreadsheet,
  X,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react";
import toast from "react-hot-toast";

/* ─── types ────────────────────────────────────────────────────── */

interface FormData {
  businessContext: string;
  csvFile: File | null;
  churnDefinition: string;
  churnDefinitionOther: string;
  churnInactivityDays: string;
  businessModel: string;
  typicalCustomer: string;
  companyStage: string;
  revenueModel: string;
  pricingFlexibility: string[];
  coreFeatures: string;
  canShipChanges: string;
  hasCompletionPoint: string;
  topChannels: string[];
  topCompetitors: string;
  churnDestination: string;
  supportModel: string;
  retentionTactics: string[];
  prioritySegment: string;
  prioritySegmentOther: string;
  topGoal: string;
  timeline: string;
  anythingElse: string;
  analysisDepth: string;
}

const INITIAL: FormData = {
  businessContext: "", csvFile: null, churnDefinition: "", churnDefinitionOther: "",
  churnInactivityDays: "", businessModel: "", typicalCustomer: "", companyStage: "",
  revenueModel: "", pricingFlexibility: [], coreFeatures: "", canShipChanges: "",
  hasCompletionPoint: "", topChannels: [], topCompetitors: "", churnDestination: "",
  supportModel: "", retentionTactics: [], prioritySegment: "", prioritySegmentOther: "",
  topGoal: "", timeline: "", anythingElse: "", analysisDepth: "quick",
};

const STEPS = ["About & Data", "Business & Revenue", "Product & Market", "Ops & Goals", "Final"];

/* ─── sub-components ───────────────────────────────────────────── */

function PhaseTag({ phase, label }: { phase: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-8">
      <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#d4d4d8]">{phase}</span>
      <span className="text-[12px] text-[#2a2a2e]">·</span>
      <span className="text-[12px] text-[#52525b] uppercase tracking-[0.06em]">{label}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-[#71717a] mb-3">{children}</p>;
}

function QuestionTitle({ children, required = true }: { children: React.ReactNode; required?: boolean }) {
  return (
    <h2 className="text-[20px] font-semibold text-[#fafafa] leading-[1.4] mb-2 flex items-center flex-wrap gap-1" style={{ fontFamily: "var(--font-raleway), sans-serif" }}>
      {children}
      {required && <span className="text-[#ef4444] text-[20px] leading-none ml-0.5">*</span>}
    </h2>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-[#71717a] leading-[1.7] mb-6">{children}</p>;
}

function Divider() {
  return <div className="my-10 h-px bg-[rgba(255,255,255,0.06)]" />;
}

function RadioOption({ value, label, sublabel, selected, onSelect }: { value: string; label: string; sublabel?: string; selected: boolean; onSelect: (v: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(value)}
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[14px] transition-all duration-150 cursor-pointer border text-left
        ${selected ? "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-[#fafafa]" : "border-transparent text-[#a1a1aa] hover:text-[#d4d4d8] hover:bg-[rgba(255,255,255,0.02)]"}`}>
      <span className={`w-[16px] h-[16px] rounded-full border-[1.5px] flex-shrink-0 flex items-center justify-center transition-all ${selected ? "border-[#fafafa] bg-[#fafafa]" : "border-[#3f3f46]"}`}>
        {selected && <span className="w-[6px] h-[6px] rounded-full bg-[#09090b]" />}
      </span>
      <span>{label}{sublabel && <span className="text-[#52525b] ml-1.5 text-[13px]">— {sublabel}</span>}</span>
    </button>
  );
}

function CheckOption({ label, checked, onToggle, disabled }: { label: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled && !checked}
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[14px] transition-all duration-150 cursor-pointer border text-left
        ${checked ? "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-[#fafafa]" : disabled && !checked ? "border-transparent text-[#3f3f46] cursor-not-allowed" : "border-transparent text-[#a1a1aa] hover:text-[#d4d4d8] hover:bg-[rgba(255,255,255,0.02)]"}`}>
      <span className={`w-[16px] h-[16px] rounded-[4px] border-[1.5px] flex-shrink-0 flex items-center justify-center transition-all ${checked ? "border-[#fafafa] bg-[#fafafa]" : "border-[#3f3f46]"}`}>
        {checked && <Check className="w-[10px] h-[10px] text-[#09090b]" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}

function ContinueBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div className="flex justify-center mt-14 mb-4">
      <button type="button" onClick={onClick} disabled={disabled}
        className={`flex items-center gap-2 h-10 px-7 rounded-lg text-[14px] font-medium transition-all duration-200 cursor-pointer ${!disabled ? "bg-[#fafafa] text-[#09090b] hover:bg-white" : "bg-[rgba(255,255,255,0.06)] text-[#52525b] cursor-not-allowed"}`}>
        Continue <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function SubmitBtn({ onClick, submitting }: { onClick: () => void; submitting: boolean }) {
  return (
    <div className="flex justify-center mt-14 mb-4">
      <button type="button" onClick={onClick} disabled={submitting}
        className="flex items-center gap-2 h-10 px-8 rounded-lg text-[14px] font-medium bg-[#fafafa] text-[#09090b] hover:bg-white transition-all duration-200 cursor-pointer disabled:opacity-50">
        {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <>Submit <ArrowRight className="w-4 h-4" /></>}
      </button>
    </div>
  );
}

/* visible text inputs */
const INPUT_CLS = "bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.1)] text-[14px] text-[#fafafa] placeholder:text-[#52525b] rounded-lg focus-visible:ring-0 focus-visible:border-[rgba(255,255,255,0.2)] transition-colors";

/* ─── main ─────────────────────────────────────────────────────── */

export default function FormPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const router = useRouter();
  const [maxStep, setMaxStep] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const total = STEPS.length;

  // Load saved state if available. If the landing page primed a demo run
  // (demo_csv_url present), also fetch the bundled CSV and attach it as a
  // File so the user doesn't need to re-upload.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const saved = sessionStorage.getItem("latest_form_state");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setForm({ ...parsed, csvFile: null });
          setMaxStep(STEPS.length - 1);
        } catch (err) {
          console.error("Failed to load saved form state", err);
        }
      }

      const demoUrl = sessionStorage.getItem("demo_csv_url");
      const demoName = sessionStorage.getItem("demo_csv_name") || "demo.csv";
      if (demoUrl) {
        try {
          const res = await fetch(demoUrl);
          if (!res.ok) throw new Error(`fetch ${demoUrl} ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], demoName, { type: "text/csv" });
          if (!cancelled) {
            setForm((p) => ({ ...p, csvFile: file }));
            setMaxStep(STEPS.length - 1);
          }
        } catch (err) {
          console.error("Demo CSV hydrate failed:", err);
        } finally {
          // Single-shot: clear so a user navigating back to the form
          // organically doesn't get auto-filled forever.
          sessionStorage.removeItem("demo_csv_url");
          sessionStorage.removeItem("demo_csv_name");
        }
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = useCallback(<K extends keyof FormData>(k: K, v: FormData[K]) => setForm((p) => ({ ...p, [k]: v })), []);
  const toggle = useCallback((k: "pricingFlexibility" | "topChannels" | "retentionTactics", item: string) => {
    setForm((p) => { const a = p[k]; return { ...p, [k]: a.includes(item) ? a.filter((x) => x !== item) : [...a, item] }; });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".csv") || f?.type === "text/csv") set("csvFile", f); }, [set]);
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) set("csvFile", f); }, [set]);

  const canNext = (): boolean => {
    switch (step) {
      case 0: return form.csvFile !== null && form.churnDefinition !== "";
      case 1: return form.businessModel !== "" && form.typicalCustomer !== "" && form.companyStage !== "" && form.revenueModel !== "" && form.pricingFlexibility.length > 0;
      case 2: return form.coreFeatures.trim() !== "" && form.canShipChanges !== "" && form.hasCompletionPoint !== "" && form.topChannels.length > 0 && form.topCompetitors.trim() !== "" && form.churnDestination !== "";
      case 3: return form.supportModel !== "" && form.retentionTactics.length > 0 && form.prioritySegment !== "" && form.topGoal !== "" && form.timeline !== "";
      case 4: return true;
      default: return false;
    }
  };

  const scroll0 = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const go = (t: number) => { setStep(t); scroll0(); };
  const next = () => { if (step < total - 1 && canNext()) { const n = step + 1; setStep(n); setMaxStep((p) => Math.max(p, n)); scroll0(); } };
  const prev = () => { if (step > 0) { setStep(step - 1); scroll0(); } };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    
    let resolvedCsvPath = form.csvFile?.name ?? "";
    
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    
    try {
      // 1. Upload file if a new File object is present
      if (form.csvFile) {
        const formData = new FormData();
        formData.append("file", form.csvFile);
        
        const uploadRes = await fetch(`${API_BASE}/upload`, {
          method: "POST",
          body: formData,
        });
        
        if (!uploadRes.ok) throw new Error("Failed to upload CSV file. Please make sure backend is running.");
        const uploadData = await uploadRes.json();
        resolvedCsvPath = uploadData.file_path;

        // Stash the raw CSV so "Rerun" on the results page can re-upload it.
        // The server temp file doesn't survive a restart / Render spin-down,
        // and the results page has no File object to re-send.
        try {
          const text = await form.csvFile.text();
          if (text.length < 4_000_000) {
            sessionStorage.setItem("latest_csv_text", text);
            sessionStorage.setItem("latest_csv_name", form.csvFile.name);
          } else {
            sessionStorage.removeItem("latest_csv_text");
            sessionStorage.removeItem("latest_csv_name");
          }
        } catch { /* text read failed — rerun falls back to the stale path */ }
      }
      
      const payload = {
        raw_csv_path: resolvedCsvPath,
        questionnaire: {
          business_context: form.businessContext, industry: "", size: "",
          business_model: form.businessModel, company_stage: form.companyStage,
          revenue_model: form.revenueModel, time_range: "",
          product_lines: form.coreFeatures.split(",").map((s) => s.trim()).filter(Boolean),
          market_segment: form.typicalCustomer, budget: "",
          legal_constraints: form.pricingFlexibility.includes("None — pricing is locked") ? ["Pricing locked"] : [],
          churn_definition: form.churnDefinition === "Other" ? form.churnDefinitionOther : form.churnDefinition === "Inactivity" ? `Inactivity (${form.churnInactivityDays} days)` : form.churnDefinition,
          competitors: form.topCompetitors.split(",").map((s) => s.trim()).filter(Boolean),
          top_channels: form.topChannels, support_model: form.supportModel,
          goal: form.topGoal, target_churn_rate: null,
          priority_segment: form.prioritySegment === "Specific tier or plan" ? form.prioritySegmentOther : form.prioritySegment,
          edge_cases: form.anythingElse ? [form.anythingElse] : [],
          pricing_flexibility: form.pricingFlexibility, can_ship_changes: form.canShipChanges,
          has_completion_point: form.hasCompletionPoint, churn_destination: form.churnDestination,
          retention_tactics: form.retentionTactics, timeline: form.timeline,
          typical_customer: form.typicalCustomer,
          analysis_depth: form.analysisDepth || "quick",
        },
      };

      sessionStorage.setItem("latest_form_payload", JSON.stringify(payload));
      sessionStorage.setItem("latest_form_state", JSON.stringify(form));
      
      const res = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to start analysis pipeline.");
      
      const data = await res.json();
      toast.success("Analysis started successfully!");
      router.push(`/results/${data.job_id}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to submit questionnaire.");
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  /* ── step renderers ──────────────────────────────────────────── */

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <PhaseTag phase="Phase 1" label="About & Data" />

            <QuestionTitle required={false}>Tell us about your business</QuestionTitle>
            <Hint>In a few sentences, describe your business and your biggest retention challenge. What do you sell? Who do you sell to? Why do you think customers are leaving?</Hint>
            <Textarea id="q1-ctx" value={form.businessContext} onChange={(e) => set("businessContext", e.target.value)}
              placeholder="e.g. We're a B2B SaaS platform for customer support. 500+ companies, $2K–$15K MRR. Seeing 40% churn spike at month 6…"
              className={`${INPUT_CLS} min-h-[140px] resize-none leading-[1.7]`} />
            <p className="text-[12px] text-[#52525b] mt-2">3–5 sentences suggested</p>

            <Divider />

            <QuestionTitle>Upload your customer data</QuestionTitle>
            <Hint>Upload a CSV file with your customer data. We&apos;ll auto-detect the schema and churn column.</Hint>
            <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileRef.current?.click()}
              className={`relative rounded-lg border border-dashed cursor-pointer transition-all duration-200 group ${form.csvFile ? "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)]" : "border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.02)]"}`}>
              <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" id="csv-upload" />
              {form.csvFile ? (
                <div className="flex items-center gap-3 px-5 py-5">
                  <FileSpreadsheet className="w-5 h-5 text-[#a1a1aa] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[#fafafa] truncate">{form.csvFile.name}</p>
                    <p className="text-[12px] text-[#52525b] mt-0.5">{(form.csvFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); set("csvFile", null); }} className="p-1.5 rounded-md hover:bg-[rgba(255,255,255,0.06)] transition-colors"><X className="w-4 h-4 text-[#71717a]" /></button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-2.5">
                  <Upload className="w-5 h-5 text-[#52525b] group-hover:text-[#71717a] transition-colors" />
                  <p className="text-[14px] text-[#71717a]">Drop CSV here or <span className="text-[#fafafa] underline underline-offset-2 decoration-[rgba(255,255,255,0.2)]">browse</span></p>
                  <p className="text-[12px] text-[#52525b]">.csv files only</p>
                </div>
              )}
            </div>
            {form.csvFile && (
              <div className="mt-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center gap-2.5 mb-4"><span className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa]" /><p className="text-[14px] text-[#a1a1aa]">We detected a churn column. What does it represent?</p></div>
                <div className="flex flex-col gap-1">
                  {["Cancelled paid subscription", "Downgraded to free / lower tier", "Inactivity", "Contract not renewed", "Failed payment (involuntary)", "Other"].map((o) => (
                    <RadioOption key={o} value={o} label={o} selected={form.churnDefinition === o} onSelect={(v) => set("churnDefinition", v)} />
                  ))}
                </div>
                {form.churnDefinition === "Inactivity" && <div className="mt-3 pl-10 animate-in fade-in duration-200"><Input value={form.churnInactivityDays} onChange={(e) => set("churnInactivityDays", e.target.value)} placeholder="Number of days (e.g. 30)" className={`${INPUT_CLS} h-9 w-48`} /></div>}
                {form.churnDefinition === "Other" && <div className="mt-3 pl-10 animate-in fade-in duration-200"><Input value={form.churnDefinitionOther} onChange={(e) => set("churnDefinitionOther", e.target.value)} placeholder="Describe your churn definition…" className={`${INPUT_CLS} h-9`} /></div>}
              </div>
            )}
            <ContinueBtn onClick={next} disabled={!canNext()} />
          </div>
        );

      case 1:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <PhaseTag phase="Phase 2" label="Business & Revenue" />
            <QuestionTitle>Business Type, Customer & Stage</QuestionTitle>
            <Hint>Determines which retention playbook, benchmarks, and diagnostic paths we use.</Hint>
            <SectionLabel>Business model</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["B2B SaaS","B2C SaaS","E-commerce / Subscription","Marketplace","Fintech","Media/Content","Other"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.businessModel===o} onSelect={(v)=>set("businessModel",v)} />)}</div>
            <SectionLabel>Typical customer</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Enterprise","Mid-market","SMB","Individual consumer","Prosumer"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.typicalCustomer===o} onSelect={(v)=>set("typicalCustomer",v)} />)}</div>
            <SectionLabel>Company stage</SectionLabel>
            <div className="flex flex-col gap-1">{[{value:"Pre-PMF",sub:"Under ~500 customers, still finding fit"},{value:"Growth",sub:"PMF reached, scaling acquisition"},{value:"Mature",sub:"Established, focused on efficiency and expansion"}].map((o) => <RadioOption key={o.value} value={o.value} label={o.value} sublabel={o.sub} selected={form.companyStage===o.value} onSelect={(v)=>set("companyStage",v)} />)}</div>
            <Divider />
            <QuestionTitle>Revenue Model & Pricing Flexibility</QuestionTitle>
            <Hint>The single most important constraint filter. Determines whether pricing-based interventions are viable.</Hint>
            <SectionLabel>Revenue model</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Monthly subscription","Annual subscription","Usage-based","Freemium","One-time + renewals","Transactional"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.revenueModel===o} onSelect={(v)=>set("revenueModel",v)} />)}</div>
            <SectionLabel>Pricing flexibility — select all that apply</SectionLabel>
            <div className="flex flex-col gap-1">{["Can adjust base price","Can offer discounts or promotions","Can restructure plans or tiers","Can extend free trials","None — pricing is locked"].map((o) => <CheckOption key={o} label={o} checked={form.pricingFlexibility.includes(o)} onToggle={() => toggle("pricingFlexibility",o)} />)}</div>
            <ContinueBtn onClick={next} disabled={!canNext()} />
          </div>
        );

      case 2:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <PhaseTag phase="Phase 3" label="Product & Market" />
            <QuestionTitle>Product — Features & Flexibility</QuestionTitle>
            <Hint>Features ground every downstream analysis. Without them, the agent reasons in a vacuum.</Hint>
            <SectionLabel>Core features — top 3–5 things customers use most</SectionLabel>
            <Input id="q4-feat" value={form.coreFeatures} onChange={(e)=>set("coreFeatures",e.target.value)} placeholder="e.g. Invoice creation, recurring billing, Stripe integration" className={`${INPUT_CLS} h-9 mb-6`} />
            <SectionLabel>Can you ship product changes in the next 90 days?</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Yes","No"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.canShipChanges===o} onSelect={(v)=>set("canShipChanges",v)} />)}</div>
            <SectionLabel>Does your product have a natural completion point?</SectionLabel>
            <p className="text-[13px] text-[#52525b] mb-3 -mt-1">e.g. tax software, wedding planning, project-based tools</p>
            <div className="flex flex-col gap-1">{["Yes","No","Partially"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.hasCompletionPoint===o} onSelect={(v)=>set("hasCompletionPoint",v)} />)}</div>
            <Divider />
            <QuestionTitle>Acquisition & Competition</QuestionTitle>
            <Hint>Acquisition channel quality is a major hidden churn driver — paid customers churn 2–3× more than organic.</Hint>
            <SectionLabel>Top acquisition channels — pick up to 2</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Organic search / SEO","Paid ads","Outbound sales","Referrals / word of mouth","Content / community","Partnerships / integrations","Product-led (free → paid)"].map((o) => <CheckOption key={o} label={o} checked={form.topChannels.includes(o)} disabled={form.topChannels.length>=2} onToggle={()=>{if(!form.topChannels.includes(o)&&form.topChannels.length>=2)return;toggle("topChannels",o);}} />)}</div>
            <SectionLabel>Top competitors</SectionLabel>
            <Input id="q5-comp" value={form.topCompetitors} onChange={(e)=>set("topCompetitors",e.target.value)} placeholder='1–3 names, comma-separated (or "not sure")' className={`${INPUT_CLS} h-9 mb-6`} />
            <SectionLabel>When customers cancel, where do they go?</SectionLabel>
            <div className="flex flex-col gap-1">{["To a competitor","Build something in-house","Stop using this category","Downgrade to free alternative","We don't know"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.churnDestination===o} onSelect={(v)=>set("churnDestination",v)} />)}</div>
            <ContinueBtn onClick={next} disabled={!canNext()} />
          </div>
        );

      case 3:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <PhaseTag phase="Phase 4" label="Operations & Goals" />
            <QuestionTitle>Operational Capacity & Current Efforts</QuestionTitle>
            <Hint>Eliminates unrealistic recommendations and prevents suggesting things you&apos;ve already tried.</Hint>
            <SectionLabel>Support model</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Self-serve only","Email support","Email + chat","Dedicated CSMs for key accounts","Full-service"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.supportModel===o} onSelect={(v)=>set("supportModel",v)} />)}</div>
            <SectionLabel>Retention tactics already in place — select all</SectionLabel>
            <div className="flex flex-col gap-1">{["Onboarding flow / tutorials","Health scoring / at-risk alerts","Proactive outreach to at-risk users","Win-back campaigns","Loyalty / discount programs","Customer success / account management","NPS / feedback collection","None of the above"].map((o) => <CheckOption key={o} label={o} checked={form.retentionTactics.includes(o)} onToggle={()=>toggle("retentionTactics",o)} />)}</div>
            <Divider />
            <QuestionTitle>Priority, Goal & Timeline</QuestionTitle>
            <Hint>Determines which metric to optimize, which segment to target, and whether to suggest tactical or structural changes.</Hint>
            <SectionLabel>Which customer segment matters most?</SectionLabel>
            <div className="flex flex-col gap-1 mb-1">{["All customers equally","High-value / enterprise accounts","Newest customers (first 90 days)","Long-tenured customers showing decline","Specific tier or plan"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.prioritySegment===o} onSelect={(v)=>set("prioritySegment",v)} />)}</div>
            {form.prioritySegment==="Specific tier or plan" && <div className="mb-6 pl-10 animate-in fade-in duration-200"><Input value={form.prioritySegmentOther} onChange={(e)=>set("prioritySegmentOther",e.target.value)} placeholder="Which tier or plan?" className={`${INPUT_CLS} h-9`} /></div>}
            {form.prioritySegment!=="Specific tier or plan" && <div className="mb-6" />}
            <SectionLabel>Top goal</SectionLabel>
            <div className="flex flex-col gap-1 mb-6">{["Reduce churn rate","Increase LTV / expansion","Retain a specific segment","Recover churned customers","Improve NPS / satisfaction"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.topGoal===o} onSelect={(v)=>set("topGoal",v)} />)}</div>
            <SectionLabel>Timeline</SectionLabel>
            <div className="flex flex-col gap-1">{["Quick wins (30 days)","90-day plan","6-month strategic shift","Long-term (12+ months)"].map((o) => <RadioOption key={o} value={o} label={o} selected={form.timeline===o} onSelect={(v)=>set("timeline",v)} />)}</div>
            <ContinueBtn onClick={next} disabled={!canNext()} />
          </div>
        );

      case 4:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <PhaseTag phase="Final" label="Anything else?" />
            <QuestionTitle required={false}>Anything else we should know?</QuestionTitle>
            <Hint>Constraints, past failures, internal debates, upcoming changes, or anything unique. The 30% who fill this provide the most decisive context.</Hint>
            <Textarea id="q8-extra" value={form.anythingElse} onChange={(e) => set("anythingElse", e.target.value)}
              placeholder="e.g. Win-back campaign failed — 12% ROI, $8K cost. CEO wants upsell focus. AI feature launching in 4 months…"
              className={`${INPUT_CLS} min-h-[140px] resize-none leading-[1.7]`} />
            <Divider />
            <QuestionTitle>How deep should the analysis go?</QuestionTitle>
            <Hint>Quick uses the fastest models end-to-end. Deep runs multi-pass reasoning on heavier models — better causes and a richer playbook, but slower.</Hint>
            <div className="flex flex-col gap-1 mb-6">
              <RadioOption value="quick" label="Quick scan" sublabel="~2–4 min · fastest models, single-pass diagnosis"
                selected={form.analysisDepth === "quick"} onSelect={(v) => set("analysisDepth", v)} />
              <RadioOption value="deep" label="Deep analysis" sublabel="~10–20 min · multi-pass reasoning, maximum depth"
                selected={form.analysisDepth === "deep"} onSelect={(v) => set("analysisDepth", v)} />
            </div>
            <SubmitBtn onClick={submit} submitting={submitting} />
          </div>
        );

      default: return null;
    }
  };

  /* ── layout ──────────────────────────────────────────────────── */
  return (
    <div className="relative flex-1 flex flex-col min-h-screen bg-[#09090b]">
      {/* ── fixed top progress bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-[rgba(255,255,255,0.04)]">
        <div
          className="h-full bg-[#fafafa] transition-all duration-700 ease-out"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>

      {/* ── sticky header ── */}
      <header className="sticky top-0 z-40 bg-[#09090b]/80 backdrop-blur-xl">
        {/* spacer below progress bar */}
        <div className="h-[3px]" />

        {/* logo bar */}
        <div className="max-w-7xl mx-auto w-full px-6 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-[22px] h-[22px] rounded-[5px] bg-[#fafafa] flex items-center justify-center">
              <span className="text-[11px] font-bold text-[#09090b] leading-none" style={{ fontFamily: "var(--font-raleway)" }}>R</span>
            </div>
            <span className="text-[15px] font-semibold text-[#fafafa] tracking-[-0.01em] group-hover:opacity-70 transition-opacity" style={{ fontFamily: "var(--font-raleway)" }}>
              Retain AI
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {step > 0 && (
              <button type="button" onClick={prev} className="flex items-center gap-1 text-[13px] text-[#52525b] hover:text-[#a1a1aa] transition-colors cursor-pointer">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <span className="text-[12px] text-[#3f3f46] tabular-nums">{step + 1} of {total}</span>
          </div>
        </div>

        {/* step breadcrumb — own row, centered with form */}
        <div className="flex justify-center px-6">
          <nav className="w-full max-w-[620px] flex items-center gap-1 pb-4 pt-1">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <button type="button" onClick={() => { if (i <= maxStep) go(i); }}
                  className={`text-[13px] whitespace-nowrap transition-colors duration-200
                    ${i === step ? "text-[#fafafa] font-medium" : i <= maxStep ? "text-[#71717a] hover:text-[#a1a1aa] cursor-pointer" : "text-[#27272a] cursor-default"}`}>
                  {label}
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-[#27272a] flex-shrink-0 mx-0.5" />}
              </React.Fragment>
            ))}
          </nav>
        </div>

        {/* bottom border */}
        <div className="h-px bg-[rgba(255,255,255,0.06)]" />
      </header>

      {/* ── form body ─── centered ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-20 flex justify-center">
          <div className="w-full max-w-[620px]">
            {renderStep()}
          </div>
        </div>
      </main>
    </div>
  );
}
