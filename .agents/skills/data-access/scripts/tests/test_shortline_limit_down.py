"""跌停深化(cn_shortline_limit_down)。全程不联网。

覆盖:天地面、高位龙头跌停、5/20 日均值缺日不当 0、空池 vs 失败、换手线索、风险等级,
以及 mapper 的证据 / partial / missing。
"""
from __future__ import annotations

import pytest

from test_registry_sources import _ctx
from sources import mappers_shortline as M
from sources import shortline_limit_down as L
from sources._http import DataNotAvailable

#: 20 个交易日(升序);最后一天是前一交易日
HISTORY = [f"2026-09-{d:02d}" for d in range(10, 31) if d not in (13, 20, 27)][:19]
HISTORY = ["2026-09-08", "2026-09-09"] + HISTORY
HISTORY = HISTORY[-20:]
PREV = HISTORY[-1]
TODAY = "2026-10-09"


def _zt(code: str, boards: int = 1, **kw) -> dict:
    return {"code": code, "name": f"股{code}", "boards": boards, "zt_stat": None,
            "sector": "甲", "first_seal": "09:31:00", "broken_times": 0, **kw}


def _dt(code: str, turnover: float = 2.0, ret: float = -10.0, **kw) -> dict:
    return {"code": code, "name": f"股{code}", "turnover": turnover, "ret": ret,
            "sector": "甲", "last_seal": "14:30:00", "consec_dt": 1, **kw}


def _setup(monkeypatch, *, prev_zt=None, today_dt=None, history=None, prev_fail=False, history_fail=None):
    prev_zt = [_zt("600001", 4), _zt("600002", 2)] if prev_zt is None else prev_zt
    today_dt = [_dt("600001", 12.5), _dt("600009", 3.0)] if today_dt is None else today_dt
    history = {d: [_dt(f"{600100 + i}")] * (i + 1) for i, d in enumerate(HISTORY)} if history is None else history
    history_fail = set(history_fail or [])

    monkeypatch.setattr(L.S, "review_day", lambda d: TODAY)
    monkeypatch.setattr(L.S, "prev_trade_date", lambda d: PREV)
    monkeypatch.setattr(L.S, "is_settled", lambda d: True)
    monkeypatch.setattr(L.S, "trade_dates_ending_at", lambda end, n: HISTORY[-n:])

    def pool(kind, day):
        if kind == "zt":
            if day == PREV:
                if prev_fail:
                    raise RuntimeError("HTTP 502")
                return prev_zt
            return []
        if day == TODAY:
            return today_dt
        if day in history_fail:
            raise RuntimeError("HTTP timeout")
        return history.get(day, [])

    monkeypatch.setattr(L.S, "pool", pool)


def _mctx():
    return _ctx(symbol="MARKET", market="CN", source="eastmoney+calc", ep={"id": "cn_shortline_limit_down"})


def test_sky_leader_and_pry(monkeypatch):
    _setup(monkeypatch)
    r = L.build_limit_down(TODAY)
    assert r["available"] is True
    assert r["dt_count"] == 2
    assert r["sky_to_ground_count"] == 1
    assert r["sky_to_ground"][0]["code"] == "600001"
    assert r["sky_to_ground"][0]["prev_label"] == "4板"
    assert r["leader_dt_count"] == 1
    assert r["leader_dt"][0]["boards"] == 4
    assert r["pry_open_count"] == 1
    assert r["pry_open_candidates"][0]["code"] == "600001"
    assert r["risk_level"] == "red"
    assert any("天地面" in x for x in r["risk_reasons"])


def test_averages_use_history(monkeypatch):
    _setup(monkeypatch)
    r = L.build_limit_down(TODAY)
    # 默认历史从 1 只逐日加到 20 只;最近 5 天是 16..20,均值 18
    assert r["dt_5d_avg"] == 18.0
    assert r["trend_5d"]["delta"] == round(2 - 18.0, 2)
    assert r["trend_20d"]["avg"] == 10.5
    assert r["history_days_used"] == 20
    assert not r["history_missing_days"]


def test_missing_history_day_is_not_zero(monkeypatch):
    _setup(monkeypatch, history_fail={HISTORY[-1]})
    r = L.build_limit_down(TODAY)
    assert r["available"] is True
    assert r["dt_5d_avg"] is None
    assert r["trend_5d"] is None
    assert any(m["date"] == HISTORY[-1] for m in r["history_missing_days"])
    assert "dt_5d_avg" not in str(r.get("missing"))  # 均值缺口交给 mapper 记


def test_empty_dt_pool_is_real_zero(monkeypatch):
    _setup(monkeypatch, prev_zt=[], today_dt=[])
    r = L.build_limit_down(TODAY)
    assert r["available"] is True
    assert r["dt_count"] == 0
    assert r["sky_to_ground_count"] == 0
    assert r["risk_level"] == "green"
    assert r["history_missing_days"] == []


def test_prev_zt_failure_is_unknown_not_green(monkeypatch):
    _setup(monkeypatch, prev_fail=True)
    r = L.build_limit_down(TODAY)
    assert r["available"] is True
    assert r["risk_level"] == "unknown"
    assert any(m.get("field") == "prev_zt" for m in r["missing"])
    assert any("不能给绿灯" in x for x in r["risk_reasons"])


def test_bad_window(monkeypatch):
    _setup(monkeypatch)
    with pytest.raises(ValueError, match="5..20"):
        L.build_limit_down(TODAY, days=4)
    with pytest.raises(ValueError, match="5..20"):
        L.build_limit_down(TODAY, days=21)


def test_review_day_rejects_non_trade_day(monkeypatch):
    _setup(monkeypatch)
    monkeypatch.setattr(L.S, "review_day", lambda d: (_ for _ in ()).throw(DataNotAvailable("2026-10-04 不是交易日")))
    with pytest.raises(DataNotAvailable, match="不是交易日"):
        L.build_limit_down("2026-10-04")


def test_mapper_evidence_and_partial(monkeypatch):
    _setup(monkeypatch)
    r = L.build_limit_down(TODAY)
    env = M.shortline_limit_down_map(r, _mctx())
    assert env.get("status", "ok") == "ok"
    fields = {e["field"] for e in env["evidence"]}
    assert {"dt_count", "dt_5d_avg", "risk_level", "sky_to_ground_count", "leader_limit_down_count",
            "pry_open_count", "sky_to_ground_prev_boards"}.issubset(fields)
    assert env["extra"]["result"]["sky_to_ground_count"] == 1
    assert env["extra"]["computation"]["kind"] == "computed_endpoint"

    monkeypatch.setattr(L.S, "is_settled", lambda d: False)
    r2 = L.build_limit_down(TODAY)
    env2 = M.shortline_limit_down_map(r2, _mctx())
    assert env2["status"] == "partial"
    assert "还没收盘" in (env2.get("degraded") or "")


def test_mapper_missing_is_partial(monkeypatch):
    _setup(monkeypatch, history_fail={HISTORY[-1]})
    env = M.shortline_limit_down_map(L.build_limit_down(TODAY), _mctx())
    assert env["status"] == "partial"
    assert any(m["field"] == "dt_history" for m in env["missing"])
