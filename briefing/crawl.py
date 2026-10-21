"""个人订阅简报的抓取工具(**只由服务端简报视图调用,不对 Agent 开放**)。

一次 GET 返回订阅源最新一批 topic,归一化成纯文本;不写盘、不碰数据源注册表。
访问令牌只从环境变量 `VRA_BRIEFING_TOKEN` 读(设置页保存的凭据由服务层注入),
错误信息里不回显令牌。订阅组 ID 由调用方传 `group_id`,缺省读 `VRA_BRIEFING_GROUP`。

用法::

    echo '{"group_id":"...","count":30}' | python -m briefing.crawl
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backtest.stdio_utf8 import force_utf8_stdio

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".agents", "skills", "data-access", "scripts"))
from sources._http import http_get  # noqa: E402

BASE = "https://api.zsxq.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MAX_TEXT = 20_000
MAX_TITLE = 300
MAX_TOPICS = 30
RETRY_BACKOFF = (3, 8)


def _int(v: Any) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


class BriefingError(RuntimeError):
    """业务上抓不到(没令牌、组 ID 不对、上游拒绝)。"""


def _token() -> str:
    raw = os.environ.get("VRA_BRIEFING_TOKEN", "").strip()
    if raw.lower().startswith("zsxq_access_token="):
        raw = raw.split("=", 1)[1].strip()
    return raw


def _group_id(arg: Any) -> str:
    gid = str(arg or os.environ.get("VRA_BRIEFING_GROUP", "")).strip()
    if not re.fullmatch(r"\d{6,24}", gid):
        raise BriefingError("订阅组 ID 没填或格式不对(应为 6–24 位数字)")
    return gid


def _count(arg: Any) -> int:
    try:
        n = int(arg if arg is not None else MAX_TOPICS)
    except (TypeError, ValueError):
        raise BriefingError("count 要是整数")
    if not 1 <= n <= MAX_TOPICS:
        raise BriefingError(f"count 范围 1–{MAX_TOPICS}")
    return n


def _strip_html(text: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", str(text or ""))
    text = re.sub(r"<[^>]+>", "", text)
    text = (text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'"))
    return text.strip()


def _extract_institution(title: str, text: str) -> str:
    def pick(s: str) -> str:
        m = re.search(r"【(.+?)】", s)
        if not m:
            return ""
        inst = re.split(r"[|｜\s]", m.group(1).strip())[0]
        if re.fullmatch(r"\d{6}", inst) or len(inst) <= 2:
            return ""
        if re.fullmatch(r"[一-龥]{2,4}\d{6}", inst):
            return ""
        return inst[:40]

    return pick(title) or pick((text or "").split("\n")[0][:200])


def _norm_topic(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    topic_id = str(raw.get("topic_id") or "").strip()
    if not topic_id:
        return None
    kind = str(raw.get("type") or "talk")[:20]
    talk = raw.get("talk") or {}
    question = raw.get("question") or {}
    answer = raw.get("answer") or {}
    content = talk if kind == "talk" else (question if kind in ("q&a", "question") else answer)
    owner = (content or {}).get("owner") or {}
    body = ""
    if kind == "talk":
        body = talk.get("text") or ""
    elif kind in ("q&a", "question"):
        body = question.get("text") or ""
    elif kind == "answer":
        body = answer.get("text") or ""
    else:
        body = talk.get("text") or question.get("text") or ""
    text = _strip_html(body)[:MAX_TEXT]
    title = _strip_html(raw.get("title") or talk.get("title") or question.get("title") or "")[:MAX_TITLE]

    images: List[str] = []
    for img in (raw.get("images") or talk.get("images") or [])[:20]:
        if not isinstance(img, dict):
            continue
        url = (img.get("large") or {}).get("url") if isinstance(img.get("large"), dict) else ""
        url = url or ((img.get("original") or {}).get("url") if isinstance(img.get("original"), dict) else "")
        if url:
            images.append(str(url)[:500])
    files = []
    for f in (raw.get("files") or talk.get("files") or [])[:20]:
        if isinstance(f, dict):
            files.append({"name": str(f.get("name") or "")[:200], "url": str(f.get("url") or "")[:500]})

    return {
        "topic_id": topic_id, "type": kind, "title": title,
        "author": str(owner.get("name") or "")[:80],
        "institution": _extract_institution(title, text),
        "text": text, "images": images, "files": files,
        "create_time": str(raw.get("create_time") or "")[:40],
        "digests": raw.get("digested") is True,
        "likes": _int(raw.get("likes_count")),
        "comments_count": _int(raw.get("comments_count")),
        "reading_count": _int(raw.get("reading_count")),
    }


def _fetch(group_id: str, token: str, count: int) -> List[Dict[str, Any]]:
    url = f"{BASE}/v2/groups/{group_id}/topics"
    headers = {"Cookie": f"zsxq_access_token={token}", "User-Agent": UA, "Referer": "https://wx.zsxq.com/",
               "Accept": "application/json, text/plain, */*"}
    last = ""
    for attempt in range(len(RETRY_BACKOFF) + 1):
        try:
            r = http_get(url, params={"count": count}, headers=headers, timeout=15)
        except Exception as e:  # noqa: BLE001
            last = f"网络异常:{str(e)[:120]}"
            if attempt < len(RETRY_BACKOFF):
                time.sleep(RETRY_BACKOFF[attempt])
                continue
            raise BriefingError(last) from e
        if r.status_code == 401:
            raise BriefingError("访问令牌过期或无效(401),请在设置页更新")
        if r.status_code == 429:
            last = "上游限流(429)"
            if attempt < len(RETRY_BACKOFF):
                time.sleep(RETRY_BACKOFF[attempt])
                continue
            raise BriefingError(last)
        if r.status_code != 200:
            raise BriefingError(f"上游 HTTP {r.status_code}")
        try:
            data = r.json()
        except ValueError as e:
            raise BriefingError("上游返回的不是 JSON") from e
        if not data.get("succeeded"):
            err = data.get("resp_err") or {}
            msg = str((err or {}).get("message") or err or "")[:160]
            raise BriefingError(f"上游返回失败:{msg or '原因不明'}")
        resp = data.get("resp_data") or {}
        raw_topics = resp if isinstance(resp, list) else (resp.get("topics") or [])
        return [t for t in (_norm_topic(x) for x in raw_topics if isinstance(x, dict)) if t]
    raise BriefingError(last or "抓取失败")


def crawl(group_id: Any = None, count: Any = None) -> Dict[str, Any]:
    token = _token()
    if not token:
        raise BriefingError("需要设置简报访问令牌(设置页或环境变量 VRA_BRIEFING_TOKEN)")
    gid = _group_id(group_id)
    n = _count(count)
    topics = _fetch(gid, token, n)
    return {
        "topics": topics, "count": len(topics),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": f"取到最新 {len(topics)} 条;只保存在本机,不上传",
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
    try:
        result = crawl(req.get("group_id"), req.get("count"))
    except BriefingError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
