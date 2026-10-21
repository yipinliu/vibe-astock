"""板块涨停扩散度(cn_shortline_sector_diffusion)。全程不联网。

覆盖:今天 / 昨天 / 3 天前的行业家数与趋势、失败日不当 0、空池是 0、mapper 证据与 partial。
"""
from __future__ import annotations

import pytest

from test_registry_sources import _ctx
from sources import mappers_shortline as M
from sources import shortline_sector_diffusion as D

TODAY = "2026-10-09"
PREV = "2026-10-08"
D3 = "2026-09-30"


def _rows(*counts: tuple[str, int]) -> list[dict]:
    out = []
    for sector, n in counts:
        out += [{"code": f"{600000 + len(out) + i}", "name": "股", "sector": sector} for i in range(n)]
    return out


def _setup(monkeypatch, *, today=None, prev=None, d3=None, today_fail=False, d3_fail=False):
    today = _rows(("A", 5), ("B", 1), ("C", 2), ("D", 2), ("F", 1)) if today is None else today
    prev = _rows(("A", 3), ("B", 3), ("C", 2), ("D", 4), ("E", 1)) if prev is None else prev
    d3 = _rows(("A", 1), ("B", 2), ("C", 1), ("D", 1)) if d3 is None else d3
    mapping = {TODAY: PREV, PREV: D3}
    monkeypatch.setattr(D.S, "review_day", lambda d: TODAY)
    monkeypatch.setattr(D.S, "prev_trade_date", lambda d: mapping.get(d))
    monkeypatch.setattr(D.S, "is_settled", lambda d: True)

    def pool(kind, day):
        if kind != "zt":
            raise AssertionError(kind)
        if day == TODAY and today_fail:
            raise RuntimeError("HTTP 502")
        if day == D3 and d3_fail:
            raise RuntimeError("timeout")
        return {TODAY: today, PREV: prev, D3: d3}[day]

    monkeypatch.setattr(D.S, "pool", pool)


def _mctx():
    return _ctx(symbol="MARKET", market="CN", source="eastmoney+calc", ep={"id": "cn_shortline_sector_diffusion"})


def test_trends_and_counts(monkeypatch):
    _setup(monkeypatch)
    r = D.build_sector_diffusion(TODAY)
    assert r["available"] is True
    assert (r["sector_count"], r["diffusing_count"], r["fading_count"]) == (5, 2, 2)
    by = {x["sector"]: x for x in r["sectors"]}
    assert (by["A"]["today"], by["A"]["yesterday"], by["A"]["3days_ago"], by["A"]["trend"]) == (5, 3, 1, "扩散中")
    assert by["B"]["trend"] == "退潮中"
    assert by["C"]["trend"] == "稳定"
    assert by["D"]["trend"] == "收缩"
    assert by["E"]["today"] == 0 and by["E"]["trend"] == "退潮中"
    assert by["F"]["trend"] == "扩散中"
    assert r["new_sectors"] == ["F"]
    assert r["top_diffusing"][:2] == ["A", "F"]
    assert r["missing_days"] == []


def test_missing_history_is_unknown_not_zero(monkeypatch):
    _setup(monkeypatch, d3_fail=True)
    r = D.build_sector_diffusion(TODAY)
    assert r["available"] is True
    assert any(m["date"] == D3 for m in r["missing_days"])
    assert all(x["3days_ago"] is None and x["trend"] == "unknown" for x in r["sectors"])


def test_today_failure_is_unavailable(monkeypatch):
    _setup(monkeypatch, today_fail=True)
    r = D.build_sector_diffusion(TODAY)
    assert r["available"] is False
    assert "涨停池取数失败" in r["reason"]


def test_empty_today_pool_is_real_zero(monkeypatch):
    _setup(monkeypatch, today=[])
    r = D.build_sector_diffusion(TODAY)
    assert r["available"] is True
    assert r["empty"] is True
    assert r["sector_count"] == 0
    assert all(x["today"] == 0 for x in r["sectors"])
    assert r["new_sectors"] == []


def test_calendar_missing_is_unavailable(monkeypatch):
    _setup(monkeypatch)
    monkeypatch.setattr(D.S, "prev_trade_date", lambda d: None)
    r = D.build_sector_diffusion(TODAY)
    assert r["available"] is False


def test_mapper_evidence_and_partial(monkeypatch):
    _setup(monkeypatch)
    env = M.shortline_sector_diffusion_map(D.build_sector_diffusion(TODAY), _mctx())
    assert env.get("status", "ok") == "ok"
    fields = {e["field"] for e in env["evidence"]}
    assert {"sector_count", "sector_diffusing_count", "sector_fading_count",
            "sector_limit_up_today", "sector_limit_up_yesterday", "sector_limit_up_3d_ago", "sector_trend"}.issubset(fields)
    assert env["extra"]["result"]["top_diffusing"] == ["A", "F"]

    monkeypatch.setattr(D.S, "is_settled", lambda d: False)
    env2 = M.shortline_sector_diffusion_map(D.build_sector_diffusion(TODAY), _mctx())
    assert env2["status"] == "partial"
    assert "还没收盘" in (env2.get("degraded") or "")


def test_mapper_empty_today_is_ok(monkeypatch):
    _setup(monkeypatch, today=[])
    env = M.shortline_sector_diffusion_map(D.build_sector_diffusion(TODAY), _mctx())
    assert env.get("status", "ok") == "ok", "空池是有效的一天,不能标 partial 让结果永远不缓存"


def test_mapper_missing_history_is_partial(monkeypatch):
    _setup(monkeypatch, d3_fail=True)
    env = M.shortline_sector_diffusion_map(D.build_sector_diffusion(TODAY), _mctx())
    assert env["status"] == "partial"
    assert any(m["field"] == "sector_history" for m in env["missing"])


def test_render_text(monkeypatch):
    _setup(monkeypatch)
    text = D.render_sector_diffusion(D.build_sector_diffusion(TODAY))
    assert "扩散中" in text and "退潮中" in text and "A:今天 5、昨天 3、3天前 1" in text
