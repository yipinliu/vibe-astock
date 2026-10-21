// 题材演进的 SSR:时间线缺日留空、树/详情只展示程序算好的事实、编辑表单显示后端错误。
import assert from "node:assert/strict";
import test from "node:test";
import { textOf, withRenderer } from "./helpers/render.ts";

const DATES = ["2026-10-09", "2026-10-10"];
const TIMELINES = [{
  theme_id: "t_aaaaaa", name: "AI算力", level: 2, parent_id: null, confirmed: true, dates: DATES,
  timeline: [
    { date: "2026-10-09", stage: "启动", limit_up: 2, highest: 2 },
    { date: "2026-10-10", stage: "高潮", limit_up: 5, highest: 3 },
  ],
}, {
  theme_id: "t_bbbbbb", name: "机器人", level: 3, parent_id: "t_aaaaaa", confirmed: false, dates: DATES,
  timeline: [
    { date: "2026-10-09", stage: "", limit_up: null, highest: null },
    { date: "2026-10-10", stage: "退潮", limit_up: 0, highest: 2 },
  ],
}];
const NODES = [{
  id: "t_aaaaaa", name: "AI算力", level: 2, parent_id: null, confirmed: true, manual: false,
  stage: "高潮", limit_up: 5, highest: 3, has_data: true,
}, {
  id: "t_bbbbbb", name: "机器人", level: 3, parent_id: "t_aaaaaa", confirmed: false, manual: false,
  stage: "退潮", limit_up: 0, highest: 2, has_data: true,
}];
const THEME = {
  theme_id: "t_aaaaaa", name: "AI算力", level: 2, parent_id: null, aliases: ["算力"],
  confirmed: true, manual: false, source_tags: ["AI算力", "算力"], stage: "高潮", stage_base: "rules",
  stage_reason: "涨停 5 只,最高 3 板", narrative: "涨停 5 只,最高 3 板,比前一日扩散。", ai_generated_at: "2026-10-10T09:00:00.000Z",
  ai: "测试模型",
  stats: {
    limit_up: 5, first_boards: 2, consec_boards: 3, highest: 3, broken: 1, limit_down: 0,
    broken_rate: 0.2, continuation_rate: 0.6, first_seal: "093000", last_seal: "143000", state: "扩散中",
  },
  core_stocks: [{
    code: "300001", name: "甲公司", roles: ["最高板", "回封"], boards: 3, label: "3板", first_seal: "093000",
    broken_times: 1, close: 12.5, change_pct: 10.02, turnover: 8.8, thesis: "订单增长",
  }],
  events: [{ time: "09:30", source: "涨停", kind: "momentum", text: "涨停 5 只,首封 09:30" }],
  signals: [{ type: "业绩", text: "订单增长 30%", topic_ids: ["t1"], institutions: ["机构A"] }],
  risks: ["订单持续性待验证"], consensus: ["机构A 看好订单"], contrarian: ["有人担心估值"],
  fund_flow: { net_today_yi: 12.5, net_pct: 3.2, board: "AI算力" },
  briefing_mentions: 2, issues: [],
};
const REGISTRY = {
  schema: 1, updated_at: "2026-10-10T09:00:00.000Z",
  themes: [{
    id: "t_aaaaaa", name: "AI算力", level: 2, parent_id: null, aliases: ["算力"], auto: true, manual: false,
    active: true, confirmed: true, first_seen: "2026-10-09", last_seen: "2026-10-10", evidence: { theme_tree: 2 },
  }, {
    id: "t_bbbbbb", name: "机器人", level: 3, parent_id: "t_aaaaaa", aliases: [], auto: true, manual: false,
    active: true, confirmed: false, first_seen: "2026-10-09", last_seen: "2026-10-10", evidence: { theme_tree: 1 },
  }],
  relations: [{ from: "t_aaaaaa", to: "t_bbbbbb", type: "上游", manual: false }],
};

test("全局时间线:数字是当天涨停家数,缺日显示空心点而不是 0", async () => {
  await withRenderer(async (r) => {
    const { ThemeOverview } = await r.load("/src/verticals/finance/theme_evolution/Overview.tsx");
    const html = r.html(ThemeOverview, { timelines: TIMELINES, dates: DATES, selectedId: "t_aaaaaa", onSelect: () => {} });
    const t = textOf(html);
    assert.match(t, /AI算力/);
    assert.match(t, /机器人/);
    assert.match(t, /10-09/);
    assert.match(t, /10-10/);
    assert.match(t, /不是 0/);
    assert.match(html, /title="这天没生成快照或没这个题材"/, "缺日留空");
    assert.match(html, /title="退潮 · 最高 2 板"/);
  });
});

test("题材树:层级缩进、阶段和候选标记", async () => {
  await withRenderer(async (r) => {
    const { ThemeTree } = await r.load("/src/verticals/finance/theme_evolution/Tree.tsx");
    const t = textOf(r.html(ThemeTree, { nodes: NODES, selectedId: "t_bbbbbb", onSelect: () => {} }));
    assert.match(t, /AI算力/);
    assert.match(t, /机器人/);
    assert.match(t, /高潮/);
    assert.match(t, /退潮/);
    assert.match(t, /候选/);
    assert.match(t, /人工确认过的节点不会被 AI 提案改动/);
  });
});

test("详情:规则阶段与理由、AI 解读、核心个股、事件与风险;不出现买卖建议", async () => {
  await withRenderer(async (r) => {
    const { ThemeDetail } = await r.load("/src/verticals/finance/theme_evolution/Detail.tsx");
    const html = r.html(ThemeDetail, {
      theme: THEME, timeline: TIMELINES[0], relations: [{ from: "AI算力", to: "机器人", type: "上游", manual: false }],
      busyNarrate: false, onNarrate: () => {}, onEdit: () => {},
    });
    const t = textOf(html);
    assert.match(t, /AI算力/);
    assert.match(t, /高潮/);
    assert.match(t, /涨停 5 只,最高 3 板/);
    assert.match(t, /AI 解读/);
    assert.match(t, /比前一日扩散/);
    assert.match(t, /甲公司/);
    assert.match(t, /最高板、回封/);
    assert.match(t, /订单增长 30%/);
    assert.match(t, /订单持续性待验证/);
    assert.match(t, /AI算力 → 机器人/);
    assert.match(t, /事实标签,不是推荐/);
    assert.doesNotMatch(t, /建议买入|目标价|强烈关注|置信度/);
    const missing = textOf(r.html(ThemeDetail, {
      theme: null, timeline: null, relations: [], busyNarrate: false, onNarrate: () => {}, onEdit: () => {},
    }));
    assert.match(missing, /从左边选一个题材看详情/);
  });
});

test("单题材时间线:缺日写「缺」,不当成 0", async () => {
  await withRenderer(async (r) => {
    const { ThemeTimelineStrip } = await r.load("/src/verticals/finance/theme_evolution/Timeline.tsx");
    const t = textOf(r.html(ThemeTimelineStrip, { timeline: TIMELINES[1] }));
    assert.match(t, /机器人|10-09/);
    assert.match(t, /缺/);
    assert.match(t, /0 只/);
    assert.match(t, /退潮/);
  });
});

test("层级编辑:节点 / 层级 / 别名 / 关系与后端错误原样显示", async () => {
  await withRenderer(async (r) => {
    const { ThemeEditor } = await r.load("/src/verticals/finance/theme_evolution/Editor.tsx");
    const html = r.html(ThemeEditor, {
      registry: REGISTRY, selectedId: "t_bbbbbb", relations: REGISTRY.relations,
      busy: false, error: "「机器人」的父节点必须正好高一级", onSave: () => {}, onClose: () => {},
    });
    const t = textOf(html);
    assert.match(t, /编辑题材层级/);
    assert.match(t, /人工改过的节点不再接受 AI 提案/);
    assert.match(t, /AI算力\(2 级\)/);
    assert.match(t, /机器人\(3 级\)/);
    assert.match(t, /保存层级/);
    assert.match(t, /确认题材/);
    assert.match(t, /恢复自动/);
    assert.match(t, /AI算力 → 机器人/);
    assert.match(t, /父节点必须正好高一级/);
    assert.match(html, /aria-label="删除关系"/);
    assert.match(t, /不合法会原样报错/);
  });
});
