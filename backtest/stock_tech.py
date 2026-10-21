"""批量技术读数:均线 / 近 5、20 日涨跌 / 距 60 日高低点 / 量比。

给简报个股页做**确定性**技术面事实,不预测、不给建议。只读公开行情、不落用户数据。
输入 `{"symbols": ["600519", ...]}`(最多 30 只);非 A 股直接说明取不了技术读数。
"""
from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional

from backtest.stdio_utf8 import force_utf8_stdio
from backtest.hover_kline import HoverKlineError, _fetch_rows, _num, _volume_scale
from backtest.loader import LoaderError, bare, canonical_code, market_of

MAX_SYMBOLS = 30
BARS = 90


def _avg(xs: List[Optional[float]], n: int) -> Optional[float]:
    if len(xs) < n:
        return None
    window = xs[-n:]
    return None if any(x is None for x in window) else round(sum(x for x in window if x is not None) / n, 4)


def _facts(rows: List[dict], scale: Optional[int]) -> dict:
    good = [r for r in rows if str(r.get("date") or "") and _num(r.get("close")) is not None]
    good.sort(key=lambda r: str(r["date"]))
    good = good[-BARS:]
    closes = [_num(r.get("close")) for r in good]
    highs = [_num(r.get("high")) for r in good]
    lows = [_num(r.get("low")) for r in good]

    def volume_of(r: dict) -> Optional[float]:
        v = _num(r.get("volume"))
        return v * scale if v is not None and scale else None

    vols = [volume_of(r) for r in good]

    def ret(n: int) -> Optional[float]:
        if len(closes) <= n or closes[-1] is None:
            return None
        base = closes[-1 - n]
        return round(closes[-1] / base - 1, 4) if base and base > 0 else None

    hi = max((x for x in highs[-60:] if x is not None), default=None)
    lo = min((x for x in lows[-60:] if x is not None), default=None)
    last = closes[-1] if closes else None
    avg5 = _avg(vols, 5)
    avg20 = _avg(vols, 20)
    return {
        "date": str(good[-1]["date"]) if good else None,
        "close": round(last, 4) if last is not None else None,
        "ma5": _avg(closes, 5), "ma10": _avg(closes, 10), "ma20": _avg(closes, 20), "ma60": _avg(closes, 60),
        "ret5": ret(5), "ret20": ret(20),
        "high60": round(hi, 4) if hi is not None else None,
        "low60": round(lo, 4) if lo is not None else None,
        "from_high": round(last / hi - 1, 4) if last is not None and hi else None,
        "from_low": round(last / lo - 1, 4) if last is not None and lo else None,
        "vol_ratio_5_20": round(avg5 / avg20, 2) if avg5 is not None and avg20 else None,
        "bars": len(good),
        "volume_unit": "股" if scale else None,
    }


def build(req: Dict[str, Any], out_dir) -> Dict[str, Any]:
    raw = req.get("symbols")
    if not isinstance(raw, list) or not raw:
        raise ValueError("symbols 要是非空列表")
    if len(raw) > MAX_SYMBOLS:
        raise ValueError(f"一次最多 {MAX_SYMBOLS} 只")
    items: List[dict] = []
    seen: set[str] = set()
    for v in raw:
        if not isinstance(v, str) or not v.strip():
            items.append({"symbol": str(v)[:20], "ok": False, "error": "代码是空的"})
            continue
        try:
            code = canonical_code(v)
            market = market_of(code)
        except LoaderError as exc:
            items.append({"symbol": v[:20], "ok": False, "error": str(exc)})
            continue
        if market != "a_share":
            items.append({"symbol": v[:20], "ok": False, "error": "非 A 股,不取 A 股技术读数"})
            continue
        six = bare(code)
        if six in seen:
            continue
        seen.add(six)
        try:
            rows, env = _fetch_rows(code, "day", "qfq", BARS, out_dir)
            items.append({"symbol": six, "ok": True, "facts": _facts(rows, _volume_scale(env))})
        except (HoverKlineError, LoaderError) as exc:
            items.append({"symbol": six, "ok": False, "error": str(exc)[:200]})
    return {"items": items, "source": "腾讯前复权日线(近 90 根)"}


def main() -> None:
    force_utf8_stdio()
    import tempfile
    from pathlib import Path
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"入参不是合法 JSON:{exc}"}, ensure_ascii=False))
        return
    if not isinstance(req, dict):
        print(json.dumps({"ok": False, "error": "入参必须是对象"}, ensure_ascii=False))
        return
    try:
        with tempfile.TemporaryDirectory(prefix="vra-stock-tech-") as scratch:
            result = build(req, Path(scratch))
    except (ValueError, LoaderError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
