/** 右侧题材详情:规则阶段、AI 解读、统计、核心个股、事件与简报信号。 */
import { type ReactNode } from "react";
import { AlertTriangle, GitBranch, Loader2, Pencil, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { StockKlineHover } from "@/components/StockKlineHover";
import { cn } from "@/lib/utils";
import {
  fmtPct, fmtSeal, stageTone, type ThemeRow, type ThemeTimeline,
} from "@/lib/themeEvolution";
import { ThemeTimelineStrip } from "./Timeline";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/50 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[12px] font-semibold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

export function ThemeDetail({ theme, timeline, relations, busyNarrate, onNarrate, onEdit }: {
  theme: ThemeRow | null; timeline: ThemeTimeline | null;
  relations: { from: string; to: string; type: string; manual: boolean }[];
  busyNarrate: boolean; onNarrate: () => void; onEdit: () => void;
}) {
  if (!theme) {
    return (
      <GlassCard className="flex min-h-60 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        从左边选一个题材看详情。
      </GlassCard>
    );
  }
  const s = theme.stats;
  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-base font-semibold">{theme.name}</h3>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", stageTone(theme.stage))}>{theme.stage}</span>
          <span className="text-[11px] text-muted-foreground">规则理由:{theme.stage_reason}</span>
          <button type="button" onClick={onEdit}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" /> 编辑层级
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {theme.source_tags.map((t) => <span key={t} className="rounded border border-border/50 px-1.5 py-0.5">来源:{t}</span>)}
          {theme.aliases.map((a) => <span key={a} className="rounded border border-border/50 px-1.5 py-0.5">别名:{a}</span>)}
          {theme.manual && <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">人工</span>}
          {!theme.confirmed && <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning">候选</span>}
          {theme.briefing_mentions > 0 && <span className="rounded border border-border/50 px-1.5 py-0.5">简报提及 {theme.briefing_mentions}</span>}
        </div>

        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <b className="text-[12px]">AI 解读</b>
            <span className="text-[10px] text-muted-foreground">只写解读;阶段和数字由程序判定{theme.ai ? ` · ${theme.ai}` : ""}</span>
            <button type="button" onClick={onNarrate} disabled={busyNarrate}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-50">
              {busyNarrate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {busyNarrate ? "生成中…" : theme.narrative ? "重新生成" : "生成 AI 解读"}
            </button>
          </div>
          {theme.narrative
            ? <p className="text-[12px] leading-relaxed">{theme.narrative}</p>
            : <p className="text-[11px] text-muted-foreground">还没生成 AI 解读。它只基于这份快照里已经算好的事实写,不会改阶段。</p>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="涨停" value={String(s.limit_up)} hint={`首板 ${s.first_boards} / 连板 ${s.consec_boards}`} />
          <Stat label="最高板" value={`${s.highest} 板`} hint={`首封 ${fmtSeal(s.first_seal)}`} />
          <Stat label="炸板" value={`${s.broken} 只`} hint={`炸板率 ${fmtPct(s.broken_rate)}`} />
          <Stat label="跌停" value={`${s.limit_down} 只`} />
          <Stat label="昨日延续率" value={fmtPct(s.continuation_rate)} />
          <Stat label="盘面状态" value={s.state || "—"} />
          <Stat label="核心个股" value={`${theme.core_stocks.length} 只`} />
          <Stat label="简报提及" value={String(theme.briefing_mentions)} />
        </div>
        {theme.fund_flow && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            行业资金:{theme.fund_flow.board} 主力净流入 {theme.fund_flow.net_today_yi == null ? "缺" : `${theme.fund_flow.net_today_yi.toFixed(2)} 亿`}
            {theme.fund_flow.net_pct == null ? "" : `(净占比 ${theme.fund_flow.net_pct.toFixed(2)}%)`}
          </p>
        )}
      </GlassCard>

      <GlassCard className="space-y-4 p-4">
        <Block title="核心个股(事实标签,不是推荐)">
          {theme.core_stocks.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] text-muted-foreground">
                  <tr className="border-b border-border/40">
                    <th className="px-2 py-1 text-left font-medium">个股</th>
                    <th className="px-2 py-1 text-left font-medium">角色</th>
                    <th className="px-2 py-1 text-right font-medium">板位</th>
                    <th className="px-2 py-1 text-right font-medium">收盘 / 涨跌</th>
                    <th className="px-2 py-1 text-left font-medium">简报理由</th>
                  </tr>
                </thead>
                <tbody>
                  {theme.core_stocks.map((c) => (
                    <tr key={`${c.code}-${c.name}`} className="border-b border-border/25 align-top last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {/^\d{6}$/.test(c.code)
                          ? <StockKlineHover symbol={c.code} name={c.name} className="font-medium">{c.name}</StockKlineHover>
                          : <span className="font-medium">{c.name}</span>}
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">{c.code || "无代码"}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">{c.roles.join("、") || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{c.boards ? `${c.boards} 板` : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
                        {c.close == null ? <span className="text-muted-foreground">没取到</span> : (
                          <>
                            {c.close.toFixed(2)}
                            {c.change_pct != null && (
                              <span className={cn("ml-1", c.change_pct > 0 ? "text-danger" : c.change_pct < 0 ? "text-success" : "text-muted-foreground")}>
                                {c.change_pct > 0 ? "+" : ""}{c.change_pct.toFixed(2)}%
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="max-w-64 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">{c.thesis || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-[11px] text-muted-foreground">这一天没有可核对的成员。</p>}
        </Block>

        <Block title="当天时间线">
          <ThemeTimelineStrip timeline={timeline} />
        </Block>
      </GlassCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <GlassCard className="p-4">
          <Block title="事件与信号">
            {theme.events.length === 0 && theme.signals.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">没有可核对的事件。</p>
            ) : (
              <ul className="space-y-1.5 text-[11px] leading-relaxed">
                {theme.events.map((e, i) => (
                  <li key={`e${i}`} className="flex gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground">{e.time}</span>
                    <span className="shrink-0 rounded border border-border/50 px-1 text-[10px] text-muted-foreground">{e.source}</span>
                    <span className="min-w-0 flex-1">{e.text}</span>
                  </li>
                ))}
                {theme.signals.map((s, i) => (
                  <li key={`s${i}`} className="flex gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground">简报</span>
                    <span className="shrink-0 rounded border border-border/50 px-1 text-[10px] text-muted-foreground">{s.type || "信号"}</span>
                    <span className="min-w-0 flex-1">{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </GlassCard>

        <GlassCard className="p-4">
          <Block title="共识 / 分歧 / 风险(来自简报分析)">
            {[theme.consensus, theme.contrarian, theme.risks].every((x) => !x.length) ? (
              <p className="text-[11px] text-muted-foreground">简报分析还没生成,或没有提到这个题材的条目。</p>
            ) : (
              <div className="space-y-2 text-[11px] leading-relaxed">
                {theme.consensus.length > 0 && <div><b className="text-[11px]">共识</b><ul className="mt-0.5 list-disc pl-4 text-muted-foreground">{theme.consensus.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                {theme.contrarian.length > 0 && <div><b className="text-[11px]">分歧</b><ul className="mt-0.5 list-disc pl-4 text-muted-foreground">{theme.contrarian.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
                {theme.risks.length > 0 && <div><b className="text-[11px]">风险</b><ul className="mt-0.5 list-disc pl-4 text-muted-foreground">{theme.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
              </div>
            )}
          </Block>
        </GlassCard>
      </div>

      {relations.length > 0 && (
        <GlassCard className="p-4">
          <Block title="与其它题材的关系">
            <ul className="flex flex-wrap gap-1.5 text-[11px]">
              {relations.map((r, i) => (
                <li key={i} className="inline-flex items-center gap-1 rounded border border-border/50 px-2 py-0.5">
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {r.from} → {r.to}
                  <span className="text-muted-foreground">({r.type}{r.manual ? " · 人工" : ""})</span>
                </li>
              ))}
            </ul>
          </Block>
        </GlassCard>
      )}

      {theme.issues.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />这个题材有缺口</div>
          <ul className="mt-1 list-disc pl-5">{theme.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        阶段由确定性规则按涨停数 / 首板 / 最高板 / 炸板率 / 延续率 / 简报提及判定,是对已经发生的盘面的归类,不是预测或推荐。
      </p>
    </div>
  );
}
