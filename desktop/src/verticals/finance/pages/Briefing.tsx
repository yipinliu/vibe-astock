/**
 * 研报简报(个人订阅):本机归档 + AI 主题/共识/信号/风险 + 个股提及事实。
 * 🔴 不向普通 AI 对话注册页面正文;只有用户点「生成 AI 解读」时才把选中范围的正文交给所选大脑。
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileText, Loader2, RefreshCw, Sparkles, Target } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageTabs, type PageTab } from "@/components/ui/PageTabs";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { GlassCard } from "@/components/ui/GlassCard";
import { backend } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { fmtBriefingTime, type BriefingView } from "@/lib/briefing";
import { AnalysisPanel } from "../briefing/AnalysisPanel";
import { FeedPanel } from "../briefing/FeedPanel";
import { StocksPanel } from "../briefing/StocksPanel";

type Tab = "feed" | "stocks";
const TABS: PageTab<Tab>[] = [
  { key: "feed", label: "简报", icon: FileText },
  { key: "stocks", label: "个股提及", icon: Target },
];
const SCOPES: { key: "day" | "recent7"; label: string }[] = [
  { key: "day", label: "当天" },
  { key: "recent7", label: "近 7 天" },
];

export function Briefing() {
  const [tab, setTab] = useState<Tab>("feed");
  const [date, setDate] = useState("");
  const [scope, setScope] = useState<"day" | "recent7">("day");
  const [view, setView] = useState<BriefingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"sync" | "analyze" | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const apply = (v: BriefingView) => {
    setView(v);
    setSelected((prev) => (prev && v.topics.some((t) => t.topic_id === prev) ? prev : (v.topics[0]?.topic_id ?? null)));
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const v = await backend.briefing({ date: date || undefined, scope }, signal);
      apply(v);
      setError("");
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date, scope]);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  const sync = async () => {
    if (busy) return;
    setBusy("sync");
    setError("");
    try {
      apply(await backend.briefingSync({ date: date || view?.date, scope }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (busy) return;
    const forDate = date || view?.date;
    if (!forDate) { setError("先同步一份简报,再生成解读"); return; }
    setBusy("analyze");
    setError("");
    try {
      apply(await backend.briefingAnalyze({ date: forDate, scope }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const missingSetup = !!view && (!view.token.valid || !view.group.valid);
  const shownDate = date || view?.date || "";

  return (
    <div>
      <PageHeader
        title="研报简报"
        subtitle="来自你个人订阅的机构简报 · 只保存在本机;生成 AI 解读时才会把选中范围的正文交给你选择的大脑"
        actions={
          <>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
              <span className="sr-only">看哪一天</span>
              <input
                type="date" aria-label="看哪一天" value={shownDate} max={view?.today}
                onChange={(e) => { setDate(e.target.value); setSelected(null); }}
                className="bg-transparent text-foreground outline-none [color-scheme:dark]"
              />
            </label>
            {date && (
              <button type="button" onClick={() => { setDate(""); setSelected(null); }}
                className="rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                回到最新
              </button>
            )}
            <button type="button" onClick={sync} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
              {busy === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy === "sync" ? "同步中…" : "同步"}
            </button>
            <button type="button" onClick={analyze} disabled={!!busy || !view}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              {busy === "analyze" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy === "analyze" ? "生成中…" : "生成分析"}
            </button>
            <button type="button" onClick={() => void load()} disabled={loading || !!busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
            </button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedToggle label="范围" value={scope} onChange={(v) => setScope(v)} options={SCOPES} disabled={!!busy} />
        <span className="text-[11px] text-muted-foreground">
          {view ? `${view.topics.length} 条${view.scope === "recent7" ? "(近 7 天)" : ""}` : "…"}
          {view?.state.last_sync ? ` · 上次同步 ${fmtBriefingTime(view.state.last_sync)}` : " · 还没同步"}
        </span>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          <div className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{error}</div>
          {/订阅组|令牌|设置/.test(error) && <Link to="/settings" className="mt-1 inline-block text-primary underline-offset-2 hover:underline">去设置</Link>}
        </div>
      )}
      {view?.state.last_error && !error && (
        <div role="status" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          上次同步没成功:{view.state.last_error}
        </div>
      )}
      {missingSetup && (
        <GlassCard className="mb-3 p-3 text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            还没配置简报的访问令牌或订阅组 ID,同步会失败。
            <Link to="/settings" className="text-primary underline-offset-2 hover:underline">去「接入 AI」页的设置区填写</Link>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">令牌只保存在本机;页面只显示打码后的样子。</p>
        </GlassCard>
      )}

      <PageTabs label="简报分页" value={tab} onChange={setTab} options={TABS} />

      {loading && !view ? (
        <GlassCard className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在读本机归档…
        </GlassCard>
      ) : tab === "feed" ? (
        <div className="space-y-4">
          <AnalysisPanel
            analysis={view?.analysis ?? null}
            stale={!!view?.stale}
            busy={busy === "analyze"}
            onAnalyze={analyze}
            onPickTopic={(id) => { setTab("feed"); setSelected(id); }}
          />
          <FeedPanel topics={view?.topics ?? []} selectedId={selected} onSelect={setSelected} />
        </div>
      ) : (
        <StocksPanel stocks={view?.stocks ?? null} />
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        简报正文来自你个人订阅的机构,图片仅显示链接、不自动加载;所有内容只保存在本机。
        个股页只列机构提到的事实和确定性行情读数,不提供评级、目标价或买卖建议。
      </p>
      <Disclaimer />
    </div>
  );
}
