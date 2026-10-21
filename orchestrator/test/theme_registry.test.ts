/** 题材层级注册表:匹配、校验、人工保护、AI 提案合并、过期清理。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  allNames, applyManual, emptyRegistry, ensureTheme, loadRegistry, matchTheme,
  mergeProposal, pruneStale, registryFile, saveRegistry, validateRegistry, type ThemeRegistry,
} from "../src/finance/theme_evolution/registry.ts";

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "vra-theme-reg-"));

function registryWith(names: string[]): ThemeRegistry {
  const reg = emptyRegistry();
  for (const n of names) ensureTheme(reg, n, "2026-10-09", "test");
  return reg;
}

test("匹配:名称 / 别名不区分大小写,包含关系取最长,不活跃节点不匹配", () => {
  const reg = registryWith(["AI算力", "机器人"]);
  assert.equal(matchTheme(reg, "ai算力")?.name, "AI算力");
  assert.equal(matchTheme(reg, "算力")?.name, "AI算力", "双向包含且别名够长");
  assert.equal(matchTheme(reg, "AI算力芯片")?.name, "AI算力");
  assert.equal(matchTheme(reg, "光模块"), null);
  assert.equal(matchTheme(reg, "算"), null, "单个字不做包含匹配");
  assert.equal(ensureTheme(reg, "算力", "2026-10-09", "test").node.name, "AI算力");
  assert.ok(allNames(reg).includes("算力"), "匹配到的写法记成别名");

  const bot = matchTheme(reg, "机器人")!;
  bot.active = false;
  assert.equal(matchTheme(reg, "机器人"), null);
});

test("ensureTheme:同名 / 别名归并,证据按来源计数,新题材是未确认候选", () => {
  const reg = emptyRegistry();
  const a = ensureTheme(reg, "AI算力", "2026-10-09", "theme_tree");
  assert.equal(a.created, true);
  assert.equal(a.node.level, 2);
  assert.equal(a.node.parent_id, null, "未归并的题材可以没有父节点");
  assert.equal(a.node.confirmed, false);
  const b = ensureTheme(reg, "算力", "2026-10-10", "briefing");
  assert.equal(b.created, false);
  assert.equal(b.node.id, a.node.id);
  assert.deepEqual(b.node.evidence, { theme_tree: 1, briefing: 1 });
  assert.equal(b.node.first_seen, "2026-10-09");
  assert.equal(b.node.last_seen, "2026-10-10");
  assert.deepEqual(b.node.aliases, ["算力"]);
  validateRegistry(reg);
});

test("校验:重复名称、层级 / 父节点不匹配、关系不合法都要拒绝", () => {
  const dup = registryWith(["AI算力", "机器人"]);
  dup.themes[1]!.aliases = ["ai算力"];
  assert.throws(() => validateRegistry(dup), /同时属于两个题材/);

  const badLevel = registryWith(["AI算力"]);
  badLevel.themes[0]!.level = 1;
  badLevel.themes[0]!.parent_id = "t_aaaaaa";
  assert.throws(() => validateRegistry(badLevel), /一级题材/);

  const badParent = registryWith(["AI算力", "机器人"]);
  badParent.themes[0]!.level = 1;
  badParent.themes[0]!.parent_id = null;
  badParent.themes[1]!.level = 3;
  badParent.themes[1]!.parent_id = badParent.themes[0]!.id;
  assert.throws(() => validateRegistry(badParent), /正好高一级/);

  const badEdge = registryWith(["AI算力", "机器人"]);
  badEdge.relations.push({ from: badEdge.themes[0]!.id, to: badEdge.themes[0]!.id, type: "共振", manual: true });
  assert.throws(() => validateRegistry(badEdge), /不能指向自己/);
  badEdge.relations = [{ from: badEdge.themes[0]!.id, to: "t_zzzzzz", type: "共振", manual: false }];
  assert.throws(() => validateRegistry(badEdge), /不存在的节点/);
});

test("人工层级不被 AI 提案覆盖;未知名称、别名冲突跳过", () => {
  const reg = registryWith(["AI算力", "机器人", "光模块"]);
  const manual = applyManual(reg, "update_node", { theme_id: matchTheme(reg, "机器人")!.id });
  assert.equal(manual.themes.find((t) => t.name === "机器人")?.manual, true);

  const merged = mergeProposal(manual, {
    macro_directions: [{ name: "AI算力", rationale: "算力与机器人", members: ["AI算力", "机器人", "光模块", "不存在的题材"] }],
    relations: [{ from_name: "AI算力", to_name: "光模块", relation_type: "上游" }],
    aliases: { "光模块": ["CPO"] },
  });
  const byName = (name: string) => merged.registry.themes.find((t) => t.name === name)!;
  assert.equal(byName("AI算力").level, 2);
  assert.equal(byName("AI算力").parent_id, null);
  assert.equal(byName("光模块").parent_id, byName("AI算力").id);
  assert.equal(byName("光模块").level, 3);
  assert.equal(byName("机器人").parent_id, null, "人工节点不动");
  assert.ok(merged.skipped.some((s) => s.includes("机器人") && s.includes("人工")));
  assert.ok(merged.skipped.some((s) => s.includes("不存在的题材")));
  assert.ok(merged.skipped.some((s) => s.includes("宏观方向本身")));
  assert.deepEqual(merged.registry.relations.map((r) => r.type), ["上游"]);
  assert.deepEqual(byName("光模块").aliases, ["CPO"]);
  validateRegistry(merged.registry);

  // 人工节点连别名也不再接受 AI 追加
  const confirmed = applyManual(merged.registry, "confirm_theme", { theme_id: byName("光模块").id });
  const again = mergeProposal(confirmed, { macro_directions: [], relations: [], aliases: { "光模块": ["光通信"] } });
  assert.deepEqual(again.registry.themes.find((t) => t.name === "光模块")!.aliases, ["CPO"]);

  // 恢复自动 = 取消人工和「已确认」,重新成为 AI 可以归并的候选
  const reset = applyManual(confirmed, "reset_node", { theme_id: byName("光模块").id });
  const optical = reset.themes.find((t) => t.name === "光模块")!;
  assert.equal(optical.manual, false);
  assert.equal(optical.confirmed, false);
});

test("过期清理:自动节点 45 天没出现就停用,人工节点保留", () => {
  const reg = registryWith(["AI算力", "机器人"]);
  reg.themes[0]!.last_seen = "2026-09-01";
  reg.themes[1]!.last_seen = "2026-09-01";
  reg.themes[1]!.manual = true;
  pruneStale(reg, "2026-10-21");
  assert.equal(reg.themes[0]!.active, false);
  assert.equal(reg.themes[1]!.active, true);
});

test("落盘:写后读回;坏 JSON 报明确错误而不是当成空注册表", async () => {
  const root = tmpRoot();
  const reg = registryWith(["AI算力"]);
  await saveRegistry(root, reg);
  const got = loadRegistry(root);
  assert.deepEqual(got.themes.map((t) => t.name), ["AI算力"]);
  assert.ok(got.updated_at);

  fs.writeFileSync(registryFile(root), "{ 坏的");
  assert.throws(() => loadRegistry(root), /读不了/);
});
