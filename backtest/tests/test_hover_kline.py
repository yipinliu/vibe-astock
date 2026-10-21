"""悬浮 K 线工具:分时只留最后一天、日线 60 根与均线、成交量单位、代码核对、部分失败。"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from backtest import hover_kline as H  # noqa: E402
from backtest.loader import LoaderError  # noqa: E402


def _daily_dates(n=70):
    """n 个工作日,最后一天固定是 2026-10-09(分时最后一天),方便核对 prev_close。"""
    out, d = [], date(2026, 10, 9)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return sorted(out)


def _day_rows(code="sh600519", n=70):
    return [{"code": code, "adjust": "qfq", "date": d, "open": 100.0 + i, "high": 102.0 + i,
             "low": 99.0 + i, "close": 101.0 + i, "volume": 1000.0 + i} for i, d in enumerate(_daily_dates(n))]


def _minute_rows(code="sh600519"):
    rows = []
    for day, times in (("2026-10-08", ["14:00", "14:01"]), ("2026-10-09", ["09:31", "09:32", "09:33"])):
        for i, hm in enumerate(times):
            rows.append({"code": code, "datetime": f"{day} {hm}", "open": 10.0 + i, "high": 10.2 + i,
                         "low": 9.9 + i, "close": 10.1 + i, "volume": 10.0 + i})
    return rows


def _fake_fetch(calls, *, daily=None, minute=None, unit="手", fail_period=None, wrong_code=False):
    def fake(endpoint, symbol, args, out_dir, python, timeout):
        calls.append((endpoint, symbol, dict(args)))
        raw = Path(out_dir) / "raw"
        raw.mkdir(parents=True, exist_ok=True)
        period = args["period"]
        if period == fail_period:
            raise LoaderError("腾讯 30 秒没回")
        rows = daily if period == "day" else minute
        rows = rows if rows is not None else (_day_rows() if period == "day" else _minute_rows())
        if wrong_code:
            rows = [{**r, "code": "sh600000"} for r in rows]
        name = f"extracted_{period}.json"
        (raw / name).write_text(json.dumps({"rows": rows}))
        return {"status": "ok", "fetched_at": "2026-10-09T10:00:00+08:00",
                "evidence": [{"field": "kline_volume", "unit": unit}],
                "extra": {"raw_files": [f"raw/{name}"]}}
    return fake


def test_returns_last_day_minutes_and_60_daily_bars(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(H, "_run_fetch", _fake_fetch(calls))
    r = H.build({"symbol": "600519"}, tmp_path)
    day = next(c for c in calls if c[2]["period"] == "day")
    minute = next(c for c in calls if c[2]["period"] == "m1")
    assert day[2] == {"period": "day", "adjust": "qfq", "count": 60}
    assert minute[2] == {"period": "m1", "adjust": "", "count": 240}

    assert len(r["daily"]["dates"]) == 60
    assert r["daily"]["dates"][-1] == _daily_dates()[-1] == "2026-10-09"
    # 手 × 100 = 股
    assert r["daily"]["volume"][-1] == int((1000.0 + 69) * 100)
    assert r["daily"]["ma5"][-1] == pytest.approx(sum(101.0 + i for i in range(65, 70)) / 5)
    assert r["daily"]["ma20"][-1] is not None

    assert r["intraday"]["date"] == "2026-10-09"
    assert r["intraday"]["times"] == ["09:31", "09:32", "09:33"]
    assert r["intraday"]["close"] == [10.1, 11.1, 12.1]
    assert r["intraday"]["volume"] == [1000, 1100, 1200]
    # 前一交易日收盘 = 日线里最后一天之前那根
    assert r["intraday"]["prev_close"] == pytest.approx(101.0 + 68)


def test_partial_when_minute_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(H, "_run_fetch", _fake_fetch([], fail_period="m1"))
    r = H.build({"symbol": "600519"}, tmp_path)
    assert r["daily"] is not None
    assert r["intraday"] is None
    assert "腾讯 30 秒没回" in r["intraday_error"]
    assert any("分时没取到" in x for x in r["notes"])


def test_both_fail_is_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(H, "_run_fetch", _fake_fetch([], fail_period="day"))
    # 两次都失败:fake 只对 day 抛错,分时仍成功 → 不是这个用例;改成两边都抛
    def both(*a, **k):
        raise LoaderError("断网")
    monkeypatch.setattr(H, "_run_fetch", both)
    with pytest.raises(H.HoverKlineError, match="分时和日线都没取到"):
        H.build({"symbol": "600519"}, tmp_path)


def test_identity_mismatch_is_rejected(monkeypatch, tmp_path):
    monkeypatch.setattr(H, "_run_fetch", _fake_fetch([], wrong_code=True))
    with pytest.raises(H.HoverKlineError, match="不是同一只"):
        H.build({"symbol": "600519"}, tmp_path)


def test_only_a_share(monkeypatch, tmp_path):
    with pytest.raises(H.HoverKlineError, match="只支持 A 股"):
        H.build({"symbol": "AAPL"}, tmp_path)
    with pytest.raises(H.HoverKlineError, match="请给一个 A 股代码"):
        H.build({}, tmp_path)


def test_north_exchange_is_rejected(monkeypatch, tmp_path):
    with pytest.raises(H.HoverKlineError, match="北交所"):
        H.build({"symbol": "830799.BJ"}, tmp_path)
