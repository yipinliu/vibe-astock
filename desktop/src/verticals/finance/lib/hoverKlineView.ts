/**
 * 悬浮 K 线工具（backtest.hover_kline）的解析与两张小图的 ECharts 配置。
 * 只画行情：红涨绿跌；不画买卖点、信号或任何倾向。
 */
import type { ChartPalette } from "./backtestView.ts";
import { fmtPrice } from "./klineView.ts";

type Obj = Record<string, unknown>;
type Num = number | null;

export interface HoverIntraday {
  date: string;
  times: string[];
  close: Num[];
  volume: Num[];
  /** 前一交易日收盘（日线里能对上时才有） */
  prev_close: number | null;
}
export interface HoverDaily {
  dates: string[];
  open: Num[]; high: Num[]; low: Num[]; close: Num[]; volume: Num[];
  change: Num[];
  ma5: Num[]; ma20: Num[];
}
export interface HoverKlineData {
  symbol: string; canonical: string;
  intraday: HoverIntraday | null; intraday_error: string;
  daily: HoverDaily | null; daily_error: string;
  source: string; fetched_at: string | null; notes: string[];
}
export type HoverKlineResult = { ok: true; data: HoverKlineData } | { ok: false; error: string };

const obj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numArr = (v: unknown, n: number): Num[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => x === null || finite(x)) ? (v as Num[]) : null;
const strArr = (v: unknown, n: number): string[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === "string") ? (v as string[]) : null;

function parseIntraday(v: unknown): HoverIntraday | null {
  if (!obj(v)) return null;
  const times = strArr(v.times, Array.isArray(v.times) ? v.times.length : -1);
  const close = times ? numArr(v.close, times.length) : null;
  const volume = times ? numArr(v.volume, times.length) : null;
  if (!times || !times.length || !close || !volume) return null;
  return { date: str(v.date), times, close, volume, prev_close: finite(v.prev_close) ? v.prev_close : null };
}

function parseDaily(v: unknown): HoverDaily | null {
  if (!obj(v)) return null;
  const dates = strArr(v.dates, Array.isArray(v.dates) ? v.dates.length : -1);
  if (!dates || !dates.length) return null;
  const n = dates.length;
  const [open, high, low, close, volume, change] = (["open", "high", "low", "close", "volume", "change"] as const)
    .map((k) => numArr(v[k], n));
  if (!open || !high || !low || !close || !volume || !change) return null;
  const ma = (k: string): Num[] => numArr(v[k], n) ?? Array(n).fill(null);
  return { dates, open, high, low, close, volume, change, ma5: ma("ma5"), ma20: ma("ma20") };
}

export function parseHoverKline(raw: unknown): HoverKlineResult {
  if (!obj(raw)) return { ok: false, error: "悬浮 K 线工具没有返回结果" };
  if (raw.ok !== true) return { ok: false, error: str(raw.error) || "悬浮 K 线工具没有说明原因" };
  const r = raw.result;
  if (!obj(r)) return { ok: false, error: "悬浮 K 线工具的返回里没有结果" };
  const intraday = parseIntraday(r.intraday);
  const daily = parseDaily(r.daily);
  if (!intraday && !daily) {
    return { ok: false, error: [str(r.intraday_error), str(r.daily_error)].filter(Boolean).join(";") || "分时和日线都没取到" };
  }
  return {
    ok: true,
    data: {
      symbol: str(r.symbol), canonical: str(r.canonical),
      intraday, intraday_error: str(r.intraday_error),
      daily, daily_error: str(r.daily_error),
      source: str(r.source), fetched_at: typeof r.fetched_at === "string" ? r.fetched_at : null,
      notes: Array.isArray(r.notes) ? r.notes.filter((x): x is string => typeof x === "string") : [],
    },
  };
}

const GAP = 12;
/** 鼠标附近放不下就翻到左侧 / 上侧，再夹在视口内。 */
export function clampPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  let left = x + GAP;
  if (left + w + GAP > vw) left = x - w - GAP;
  left = Math.max(GAP, Math.min(left, Math.max(GAP, vw - w - GAP)));
  const top = Math.max(GAP, Math.min(y - 16, Math.max(GAP, vh - h - GAP)));
  return { left, top };
}

/** 悬浮卡标题上的涨跌：优先用昨收，没有昨收就用当天第一根。 */
export function intradayChange(d: HoverIntraday): number | null {
  const last = d.close[d.close.length - 1];
  const base = d.prev_close ?? d.close[0];
  return last != null && base != null && base > 0 ? last / base - 1 : null;
}

const priceAxis = (p: ChartPalette) => ({
  type: "value", scale: true, splitNumber: 3,
  axisLabel: { color: p.text, fontSize: 10, formatter: (x: number) => fmtPrice(x) },
  axisLine: { show: false }, splitLine: { lineStyle: { color: p.grid } },
});

const tooltip = (p: ChartPalette) => ({
  trigger: "axis", axisPointer: { type: "cross" },
  backgroundColor: p.tooltipBg, borderColor: p.axis, textStyle: { color: p.tooltipText, fontSize: 11 },
});

export function intradayOption(d: HoverIntraday, p: ChartPalette): Obj {
  const color = (intradayChange(d) ?? 0) >= 0 ? p.rise : p.fall;
  const base = d.prev_close;
  return {
    animation: false,
    grid: { left: 46, right: 10, top: 10, bottom: 22 },
    tooltip: tooltip(p),
    xAxis: {
      type: "category", data: d.times, boundaryGap: false,
      axisLabel: { color: p.text, fontSize: 10, interval: Math.max(0, Math.floor(d.times.length / 5) - 1) },
      axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false }, splitLine: { show: false },
    },
    yAxis: priceAxis(p),
    series: [{
      name: "分时", type: "line", data: d.close, showSymbol: false, connectNulls: false,
      lineStyle: { width: 1.5, color }, itemStyle: { color }, areaStyle: { color, opacity: 0.08 },
      ...(base != null ? {
        markLine: {
          symbol: "none", silent: true, animation: false,
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { color: p.text, fontSize: 10, formatter: "昨收" },
          data: [{ yAxis: base }],
        },
      } : {}),
    }],
  };
}

export function dailyOption(d: HoverDaily, p: ChartPalette): Obj {
  const candles = d.dates.map((_, i) => [d.open[i], d.close[i], d.low[i], d.high[i]]);
  const line = (name: string, data: Num[], color: string) => ({
    name, type: "line", data: data.map((x) => x ?? "-"), showSymbol: false, smooth: false,
    lineStyle: { width: 1, color }, itemStyle: { color },
  });
  return {
    animation: false,
    grid: { left: 46, right: 10, top: 10, bottom: 22 },
    tooltip: tooltip(p),
    xAxis: {
      type: "category", data: d.dates, boundaryGap: true,
      axisLabel: { color: p.text, fontSize: 10, interval: Math.max(0, Math.floor(d.dates.length / 4) - 1) },
      axisLine: { lineStyle: { color: p.axis } }, axisTick: { show: false }, splitLine: { show: false },
    },
    yAxis: priceAxis(p),
    series: [
      {
        name: "K 线", type: "candlestick", data: candles, barMaxWidth: 8,
        itemStyle: { color: p.rise, color0: p.fall, borderColor: p.rise, borderColor0: p.fall },
      },
      line("MA5", d.ma5, "#8b8f98"),
      line("MA20", d.ma20, "#d4a017"),
    ],
  };
}
