"""悬浮 K 线的 **JSON 入口**:一次返回最近一个交易日的分钟线和最近 60 根日线。

给短线表格的悬浮卡画图用,不需要模型。只经取数层读公开行情,不落用户数据、不给买卖点。

- 分钟线用腾讯 `m1`(不复权),count 最大 320;这里取 240 根,并只保留最后一个交易日的部分。
- 日线用腾讯日线前复权,取最近 60 根;悬浮卡只画这段,不冒充完整历史。
- 只支持 A 股:港美股 / 北交所直接说明画不了,不出半张图。
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from backtest.loader import LoaderError, _read_raw, _run_fetch, bare, canonical_code, market_of
from backtest.stdio_utf8 import force_utf8_stdio

FETCH_TIMEOUT = 30
INTRADAY_COUNT = 240
DAILY_COUNT = 60


CATALOG = {
    "description": "个股悬浮卡:最近一个交易日的分时 + 最近 60 根前复权日线。"
                   "只支持 A 股,只读公开行情、不写用户数据,不给买卖点。",
    "parameters": {"symbol": "600519 / 600519.SH"},
}


class HoverKlineError(ValueError):
    """业务上画不了(认不出代码、不是 A 股、两边都取不到)。"""


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _fetch_rows(code: str, period: str, adjust: str, count: int, out_dir: Path) -> tuple[list[dict], dict]:
    """取一段 K 线并核对代码。返回 (原始行, 信封)。"""
    env = _run_fetch("tx_kline", code, {"period": period, "adjust": adjust, "count": count},
                     out_dir, sys.executable, FETCH_TIMEOUT)
    if env.get("status") == "failed":
        raise HoverKlineError(f"腾讯 K 线没取到({period}):{env.get('note') or env.get('degraded') or '原因不明'}")
    refs = [r for r in (env.get("extra") or {}).get("raw_files") or [] if Path(r).name.startswith("extracted_")]
    if not refs:
        raise HoverKlineError("腾讯 K 线信封里没有抽取后的序列文件")
    rows = (_read_raw(out_dir, refs[-1]).get("rows")) or []
    six, ex = bare(code), code.split(".")[-1]
    want = f"{ex.lower()}{six}"
    got = {str(r.get("code") or "") for r in rows}
    if got != {want}:
        raise HoverKlineError(f"要的是 {want},取回来的是 {sorted(got) or '空'} —— 不是同一只,已中止")
    return rows, env


def _volume_scale(env: dict) -> Optional[int]:
    units = {e.get("unit") for e in env.get("evidence") or [] if e.get("field") == "kline_volume"}
    unit = units.pop() if len(units) == 1 else None
    return {"股": 1, "手": 100}.get(unit or "")


def _daily_series(rows: list[dict], scale: Optional[int]) -> dict:
    """日线:按日期升序,最多 60 根;均线只在样本够长时给值。"""
    good = [r for r in rows if str(r.get("date") or "") and _num(r.get("close")) is not None]
    good.sort(key=lambda r: str(r["date"]))
    good = good[-DAILY_COUNT:]
    closes = [_num(r.get("close")) for r in good]

    def ma(n: int) -> list[Optional[float]]:
        out: list[Optional[float]] = []
        for i in range(len(good)):
            if i + 1 < n:
                out.append(None)
            else:
                window = [c for c in closes[i + 1 - n:i + 1] if c is not None]
                out.append(round(sum(window) / n, 4) if len(window) == n else None)
        return out

    def volume_of(r: dict) -> Optional[int]:
        v = _num(r.get("volume"))
        return int(round(v * scale)) if v is not None and scale else None

    change: List[Optional[float]] = [None]
    for i in range(1, len(closes)):
        cur, prev = closes[i], closes[i - 1]
        change.append(round(cur / prev - 1, 6) if cur is not None and prev is not None and prev > 0 else None)

    return {
        "dates": [str(r["date"]) for r in good],
        "open": [_num(r.get("open")) for r in good],
        "high": [_num(r.get("high")) for r in good],
        "low": [_num(r.get("low")) for r in good],
        "close": closes,
        "volume": [volume_of(r) for r in good],
        "change": change,
        "ma5": ma(5),
        "ma20": ma(20),
    }


def _intraday_series(rows: list[dict], scale: Optional[int], daily: dict) -> dict:
    """分钟线:只保留最后一个交易日;time 写成 HH:MM。"""
    good = []
    for r in rows:
        stamp = str(r.get("datetime") or r.get("date") or "")
        if len(stamp) < 16 or _num(r.get("close")) is None:
            continue
        good.append((stamp, r))
    if not good:
        raise HoverKlineError("分钟线返回为空")
    good.sort(key=lambda x: x[0])
    last_day = good[-1][0][:10]
    day_rows = [(s, r) for s, r in good if s[:10] == last_day]
    dates = daily.get("dates") or []
    prev_close = None
    if last_day in dates:
        i = dates.index(last_day)
        if i > 0:
            prev_close = (daily.get("close") or [])[i - 1]
    return {
        "date": last_day,
        "times": [s[11:16] for s, _ in day_rows],
        "close": [_num(r.get("close")) for _, r in day_rows],
        "volume": [int(round(float(r["volume"]) * scale)) if scale and _num(r.get("volume")) is not None else None for _, r in day_rows],
        "prev_close": prev_close,
    }


def build(req: Dict[str, Any], out_dir: Path) -> Dict[str, Any]:
    raw = req.get("symbol")
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 20:
        raise HoverKlineError("请给一个 A 股代码,如 600519")
    try:
        code = canonical_code(raw)
        market = market_of(code)
    except LoaderError as exc:
        raise HoverKlineError(str(exc)) from exc
    if market != "a_share":
        raise HoverKlineError("悬浮 K 线只支持 A 股")
    six, ex = bare(code), code.split(".")[-1]
    if ex == "BJ":
        raise HoverKlineError("北交所暂时画不了 K 线:腾讯只返回最新一根,baostock 也不提供北交所")

    warnings: List[str] = []
    daily_rows: list[dict] = []
    daily_env: dict = {}
    daily_error = ""
    try:
        daily_rows, daily_env = _fetch_rows(code, "day", "qfq", DAILY_COUNT, out_dir)
    except (HoverKlineError, LoaderError) as exc:
        daily_error = str(exc)
        warnings.append(f"日线没取到:{daily_error}")
    daily = _daily_series(daily_rows, _volume_scale(daily_env)) if daily_rows else None
    if daily is not None and not daily["dates"]:
        daily = None
        daily_error = "日线返回为空"
        warnings.append(f"日线没取到:{daily_error}")

    intraday = None
    intraday_error = ""
    minute_env: dict = {}
    try:
        minute_rows, minute_env = _fetch_rows(code, "m1", "", INTRADAY_COUNT, out_dir)
        intraday = _intraday_series(minute_rows, _volume_scale(minute_env), daily or {})
    except (HoverKlineError, LoaderError) as exc:
        intraday_error = str(exc)
        warnings.append(f"分时没取到:{intraday_error}")

    if daily is None and intraday is None:
        raise HoverKlineError("分时和日线都没取到:" + ";".join(warnings))

    return {
        "symbol": six, "canonical": code, "market": "a_share",
        "intraday": intraday, "intraday_error": intraday_error,
        "daily": daily, "daily_error": daily_error,
        "source": "腾讯 K 线", "fetched_at": daily_env.get("fetched_at") or minute_env.get("fetched_at"),
        "notes": ["分钟线不复权;日线为腾讯前复权近 60 根。", *warnings],
    }


def main() -> None:
    force_utf8_stdio()
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"入参不是合法 JSON:{exc}"}, ensure_ascii=False))
        return
    if not isinstance(req, dict):
        print(json.dumps({"ok": False, "error": "入参必须是对象"}, ensure_ascii=False))
        return
    if req.get("action") == "catalog":
        print(json.dumps({"ok": True, "catalog": CATALOG}, ensure_ascii=False))
        return
    try:
        with tempfile.TemporaryDirectory(prefix="vra-hover-kline-") as scratch:
            result = build(req, Path(scratch))
    except HoverKlineError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
