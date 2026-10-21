"""简报个股技术读数:均线 / 涨跌 / 高低点 / 量比,以及非 A 股、失败、去重。"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from backtest import stock_tech as T  # noqa: E402
from backtest.hover_kline import HoverKlineError  # noqa: E402


def _dates(n=90):
    out, d = [], date(2026, 6, 1)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _rows(n=90, code="sh600519"):
    return [{"code": code, "date": d, "open": 100.0 + i, "high": 102.0 + i, "low": 99.0 + i,
             "close": 101.0 + i, "volume": 1000.0 + i} for i, d in enumerate(_dates(n))]


def test_facts_math():
    f = T._facts(_rows(), 100)
    assert f["bars"] == 90
    assert f["close"] == pytest.approx(190.0)
    assert f["ma5"] == pytest.approx(sum(101.0 + i for i in range(85, 90)) / 5)
    assert f["ma60"] is not None
    assert f["ret5"] == pytest.approx(190.0 / 185.0 - 1, abs=1e-4)
    assert f["ret20"] == pytest.approx(190.0 / 170.0 - 1, abs=1e-4)
    assert f["high60"] == pytest.approx(102.0 + 89)
    assert f["low60"] == pytest.approx(99.0 + 30)
    assert f["from_high"] == pytest.approx(190.0 / (102.0 + 89) - 1, abs=1e-4)
    assert f["vol_ratio_5_20"] == 1.01
    assert f["volume_unit"] == "股"


def test_build_rejects_non_a_share_and_dedupes(monkeypatch, tmp_path):
    monkeypatch.setattr(T, "_fetch_rows", lambda *a, **k: (_rows(), {"evidence": [{"field": "kline_volume", "unit": "手"}]}))
    r = T.build({"symbols": ["600519", "AAPL", "600519"]}, tmp_path)
    assert [x["symbol"] for x in r["items"]] == ["600519", "AAPL"]
    assert r["items"][0]["ok"] is True
    assert r["items"][1] == {"symbol": "AAPL", "ok": False, "error": "非 A 股,不取 A 股技术读数"}


def test_fetch_failure_is_item_error(monkeypatch, tmp_path):
    def gone(*a, **k):
        raise HoverKlineError("腾讯超时")
    monkeypatch.setattr(T, "_fetch_rows", gone)
    r = T.build({"symbols": ["600519"]}, tmp_path)
    assert r["items"][0]["ok"] is False and "腾讯超时" in r["items"][0]["error"]


def test_input_guards(tmp_path):
    with pytest.raises(ValueError, match="非空"):
        T.build({"symbols": []}, tmp_path)
    with pytest.raises(ValueError, match="最多"):
        T.build({"symbols": [f"{600000 + i}" for i in range(31)]}, tmp_path)
