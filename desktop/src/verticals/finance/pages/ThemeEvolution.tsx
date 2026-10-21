/**
 * 题材演进:近 7 天题材时间线 + 题材树 + 详情。阶段和所有数字由程序按规则算,AI 只写解读。
 * GET 只读本机日快照;构建 / 补齐 / 叙事 / 改层级都要用户点。
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, GitBranch, Loader2, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { GlassCard } from "@/components/ui/GlassCard";
import { backend } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
  relationLines, themeOf, timelineOf, type ThemeView,
} from "@/lib/themeEvolution";
import { ThemeOverview } from "../theme_evolution/Overview";
import { ThemeTree } from "../theme_evolution/Tree";
import { ThemeDetail } from "../theme_evolution/Detail";
import { ThemeEditor, type RegistryPayload } from "../theme_evolution/Editor";

type Busy = "build" | "narrate" | "backfill" | "registry" | null;

export function ThemeEvolution() {
  const [date, setDate] = useState("");
  const [view, setView] = useState<ThemeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editorError, setEditorError] = useState("");

  const apply = useCallback((v: ThemeView) => {
    setView(v);
    setSelectedId((prev) => {
      if (prev && (v.data?.themes.some((t) => t.theme_id === prev) || v.data?.nodes.some((n) => n.id === prev))) return prev;
      return v.data?.themes[0]?.theme_id ?? v.data?.nodes[0]?.id ?? null;
    });
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      apply(await backend.themeEvolution({ date: date || undefined }, signal));
      setError("");
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date, apply]);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<ThemeView>, after?: (v: ThemeView) => string) => {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      const v = await fn();
      apply(v);
      const reason = after?.(v);
      if (reason) setError(reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const forDate = date || view?.date || "";
  const build = () => run("build", () => backend.themeEvolutionBuild(forDate || view?.today || ""),
    (v) => (v.build && !v.build.ok ? `快照没生成:${v.build.reason || "原因不明"}` : ""));
  const narrate = () => run("narrate", () => backend.themeEvolutionNarrate(forDate));
  const backfill = () => run("backfill", () => backend.themeEvolutionBackfill({ date: forDate || undefined }));
  const saveRegistry = async (payload: RegistryPayload) => {
    if (busy) return;
    setBusy("registry");
    setEditorError("");
    try {
      apply(await backend.themeEvolutionRegistry({ ...payload, date: view?.date }));
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const data = view?.data ?? null;
  const theme = themeOf(data, selectedId);
  const timeline = timelineOf(data, selectedId);
  const relations = relationLines(data).filter((r) => r.from === theme?.name || r.to === theme?.name);
  const narrative = view?.narrative;
  const backfillOutcome = view?.backfill;

  return (
    <div>
      <PageHeader
        title="题材演进"
        subtitle="按规则归并题材、判阶段、看近 7 天怎么走 · AI 只写解读,阶段和数字由程序算"
        actions={
          <>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
              <span className="sr-only">看哪一天</span>
              <input type="date" aria-label="看哪一天" value={forDate} max={view?.today}
                onChange={(e) => { setDate(e.target.value); setSelectedId(null); }}
                className="bg-transparent text-foreground outline-none [color-scheme:dark]" />
            </label>
            {date && (
              <button type="button" onClick={() => { setDate(""); setSelectedId(null); }}
                className="rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                回到最新
              </button>
            )}
            <button type="button" onClick={backfill} disabled={!!busy || loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              {busy === "backfill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
              {busy === "backfill" ? "补齐中…" : "补齐近 7 天"}
            </button>
            <button type="button" onClick={narrate} disabled={!!busy || loading || !data}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              {busy === "narrate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy === "narrate" ? "生成中…" : "生成 AI 叙事"}
            </button>
            <button type="button" onClick={build} disabled={!!busy || loading || !forDate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
              {busy === "build" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy === "build" ? "构建中…" : "重新生成快照"}
            </button>
            <button type="button" onClick={() => void load()} disabled={loading || !!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
            </button>
          </>
        }
      />

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {narrative && (narrative.warnings.length > 0 || narrative.applied.length > 0) && (
        <div role="status" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />这次 AI 输出有 {narrative.warnings.length} 条没通过核对
            {narrative.applied.length > 0 && <span className="font-normal">· 层级提案已合并 {narrative.applied.length} 条</span>}
          </div>
          {narrative.warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{narrative.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {narrative.applied.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{narrative.applied.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
        </div>
      )}

      {backfillOutcome && (
        <div role="status" className="mb-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground">补齐结果</div>
          {backfillOutcome.gap && <p className="text-warning">{backfillOutcome.gap}</p>}
          <ul className="mt-1 space-y-0.5">
            {backfillOutcome.results.map((r) => (
              <li key={r.date} className={cn(r.ok ? "" : "text-warning")}>
                {r.date} · {r.ok ? (r.refreshed ? "已生成" : "已有快照,跳过") : `没生成:${r.reason || "原因不明"}`}
                {r.partial ? "(部分)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && !view ? (
        <GlassCard className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在读本机题材快照…
        </GlassCard>
      ) : !data ? (
        <GlassCard className="p-8 text-center">
          <GitBranch className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{view?.reason || "这一天还没有题材演进快照"}</p>
          <button type="button" onClick={build} disabled={!!busy || !forDate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
            {busy === "build" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            生成这一天的快照
          </button>
          <p className="mt-2 text-[10px] text-muted-foreground">只给已收盘的交易日构建;缺的数据会写进缺口,不会当成 0。</p>
        </GlassCard>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{data.date}{data.settled ? "(已收盘)" : "(盘中快照,未定稿)"}</span>
            {data.rotation_quality && <span>· 轮动:{data.rotation_quality}</span>}
            {data.prev_date && <span>· 对比 {data.prev_date}</span>}
            {data.partial && <span className="text-warning">· 部分数据没取到</span>}
            {data.ai_hierarchy && <span>· 层级提案已合并 {data.ai_hierarchy.applied.length} 条</span>}
          </div>

          {data.gaps.length > 0 && (
            <div role="status" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />数据缺口(缺的不会写成 0)</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{data.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}

          <ThemeOverview
            timelines={data.all_timelines}
            dates={data.all_timelines[0]?.dates ?? []}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setEditing(false); }}
          />

          <div className="mt-3 grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <ThemeTree nodes={data.nodes} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setEditing(false); }} />
            <div className="min-w-0 space-y-3">
              {editing ? (
                <ThemeEditor
                  key={`${view?.registry.updated_at}-${selectedId ?? ""}`}
                  registry={view!.registry}
                  selectedId={selectedId}
                  relations={data.relations}
                  busy={busy === "registry"}
                  error={editorError}
                  onSave={saveRegistry}
                  onClose={() => { setEditing(false); setEditorError(""); }}
                />
              ) : (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setEditing(true)} disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                    <Pencil className="h-3 w-3" /> 编辑层级
                  </button>
                </div>
              )}
              <ThemeDetail
                theme={theme}
                timeline={timeline}
                relations={relations}
                busyNarrate={busy === "narrate"}
                onNarrate={narrate}
                onEdit={() => setEditing(true)}
              />
            </div>
          </div>

          {data.pre_signals.length > 0 && (
            <GlassCard className="mt-3 p-4">
              <h3 className="mb-2 text-sm font-semibold">还没进盘面的简报方向(盘前线索)</h3>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                {data.pre_signals.map((p) => (
                  <li key={p.name}>· <b className="text-foreground">{p.name}</b>({p.mentions} 篇){p.key_points[0] ? `:${p.key_points[0]}` : ""}</li>
                ))}
              </ul>
            </GlassCard>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            {data.source_notes.join(" ")}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            只有点「生成 AI 叙事」时,才会把这一天已经算好的题材事实(包括本机简报分析里提到这个题材的要点)发给你在「接入 AI」里选的大脑;不点不发。AI 写的解读和层级提案都会再核对一遍。
          </p>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
