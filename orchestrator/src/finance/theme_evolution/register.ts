/**
 * 题材演进的界面视图:GET 只读本机日快照;POST 才构建 / 调 AI / 改注册表。
 *
 * 🔴 GET 不取数、不写盘;阶段和数字都读日文件里程序算好的结果。
 * 🔴 只有写动作会调 AI(叙事),定时任务里只做确定性构建。
 */
import { localClock } from "../../notify.ts";
import { ServiceError, type ServiceContext } from "../../service.ts";
import { registerView } from "../../views.ts";
import { SCHEDULE_TZ } from "../schedule.ts";
import { tradeWindow, validDate } from "../shortline/history.ts";
import { buildThemes, readDaily, readThemeView } from "./build.ts";
import { narrateThemes } from "./narrative.ts";
import { applyManual, loadRegistry, saveRegistry, type ManualPayload } from "./registry.ts";

const MANUAL_OPS = ["update_node", "add_edge", "remove_edge", "reset_node", "confirm_theme"];

function dateOf(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !validDate(v)) throw new ServiceError("bad_request", "date 要写成 YYYY-MM-DD");
  return v;
}

function viewOf(ctx: ServiceContext, date?: unknown) {
  return readThemeView(ctx, typeof date === "string" ? date : null);
}

async function buildAction(ctx: ServiceContext, body: Record<string, unknown>, signal: AbortSignal) {
  const today = localClock(new Date(), SCHEDULE_TZ).day;
  const date = dateOf(body.date, today);
  const built = await buildThemes(ctx, date, { persist: true, force: body.force === true, signal });
  if (!built.available) return { ...viewOf(ctx, date), build: { ok: false, reason: built.reason } };
  return {
    ...viewOf(ctx, date),
    build: { ok: true, settled: built.settled, partial: built.partial, gaps: built.gaps },
  };
}

async function narrateAction(ctx: ServiceContext, body: Record<string, unknown>, signal: AbortSignal) {
  const fallback = viewOf(ctx).default_date;
  const date = dateOf(body.date, fallback);
  const r = await narrateThemes(ctx, { ...body, date }, signal);
  return {
    ...viewOf(ctx, date),
    narrative: { warnings: r.warnings, applied: r.applied, skipped: r.skipped },
  };
}

async function backfillAction(ctx: ServiceContext, body: Record<string, unknown>, signal: AbortSignal) {
  const now = new Date();
  const clock = localClock(now, SCHEDULE_TZ);
  const end = dateOf(body.date, clock.day);
  if (end > clock.day) throw new ServiceError("bad_request", `${end} 还没到`);
  const force = body.force === true;
  // 交易日从指数日 K 里取,不用日历减法;结尾那天不是交易日时构建会失败并写明原因
  const { window, gap } = await tradeWindow(ctx, end, 7, signal);
  const results: { date: string; ok: boolean; reason?: string; refreshed?: boolean; partial?: boolean }[] = [];
  for (const d of window) {
    if (signal.aborted) throw new ServiceError("aborted", "已取消");
    if (d > clock.day) { results.push({ date: d, ok: false, reason: "还没到这一天" }); continue; }
    if (d === clock.day && clock.hm < "15:05") { results.push({ date: d, ok: false, reason: "今天还没收盘,15:05 后再补" }); continue; }
    const cached = readDaily(ctx.dataRoot, d);
    if (!force && cached && !cached.partial) { results.push({ date: d, ok: true, reason: "已有快照" }); continue; }
    try {
      const r = await buildThemes(ctx, d, { persist: true, force: true, signal });
      results.push(r.available
        ? { date: d, ok: true, refreshed: true, partial: r.partial, ...(r.partial ? { reason: r.gaps.slice(0, 3).join(";") } : {}) }
        : { date: d, ok: false, reason: r.reason });
    } catch (e) {
      if (signal.aborted) throw e;
      results.push({ date: d, ok: false, reason: e instanceof Error ? e.message.slice(0, 80) : "没构建出来" });
    }
  }
  return { ...viewOf(ctx, end), backfill: { gap, results } };
}

async function registryAction(ctx: ServiceContext, body: Record<string, unknown>) {
  const op = typeof body.op === "string" ? body.op : "";
  if (!MANUAL_OPS.includes(op)) {
    throw new ServiceError("bad_request", `只支持 ${MANUAL_OPS.join(" / ")}`);
  }
  const reg = loadRegistry(ctx.dataRoot);
  const payload: ManualPayload = {
    theme_id: body.theme_id, parent_id: body.parent_id, level: body.level, aliases: body.aliases,
    name: body.name, from: body.from, to: body.to, type: body.type,
  };
  const next = applyManual(reg, op, payload);
  await saveRegistry(ctx.dataRoot, next);
  return viewOf(ctx, body.date);
}

async function themeEvolutionAct(ctx: ServiceContext, body: Record<string, unknown>, signal: AbortSignal) {
  const action = body.action;
  if (action === "build") return buildAction(ctx, body, signal);
  if (action === "narrate") return narrateAction(ctx, body, signal);
  if (action === "backfill") return backfillAction(ctx, body, signal);
  if (action === "registry") return registryAction(ctx, body);
  throw new ServiceError("bad_request", "只支持 action=build / narrate / backfill / registry");
}

registerView({
  id: "theme_evolution",
  label: "题材演进",
  run: (ctx, query) => Promise.resolve(viewOf(ctx, query.date)),
  act: themeEvolutionAct,
});

export { themeEvolutionAct };
