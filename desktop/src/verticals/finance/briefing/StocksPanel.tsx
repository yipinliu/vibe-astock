/** 简报个股提及:机构事实 + 确定性技术读数;没有产品自己的评级 / 置信度 / 推荐。 */
import { AlertTriangle, Target } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { StockKlineHover } from "@/components/StockKlineHover";
import { cn } from "@/lib/utils";
import { techLine, type BriefingStocks } from "@/lib/briefing";

const TYPE_TONE: Record<string, string> = {
  深度分析: "border-primary/40 bg-primary/10 text-primary",
  简要点名: "border-border bg-muted/30 text-muted-foreground",
  行业举例: "border-border bg-muted/30 text-muted-foreground",
  风险提示: "border-warning/40 bg-warning/10 text-warning",
};

export function StocksPanel({ stocks }: { stocks: BriefingStocks | null }) {
  if (!stocks) {
    return (
      <GlassCard className="p-8 text-center">
        <Target className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">还没生成个股提及。点「生成 AI 解读」时会把主题和个股一起提取,再用确定性行情补技术读数。</p>
      </GlassCard>
    );
  }
  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">个股提及</h3>
        <span className="text-[11px] text-muted-foreground">{stocks.ai || "当前 AI"} · {stocks.stocks.length} 只 · 只列机构提到的事实,不是推荐</span>
      </div>
      {stocks.warnings.length > 0 && (
        <div role="status" className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />个股提取有缺口</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {stocks.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {stocks.stocks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">这批简报里没有可核对的个股提及。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-border/50">
                {["个股", "提及", "机构", "机构理由 / 估值原文", "技术读数"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.stocks.map((s, i) => {
                const aShare = /^\d{6}$/.test(s.stock_code);
                return (
                  <tr key={`${s.stock_name}-${s.stock_code}-${i}`} className="border-b border-border/30 align-top last:border-0">
                    <td className="whitespace-nowrap px-2 py-2">
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        {aShare
                          ? <StockKlineHover symbol={s.stock_code} name={s.stock_name} className="font-medium">{s.stock_name}</StockKlineHover>
                          : <span className="font-medium">{s.stock_name}</span>}
                        <span className="font-mono text-[10px] text-muted-foreground">{s.stock_code || "代码未识别"}</span>
                      </div>
                      <span className={cn("mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[10px]", TYPE_TONE[s.mention_type] ?? TYPE_TONE.简要点名)}>{s.mention_type}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{s.topic_ids.length} 篇</td>
                    <td className="max-w-40 px-2 py-2 text-[11px] text-muted-foreground">{s.institutions.join("、") || "—"}</td>
                    <td className="max-w-72 px-2 py-2">
                      <div className="leading-relaxed">{s.thesis || "—"}</div>
                      {s.metrics && <div className="mt-0.5 text-[10px] text-muted-foreground">估值 / 业绩原文:{s.metrics}</div>}
                    </td>
                    <td className={cn("max-w-60 px-2 py-2 text-[11px] leading-relaxed", s.tech ? "text-muted-foreground" : "text-warning")}>
                      {techLine(s)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        机构理由和估值文字来自简报原文;技术读数由本机按公开日线确定性计算。页面不生成产品自己的评级、置信度或推荐。
      </p>
    </GlassCard>
  );
}
