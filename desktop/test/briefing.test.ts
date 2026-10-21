// 研报简报的 SSR:分析、正文、个股提及都只展示用户看得到的事实;不出现产品自己的评级/推荐。
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { textOf, withRenderer } from "./helpers/render.ts";

const TOPIC = {
  topic_id: "t1", type: "talk", title: "贵州茅台纪要", author: "作者", institution: "机构A",
  text: "贵州茅台 600519 订单增长 30%", create_time: "2026-10-09T08:00:00",
  images: ["https://example.com/a.png"], files: [{ name: "附件.pdf", url: "https://example.com/a.pdf" }],
  digests: true, likes: 0, comments_count: 0, reading_count: 0,
};
const ANALYSIS = {
  schema: 1, date: "2026-10-09", scope: "day", generated_at: "2026-10-09T09:00:00", ai: "测试模型", topic_ids: ["t1"],
  themes: [{ name: "AI算力", mentions: 1, key_points: ["订单增长 30%"], topic_ids: ["t1"], institutions: ["机构A"] }],
  consensus: ["机构A 订单增长"], contrarian: ["有人担心估值"], risks: ["订单持续性待验证"],
  signals: [{ type: "业绩", text: "订单增长 30%", topic_ids: ["t1"], institutions: ["机构A"] }],
  warnings: ["主题「X」有原文里找不到的数字(99),已剔除"],
};
const STOCKS = {
  schema: 1, date: "2026-10-09", scope: "day", generated_at: "2026-10-09T09:00:00", ai: "测试模型", topic_ids: ["t1"],
  stocks: [{
    stock_name: "贵州茅台", stock_code: "600519", mention_type: "深度分析", thesis: "订单增长 30%", metrics: "PE 18x",
    topic_ids: ["t1"], institutions: ["机构A"],
    tech: { close: 1500, ma20: 1400, ret20: 0.1, from_high: -0.05, vol_ratio_5_20: 1.1 }, tech_error: null,
  }, {
    stock_name: "宁德时代", stock_code: "", mention_type: "简要点名", thesis: "行业举例", metrics: "",
    topic_ids: ["t1"], institutions: ["机构B"], tech: null, tech_error: "未识别 A 股代码",
  }],
  warnings: ["个股提取有一批没通过核对"],
};

test("AI 解读:主题/共识/分歧/信号/风险与剔除警告都画出来", async () => {
  await withRenderer(async (r) => {
    const { AnalysisPanel } = await r.load("/src/verticals/finance/briefing/AnalysisPanel.tsx");
    const t = textOf(r.html(AnalysisPanel, { analysis: ANALYSIS, stale: true, busy: false, onAnalyze: () => {}, onPickTopic: () => {} }));
    assert.match(t, /AI 解读/);
    assert.match(t, /AI算力/);
    assert.match(t, /订单增长 30%/);
    assert.match(t, /机构A/);
    assert.match(t, /共识/);
    assert.match(t, /有人担心估值/);
    assert.match(t, /业绩/);
    assert.match(t, /订单持续性待验证/);
    assert.match(t, /没通过核对/);
    assert.match(t, /建议重新生成/);
    assert.doesNotMatch(t, /建议买入|强烈关注|目标价/);
  });
});

test("AI 解读:还没有分析时给出生成入口", async () => {
  await withRenderer(async (r) => {
    const { AnalysisPanel } = await r.load("/src/verticals/finance/briefing/AnalysisPanel.tsx");
    const t = textOf(r.html(AnalysisPanel, { analysis: null, stale: false, busy: false, onAnalyze: () => {}, onPickTopic: () => {} }));
    assert.match(t, /还没生成 AI 解读/);
    assert.match(t, /生成 AI 解读/);
  });
});

test("简报正文:机构/标题/正文/附件链接;远程图片不自动加载", async () => {
  await withRenderer(async (r) => {
    const { FeedPanel } = await r.load("/src/verticals/finance/briefing/FeedPanel.tsx");
    const html = r.html(FeedPanel, { topics: [TOPIC], selectedId: "t1", onSelect: () => {} });
    const t = textOf(html);
    assert.match(t, /机构A/);
    assert.match(t, /贵州茅台纪要/);
    assert.match(t, /订单增长 30%/);
    assert.match(t, /附件.pdf/);
    assert.doesNotMatch(html, /<img\b/, "不自动加载远程图片");
    const empty = textOf(r.html(FeedPanel, { topics: [], selectedId: null, onSelect: () => {} }));
    assert.match(empty, /还没有归档的简报/);
  });
});

test("个股提及:机构事实 + 技术读数;产品自己的评级/置信度不显示", async () => {
  await withRenderer(async (r) => {
    const { StocksPanel } = await r.load("/src/verticals/finance/briefing/StocksPanel.tsx");
    const withRating = {
      ...STOCKS,
      stocks: STOCKS.stocks.map((s) => ({ ...s, rating: "强烈关注", confidence: 0.9 })),
    };
    const t = textOf(r.html(StocksPanel, { stocks: withRating }));
    assert.match(t, /贵州茅台/);
    assert.match(t, /600519/);
    assert.match(t, /订单增长 30%/);
    assert.match(t, /PE 18x/);
    assert.match(t, /MA20 1400/);
    assert.match(t, /未识别 A 股代码/);
    assert.doesNotMatch(t, /强烈关注|评级理由|90%/);
    assert.match(t, /不是推荐/);
  });
});
