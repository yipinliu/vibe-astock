/** 题材 AI 叙事:阶段仍由规则决定;数字 / 红线 / 未知题材被拒;层级提案不碰人工节点。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { localClock } from "../src/notify.ts";
import type { ServiceContext } from "../src/service.ts";
import { SCHEDULE_TZ } from "../src/finance/schedule.ts";
import { buildThemes, readDaily } from "../src/finance/theme_evolution/build.ts";
import {
  applyManual, loadRegistry, matchTheme, saveRegistry,
} from "../src/finance/theme_evolution/registry.ts";
import { narrateThemes, type Turn } from "../src/finance/theme_evolution/narrative.ts";

const today = () => localClock(new Date(), SCHEDULE_TZ).day;
const ctxOf = (dataRoot: string) => ({ dataRoot } as ServiceContext);
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "vra-theme-narr-"));

const rawTheme = (tag: string, limitUp = 2) => ({
  tag, state: "扩散中", limit_up: limitUp, first_boards: 1, consec_boards: 1, highest: 2,
  broken: 0, limit_down: 0, broken_rate: 0.1, first_seal: "093000", last_seal: "093000",
  continuation_rate: 0.6, members: [{ code: "300001", name: "甲", boards: 2, label: "2板", first_seal: "093000", broken_times: 0 }],
});

const fetchOf = (themes: unknown[]) => async (_ctx: ServiceContext, req: { endpoint: string }) => {
  if (req.endpoint === "cn_shortline_themes") {
    return { envelope: { status: "ok", extra: { settled: true, result: { tree: { available: true, prev_date: null, themes } } } } };
  }
  if (req.endpoint === "cn_shortline_theme_rotation") {
    return { envelope: { status: "ok", extra: { result: { rotation: { available: true, themes: [], missing_days: [] } } } } };
  }
  if (req.endpoint === "em_board_fund_flow" || req.endpoint === "tx_quotes_batch") return { envelope: { status: "ok", evidence: [] } };
  throw new Error(`unexpected ${req.endpoint}`);
};

async function setup(root: string, tags: string[]) {
  const built = await buildThemes(ctxOf(root), today(), { persist: true }, fetchOf(tags.map((t) => rawTheme(t))) as never);
  assert.ok(built.available);
  if (!built.available) throw new Error("build failed");
  return built;
}

test("叙事落地:AI 返回的 stage 字段被忽略,阶段 / 数字仍是规则算的", async () => {
  const root = tmpRoot();
  const built = await setup(root, ["AI算力"]);
  const id = built.themes[0]!.theme_id;
  const stage = built.themes[0]!.stage;
  const turn: Turn = async () => JSON.stringify({
    themes: [{ theme_id: id, narrative: "今日涨停 2 只,最高 2 板,延续率 60.0%。", stage: "高潮" }],
  });
  const r = await narrateThemes(ctxOf(root), { date: today(), ai: "测试模型" }, undefined, {
    turn, now: () => new Date("2026-10-21T08:00:00Z"),
  });
  const row = r.data.themes.find((t) => t.theme_id === id)!;
  assert.equal(row.stage, stage, "AI 不能改阶段");
  assert.equal(row.stage_base, "rules");
  assert.match(row.narrative, /今日涨停 2 只/);
  assert.equal(row.ai, "测试模型");
  assert.equal(row.ai_generated_at, "2026-10-21T08:00:00.000Z");
  const saved = readDaily(root, today())!;
  assert.equal(saved.themes.find((t) => t.theme_id === id)?.narrative, row.narrative);
});

test("叙事校验:快照外的数字、买卖建议、未知题材都剔除", async () => {
  const root = tmpRoot();
  const built = await setup(root, ["AI算力"]);
  const id = built.themes[0]!.theme_id;
  const cases = [
    { narrative: "今日涨幅 7.5%,继续走强。", match: /找不到的数字/ },
    { narrative: "建议买入,目标价 20 元。", match: /理财红线/ },
  ];
  for (const c of cases) {
    const turn: Turn = async () => JSON.stringify({ themes: [{ theme_id: id, narrative: c.narrative }] });
    await assert.rejects(
      narrateThemes(ctxOf(root), { date: today() }, undefined, { turn }),
      c.match,
    );
  }
  const unknown: Turn = async () => JSON.stringify({ themes: [{ theme_id: "t_zzzzzz", narrative: "涨停 2 只。" }] });
  await assert.rejects(
    narrateThemes(ctxOf(root), { date: today() }, undefined, { turn: unknown }),
    /不存在的题材/,
  );
  assert.equal(readDaily(root, today())?.themes.find((t) => t.theme_id === id)?.narrative, "", "被剔除的叙事不落盘");
});

test("层级提案:只合并到 auto 节点,人工节点和未知名称跳过", async () => {
  const root = tmpRoot();
  await setup(root, ["AI算力", "机器人", "光模块"]);

  const reg = loadRegistry(root);
  const robot = matchTheme(reg, "机器人")!;
  await saveRegistry(root, applyManual(reg, "update_node", { theme_id: robot.id }));

  const turn: Turn = async (message) => {
    if (message.includes("这次只做层级提案")) {
      return JSON.stringify({
        macro_directions: [{ name: "AI算力", rationale: "算力主线", members: ["机器人", "光模块", "不存在的题材"] }],
        relations: [{ from_name: "AI算力", to_name: "光模块", relation_type: "上游" }],
        aliases: { "光模块": ["CPO"] },
      });
    }
    return JSON.stringify({ themes: [{ theme_id: matchTheme(loadRegistry(root), "AI算力")!.id, narrative: "今日涨停 2 只。" }] });
  };
  const r = await narrateThemes(ctxOf(root), { date: today(), ai: "测试模型" }, undefined, { turn });
  assert.ok(r.applied.some((s) => s.includes("光模块")));
  assert.ok(r.skipped.some((s) => s.includes("机器人") && s.includes("人工")));
  assert.ok(r.skipped.some((s) => s.includes("不存在的题材")));
  assert.ok(r.warnings.length >= 2);

  const after = loadRegistry(root);
  const bot = matchTheme(after, "机器人")!;
  const optical = matchTheme(after, "光模块")!;
  const ai = matchTheme(after, "AI算力")!;
  assert.equal(bot.parent_id, null, "人工节点不动");
  assert.equal(optical.parent_id, ai.id);
  assert.ok(optical.aliases.includes("CPO"));
  assert.deepEqual(after.relations.map((x) => x.type), ["上游"]);

  const saved = readDaily(root, today())!;
  assert.deepEqual(saved.ai_hierarchy?.applied, r.applied);
  assert.deepEqual(saved.ai_hierarchy?.skipped, r.skipped);
  assert.equal(fs.existsSync(path.join(root, "shortline", "themes", "registry.json")), true);
});
