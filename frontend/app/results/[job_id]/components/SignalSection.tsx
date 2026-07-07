import { cn } from "@/lib/utils";
import type { Ctx, RiskData } from "../types";
import { Chip, Insight, Section, Stat } from "./primitives";

export function SignalSection({ data, visible }: { data: RiskData; ctx: Ctx; visible: boolean }) {
  const fs = data.feature_store;
  const ltvMean = fs?.ltv_estimates?.mean_ltv ?? fs?.ltv_estimates?.mean;
  const ltvMed = fs?.ltv_estimates?.median_ltv ?? fs?.ltv_estimates?.median;
  const detectedCols = data.input_context?.detected_columns;
  const colCount = Array.isArray(detectedCols) ? detectedCols.length : detectedCols ? Object.values(detectedCols).filter(Boolean).length : 0;
  return (
    <Section
      tone="amber"
      title="Signal"
      meta={`${data.total_active.toLocaleString()} active users · risk model ${data.confidence}% conf.`}
      visible={visible}
    >
      <div className={cn("grid gap-3", fs ? "grid-cols-5" : "grid-cols-3")}>
        <Stat label="High risk users" tone="amber" value={data.high_risk_count.toLocaleString()} sub={`of ${data.total_active.toLocaleString()} active`} />
        <Stat label="At risk" tone="amber" value={`${data.risk_pct.toFixed(1)}%`} sub="of user base" />
        <Stat label="Confidence" value={`${data.confidence}%`} sub="concordance index" />
        {ltvMean != null && (
          <Stat
            label="Mean LTV"
            value={`$${Math.round(ltvMean).toLocaleString()}`}
            sub={ltvMed != null ? `median $${Math.round(ltvMed).toLocaleString()}` : undefined}
          />
        )}
        {fs?.velocity_metrics?.avg_logins_per_month != null && (
          <Stat
            label="Avg logins / mo"
            tone="blue"
            value={fs.velocity_metrics.avg_logins_per_month}
            sub={fs.velocity_metrics.drop_off_at_day != null ? `drop-off day ${fs.velocity_metrics.drop_off_at_day}` : undefined}
          />
        )}
      </div>
      <Insight>{data.insight}</Insight>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.data_quality_score != null && <Chip tone="zinc">data quality {Math.round(data.data_quality_score * 100)}%</Chip>}
        {colCount > 0 && <Chip tone="zinc">{colCount} columns detected</Chip>}
        {data.input_context?.industry && <Chip tone="zinc">industry · {data.input_context.industry}</Chip>}
        {data.input_context?.stage && <Chip tone="zinc">stage · {data.input_context.stage}</Chip>}
      </div>
    </Section>
  );
}
