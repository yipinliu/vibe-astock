"""简报抓取工具:归一化、机构、令牌/组 ID、401/429、上游失败。全程不联网。"""
from __future__ import annotations

import pytest

from briefing import crawl as C


class Resp:
    def __init__(self, code: int, payload=None):
        self.status_code = code
        self._payload = payload
        self.text = ""

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def test_strip_html_and_institution():
    assert C._strip_html("【中信证券】<br>第一行</br><b>粗</b>&nbsp;尾") == "【中信证券】\n第一行粗 尾"
    assert C._extract_institution("【中信证券|宏观】标题", "") == "中信证券"
    assert C._extract_institution("600519 贵州茅台", "【华泰证券】正文") == "华泰证券"
    assert C._extract_institution("【12】", "") == ""


def test_norm_topic():
    t = C._norm_topic({
        "topic_id": 123, "type": "talk", "title": "标题",
        "talk": {"owner": {"name": "张三"}, "text": "【中信证券】<br>正文 600519"},
        "create_time": "2026-10-09T08:00:00", "likes_count": "2",
    })
    assert t is not None
    assert t["topic_id"] == "123"
    assert t["institution"] == "中信证券"
    assert "正文 600519" in t["text"]
    assert t["author"] == "张三"
    assert t["likes"] == 2
    assert C._norm_topic({"talk": {}}) is None


def test_token_and_group(monkeypatch):
    monkeypatch.setenv("VRA_BRIEFING_TOKEN", "zsxq_access_token=test-token-123456")
    assert C._token() == "test-token-123456"
    monkeypatch.setenv("VRA_BRIEFING_GROUP", "12345678901234")
    assert C._group_id(None) == "12345678901234"
    with pytest.raises(C.BriefingError, match="6–24"):
        C._group_id("abc")
    with pytest.raises(C.BriefingError, match="1–30"):
        C._count(0)


def test_missing_token(monkeypatch):
    monkeypatch.delenv("VRA_BRIEFING_TOKEN", raising=False)
    with pytest.raises(C.BriefingError, match="访问令牌"):
        C.crawl("12345678901234")


def test_401_and_429(monkeypatch):
    monkeypatch.setenv("VRA_BRIEFING_TOKEN", "test-token-123456")
    monkeypatch.setattr(C.time, "sleep", lambda _s: None)
    monkeypatch.setattr(C, "http_get", lambda *a, **k: Resp(401))
    with pytest.raises(C.BriefingError, match="401"):
        C.crawl("12345678901234")

    calls = []
    def fake(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            return Resp(429)
        return Resp(200, {"succeeded": True, "resp_data": {"topics": [{"topic_id": 1, "type": "talk", "talk": {"text": "ok"}, "create_time": "2026-10-09T08:00:00"}]}})
    monkeypatch.setattr(C, "http_get", fake)
    r = C.crawl("12345678901234")
    assert len(calls) == 2
    assert r["count"] == 1 and r["topics"][0]["text"] == "ok"


def test_upstream_failure(monkeypatch):
    monkeypatch.setenv("VRA_BRIEFING_TOKEN", "test-token-123456")
    monkeypatch.setattr(C, "http_get", lambda *a, **k: Resp(200, {"succeeded": False, "resp_err": {"message": "token expired"}}))
    with pytest.raises(C.BriefingError, match="token expired"):
        C.crawl("12345678901234")
    monkeypatch.setattr(C, "http_get", lambda *a, **k: Resp(500, {}))
    with pytest.raises(C.BriefingError, match="HTTP 500"):
        C.crawl("12345678901234")
