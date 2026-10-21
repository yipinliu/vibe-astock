/** 简报 AI 解读面板:主题 / 共识 / 分歧 / 信号 / 风险。只显示已核对过的条目。 */
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { fmtBriefingTime, type BriefingAnalysis } from "@/lib/briefing";

const TYPE_TONE: Record<string, string> = {
  政策: "border-warning/40 bg-warning/10 text-warning",
  业绩: "border-success/40 bg-success/10 text-success",
  事件: "border-primary/40 bg-primary/10 text-primary",
  资金: "border-danger/40 bg-danger/10 text-danger",
  行业: "border-border bg-muted/30 text-muted-foreground",
  宏观: "border-border bg-muted/30 text-muted-foreground",
  其他: "border-border bg-muted/30 text-muted-foreground",
};

function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <h4 className="mb-2 flex items-baseline gap-1.5 text-[12px] font-semibold text-foreground">
      {children}
      {count != null && <span className="text-[10px] font-normal text-muted-foreground">{count}</span>}
    </h4>
  );
}

export function AnalysisPanel({ analysis, stale, busy, onAnalyze, onPickTopic }: {
  analysis: BriefingAnalysis | null; stale: boolean; busy: boolean;
  onAnalyze: () => void; onPickTopic: (id: string) => void;
}) {
  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AI 解读</h3>
        {analysis && <span className="text-[11px] text-muted-foreground">{analysis.ai || "当前 AI"} · {fmtBriefingTime(analysis.generated_at)}</span>}
        {analysis && (
          <button type="button" onClick={onAnalyze} disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {busy ? "正在生成…" : "重新生成"}
          </button>
        )}
      </div>

      {!analysis ? (
        <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">还没生成 AI 解读。它会先同步简报,再把选中范围的正文交给你在「接入 AI」里选的大脑。</p>
          <button type="button" onClick={onAnalyze} disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? "正在生成…" : "生成 AI 解读"}
          </button>
          <p className="mt-2 text-[10px] text-muted-foreground">需要先在「接入 AI」接上大脑;没接上不会白跑。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stale && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              简报在分析之后又同步过,这份解读是旧的;建议重新生成。
            </p>
          )}
          {analysis.warnings.length > 0 && (
            <div role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />有 {analysis.warnings.length} 条 AI 输出没通过核对,已剔除</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {analysis.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <section>
            <SectionTitle count={analysis.themes.length}>主题</SectionTitle>
            <div className="grid gap-2 md:grid-cols-2">
              {analysis.themes.map((t) => (
                <div key={t.name} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <b className="text-[13px]">{t.name}</b>
                    <span className="text-[11px] text-muted-foreground">{t.mentions} 篇</span>
                    {t.institutions.length > 0 && <span className="text-[10px] text-primary">{t.institutions.slice(0, 3).join("、")}</span>}
                    {t.topic_ids[0] && (
                      <button type="button" onClick={() => onPickTopic(t.topic_ids[0]!)} className="ml-auto text-[10px] text-primary/80 underline-offset-2 hover:underline">
                        看原文
                      </button>
                    )}
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                    {t.key_points.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <section>
              <SectionTitle count={analysis.consensus.length}>共识</SectionTitle>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                {analysis.consensus.length ? analysis.consensus.map((x, i) => <li key={i}>· {x}</li>) : <li>没有可核对的共识条目</li>}
              </ul>
            </section>
            <section>
              <SectionTitle count={analysis.contrarian.length}>分歧 / 反向</SectionTitle>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                {analysis.contrarian.length ? analysis.contrarian.map((x, i) => <li key={i}>· {x}</li>) : <li>没有可核对的分歧条目</li>}
              </ul>
            </section>
            <section>
              <SectionTitle count={analysis.risks.length}>风险</SectionTitle>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                {analysis.risks.length ? analysis.risks.map((x, i) => <li key={i}>· {x}</li>) : <li>没有可核对的风险条目</li>}
              </ul>
            </section>
          </div>

          {analysis.signals.length > 0 && (
            <section>
              <SectionTitle count={analysis.signals.length}>信号</SectionTitle>
              <div className="space-y-1.5">
                {analysis.signals.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px]">
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", TYPE_TONE[s.type] ?? TYPE_TONE.其他)}>{s.type}</span>
                    <span className="min-w-0 flex-1 leading-relaxed">{s.text}</span>
                    {s.institutions.length > 0 && <span className="text-[10px] text-muted-foreground">{s.institutions.slice(0, 3).join("、")}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            AI 解读只做摘要;每条都已按资料 id、机构、数字和「不荐股」红线核对过。以原文为准,不构成投资建议。
          </p>
        </div>
      )}
    </GlassCard>
  );
}
