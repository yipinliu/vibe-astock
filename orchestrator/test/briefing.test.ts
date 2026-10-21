/** 研报简报:本地合并/清理、AI 输出落地校验、个股去评级与技术读数。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { localClock } from "../src/notify.ts";
import { SCHEDULE_TZ } from "../src/finance/schedule.ts";
import type { ServiceContext } from "../src/service.ts";
import {
  listArchiveDates, readBriefingDay, readState, syncBriefings, type BriefingTopic,
} from "../src/finance/briefing/archive.ts";
import {
  analyzeBriefings, analyzeDossier, readAnalysis, readStocks, type Turn,
} from "../src/finance/briefing/analysis.ts";

const today = () => localClock(new Date(), SCHEDULE_TZ).day;
const ctxOf = (dataRoot: string) => ({ dataRoot } as ServiceContext);

function topic(id: string, title: string, text = "贵州茅台 600519 订单增长 30%"): BriefingTopic {
  return {
    topic_id: id, type: "talk", title, author: "作者", institution: "机构A", text,
    create_time: `${today()}T08:00:00`, images: [], files: [], digests: false,
    likes: 0, comments_count: 0, reading_count: 0,
  };
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vra-briefing-"));
}

test("归档:抓取结果按日期合并、去重、清理 7 天前", async () => {
  const root = tmpRoot();
  const old = "2020-01-01";
  const dir = path.join(root, "briefing", "archive");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${old}.json`), JSON.stringify({ schema: 1, date: old, updated_at: "", topics: [] }));

  let batch = [topic("t1", "第一版"), topic("t2", "第二篇")];
  const run = async (_ctx: ServiceContext, name: string) => {
    assert.equal(name, "briefing_crawl");
    return { ok: true, result: { topics: batch, fetched_at: "2026-10-09T10:00:00Z" } };
  };
  const first = await syncBriefings(ctxOf(root), "123456", undefined, run);
  assert.deepEqual(first.dates, [today()]);
  assert.equal(readBriefingDay(root)?.topics.length, 2);

  batch = [topic("t1", "第一版(更新)"), topic("t3", "第三篇")];
  await syncBriefings(ctxOf(root), "123456", undefined, run);
  const day = readBriefingDay(root);
  assert.equal(day?.topics.length, 3, "同一 topic_id 合并而不是重复");
  assert.equal(day?.topics.find((t) => t.topic_id === "t1")?.title, "第一版(更新)");
  assert.equal(fs.existsSync(path.join(dir, `${old}.json`)), false, "超过 7 天的归档要清掉");
  const state = readState(root);
  assert.equal(state.last_error, null);
  assert.ok(state.last_sync);
  assert.deepEqual(listArchiveDates(root), [today()]);
});

test("AI 分析:资料 id、机构、数字和红线逐条核对", () => {
  const d = {
    text: "【资料 t1】机构:机构A\n<<<\n贵州茅台 600519 订单增长 30%\n>>>",
    ids: new Set(["t1"]), institutions: new Map([["t1", "机构A"]]), numbers: [600519, 30], count: 1,
  };
  const ok = analyzeDossier({
    themes: [{ name: "AI算力", key_points: ["订单增长 30%"], topic_ids: ["t1"] }],
    consensus: ["机构A 订单增长"], contrarian: [], risks: [],
    signals: [{ type: "业绩", text: "订单增长 30%", topic_ids: ["t1"] }],
  }, d);
  assert.equal(ok.analysis.themes[0]?.mentions, 1);
  assert.deepEqual(ok.analysis.themes[0]?.institutions, ["机构A"]);
  assert.equal(ok.analysis.signals[0]?.institutions[0], "机构A");

  assert.throws(() => analyzeDossier({
    themes: [{ name: "AI算力", key_points: ["订单增长 30%"], topic_ids: ["编造的id"] }], signals: [],
  }, d), /没有产出/);

  assert.throws(() => analyzeDossier({
    themes: [{ name: "AI算力", key_points: ["建议买入"], topic_ids: ["t1"] }], signals: [],
  }, d), /没有产出/);

  assert.throws(() => analyzeDossier({
    themes: [{ name: "AI算力", key_points: ["增长 99%"], topic_ids: ["t1"] }], signals: [],
  }, d), /没有产出/);
});

test("完整分析:主题/信号落盘、个股代码解析与技术读数、评级字段被丢弃", async () => {
  const root = tmpRoot();
  const dir = path.join(root, "briefing", "archive");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${today()}.json`), JSON.stringify({
    schema: 1, date: today(), updated_at: "", topics: [topic("t1", "贵州茅台纪要")],
  }));

  const turn: Turn = async (message) => message.includes("stock_name")
    ? JSON.stringify({
      stocks: [
        { stock_name: "贵州茅台", stock_code: "600519", mention_type: "深度分析", thesis: "订单增长 30%", metrics: "", topic_ids: ["t1"], rating: "强烈关注", confidence: 0.9 },
        { stock_name: "宁德时代", stock_code: "", mention_type: "简要点名", thesis: "行业举例", metrics: "", topic_ids: ["t1"] },
      ],
    })
    : JSON.stringify({
      themes: [{ name: "AI算力", key_points: ["订单增长 30%"], topic_ids: ["t1"] }],
      consensus: ["机构A 订单增长"], contrarian: [], risks: [],
      signals: [{ type: "业绩", text: "订单增长 30%", topic_ids: ["t1"] }],
    });

  const run = async (_ctx: ServiceContext, name: string) => {
    if (name === "search") {
      return { ok: true, result: { items: [{ query: "宁德时代", pick: { symbol: "300750", market: "CN" } }] } };
    }
    assert.equal(name, "stock_tech");
    return {
      ok: true,
      result: {
        items: [
          { symbol: "600519", ok: true, facts: { close: 1500, ma20: 1400, ret20: 0.1 } },
          { symbol: "300750", ok: true, facts: { close: 200, ma20: 190 } },
        ],
      },
    };
  };

  const got = await analyzeBriefings(ctxOf(root), { date: today(), scope: "day", ai: "测试模型" }, undefined, turn, run);
  assert.equal(got.analysis.themes[0]?.institutions[0], "机构A");
  assert.equal(got.analysis.signals[0]?.type, "业绩");
  assert.ok(got.stocks.stocks.length, `个股没解析出来:${JSON.stringify(got.stocks)}`);
  const maotai = got.stocks.stocks.find((s) => s.stock_name === "贵州茅台")!;
  assert.equal(maotai.stock_code, "600519");
  assert.equal(maotai.tech?.close, 1500);
  const catl = got.stocks.stocks.find((s) => s.stock_name === "宁德时代")!;
  assert.equal(catl.stock_code, "300750", "没有代码时用搜索唯一匹配补全");
  assert.equal(catl.tech?.close, 200);
  assert.equal("rating" in maotai, false, "产品自己的评级字段必须丢掉");
  assert.equal("confidence" in maotai, false);

  assert.ok(readAnalysis(root, today()));
  assert.ok(readStocks(root, today()));
});

test("没有归档时不白调 AI", async () => {
  const root = tmpRoot();
  const turn: Turn = async () => { throw new Error("不该调用"); };
  await assert.rejects(
    analyzeBriefings(ctxOf(root), { date: "2026-10-09", scope: "day" }, undefined, turn),
    /先同步/,
  );
});
