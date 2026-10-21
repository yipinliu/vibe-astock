/**
 * 题材演进的 AI 解读:只给已由程序算好的事实写 ≤120 字叙事 + 可选的层级提案。
 *
 * 🔴 AI 不决定阶段:只写 narrative;任何 stage 字段都忽略。
 * 🔴 数字只用快照里的数;买卖建议 / 评级 / 目标价命中产品红线即丢弃该条。
 * 🔴 层级提案只合并到 auto 节点;manual 不动;未知名称跳过。
 */
import { randomUUID } from "node:crypto";

import { writeJson } from "../../fsutil.ts";
import { ServiceError, agentTurnFor, type ServiceContext } from "../../service.ts";
import { cleanLine, numbersIn, parseJsonReply, ungroundedNumbers, violatesFinanceGate } from "../ai_audit.ts";
import { aiName } from "../shortline/review.ts";
import { dailyFile, readDaily, type ThemeDaily } from "./build.ts";
import { allNames, loadRegistry, mergeProposal, saveRegistry } from "./registry.ts";

export type Turn = (message: string, session: string, signal?: AbortSignal) => Promise<string>;

export interface NarrateResult {
  data: ThemeDaily; warnings: string[]; applied: string[]; skipped: string[];
}
export interface NarrateDeps {
  turn?: Turn;
  now?: () => Date;
}

const running = new Set<string>();

const NARRATIVE_SCHEMA = `{"themes":[{"theme_id":"注册表 id","narrative":"≤120 字解读"}]}`;
const HIERARCHY_SCHEMA = `{
  "macro_directions": [{"name":"宏观方向名","rationale":"依据","members":["已出现的题材名"]}],
  "relations": [{"from_name":"题材名","to_name":"题材名","relation_type":"上游|下游|共振"}],
  "aliases": {"已有题材名":["别名"]}
}`;

const SYSTEM = [
  "你在给一份**已经由程序算好**的题材日快照写解读,不是预测,也不是推荐。",
  "只用给定的事实;数字照抄,不要自己算;不要改变规则阶段。",
  "每个题材写一句到三句,总长不超过 120 字:发生了什么、和前两天相比哪里变了、缺什么证据。",
  "不写买卖建议、评级、目标价、止损止盈、仓位、择时或涨跌预测。",
  "只输出严格 JSON,不要 Markdown、代码块或解释。",
].join("\n");

function dossierOf(data: ThemeDaily, themes: ThemeDaily["themes"]): { text: string; numbers: number[] } {
  const lines: string[] = [];
  for (const t of themes) {
    const s = t.stats;
    lines.push(
      `【${t.theme_id}】${t.name} | 规则阶段:${t.stage}(${t.stage_reason})`,
      `涨停 ${s.limit_up} 只(首板 ${s.first_boards}/连板 ${s.consec_boards}),最高 ${s.highest} 板,炸板 ${s.broken} 只,`
      + `跌停 ${s.limit_down} 只,炸板率 ${s.broken_rate == null ? "缺" : `${(s.broken_rate * 100).toFixed(1)}%`},`
      + `昨日该题材延续率 ${s.continuation_rate == null ? "缺" : `${(s.continuation_rate * 100).toFixed(1)}%`}`,
    );
    if (t.core_stocks.length) {
      lines.push("核心:" + t.core_stocks.slice(0, 6).map((c) => `${c.name}(${c.code || "无代码"}) ${c.label}/${c.roles.join("、")}`).join(";"));
    }
    for (const e of t.events) lines.push(`事件(${e.source}):${e.text}`);
    for (const sig of t.signals.slice(0, 3)) lines.push(`简报信号:${sig.text}`);
    for (const r of t.risks.slice(0, 3)) lines.push(`简报风险:${r}`);
    if (t.fund_flow?.net_today_yi != null) lines.push(`行业资金:${t.fund_flow.board} 主力净流入 ${t.fund_flow.net_today_yi.toFixed(2)} 亿`);
  }
  const text = lines.join("\n");
  return { text, numbers: numbersIn(text) };
}

function parseNarratives(raw: unknown, allowedIds: Set<string>, allowedNumbers: number[]): { items: { id: string; narrative: string }[]; warnings: string[] } {
  const warnings: string[] = [];
  const items: { id: string; narrative: string }[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { items, warnings: ["AI 没有返回可解析的 JSON"] };
  const list = (raw as Record<string, unknown>).themes;
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    const id = typeof x.theme_id === "string" ? x.theme_id : "";
    const text = cleanLine(x.narrative, 120);
    if (!allowedIds.has(id)) { warnings.push(`叙事引用了不存在的题材:${id || "(空)"}`); continue; }
    if (!text) continue;
    if (violatesFinanceGate(text)) { warnings.push(`题材 ${id} 的叙事命中理财红线,已剔除`); continue; }
    const missing = ungroundedNumbers(text, allowedNumbers);
    if (missing.length) { warnings.push(`题材 ${id} 的叙事有快照里找不到的数字(${missing.slice(0, 5).join("、")}),已剔除`); continue; }
    items.push({ id, narrative: text });
  }
  return { items, warnings };
}

/** AI 叙事 + 可选层级提案。turn 只给测试注入。 */
export async function narrateThemes(ctx: ServiceContext, body: Record<string, unknown>, signal?: AbortSignal, deps: NarrateDeps = {}): Promise<NarrateResult> {
  const date = typeof body.date === "string" ? body.date : "";
  const data = /^\d{4}-\d{2}-\d{2}$/.test(date) ? readDaily(ctx.dataRoot, date) : null;
  if (!data) throw new ServiceError("theme_no_snapshot", "这一天还没有题材演进快照;先生成日快照");
  const key = `${ctx.dataRoot}\u0000${date}`;
  if (running.has(key)) throw new ServiceError("theme_narrative_busy", "这一天的 AI 叙事正在生成,等它写完");
  running.add(key);
  try {
    const agent = deps.turn ? { turn: deps.turn } : agentTurnFor(ctx, body);
    const ai = aiName(body) || "当前 AI";
    const now = deps.now?.() ?? new Date();
    const top = [...data.themes].sort((a, b) => b.stats.limit_up - a.stats.limit_up).slice(0, 15);
    if (!top.length) throw new ServiceError("theme_no_snapshot", "这一天没有可解读的题材");
    const dossier = dossierOf(data, top);
    const reply = await agent.turn(
      `${SYSTEM}\n\n严格按这个 JSON 形状输出:\n${NARRATIVE_SCHEMA}\n\n${dossier.text}`,
      `theme-narrative-${randomUUID()}`, signal,
    );
    const parsed = parseNarratives(parseJsonReply(reply), new Set(top.map((t) => t.theme_id)), dossier.numbers);
    if (!parsed.items.length) {
      throw new ServiceError("theme_narrative_empty", `AI 没有产出可核对的叙事${parsed.warnings.length ? `:${parsed.warnings.slice(0, 3).join(";")}` : ""}`);
    }
    const warnings = [...parsed.warnings];
    for (const item of parsed.items) {
      const t = data.themes.find((x) => x.theme_id === item.id);
      if (!t) continue;
      t.narrative = item.narrative;
      t.ai_generated_at = now.toISOString();
      t.ai = ai;
    }

    let applied: string[] = [];
    let skipped: string[] = [];
    const reg = loadRegistry(ctx.dataRoot);
    const candidates = reg.themes.filter((t) => t.active && !t.confirmed);
    if (candidates.length >= 3 || !reg.themes.length) {
      const names = allNames(reg);
      const replyH = await agent.turn(
        `${SYSTEM}\n\n这次只做层级提案:把下面这些题材按宏观方向归并,补上下游 / 共振关系,可以给别名。\n`
        + `只能用这些名称,不要新造:${names.join("、")}\n`
        + `严格按这个 JSON 形状输出:\n${HIERARCHY_SCHEMA}`,
        `theme-hierarchy-${randomUUID()}`, signal,
      );
      const proposal = parseJsonReply(replyH);
      const merged = mergeProposal(reg, proposal);
      applied = merged.applied;
      skipped = merged.skipped;
      if (applied.length) await saveRegistry(ctx.dataRoot, merged.registry);
      data.ai_hierarchy = { applied, skipped, proposal };
      warnings.push(...skipped.slice(0, 10));
    }

    writeJson(dailyFile(ctx.dataRoot, date), data);
    return { data, warnings, applied, skipped };
  } finally {
    running.delete(key);
  }
}
