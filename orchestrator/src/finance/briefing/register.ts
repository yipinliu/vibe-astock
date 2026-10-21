/**
 * 研报简报的界面视图:GET 只读本机归档;POST 才同步 / 调 AI。
 * 私人订阅正文不进普通页面上下文;也不向 Agent 暴露抓取工具(见 plugin.tools.briefing_crawl.agentHidden)。
 */
import { ServiceError, credentialStatus, type ServiceContext } from "../../service.ts";
import { registerView } from "../../views.ts";
import { localClock } from "../../notify.ts";
import { SCHEDULE_TZ } from "../schedule.ts";
import { readBriefingGroup } from "./credential.ts";
import {
  listArchiveDates, readState, readTopicsForScope, syncBriefings,
} from "./archive.ts";
import { analyzeBriefings, readAnalysis, readStocks, type BriefingScope } from "./analysis.ts";

interface Query { date?: string; scope?: string }

function scopeOf(v: unknown): BriefingScope {
  return v === "recent7" ? "recent7" : "day";
}

function idsKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

async function viewBriefing(ctx: ServiceContext, query: Query) {
  const dates = listArchiveDates(ctx.dataRoot);
  const today = localClock(new Date(), SCHEDULE_TZ).day;
  const date = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : (dates[0] ?? today);
  const scope = scopeOf(query.scope);
  const topics = readTopicsForScope(ctx.dataRoot, date, scope);
  const analysis = readAnalysis(ctx.dataRoot, date);
  const stocks = readStocks(ctx.dataRoot, date);
  const currentIds = idsKey(topics.map((t) => t.topic_id));
  const stale = !!analysis && (analysis.scope !== scope || idsKey(analysis.topic_ids) !== currentIds);
  return {
    date, scope, today, dates,
    topics, analysis, stocks,
    stale,
    state: readState(ctx.dataRoot),
    token: credentialStatus(ctx, "briefing-token"),
    group: credentialStatus(ctx, "briefing-group"),
    group_id: readBriefingGroup(ctx.dataRoot) ?? "",
    read_only: process.env.VRA_REMOTE === "1",
  };
}

async function viewBriefingAct(ctx: ServiceContext, body: Record<string, unknown>, signal: AbortSignal) {
  const action = body.action;
  if (action === "sync") {
    const group = readBriefingGroup(ctx.dataRoot) || String(body.group_id ?? "").trim();
    if (!group) throw new ServiceError("briefing_group_missing", "先设置订阅组 ID");
    await syncBriefings(ctx, group, signal);
    return viewBriefing(ctx, { date: typeof body.date === "string" ? body.date : undefined, scope: typeof body.scope === "string" ? body.scope : undefined });
  }
  if (action === "analyze") {
    const date = typeof body.date === "string" ? body.date : (listArchiveDates(ctx.dataRoot)[0] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ServiceError("briefing_no_topics", "先同步一份简报再生成分析");
    const scope = scopeOf(body.scope);
    await analyzeBriefings(ctx, { ...body, date, scope }, signal);
    return viewBriefing(ctx, { date, scope });
  }
  throw new ServiceError("bad_request", "只支持 action=sync / analyze");
}

registerView({
  id: "briefing",
  label: "研报简报",
  run: (ctx, query) => viewBriefing(ctx, query),
  act: viewBriefingAct,
});

// 供测试 / 其他视图读取:不额外导出内部函数,保持入口只有视图。
export { viewBriefing };
