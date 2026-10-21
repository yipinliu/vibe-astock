/** 私人订阅抓取只许服务端视图调用:不出现工具目录、对话 run_tool 和原始工具入口都拒绝。 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "../src/finance/register.ts";
import { assistantTools, listTools, runToolRequest, type ServiceContext } from "../src/service.ts";

const ctx = {} as ServiceContext;

test("briefing_crawl 不在工具目录里,普通工具照常", () => {
  const names = listTools().map((t) => t.name);
  assert.ok(!names.includes("briefing_crawl"));
  assert.ok(names.includes("kline") && names.includes("stock_tech"));
});

test("对话的 run_tool 拒绝隐藏工具", async () => {
  const tools = assistantTools(ctx);
  const runTool = tools.find((t) => t.name === "run_tool");
  assert.ok(runTool);
  const run = runTool.run as unknown as (args: unknown, signal: AbortSignal) => Promise<unknown>;
  await assert.rejects(
    async () => run({ name: "briefing_crawl", input: {} }, new AbortController().signal),
    /不对对话开放/,
  );
});

test("原始工具入口拒绝隐藏工具", async () => {
  await assert.rejects(
    runToolRequest(ctx, "briefing_crawl", { input: {}, executionMode: "direct" }),
    /只由页面在服务端调用/,
  );
});
