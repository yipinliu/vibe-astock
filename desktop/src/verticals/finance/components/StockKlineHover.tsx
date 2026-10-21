/**
 * 股票名悬浮卡:最近一个交易日的分时 + 最近 60 根日线。
 * 只读公开行情、不用模型;鼠标移开 / 失焦 / Esc 立即关掉并发起取消。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { backend } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { usePalette } from "@/components/ui/chartPalette";
import { EChart } from "@/components/ui/EChart";
import { fmtChange, fmtPrice } from "@/lib/klineView";
import {
  clampPosition, dailyOption, intradayChange, intradayOption, parseHoverKline, type HoverKlineData,
} from "@/lib/hoverKlineView";

const CARD_W = 480;
const CARD_H = 350;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: HoverKlineData }>();

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; data: HoverKlineData }
  | { state: "error"; error: string };

interface Props {
  symbol: string;
  name?: string;
  children?: ReactNode;
  className?: string;
}

export function StockKlineHover({ symbol, name, children, className }: Props) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const timer = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => () => {
    alive.current = false;
    if (timer.current) window.clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // hide 只读 refs / setState,不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = () => {
    const hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      setLoad({ state: "done", data: hit.data });
      return;
    }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLoad({ state: "loading" });
    backend.runTool<unknown>("hover_kline", { symbol }, ctl.signal)
      .then((raw) => {
        if (!alive.current || ctl.signal.aborted) return;
        const parsed = parseHoverKline(raw);
        if (!parsed.ok) { setLoad({ state: "error", error: parsed.error }); return; }
        cache.set(symbol, { at: Date.now(), data: parsed.data });
        setLoad({ state: "done", data: parsed.data });
      })
      .catch((e) => {
        if (!alive.current || ctl.signal.aborted) return;
        setLoad({ state: "error", error: e instanceof Error ? e.message : String(e) });
      });
  };

  const showAt = (x: number, y: number) => {
    if (typeof window === "undefined") return;
    setPos(clampPosition(x, y, CARD_W, CARD_H, window.innerWidth, window.innerHeight));
    setOpen(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, 250);
  };

  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    abort.current = null;
    setOpen(false);
  };

  const data = load.state === "done" ? load.data : null;
  const intraday = data?.intraday ?? null;
  const last = intraday?.close[intraday.close.length - 1] ?? data?.daily?.close[data.daily.close.length - 1] ?? null;
  const change = intraday ? intradayChange(intraday) : null;

  return (
    <>
      <span
        ref={anchor}
        tabIndex={0}
        role="button"
        aria-label={`查看 ${name ?? symbol} 的分时和日线`}
        title="悬浮 / 聚焦查看分时与日线"
        className={cn(
          "cursor-help underline-offset-2 decoration-dotted hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
          className,
        )}
        onMouseEnter={(e) => showAt(e.clientX, e.clientY)}
        onMouseLeave={hide}
        onFocus={() => {
          const r = anchor.current?.getBoundingClientRect();
          if (r) showAt(r.right, r.top);
        }}
        onBlur={hide}
      >
        {children ?? name ?? symbol}
      </span>
      {open && typeof document !== "undefined" && pos && createPortal(
        <div
          role="dialog"
          aria-label={`${name ?? symbol} 的分时与日线`}
          style={{ left: pos.left, top: pos.top }}
          className="pointer-events-none fixed z-[60] w-[480px] rounded-xl border border-border bg-card p-3 shadow-2xl"
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <b className="text-sm">{name ?? symbol}</b>
            <span className="font-mono text-[11px] text-muted-foreground">{symbol}</span>
            {last != null && <span className="font-mono text-sm font-bold">{fmtPrice(last)}</span>}
            {change != null && <span className={cn("font-mono text-xs", change > 0 ? "text-danger" : change < 0 ? "text-success" : "text-muted-foreground")}>{fmtChange(change)}</span>}
            <span className="ml-auto text-[10px] text-muted-foreground">红涨绿跌 · 只读行情</span>
          </div>

          {load.state === "loading" && (
            <p role="status" className="flex items-center justify-center gap-1.5 py-20 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在取分时和日线…
            </p>
          )}
          {load.state === "error" && (
            <p role="status" className="py-16 text-center text-xs text-muted-foreground">暂无分时 / K 线:{load.error || "原因不明"}</p>
          )}
          {data && (
            <>
              <div className="mb-0.5 flex items-baseline justify-between text-[10px] text-muted-foreground">
                <span>分时(最近一个交易日{intraday ? ` ${intraday.date}` : ""})</span>
                {!intraday && <span className="text-warning">没取到:{data.intraday_error || "原因不明"}</span>}
              </div>
              {intraday ? <EChart option={intradayOption(intraday, palette)} height={140} /> : <p className="py-8 text-center text-[11px] text-muted-foreground">没有分时数据</p>}

              <div className="mb-0.5 mt-2 flex items-baseline justify-between text-[10px] text-muted-foreground">
                <span>日线(近 {data.daily?.dates.length ?? 0} 根 · MA5 / MA20)</span>
                {!data.daily && <span className="text-warning">没取到:{data.daily_error || "原因不明"}</span>}
              </div>
              {data.daily ? <EChart option={dailyOption(data.daily, palette)} height={150} /> : <p className="py-8 text-center text-[11px] text-muted-foreground">没有日线数据</p>}

              <p className="mt-1 truncate text-[10px] text-muted-foreground" title={data.notes.join(";")}>
                {data.notes.join(" · ") || "腾讯 K 线"}
              </p>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
