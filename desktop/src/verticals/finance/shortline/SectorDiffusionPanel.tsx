/**
 * 板块涨停扩散度:东财行业今天 vs 昨天 vs 3 天前的涨停家数与趋势。
 * 行业不是题材串;某一天取数失败时该天写「—」、趋势 unknown,不写成 0。
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section } from "./FactsPanels";
import { safeArray } from "./format";
import type { SectorDiffusionResult, SectorDiffusionRow, SectorTrend } from "./types";

const TREND_STYLE: Record<SectorTrend, { text: string; badge: string; label: string }> = {
  "扩散中": { text: "text-danger", badge: "border-danger/40 bg-danger/10", label: "扩散中" },
  "退潮中": { text: "text-success", badge: "border-success/40 bg-success/10", label: "退潮中" },
  "收缩": { text: "text-warning", badge: "border-warning/40 bg-warning/10", label: "收缩" },
  "稳定": { text: "text-muted-foreground", badge: "border-border/60 bg-muted/20", label: "稳定" },
  unknown: { text: "text-muted-foreground", badge: "border-dashed border-border/60", label: "缺数" },
};

function TrendBadge({ t }: { t: SectorTrend }) {
  const s = TREND_STYLE[t] ?? TREND_STYLE.unknown;
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", s.text, s.badge)}>{s.label}</span>;
}

function Count({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return <span className={v > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}>{v}</span>;
}

export function SectorDiffusionPanel({ r }: { r: SectorDiffusionResult }) {
  const [missingOpen, setMissingOpen] = useState(false);
  const sectors = safeArray<SectorDiffusionRow>(r.sectors);
  const missing = safeArray<{ date: string; reason: string }>(r.missing_days);
  const newSectors = safeArray<string>(r.new_sectors);

  return (
    <Section
      icon={Layers3}
      title="板块扩散"
      hint="同一行业今天、昨天、3 天前各有多少只涨停。今天同时高于前两天 = 在扩散;同时不高于 = 在退潮。行业是东财分类,不是涨停原因题材。"
      available={r.available}
      reason={r.reason}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
        <span>今天有涨停的行业 <b className="text-foreground">{r.sector_count}</b> 个</span>
        <span className="text-danger">扩散中 <b>{r.diffusing_count}</b></span>
        <span className="text-success">退潮中 <b>{r.fading_count}</b></span>
        <span className="text-muted-foreground">对比 {r.prev_date} / {r.d3_date}</span>
      </div>

      {newSectors.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">新出现:</span>
          {newSectors.map((s) => <span key={s} className="rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-medium text-danger">{s}</span>)}
        </div>
      )}

      {missing.length > 0 && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            历史涨停池有 {missing.length} 天没取到;这些天的家数没有当成 0,相关趋势只能是缺数。
            <button type="button" onClick={() => setMissingOpen((v) => !v)} className="ml-auto inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
              看是哪几天 <ChevronDown className={cn("h-3 w-3 transition-transform", missingOpen && "rotate-180")} />
            </button>
          </div>
          {missingOpen && (
            <ul className="mt-1.5 space-y-0.5">
              {missing.slice(0, 30).map((m) => <li key={m.date}>{m.date}:{m.reason || "涨停池没取到"}</li>)}
              {missing.length > 30 && <li>其余 {missing.length - 30} 天略。</li>}
            </ul>
          )}
        </div>
      )}

      {sectors.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {r.empty ? "这一天的涨停池是空的(取数成功),没有可统计的行业。" : "没有可统计的行业。"}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-background/95 text-[11px] text-muted-foreground">
              <tr>{["行业", "今天", "昨天", "3 天前", "趋势"].map((h) => <th key={h} className="whitespace-nowrap px-1.5 py-1 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {sectors.map((x) => (
                <tr key={x.sector} className="border-t border-border/40">
                  <td className="px-1.5 py-1 font-semibold">{x.sector}</td>
                  <td className="px-1.5 py-1"><Count v={x.today} /></td>
                  <td className="px-1.5 py-1"><Count v={x.yesterday} /></td>
                  <td className="px-1.5 py-1"><Count v={x["3days_ago"]} /></td>
                  <td className="px-1.5 py-1"><TrendBadge t={x.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        口径:行业按东财所属行业归组,不是涨停原因题材;昨天 / 3 天前按交易日历取。
        某天涨停池取数失败时该天写「—」、趋势标「缺数」,不拿 0 顶替;成功但池子为空才是 0。{r.note}
      </p>
    </Section>
  );
}
