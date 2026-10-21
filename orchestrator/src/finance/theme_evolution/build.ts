/**
 * 题材演进日快照:把各来源的题材/涨停/简报事实按注册表归并,规则定阶段,写进本机日文件。
 *
 * 🔴 阶段和所有数字都由程序算,AI 只写叙事(narrative.ts);GET 只读日文件,POST 才构建。
 * 🔴 缺数不当 0:某天题材树 / 简报 / 资金流没取到,写进 gaps;timeline 的缺日 stage 为空。
 */
import fs from "node:fs";
import path from "node:path";

import { fetchEndpoint, ServiceError, type FetchResult, type ServiceContext } from "../../service.ts";
import { writeJson } from "../../fsutil.ts";
import { localClock } from "../../notify.ts";
import { SCHEDULE_TZ, rowsOf } from "../schedule.ts";
import { validDate } from "../shortline/history.ts";
import { readAnalysis, readStocks, type BriefingStock, type BriefingTheme } from "../briefing/analysis.ts";
import {
  ensureTheme, loadRegistry, matchTheme, pruneStale, saveRegistry, daysDir,
  type ThemeNode, type ThemeRegistry,
} from "./registry.ts";

export type Stage = "发酵" | "启动" | "高潮" | "退潮" | "维持";
export const STAGES: Stage[] = ["发酵", "启动", "高潮", "退潮", "维持"];
const STAGE_ORDER: Stage[] = ["退潮", "发酵", "高潮", "启动", "维持"];

export interface ThemeStats {
  limit_up: number; first_boards: number; consec_boards: number; highest: number;
  broken: number; limit_down: number;
  broken_rate: number | null; continuation_rate: number | null;
  first_seal: string | null; last_seal: string | null; state: string;
}
export interface CoreStock {
  code: string; name: string; roles: string[]; boards: number; label: string;
  first_seal: string | null; broken_times: number;
  close?: number | null; change_pct?: number | null; turnover?: number | null;
  thesis?: string;
}
export interface ThemeEvent {
  time: string; source: string; kind: string; text: string;
  topic_ids?: string[]; institutions?: string[];
}
export interface ThemeSignal {
  type?: string; text: string; topic_ids: string[]; institutions: string[];
}
export interface ThemeRow {
  theme_id: string; name: string; level: 1 | 2 | 3; parent_id: string | null; aliases: string[];
  confirmed: boolean; manual: boolean; source_tags: string[];
  stage: Stage; stage_base: "rules"; stage_reason: string;
  narrative: string; ai_generated_at: string | null; ai: string | null;
  stats: ThemeStats; core_stocks: CoreStock[]; events: ThemeEvent[];
  signals: ThemeSignal[]; risks: string[]; consensus: string[]; contrarian: string[];
  fund_flow: { net_today_yi: number | null; net_pct: number | null; board: string } | null;
  briefing_mentions: number; issues: string[];
}
export interface ThemeNodeView {
  id: string; name: string; level: 1 | 2 | 3; parent_id: string | null;
  confirmed: boolean; manual: boolean; stage: Stage | ""; limit_up: number | null; highest: number | null; has_data: boolean;
}
export interface ThemeTimelinePoint { date: string; stage: Stage | ""; limit_up: number | null; highest: number | null }
export interface ThemeTimeline {
  theme_id: string; name: string; level: 1 | 2 | 3; parent_id: string | null; confirmed: boolean;
  timeline: ThemeTimelinePoint[]; dates: string[];
}
export interface ThemeDaily {
  schema: 1; date: string; prev_date: string | null; generated_at: string;
  settled: boolean; partial: boolean; available: true;
  themes: ThemeRow[]; nodes: ThemeNodeView[];
  relations: { from: string; to: string; type: string; manual: boolean }[];
  pre_signals: { name: string; mentions: number; key_points: string[]; topic_ids: string[]; institutions: string[] }[];
  all_timelines: ThemeTimeline[];
  rotation_quality: string;
  gaps: string[];
  source_notes: string[];
  ai_hierarchy?: { applied: string[]; skipped: string[]; proposal: unknown };
}
export interface BuildUnavailable { available: false; date: string; reason: string }
export interface ThemeView {
  date: string; default_date: string; today: string; dates: string[];
  data: ThemeDaily | null; needs_build: boolean; reason: string;
  registry: ThemeRegistry;
}

type Envelope = { status?: string; extra?: Record<string, unknown>; reason?: string; degraded?: string; missing?: unknown[]; errors?: { error?: unknown }[] };
type Fetch = (ctx: ServiceContext, req: {
  endpoint: string; args?: Record<string, unknown>;
  consistency?: { mode: "fresh" | "prefer_cache" | "cache_only" }; signal?: AbortSignal;
}) => Promise<Pick<FetchResult, "envelope">>;

interface RawMember { code?: string; name?: string; boards?: number; label?: string; first_seal?: string | null; broken_times?: number; zt_stat?: string | null }
interface RawTheme {
  tag?: string; state?: string; limit_up?: number; first_boards?: number; consec_boards?: number;
  highest?: number; broken?: number; limit_down?: number; broken_rate?: number | null;
  first_seal?: string | null; last_seal?: string | null; continuation_rate?: number | null;
  prev_members?: number; prev_still_up?: number; prev_broken_or_down?: number; members?: RawMember[];
}

export const dailyFile = (dataRoot: string, date: string) => path.join(daysDir(dataRoot), `${date}.json`);

export function listDailyDates(dataRoot: string): string[] {
  try {
    return fs.readdirSync(daysDir(dataRoot))
      .map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1])
      .filter((x): x is string => !!x).sort().reverse();
  } catch { return []; }
}

export function readDaily(dataRoot: string, date: string): ThemeDaily | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(dailyFile(dataRoot, date), "utf8")) as ThemeDaily;
    return parsed && parsed.available === true && parsed.schema === 1 ? parsed : null;
  } catch { return null; }
}

function writeDaily(dataRoot: string, data: ThemeDaily): void {
  writeJson(dailyFile(dataRoot, data.date), data);
}

const resultOf = (env: Envelope): Record<string, unknown> | null =>
  env.extra && typeof env.extra.result === "object" && env.extra.result !== null ? env.extra.result as Record<string, unknown> : null;
const numOf = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const strOf = (v: unknown): string => typeof v === "string" ? v : "";
const arrOf = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : [];
const hhmm = (t: string | null | undefined) =>
  t ? (/^\d{6}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : (/^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : "—")) : "—";
const pctOf = (v: number | null | undefined) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const nameHit = (text: string, names: string[]) => names.some((n) => n.length >= 2 && text.includes(n));

function rawStats(t: RawTheme): ThemeStats {
  return {
    limit_up: numOf(t.limit_up) ?? 0,
    first_boards: numOf(t.first_boards) ?? 0,
    consec_boards: numOf(t.consec_boards) ?? 0,
    highest: numOf(t.highest) ?? 0,
    broken: numOf(t.broken) ?? 0,
    limit_down: numOf(t.limit_down) ?? 0,
    broken_rate: numOf(t.broken_rate),
    continuation_rate: numOf(t.continuation_rate),
    first_seal: typeof t.first_seal === "string" ? t.first_seal : null,
    last_seal: typeof t.last_seal === "string" ? t.last_seal : null,
    state: strOf(t.state),
  };
}

export function detectStage(s: ThemeStats, prev1: number | null, prev2: number | null, briefingMentions: number): { stage: Stage; reason: string } {
  if (s.limit_down > 0) return { stage: "退潮", reason: `出现 ${s.limit_down} 只跌停` };
  if ((s.broken_rate ?? 0) >= 0.5) return { stage: "退潮", reason: `炸板率 ${pctOf(s.broken_rate)}` };
  if (s.continuation_rate != null && s.continuation_rate <= 0.15 && s.limit_up <= 2) {
    return { stage: "退潮", reason: `延续率仅 ${pctOf(s.continuation_rate)},接力断档` };
  }
  if (prev1 != null && prev2 != null && prev2 > prev1 && prev1 > s.limit_up) {
    return { stage: "退潮", reason: `连续 2 天涨停递减:${prev2}→${prev1}→${s.limit_up}` };
  }
  if (s.limit_up === 0 && prev1 != null && prev1 > 0) return { stage: "退潮", reason: "今日未再涨停" };
  if (briefingMentions > 0 && s.limit_up <= 1) return { stage: "发酵", reason: `${briefingMentions} 篇机构简报提及,盘面尚未反应` };
  if (s.limit_up >= 4 && s.highest >= 3) return { stage: "高潮", reason: `涨停 ${s.limit_up} 只,最高 ${s.highest} 板` };
  if (s.limit_up >= 3 && s.state === "扩散中" && (s.continuation_rate ?? 0) >= 0.5) {
    return { stage: "高潮", reason: `涨停 ${s.limit_up} 只,扩散中,延续率 ${pctOf(s.continuation_rate)}` };
  }
  if (s.limit_up >= 2 && s.first_boards >= 2 && (prev1 == null || prev1 === 0 || s.state.includes("新出现") || s.state === "扩散中")) {
    return { stage: "启动", reason: `涨停 ${s.limit_up} 只,首板 ${s.first_boards} 只` };
  }
  return { stage: "维持", reason: `涨停 ${s.limit_up} 只,最高 ${s.highest} 板` };
}

function mergeMembers(group: RawTheme[]): RawMember[] {
  const by = new Map<string, RawMember>();
  for (const t of group) {
    for (const m of arrOf<RawMember>(t.members)) {
      const code = strOf(m.code);
      if (!/^\d{6}$/.test(code)) continue;
      const cur = by.get(code);
      if (!cur || (numOf(m.boards) ?? 1) > (numOf(cur.boards) ?? 1)) by.set(code, m);
    }
  }
  return [...by.values()].sort((a, b) => (numOf(b.boards) ?? 1) - (numOf(a.boards) ?? 1)).slice(0, 12);
}

function coreOf(group: RawTheme[], node: ThemeNode, briefingStocks: BriefingStock[], quotes: Map<string, { close: number | null; change_pct: number | null; turnover: number | null }>): CoreStock[] {
  const names = [node.name, ...node.aliases];
  const out: CoreStock[] = mergeMembers(group).map((m) => {
    const q = quotes.get(strOf(m.code));
    const boards = numOf(m.boards) ?? 1;
    const roles = [boards === Math.max(...group.flatMap((t) => arrOf<RawMember>(t.members).map((x) => numOf(x.boards) ?? 1)), 1) ? "最高板" : boards > 1 ? "连板核心" : "首板"];
    if ((numOf(m.broken_times) ?? 0) > 0) roles.push("回封");
    return {
      code: strOf(m.code), name: strOf(m.name), roles, boards,
      label: strOf(m.label) || `${boards}板`, first_seal: typeof m.first_seal === "string" ? m.first_seal : null,
      broken_times: numOf(m.broken_times) ?? 0,
      close: q?.close ?? null, change_pct: q?.change_pct ?? null, turnover: q?.turnover ?? null,
    };
  });
  for (const s of briefingStocks) {
    if (out.some((c) => (s.stock_code && c.code === s.stock_code) || c.name === s.stock_name)) continue;
    if (!nameHit(`${s.stock_name} ${s.thesis}`, names) && !out.some((c) => s.stock_code && c.code === s.stock_code)) continue;
    const q = s.stock_code ? quotes.get(s.stock_code) : undefined;
    out.push({
      code: s.stock_code, name: s.stock_name, roles: ["机构提及"], boards: 0, label: "—", first_seal: null, broken_times: 0,
      close: q?.close ?? null, change_pct: q?.change_pct ?? null, turnover: q?.turnover ?? null, thesis: s.thesis,
    });
  }
  const roleOrder = (r: string) => r === "最高板" ? 0 : r === "连板核心" ? 1 : r === "首板" ? 2 : 3;
  return out.sort((a, b) => Math.min(...a.roles.map(roleOrder)) - Math.min(...b.roles.map(roleOrder)) || b.boards - a.boards).slice(0, 12);
}

function eventsOf(s: ThemeStats, node: ThemeNode, briefing: BriefingTheme[], flow: ThemeRow["fund_flow"]): ThemeEvent[] {
  const events: ThemeEvent[] = [];
  if (briefing.length) {
    for (const b of briefing) {
      events.push({
        time: "盘前", source: "简报", kind: "pre_signal",
        text: `${b.mentions} 篇简报提及:${b.key_points[0] ?? "—"}`, topic_ids: b.topic_ids, institutions: b.institutions,
      });
    }
  }
  events.push({
    time: s.first_seal ? hhmm(s.first_seal) : "全天", source: "涨停", kind: "momentum",
    text: `涨停 ${s.limit_up} 只(首板 ${s.first_boards} / 连板 ${s.consec_boards}),最高 ${s.highest} 板`
      + (s.first_seal ? `,首封 ${hhmm(s.first_seal)}` : "") + (s.last_seal && s.last_seal !== s.first_seal ? `→末封 ${hhmm(s.last_seal)}` : "")
      + (s.broken ? `,炸板 ${s.broken} 只` : "") + (s.limit_down ? `,跌停 ${s.limit_down} 只` : ""),
  });
  if (flow && flow.net_today_yi != null) {
    const pct = flow.net_pct == null ? "" : `(主力净占比 ${flow.net_pct.toFixed(2)}%)`;
    events.push({ time: "全天", source: "资金", kind: "validation", text: `${flow.board} 主力净流入 ${flow.net_today_yi.toFixed(2)} 亿${pct}` });
  }
  events.sort((a, b) => (a.time === "盘前" ? 0 : a.time === "全天" ? 2 : 1) - (b.time === "盘前" ? 0 : b.time === "全天" ? 2 : 1));
  return events;
}

function nodesOf(reg: ThemeRegistry, themes: ThemeRow[]): ThemeNodeView[] {
  const byId = new Map(reg.themes.map((t) => [t.id, t]));
  const rows = new Map(themes.map((t) => [t.theme_id, t]));
  const keep = new Set<string>();
  const has = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const r = rows.get(id);
    if (r && (r.stats.limit_up > 0 || r.stats.broken > 0 || r.stats.limit_down > 0 || r.core_stocks.length > 0)) return true;
    return reg.themes.some((t) => t.parent_id === id && has(t.id, seen));
  };
  for (const t of reg.themes) if (has(t.id)) keep.add(t.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...keep]) {
      const p = byId.get(id)?.parent_id;
      if (p && !keep.has(p)) { keep.add(p); changed = true; }
    }
  }
  return reg.themes.filter((t) => keep.has(t.id)).map((t) => {
    const r = rows.get(t.id);
    return {
      id: t.id, name: t.name, level: t.level, parent_id: t.parent_id, confirmed: t.confirmed, manual: t.manual,
      stage: (r?.stage ?? "") as Stage | "", limit_up: r ? r.stats.limit_up : null, highest: r ? r.stats.highest : null,
      has_data: !!r,
    };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function timelinesOf(reg: ThemeRegistry, date: string, current: ThemeDaily | null, dates: string[], dataRoot: string): ThemeTimeline[] {
  const order = [...dates];
  if (current && !order.includes(date)) order.push(date);
  const sorted = [...new Set(order)].sort();
  const byDate = new Map<string, ThemeDaily | null>();
  for (const d of sorted) byDate.set(d, d === date ? current : readDaily(dataRoot, d));
  const out: ThemeTimeline[] = [];
  for (const t of reg.themes.filter((x) => x.active)) {
    let any = false;
    const timeline: ThemeTimelinePoint[] = sorted.map((d) => {
      const day = byDate.get(d);
      const row = day?.themes.find((x) => x.theme_id === t.id);
      if (row) any = true;
      return { date: d, stage: row?.stage ?? "", limit_up: row ? row.stats.limit_up : null, highest: row ? row.stats.highest : null };
    });
    if (!any) continue;
    out.push({ theme_id: t.id, name: t.name, level: t.level, parent_id: t.parent_id, confirmed: t.confirmed, timeline, dates: sorted });
  }
  return out;
}

/** 构建某天的题材演进。persist=true 才写注册表和日文件;GET 永远走 readDaily。 */
export async function buildThemes(
  ctx: ServiceContext, date: string,
  opts: { persist?: boolean; force?: boolean; signal?: AbortSignal; now?: Date } = {},
  fetch: Fetch = fetchEndpoint,
): Promise<ThemeDaily | BuildUnavailable> {
  if (!validDate(date)) throw new ServiceError("bad_request", "date 要写成 YYYY-MM-DD");
  const clock = localClock(opts.now ?? new Date(), SCHEDULE_TZ);
  const today = clock.day;
  if (date > today) throw new ServiceError("bad_request", `${date} 还没到`);
  // 盘中不落盘:没收盘的数字还会变,GET 只能读到收盘后构建的那一版
  if (opts.persist && date === today && clock.hm < "15:05") {
    throw new ServiceError("theme_not_settled", "今天还没收盘,15:05 后再生成快照");
  }
  if (!opts.force) {
    const cached = readDaily(ctx.dataRoot, date);
    if (cached) return cached;
  }

  const themesEnv = (await fetch(ctx, {
    endpoint: "cn_shortline_themes", args: { date, top: 30 },
    consistency: { mode: opts.force ? "fresh" : "prefer_cache" }, signal: opts.signal,
  })).envelope as Envelope;
  if (themesEnv.status === "failed") {
    return { available: false, date, reason: themesEnv.reason || strOf((themesEnv.errors?.[0] as { error?: unknown })?.error) || "题材树没取到" };
  }
  const themeResult = resultOf(themesEnv);
  const tree = themeResult?.tree && typeof themeResult.tree === "object" ? themeResult.tree as Record<string, unknown> : null;
  if (!tree || tree.available !== true) {
    return { available: false, date, reason: strOf(tree?.reason) || "题材树没算出来" };
  }
  const rawThemes = arrOf<RawTheme>(tree.themes);
  if (!rawThemes.length) return { available: false, date, reason: "题材树没有可用的题材" };

  const gaps: string[] = [];
  const partial = themesEnv.status === "partial";
  if (partial) gaps.push(strOf(themesEnv.degraded) || "题材树这次只取到部分数据");
  const settled = themesEnv.extra?.settled === true;

  // 轮动:只用来给「正常轮动 / 主线延续 / 热点散乱」一个确定性的标签
  let rotationQuality = "";
  try {
    const rotEnv = (await fetch(ctx, { endpoint: "cn_shortline_theme_rotation", args: { date }, consistency: { mode: "prefer_cache" }, signal: opts.signal })).envelope as Envelope;
    const rot = resultOf(rotEnv)?.rotation as Record<string, unknown> | undefined;
    if (rot?.available === true) {
      const sustained = arrOf<Record<string, unknown>>(rot.themes).filter((t) => strOf(t.status).startsWith("连续")).length;
      rotationQuality = sustained >= 3 ? "主线延续" : sustained <= 1 ? "热点散乱" : "正常轮动";
      if (arrOf<unknown>(rot.missing_days).length) gaps.push(`题材轮动有 ${arrOf<unknown>(rot.missing_days).length} 天缺数`);
    } else gaps.push("题材轮动没算出来");
  } catch { gaps.push("题材轮动没取到"); }

  // 行业资金流:只给当天,历史日期不取
  const flowRows: { name: string; net: number | null; pct: number | null }[] = [];
  if (date === today) {
    try {
      const flowEnv = (await fetch(ctx, { endpoint: "em_board_fund_flow", args: { board_type: "industry", period: "today", top_n: 50 }, consistency: { mode: "prefer_cache" }, signal: opts.signal })).envelope as Envelope;
      for (const r of rowsOf(flowEnv)) {
        const name = r.note.replace(/\s*排名.*$/, "").trim();
        flowRows.push({ name, net: numberEv(r.f.board_main_net_today), pct: numberEv(r.f.board_main_pct_today) });
      }
      if (!flowRows.length) gaps.push("行业资金流没取到");
    } catch { gaps.push("行业资金流没取到"); }
  } else gaps.push("行业资金流只给当天,历史日期未取");

  const analysis = readAnalysis(ctx.dataRoot, date);
  const stocksFile = readStocks(ctx.dataRoot, date);
  const briefingThemes = analysis?.themes ?? [];
  if (!analysis) gaps.push("简报分析未生成;题材演进只用盘面事实");

  const reg = loadRegistry(ctx.dataRoot);
  const grouped = new Map<string, { node: ThemeNode; group: RawTheme[] }>();
  for (const t of rawThemes) {
    const tag = strOf(t.tag);
    if (!tag) continue;
    const { node } = ensureTheme(reg, tag, date, "theme_tree");
    const g = grouped.get(node.id) ?? { node, group: [] };
    g.group.push(t);
    grouped.set(node.id, g);
  }

  // 行情:只在当天构建时补;历史日期不拿今天的价格冒充
  const quotes = new Map<string, { close: number | null; change_pct: number | null; turnover: number | null }>();
  if (date === today) {
    const codes = [...new Set([...grouped.values()].flatMap((g) => mergeMembers(g.group).map((m) => strOf(m.code))).filter((c) => /^\d{6}$/.test(c)))];
    if (codes.length) {
      try {
        const qEnv = (await fetch(ctx, { endpoint: "tx_quotes_batch", args: { codes: codes.slice(0, 50) }, consistency: { mode: "fresh" }, signal: opts.signal })).envelope as Envelope;
        for (const r of rowsOf(qEnv)) {
          quotes.set(symbolOfKey(r.key), { close: numberEv(r.f.close), change_pct: numberEv(r.f.change_pct), turnover: numberEv(r.f.turnover_pct) });
        }
        if (!quotes.size) gaps.push("行情没取到,核心个股不显示当天涨跌");
      } catch { gaps.push("行情没取到,核心个股不显示当天涨跌"); }
    }
  }

  const prevDates = listDailyDates(ctx.dataRoot).filter((d) => d < date).sort().reverse().slice(0, 7);
  const prevData = prevDates.map((d) => readDaily(ctx.dataRoot, d)).filter((x): x is ThemeDaily => !!x);
  if (!prevData.length) gaps.push("还没有历史日快照;阶段规则里的「连续递减」和 timeline 只能从这一天开始累积");

  const themes: ThemeRow[] = [];
  for (const { node, group } of grouped.values()) {
    const chosen = [...group].sort((a, b) => (numOf(b.limit_up) ?? 0) - (numOf(a.limit_up) ?? 0))[0]!;
    const stats = rawStats(chosen);
    const names = [node.name, ...node.aliases, ...group.map((g) => strOf(g.tag))].filter(Boolean);
    const hits = briefingThemes.filter((b) => nameHit(`${b.name} ${b.key_points.join(" ")}`, names));
    const bStocks = (stocksFile?.stocks ?? []).filter((s) => nameHit(`${s.stock_name} ${s.thesis}`, names));
    const p1 = prevData[0]?.themes.find((t) => t.theme_id === node.id)?.stats.limit_up ?? null;
    const p2 = prevData[1]?.themes.find((t) => t.theme_id === node.id)?.stats.limit_up ?? null;
    const { stage, reason } = detectStage(stats, p1, p2, hits.reduce((n, b) => n + b.mentions, 0));
    const flow = flowRows.find((f) => nameHit(f.name, names)) ?? null;
    const existing = readDaily(ctx.dataRoot, date)?.themes.find((t) => t.theme_id === node.id);
    const signals: ThemeSignal[] = (analysis?.signals ?? []).filter((s) => nameHit(s.text, names))
      .map((s) => ({ type: s.type, text: s.text, topic_ids: s.topic_ids, institutions: s.institutions }));
    themes.push({
      theme_id: node.id, name: node.name, level: node.level, parent_id: node.parent_id, aliases: node.aliases,
      confirmed: node.confirmed, manual: node.manual,
      source_tags: [...new Set(group.map((g) => strOf(g.tag)).filter(Boolean))],
      stage, stage_base: "rules", stage_reason: reason,
      narrative: existing?.narrative ?? "", ai_generated_at: existing?.ai_generated_at ?? null, ai: existing?.ai ?? null,
      stats,
      core_stocks: coreOf(group, node, bStocks, quotes),
      events: eventsOf(stats, node, hits, flow ? { net_today_yi: flow.net, net_pct: flow.pct, board: flow.name } : null),
      signals,
      risks: (analysis?.risks ?? []).filter((x) => nameHit(x, names)),
      consensus: (analysis?.consensus ?? []).filter((x) => nameHit(x, names)),
      contrarian: (analysis?.contrarian ?? []).filter((x) => nameHit(x, names)),
      fund_flow: flow ? { net_today_yi: flow.net, net_pct: flow.pct, board: flow.name } : null,
      briefing_mentions: hits.reduce((n, b) => n + b.mentions, 0),
      issues: group.length > 1 ? [`合并了 ${group.length} 个来源标签,统计取涨停数最多的一份`] : [],
    });
  }
  themes.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.stats.limit_up - a.stats.limit_up || a.name.localeCompare(b.name));

  const preSignals = briefingThemes
    .filter((b) => !matchTheme(reg, b.name))
    .map((b) => ({ name: b.name, mentions: b.mentions, key_points: b.key_points, topic_ids: b.topic_ids, institutions: b.institutions }));

  const generatedAt = new Date().toISOString();
  const draft: ThemeDaily = {
    schema: 1, date, prev_date: typeof themeResult?.prev_date === "string" ? themeResult.prev_date : null,
    generated_at: generatedAt, settled, partial, available: true,
    themes,
    nodes: nodesOf(reg, themes),
    relations: reg.relations.map((r) => ({ from: r.from, to: r.to, type: r.type, manual: r.manual })),
    pre_signals: preSignals,
    all_timelines: [],
    rotation_quality: rotationQuality,
    gaps,
    source_notes: [
      "题材按涨停原因串归组;涨停原因是源站编辑归因,不是公司确认。",
      "阶段由确定性规则按涨停数 / 首板 / 最高板 / 炸板率 / 延续率 / 简报提及判定,不是预测。",
      "同名 / 别名题材合并时,统计取涨停数最多的一份;核心个股取成员并集(源站每个题材最多给 8 只成员)。",
      "财报与行情数据来源见 cn_shortline_themes;行业资金流只给当天。",
    ],
  };
  const dates = [...new Set([...listDailyDates(ctx.dataRoot).filter((d) => d <= date), date])].sort().slice(-7);
  draft.all_timelines = timelinesOf(reg, date, draft, dates, ctx.dataRoot);

  if (opts.persist) {
    pruneStale(reg, date);
    await saveRegistry(ctx.dataRoot, reg);
    writeDaily(ctx.dataRoot, draft);
  }
  return draft;
}

function numberEv(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const v = (e as { value?: unknown }).value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function symbolOfKey(key: string): string {
  return key.replace(/^(?:sh|sz|bj)/i, "").replace(/\.(?:SH|SZ|BJ)$/i, "");
}

export function readThemeView(ctx: ServiceContext, date?: string | null): ThemeView {
  const today = localClock(new Date(), SCHEDULE_TZ).day;
  const dates = listDailyDates(ctx.dataRoot);
  const defaultDate = date && validDate(date) ? date : (dates[0] ?? today);
  const data = readDaily(ctx.dataRoot, defaultDate);
  return {
    date: defaultDate, default_date: dates[0] ?? today, today, dates,
    data, needs_build: !data, reason: data ? "" : "这一天还没有生成题材演进快照",
    registry: loadRegistry(ctx.dataRoot),
  };
}
