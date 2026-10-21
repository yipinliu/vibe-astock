"""跌停深化:天地面、跌停趋势、高位龙头跌停、跌停池换手偏高线索。

跌停不只是计数项。昨天封住涨停的票今天跌停(天地面)、连板高度上的票跌停、
跌停家数明显高于前几日均值,含义完全不同;这里把这几件事拆开摆事实。

口径与边界:
- 天地面 / 高位龙头用**前一交易日东财涨停池**和**当日东财跌停池**逐只对代码;
  前一交易日的连板高度取东财连板数与「N天M板」里较大的那个(反包票连板数只给 1)。
- 5/20 日均值用**逐日跌停池**的家数。任何一天取数失败 → 该均值 None + missing_days,
  **不拿 0 顶替**;成功但池子为空才是真的 0。
- 翘板只给线索:数据层没有可靠的逐股前 5 日成交额,按当日跌停池换手率 ≥10% 列出,
  明确标成「换手偏高」,不写成确认翘板。
- 风险等级是**确定性规则**,只由已取到的读数推出;关键输入缺失时标 unknown,不默认绿色。
"""
from __future__ import annotations

from statistics import mean
from typing import Any, Optional

from sources import shortline as S

#: 翘板线索的换手率门槛(%)
PRY_TURNOVER_PCT = 10.0
#: 跌停家数进入风险计分的阈值
DT_MANY = 30
#: 当日跌停家数 / 5 日均值 达到这个倍数且不少于 10 家,风险加一档
DT_JUMP_RATIO = 1.5
DT_JUMP_MIN = 10


def _row_height(r: dict) -> int:
    """昨日涨停股的有效连板高度:东财连板数,反包票再和「N天M板」里的 M 取大。"""
    return max(int(r.get("boards") or 1), S.stat_boards(r.get("zt_stat")))


def _count_dt(day: str) -> int:
    """某日跌停家数;取数失败照常抛,空池是 0。"""
    return len(S.pool("dt", day))


def _history_counts(days: list[str]) -> tuple[list[dict], list[dict]]:
    """逐日跌停家数。返回 (有效的 {date, count}, 缺失的 {date, reason})。"""
    counts: list[dict] = []
    missing: list[dict] = []
    for d in days:
        try:
            counts.append({"date": d, "count": _count_dt(d)})
        except Exception as e:  # noqa: BLE001  取不到就是取不到,由调用方如实报原因
            missing.append({"date": d, "reason": str(e)[:200] or "跌停池没取到"})
    return counts, missing


def _avg(counts: list[dict], n: int, expected: list[str]) -> Optional[float]:
    """最近 n 个**交易日**的均值;不足 n 天或窗口里任一天缺数 → None(不拿少的凑)。

    🔴 不能取「成功取到的最后 n 条」:中间缺一天时,那样会把窗口悄悄往前挪,均值看着正常但口径错了。
    """
    days = expected[-n:]
    if len(days) < n:
        return None
    by_day = {c["date"]: c["count"] for c in counts}
    if any(d not in by_day for d in days):
        return None
    return round(mean(by_day[d] for d in days), 2)


def _pct(value: Any) -> Optional[float]:
    return value if isinstance(value, (int, float)) else None


def build_limit_down(date: Optional[str] = None, days: int = 20) -> dict:
    """计算某日的跌停深化。date 不给 = 最近一个已收盘交易日。"""
    d = S.review_day(date)
    days = int(days)
    if not 5 <= days <= 20:
        raise ValueError("days 要 5..20:东财跌停池只留约一个月,更长的窗口取不全")

    prev = S.prev_trade_date(d)
    if not prev:
        return {"available": False, "date": d, "reason": "取不到前一交易日"}

    # 当日跌停池:失败 = 整个端点不可用;空池是有效的一天
    try:
        today_dt = S.pool("dt", d)
    except Exception as e:  # noqa: BLE001
        return {"available": False, "date": d, "reason": f"{d} 跌停池取数失败:{str(e)[:160]}"}

    # 前一交易日涨停池:失败和空池分开
    prev_zt_ok = True
    try:
        prev_zt = S.pool("zt", prev)
    except Exception as e:  # noqa: BLE001
        prev_zt_ok = False
        prev_zt = []
        prev_zt_error = str(e)[:160] or "前一交易日涨停池没取到"
    else:
        prev_zt_error = ""

    dt_by_code = {r["code"]: r for r in today_dt}
    zt_by_code = {r["code"]: r for r in prev_zt}

    # 1) 天地面:昨日涨停 → 今日跌停
    sky_to_ground = []
    for code, z in zt_by_code.items():
        dt = dt_by_code.get(code)
        if dt is None:
            continue
        sky_to_ground.append({
            "code": code, "name": z.get("name") or dt.get("name") or "",
            "sector": z.get("sector") or dt.get("sector") or "",
            "prev_boards": _row_height(z), "prev_label": S.board_label(z.get("boards"), z.get("zt_stat")),
            "ret": _pct(dt.get("ret")), "turnover": _pct(dt.get("turnover")),
            "consec_dt": dt.get("consec_dt"), "last_seal": dt.get("last_seal"),
        })
    sky_to_ground.sort(key=lambda x: (-x["prev_boards"], x["code"]))

    # 2) 高位龙头跌停:昨日连板高度 ≥3
    leader_dt = []
    for code, z in zt_by_code.items():
        h = _row_height(z)
        dt = dt_by_code.get(code)
        if h < 3 or dt is None:
            continue
        leader_dt.append({
            "code": code, "name": z.get("name") or dt.get("name") or "",
            "sector": z.get("sector") or dt.get("sector") or "",
            "boards": h, "label": S.board_label(z.get("boards"), z.get("zt_stat")),
            "ret": _pct(dt.get("ret")), "consec_dt": dt.get("consec_dt"),
        })
    leader_dt.sort(key=lambda x: (-x["boards"], x["code"]))

    # 3) 跌停趋势:当日 vs 前 5 / 20 个交易日跌停家数均值
    history_ok = True
    try:
        window = S.trade_dates_ending_at(prev, days)
    except Exception as e:  # noqa: BLE001
        window = []
        history_ok = False
        history_error = str(e)[:160] or "交易日历没取到"
    else:
        history_error = ""
        if not window:
            history_ok = False
            history_error = "交易日历里没有可用的历史交易日"
    counts, missing_days = _history_counts(window) if window else ([], [])
    avg5 = _avg(counts, 5, window) if history_ok else None
    avg20 = _avg(counts, days, window) if history_ok else None
    today_n = len(today_dt)

    def trend(avg: Optional[float]) -> Optional[dict]:
        if avg is None:
            return None
        delta = round(today_n - avg, 2)
        ratio = round(today_n / avg, 3) if avg > 0 else None
        label = "高于均值" if delta > 0 else "低于均值" if delta < 0 else "与均值持平"
        return {"avg": avg, "delta": delta, "ratio": ratio, "label": label}

    # 4) 翘板线索:当日跌停池换手率偏高
    pry_open = [
        {"code": r["code"], "name": r.get("name") or "", "sector": r.get("sector") or "",
         "turnover": _pct(r.get("turnover")), "ret": _pct(r.get("ret")),
         "consec_dt": r.get("consec_dt")}
        for r in today_dt
        if (_pct(r.get("turnover")) or 0) >= PRY_TURNOVER_PCT
    ]
    pry_open.sort(key=lambda x: (-(x["turnover"] or 0), x["code"]))

    # 5) 风险等级:只由已取到的读数推出
    risk_score = 0
    risk_reasons: list[str] = []
    if sky_to_ground:
        risk_score += 2
        risk_reasons.append(f"天地面 {len(sky_to_ground)} 只")
    if leader_dt:
        risk_score += 2
        risk_reasons.append(f"高位龙头跌停 {len(leader_dt)} 只")
    if today_n > DT_MANY:
        risk_score += 1
        risk_reasons.append(f"跌停 {today_n} 只,超过 {DT_MANY} 只")
    t5 = trend(avg5)
    if t5 and t5["avg"] >= DT_JUMP_MIN and (t5["ratio"] or 0) >= DT_JUMP_RATIO:
        risk_score += 1
        risk_reasons.append(f"跌停 {today_n} 只,是 5 日均值 {t5['avg']:.1f} 只的 {t5['ratio']:.1f} 倍")
    if not prev_zt_ok:
        risk_level = "unknown"
        risk_reasons.append("前一交易日涨停池没取到,天地面和龙头跌停无法判断,不能给绿灯")
    elif risk_score >= 4:
        risk_level = "red"
    elif risk_score >= 2:
        risk_level = "yellow"
    else:
        risk_level = "green"

    missing: list[dict] = list(missing_days)
    if not prev_zt_ok:
        missing.append({"field": "prev_zt", "date": prev, "reason": prev_zt_error})
    if not history_ok:
        missing.append({"field": "history", "date": prev, "reason": history_error})

    return {
        "available": True,
        "date": d, "prev_date": prev, "settled": S.is_settled(d),
        "dt_count": today_n,
        "dt_5d_avg": avg5, "dt_20d_avg": avg20,
        "trend_5d": t5, "trend_20d": trend(avg20),
        "history_days_used": len(counts), "history_days_expected": days,
        "history_missing_days": missing_days,
        "sky_to_ground": sky_to_ground, "sky_to_ground_count": len(sky_to_ground),
        "leader_dt": leader_dt, "leader_dt_count": len(leader_dt),
        "pry_open_candidates": pry_open, "pry_open_count": len(pry_open),
        "risk_level": risk_level, "risk_score": risk_score, "risk_reasons": risk_reasons,
        "missing": missing,
        "note": ("跌停池明细取东财;5/20 日均值用逐日跌停池,缺失日不当 0;"
                 "翘板只按当日跌停池换手率 ≥10% 给线索,不是确认翘板"),
    }


def render_limit_down(r: dict) -> str:
    """给模型读的文字版。只写已发生的读数和缺口。"""
    if not r.get("available"):
        return f"跌停深化没有算出来:{r.get('reason') or '原因不明'}"
    t5, t20 = r.get("trend_5d"), r.get("trend_20d")
    lines = [
        f"跌停深化 {r['date']}(前一交易日 {r['prev_date']})",
        f"· 当日跌停 {r['dt_count']} 只;5 日均值 "
        + (f"{t5['avg']:.2f} 只({t5['label']}, 差 {t5['delta']:+.2f})" if t5 else "没算出来(历史跌停池缺数)")
        + ";20 日均值 " + (f"{t20['avg']:.2f} 只" if t20 else "没算出来(历史跌停池缺数)"),
        f"· 天地面(昨日涨停今日跌停){r['sky_to_ground_count']} 只;高位龙头跌停 {r['leader_dt_count']} 只;"
        f"换手偏高的跌停股 {r['pry_open_count']} 只",
        f"· 风险等级:{r['risk_level']}(分 {r['risk_score']})"
        + (f";依据:{'、'.join(r['risk_reasons'])}" if r.get("risk_reasons") else ""),
    ]
    for x in r.get("sky_to_ground") or []:
        lines.append(f"  - 天地面 {x['name']}({x['code']}) 昨 {x['prev_label']},今日 {x['ret']}%,"
                     f"换手 {x['turnover']}%" + (f",连续跌停 {x['consec_dt']} 天" if x.get("consec_dt") else ""))
    for x in r.get("leader_dt") or []:
        lines.append(f"  - 龙头跌停 {x['name']}({x['code']}) {x['label']},今日 {x['ret']}%")
    for x in r.get("pry_open_candidates") or []:
        lines.append(f"  - 换手偏高 {x['name']}({x['code']}) 换手 {x['turnover']}%,今日 {x['ret']}%")
    for m in r.get("missing") or []:
        lines.append(f"  - 缺口:{m.get('date') or m.get('field')} {m.get('reason')}")
    lines.append("· 说明:" + (r.get("note") or ""))
    return "\n".join(lines)
