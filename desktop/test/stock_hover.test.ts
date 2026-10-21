// 悬浮 K 线：工具输出解析、视口定位、两张小图的配置；SSR 只验名字仍可渲染。
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { textOf, withRenderer } from "./helpers/render.ts";

const DATA = {
  symbol: "600519", canonical: "600519.SH",
  intraday: { date: "2026-10-09", times: ["09:31", "09:32"], close: [10, 10.5], volume: [100, 200], prev_close: 9.9 },
  intraday_error: "",
  daily: {
    dates: ["2026-10-08", "2026-10-09"], open: [9.8, 10], high: [10.1, 10.6], low: [9.7, 9.9],
    close: [9.9, 10.5], volume: [1000, 1200], change: [null, 0.060606],
    ma5: [null, 10.2], ma20: [null, null],
  },
  daily_error: "",
  source: "腾讯 K 线", fetched_at: "2026-10-09T10:00:00+08:00",
  notes: ["分钟线不复权;日线为腾讯前复权近 60 根。"],
};

test("悬浮 K 线：解析工具输出、昨收涨跌、视口定位和两张图", async () => {
  await withRenderer(async (r) => {
    const V = await r.load("/src/verticals/finance/lib/hoverKlineView.ts");
    const ok = V.parseHoverKline({ ok: true, result: DATA });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.intraday.times.length, 2);
    assert.ok(Math.abs(V.intradayChange(ok.data.intraday) - (10.5 / 9.9 - 1)) < 1e-9);

    const bad = V.parseHoverKline({ ok: false, error: "不是 A 股" });
    assert.deepEqual(bad, { ok: false, error: "不是 A 股" });
    const empty = V.parseHoverKline({ ok: true, result: { ...DATA, intraday: null, daily: null, intraday_error: "超时", daily_error: "断网" } });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /超时/);

    // 视口右侧放不下 → 翻到左侧;底部放不下 → 上移
    assert.deepEqual(V.clampPosition(1000, 700, 480, 350, 1200, 800), { left: 508, top: 438 });
    assert.deepEqual(V.clampPosition(20, 30, 480, 350, 1200, 800), { left: 32, top: 14 });

    const palette = await r.load("/src/verticals/finance/components/ui/chartPalette.ts").then((m: any) => m.readPalette());
    const minute = V.intradayOption(ok.data.intraday, palette);
    assert.equal(minute.series[0].type, "line");
    assert.equal(minute.series[0].markLine.data[0].yAxis, 9.9);
    const daily = V.dailyOption(ok.data.daily, palette);
    assert.deepEqual(daily.series.map((s: any) => s.type), ["candlestick", "line", "line"]);
    assert.deepEqual(daily.series[0].data[1], [10, 10.5, 9.9, 10.6]);
  });
});

test("悬浮 K 线：名字照常渲染，不依赖 AI；SSR 不打开悬浮卡", async () => {
  await withRenderer(async (r) => {
    const { StockKlineHover } = await r.load("/src/verticals/finance/components/StockKlineHover.tsx");
    const html = r.html(StockKlineHover, { symbol: "600519", name: "贵州茅台" });
    assert.match(textOf(html), /贵州茅台/);
    assert.doesNotMatch(html, /role="dialog"/, "SSR 不打开悬浮卡");
    const withChild = r.html(StockKlineHover, { symbol: "600519", name: "贵州茅台", children: "茅台(自定义)" });
    assert.match(textOf(withChild), /茅台\(自定义\)/);
  });
});
