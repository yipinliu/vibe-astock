/** 题材演进日快照:阶段规则、成员归并、缺数不当 0、timeline、GET 只读。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { localClock } from "../src/notify.ts";
import { runView } from "../src/views.ts";
import type { ServiceContext } from "../src/service.ts";
import { SCHEDULE_TZ } from "../src/finance/schedule.ts";
import {
  buildThemes, dailyFile, detectStage, readDaily, type ThemeStats,
} from "../src/finance/theme_evolution/build.ts";
import {
  ensureTheme, emptyRegistry, registryFile, saveRegistry,
} from "../src/finance/theme_evolution/registry.ts";
import "../src/finance/theme_evolution/register.ts";

const today = () => localClock(new Date(), SCHEDULE_TZ).day;
const afterClose = () => new Date(`${today()}T16:00:00+08:00`);
const ctxOf = (dataRoot: string) => ({ dataRoot } as ServiceContext);
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "vra-themes-"));

/** 从今天往前 n 个日历日(只用来摆日文件,不判断交易日) */
function dayBefore(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type BuildFetch = NonNullable<Parameters<typeof buildThemes>[3]>;

function rawTheme(tag: string, limitUp: number, extra: Record<string, unknown> = {}) {
  return {
    tag, state: "扩散中", limit_up: limitUp, first_boards: Math.max(0, limitUp - 1), consec_boards: 1,
    highest: 2, broken: 0, limit_down: 0, broken_rate: 0.1, first_seal: "093000", last_seal: "093000",
    continuation_rate: 0.6, members: [], ...extra,
  };
}

const member = (code: string, name: string, boards = 1, extra: Record<string, unknown> = {}) =>
  ({ code, name, boards, label: `${boards}板`, first_seal: "093000", broken_times: 0, ...extra });

const ev = (key: string, field: string, value: unknown, note = "") => ({ record_key: key, field, value, note, period: today() });

function fakeFetch(opts: {
  themes?: unknown[]; themesStatus?: string; reason?: string; settled?: boolean;
  rotation?: unknown[]; flow?: unknown[]; quotes?: unknown[]; calls?: string[];
}): BuildFetch {
  return async (_ctx, req) => {
    opts.calls?.push(req.endpoint);
    if (req.endpoint === "cn_shortline_themes") {
      if (opts.themesStatus === "failed") return { envelope: { status: "failed", reason: opts.reason ?? "没取到" } };
      return {
        envelope: {
          status: opts.themesStatus ?? "ok",
          extra: { settled: opts.settled ?? true, result: { tree: { available: true, prev_date: null, themes: opts.themes ?? [] } } },
        },
      };
    }
    if (req.endpoint === "cn_shortline_theme_rotation") {
      return { envelope: { status: "ok", extra: { result: { rotation: { available: true, themes: opts.rotation ?? [], missing_days: [] } } } } };
    }
    if (req.endpoint === "em_board_fund_flow") return { envelope: { status: "ok", evidence: opts.flow ?? [] } };
    if (req.endpoint === "tx_quotes_batch") return { envelope: { status: "ok", evidence: opts.quotes ?? [] } };
    throw new Error(`unexpected endpoint ${req.endpoint}`);
  };
}

const stats = (over: Partial<ThemeStats> = {}): ThemeStats => ({
  limit_up: 3, first_boards: 1, consec_boards: 2, highest: 2, broken: 0, limit_down: 0,
  broken_rate: 0.2, continuation_rate: 0.6, first_seal: "093000", last_seal: null, state: "扩散中", ...over,
});

test("阶段规则:退潮 > 发酵 > 高潮 > 启动 > 维持,按既定优先级", () => {
  assert.equal(detectStage(stats({ limit_down: 1 }), null, null, 0).stage, "退潮");
  assert.equal(detectStage(stats({ broken_rate: 0.5 }), null, null, 0).stage, "退潮");
  assert.equal(detectStage(stats({ continuation_rate: 0.1, limit_up: 2 }), null, null, 0).stage, "退潮");
  assert.equal(detectStage(stats({ limit_up: 3 }), 4, 5, 0).stage, "退潮", "连续两天递减");
  assert.equal(detectStage(stats({ limit_up: 0 }), 2, 1, 0).stage, "退潮");
  assert.equal(detectStage(stats({ limit_up: 1 }), null, null, 2).stage, "发酵");
  assert.equal(detectStage(stats({ limit_up: 4, highest: 3 }), null, null, 0).stage, "高潮");
  assert.equal(detectStage(stats({ limit_up: 3, state: "扩散中", continuation_rate: 0.5 }), null, null, 0).stage, "高潮");
  assert.equal(detectStage(stats({ limit_up: 2, first_boards: 2 }), null, null, 0).stage, "启动");
  assert.equal(detectStage(stats({ limit_up: 1, first_boards: 1, continuation_rate: 0.6 }), 1, null, 0).stage, "维持");
  // 跌停和炸板同时出现时先判退潮,理由写第一条命中的
  assert.match(detectStage(stats({ limit_down: 2, broken_rate: 0.8 }), null, null, 0).reason, /跌停/);
});

test("构建:同名 / 别名合组、成员按代码去重、行情与资金流只补当天", async () => {
  const root = tmpRoot();
  const reg = emptyRegistry();
  const node = ensureTheme(reg, "AI算力", today(), "test").node;
  ensureTheme(reg, "算力", today(), "test");
  await saveRegistry(root, reg);
  const before = fs.readFileSync(registryFile(root), "utf8");

  const calls: string[] = [];
  const data = await buildThemes(ctxOf(root), today(), {}, fakeFetch({
    calls,
    themes: [
      rawTheme("AI算力", 2, { members: [member("300001", "甲", 1), member("300002", "乙", 2)] }),
      rawTheme("算力", 3, { members: [member("300002", "乙", 2), member("300003", "丙", 3, { broken_times: 1 })] }),
    ],
    rotation: [{ status: "连续 3 天" }, { status: "连续 2 天" }, { status: "连续 2 天" }],
    flow: [ev("AI算力", "board_main_net_today", 12.5, "AI算力 排名 1"), ev("AI算力", "board_main_pct_today", 3.2, "AI算力 排名 1")],
    quotes: [
      ev("sz300001", "close", 10.5), ev("sz300001", "change_pct", 2.3), ev("sz300001", "turnover_pct", 8.8),
    ],
  }));

  assert.ok(data.available);
  if (!data.available) return;
  assert.equal(data.themes.length, 1, "两个涨停原因归到同一个题材");
  const row = data.themes[0]!;
  assert.equal(row.theme_id, node.id);
  assert.deepEqual(row.source_tags, ["AI算力", "算力"]);
  assert.equal(row.stats.limit_up, 3, "同一题材取涨停数最多的那份统计");
  assert.match(row.issues.join(" "), /合并了 2 个来源标签/);
  assert.deepEqual(row.core_stocks.map((s) => s.code), ["300003", "300002", "300001"], "成员按代码去重、按板数排");
  assert.equal(row.core_stocks.find((s) => s.code === "300003")?.roles.includes("回封"), true);
  assert.equal(row.core_stocks.find((s) => s.code === "300001")?.close, 10.5);
  assert.equal(row.fund_flow?.net_today_yi, 12.5);
  assert.equal(data.rotation_quality, "主线延续");
  assert.equal(fs.readFileSync(registryFile(root), "utf8"), before, "persist=false 不改注册表");
  assert.equal(fs.existsSync(dailyFile(root, today())), false, "persist=false 不写日文件");
});

test("历史日期不拿今天的资金流和行情冒充", async () => {
  const root = tmpRoot();
  const calls: string[] = [];
  const data = await buildThemes(ctxOf(root), "2026-09-30", {}, fakeFetch({
    calls, themes: [rawTheme("AI算力", 2)],
  }));
  assert.ok(data.available);
  assert.deepEqual(calls, ["cn_shortline_themes", "cn_shortline_theme_rotation"]);
  assert.ok(!data.available || data.gaps.some((g) => g.includes("只给当天")));
});

test("timeline:没生成 / 没这个题材的日子是 null,不是 0", async () => {
  const root = tmpRoot();
  const reg = emptyRegistry();
  const node = ensureTheme(reg, "AI算力", dayBefore(2), "test").node;
  await saveRegistry(root, reg);

  const put = (day: string, themes: unknown[]) => {
    fs.mkdirSync(path.dirname(dailyFile(root, day)), { recursive: true });
    fs.writeFileSync(dailyFile(root, day), JSON.stringify({ schema: 1, available: true, date: day, themes }));
  };
  put(dayBefore(2), [{ theme_id: node.id, stage: "维持", stats: { limit_up: 0, highest: 0 } }]);
  put(dayBefore(1), []);

  const data = await buildThemes(ctxOf(root), today(), {}, fakeFetch({ themes: [rawTheme("AI算力", 2)] }));
  assert.ok(data.available);
  if (!data.available) return;
  const line = data.all_timelines.find((t) => t.theme_id === node.id);
  assert.ok(line);
  assert.deepEqual(line!.timeline.map((p) => [p.date, p.limit_up]), [
    [dayBefore(2), 0], [dayBefore(1), null], [today(), 2],
  ]);
  assert.equal(line!.timeline[0]!.stage, "维持", "空池成功取到是 0");
  assert.equal(line!.timeline[1]!.stage, "", "没这个题材的行按缺数处理");
});

test("构建失败写原因,不落盘", async () => {
  const root = tmpRoot();
  const got = await buildThemes(ctxOf(root), today(), { persist: true, now: afterClose() }, fakeFetch({ themesStatus: "failed", reason: "源站超时" }));
  assert.deepEqual(got, { available: false, date: today(), reason: "源站超时" });
  assert.equal(fs.existsSync(path.join(root, "shortline")), false);
});

test("盘中不落盘:收盘前构建只给内存结果,刷新后仍要重新构建", async () => {
  const root = tmpRoot();
  const beforeClose = new Date(`${today()}T10:00:00+08:00`);
  await assert.rejects(
    buildThemes(ctxOf(root), today(), { persist: true, now: beforeClose }, fakeFetch({ themes: [rawTheme("AI算力", 2)] })),
    /还没收盘/,
  );
  assert.equal(fs.existsSync(dailyFile(root, today())), false);
  const draft = await buildThemes(ctxOf(root), today(), { persist: false, now: beforeClose }, fakeFetch({ themes: [rawTheme("AI算力", 2)] }));
  assert.ok(draft.available);
  assert.equal(fs.existsSync(dailyFile(root, today())), false);
});

test("GET 只读:不创建目录、不改日文件和注册表", async () => {
  const root = tmpRoot();
  const ctx = ctxOf(root);
  const signal = new AbortController().signal;
  const empty = await runView(ctx, "theme_evolution", { date: today() }, signal) as { data: unknown; needs_build: boolean };
  assert.equal(empty.data, null);
  assert.equal(empty.needs_build, true);
  assert.equal(fs.existsSync(path.join(root, "shortline")), false, "GET 不能顺手创建注册表目录");

  const built = await buildThemes(ctx, today(), { persist: true, now: afterClose() }, fakeFetch({ themes: [rawTheme("AI算力", 2)] }));
  assert.ok(built.available);
  const daily = fs.readFileSync(dailyFile(root, today()), "utf8");
  const reg = fs.readFileSync(registryFile(root), "utf8");
  const view = await runView(ctx, "theme_evolution", { date: today() }, signal) as { data: { date: string } | null };
  assert.equal(view.data?.date, today());
  assert.equal(fs.readFileSync(dailyFile(root, today()), "utf8"), daily);
  assert.equal(fs.readFileSync(registryFile(root), "utf8"), reg);
  assert.ok(readDaily(root, today()));
});
