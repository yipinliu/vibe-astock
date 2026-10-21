"""板块涨停扩散度:东财行业今天 vs 昨天 vs 3 天前的涨停家数与趋势。

回答的是「热点在扩散还是在收缩」,不是「买哪个板块」。行业按东财 `所属行业` 归组;
它和 `cn_shortline_themes` 的题材串是两套口径:行业是分类,题材是源站编辑的归因。

边界:
- 昨天 / 3 天前用**交易日历**取 (prev_trade_date),不按自然日减。
- 某一天涨停池取数失败 → 那天的计数 None、trend unknown,**不拿 0 顶替**;
  成功但池子为空才是 0。
- 今天涨停池取数失败 → 整个端点不可用。
"""
from __future__ import annotations

from typing import Any, Optional

from sources import shortline as S

TRENDS = ("扩散中", "退潮中", "稳定", "收缩", "unknown")


def _counts(rows: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        name = str(r.get("sector") or "").strip() or "其他"
        out[name] = out.get(name, 0) + 1
    return out


def _trend(today: int, yesterday: Optional[int], d3: Optional[int]) -> str:
    if yesterday is None or d3 is None:
        return "unknown"
    if today > yesterday and today > d3:
        return "扩散中"
    if today <= yesterday and today <= d3:
        return "退潮中"
    if today >= yesterday:
        return "稳定"
    return "收缩"


def build_sector_diffusion(date: Optional[str] = None) -> dict:
    """某日各行业涨停扩散度。date 不给 = 最近一个已收盘交易日。"""
    d = S.review_day(date)
    prev = S.prev_trade_date(d)
    d3 = S.prev_trade_date(prev) if prev else None
    if not prev or not d3:
        return {"available": False, "date": d, "reason": "取不到前两个交易日"}

    try:
        today_rows = S.pool("zt", d)
    except Exception as e:  # noqa: BLE001
        return {"available": False, "date": d, "reason": f"{d} 涨停池取数失败:{str(e)[:160]}"}

    historical: dict[str, Optional[dict[str, int]]] = {}
    missing: list[dict] = []
    for label, day in (("yesterday", prev), ("d3", d3)):
        try:
            historical[label] = _counts(S.pool("zt", day))
        except Exception as e:  # noqa: BLE001
            historical[label] = None
            missing.append({"date": day, "reason": str(e)[:200] or "涨停池没取到"})

    today_count = _counts(today_rows)
    y_count = historical["yesterday"]
    d3_count = historical["d3"]
    names = set(today_count) | set(y_count or {}) | set(d3_count or {})

    sectors = []
    for name in names:
        t = today_count.get(name, 0)
        y = (y_count or {}).get(name, 0) if y_count is not None else None
        b = (d3_count or {}).get(name, 0) if d3_count is not None else None
        sectors.append({
            "sector": name, "today": t, "yesterday": y, "3days_ago": b,
            "trend": _trend(t, y, b),
        })
    sectors.sort(key=lambda x: (-x["today"], -(x["yesterday"] or 0), x["sector"]))

    top_diffusing = [x["sector"] for x in sectors if x["trend"] == "扩散中"][:10]
    fading = [x["sector"] for x in sectors if x["trend"] == "退潮中"][:10]
    new_sectors = [x["sector"] for x in sectors if x["today"] > 0 and x["yesterday"] == 0 and x["3days_ago"] == 0]
    empty = not today_rows

    return {
        "available": True,
        "date": d, "prev_date": prev, "d3_date": d3,
        "settled": S.is_settled(d),
        "sectors": sectors,
        "sector_count": len([x for x in sectors if x["today"] > 0]),
        "diffusing_count": len(top_diffusing),
        "fading_count": len(fading),
        "new_sectors": new_sectors,
        "top_diffusing": top_diffusing,
        "top_fading": fading,
        "missing_days": missing,
        "empty": empty,
        "note": ("行业按东财所属行业归组,不是题材串;昨天 / 3 天前按交易日历取。"
                 "某天涨停池取数失败时该天计数为空、趋势 unknown,不拿 0 顶替;成功但池子为空才是 0。"),
    }


def render_sector_diffusion(r: dict) -> str:
    """给模型读的文字版。"""
    if not r.get("available"):
        return f"板块扩散没有算出来:{r.get('reason') or '原因不明'}"
    lines = [
        f"板块涨停扩散 {r['date']}(对比 {r['prev_date']} / {r['d3_date']})",
        f"· 今天有涨停的行业 {r['sector_count']} 个;扩散中 {r['diffusing_count']} 个、退潮中 {r['fading_count']} 个"
        + (f";新出现:{'、'.join(r['new_sectors'][:8])}" if r.get("new_sectors") else ""),
    ]
    for x in r.get("sectors") or []:
        y = "缺" if x["yesterday"] is None else x["yesterday"]
        b = "缺" if x["3days_ago"] is None else x["3days_ago"]
        lines.append(f"  - {x['sector']}:今天 {x['today']}、昨天 {y}、3天前 {b} → {x['trend']}")
    for m in r.get("missing_days") or []:
        lines.append(f"  - 缺口:{m['date']} {m['reason']}")
    lines.append("· 说明:" + (r.get("note") or ""))
    return "\n".join(lines)
