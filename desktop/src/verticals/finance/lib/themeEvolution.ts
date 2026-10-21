/** 题材演进视图的类型与展示口径(后端见 orchestrator/src/finance/theme_evolution/)。 */

export type ThemeStage = "发酵" | "启动" | "高潮" | "退潮" | "维持";
export type StageOrEmpty = ThemeStage | "";

export interface ThemeStats {
  limit_up: number; first_boards: number; consec_boards: number; highest: number;
  broken: number; limit_down: number;
  broken_rate: number | null; continuation_rate: number | null;
  first_seal: string | null; last_seal: string | null; state: string;
}
export interface ThemeCoreStock {
  code: string; name: string; roles: string[]; boards: number; label: string;
  first_seal: string | null; broken_times: number;
  close?: number | null; change_pct?: number | null; turnover?: number | null;
  thesis?: string;
}
export interface ThemeEvent {
  time: string; source: string; kind: string; text: string;
  topic_ids?: string[]; institutions?: string[];
}
export interface ThemeSignal { type?: string; text: string; topic_ids: string[]; institutions: string[] }
export interface ThemeRow {
  theme_id: string; name: string; level: 1 | 2 | 3; parent_id: string | null; aliases: string[];
  confirmed: boolean; manual: boolean; source_tags: string[];
  stage: ThemeStage; stage_base: "rules"; stage_reason: string;
  narrative: string; ai_generated_at: string | null; ai: string | null;
  stats: ThemeStats; core_stocks: ThemeCoreStock[]; events: ThemeEvent[];
  signals: ThemeSignal[]; risks: string[]; consensus: string[]; contrarian: string[];
  fund_flow: { net_today_yi: number | null; net_pct: number | null; board: string } | null;
  briefing_mentions: number; issues: string[];
}
export interface ThemeNodeView {
  id: string; name: string; level: 1 | 2 | 3; parent_id: string | null;
  confirmed: boolean; manual: boolean; stage: StageOrEmpty; limit_up: number | null; highest: number | null; has_data: boolean;
}
export interface ThemeTimelinePoint { date: string; stage: StageOrEmpty; limit_up: number | null; highest: number | null }
export interface ThemeTimeline {
  theme_id: string; name: string; level: 1 | 2 | 3; parent_id: string | null; confirmed: boolean;
  timeline: ThemeTimelinePoint[]; dates: string[];
}
export interface ThemeDaily {
  schema: number; date: string; prev_date: string | null; generated_at: string;
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
export interface ThemeRegistryNode {
  id: string; name: string; level: 1 | 2 | 3; parent_id: string | null;
  aliases: string[]; auto: boolean; manual: boolean; active: boolean; confirmed: boolean;
  first_seen: string; last_seen: string; evidence: Record<string, number>;
}
export interface ThemeRelation { from: string; to: string; type: string; manual: boolean }
export interface ThemeRegistry { schema: number; updated_at: string; themes: ThemeRegistryNode[]; relations: ThemeRelation[] }
export interface BuildOutcome { ok: boolean; reason?: string; settled?: boolean; partial?: boolean; gaps?: string[] }
export interface NarrateOutcome { warnings: string[]; applied: string[]; skipped: string[] }
export interface BackfillOutcome {
  gap: string | null;
  results: { date: string; ok: boolean; reason?: string; refreshed?: boolean; partial?: boolean }[];
}
export interface ThemeView {
  date: string; default_date: string; today: string; dates: string[];
  data: ThemeDaily | null; needs_build: boolean; reason: string;
  registry: ThemeRegistry;
  build?: BuildOutcome;
  narrative?: NarrateOutcome;
  backfill?: BackfillOutcome;
}

export interface ThemeRegistryPayload {
  op: string; date?: string; theme_id?: string; name?: string; level?: 1 | 2 | 3; parent_id?: string | null;
  aliases?: string[]; from?: string; to?: string; type?: string;
}

export const STAGE_ORDER: ThemeStage[] = ["退潮", "发酵", "高潮", "启动", "维持"];

/** 阶段颜色:红涨绿跌(退潮用绿),全部用语义 token,不写死色值。 */
export const STAGE_TONE: Record<ThemeStage, string> = {
  退潮: "border-success/40 bg-success/10 text-success",
  发酵: "border-warning/40 bg-warning/10 text-warning",
  高潮: "border-danger/40 bg-danger/10 text-danger",
  启动: "border-primary/40 bg-primary/10 text-primary",
  维持: "border-border bg-muted/30 text-muted-foreground",
};

export const stageTone = (s: StageOrEmpty): string => (s ? STAGE_TONE[s] : "border-border bg-muted/30 text-muted-foreground");

export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "缺";

export const fmtSeal = (t: string | null | undefined): string => {
  if (!t) return "—";
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  return /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : t;
};

export const shortDate = (d: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : d);

export const themeOf = (data: ThemeDaily | null, id: string | null): ThemeRow | null =>
  (data && id ? data.themes.find((t) => t.theme_id === id) ?? null : null);

export const timelineOf = (data: ThemeDaily | null, id: string | null): ThemeTimeline | null =>
  (data && id ? data.all_timelines.find((t) => t.theme_id === id) ?? null : null);

/** 侧栏树的子节点:父节点不在当前节点集合里的按根节点画,不丢。 */
export function treeChildren(nodes: ThemeNodeView[]): Map<string | null, ThemeNodeView[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string | null, ThemeNodeView[]>();
  for (const n of nodes) {
    const key = n.parent_id && ids.has(n.parent_id) ? n.parent_id : null;
    const list = out.get(key) ?? [];
    list.push(n);
    out.set(key, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.has_data) - Number(a.has_data) || (b.limit_up ?? 0) - (a.limit_up ?? 0) || a.name.localeCompare(b.name));
  }
  return out;
}

export const nodeName = (nodes: ThemeNodeView[] | ThemeRegistryNode[], id: string): string =>
  nodes.find((n) => n.id === id)?.name ?? id;

/** 关系两端都换成名字;后端校验过节点存在,这里做防御性兜底。 */
export function relationLines(data: ThemeDaily | null): { from: string; to: string; type: string; manual: boolean }[] {
  if (!data) return [];
  const byId = new Map(data.nodes.map((n) => [n.id, n.name]));
  return data.relations.map((r) => ({ ...r, from: byId.get(r.from) ?? r.from, to: byId.get(r.to) ?? r.to }));
}
