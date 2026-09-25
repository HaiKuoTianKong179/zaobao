# -*- coding: utf-8 -*-
"""解析懂球帝早报专题页(https://www.dongqiudi.com/special/48)。

专题页是 Nuxt 服务端渲染:文章列表不在 DOM 链接里,而是位于
window.__NUXT__ 的 JS 数据块中,每条目含 title / aid / show_time
三个字段,因此用正则按固定顺序配对提取。aid 即文章 ID,
网页地址为 https://www.dongqiudi.com/articles/{aid}.html。
"""
import re
import time
from datetime import datetime
from typing import Dict, List, Optional  # noqa: F401  (Python 3.8 兼容的类型标注)

import requests

SPECIAL_URL = "https://www.dongqiudi.com/special/48"
ARTICLE_URL = "https://www.dongqiudi.com/articles/{aid}.html"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}
TIMEOUT = 15

# 懂球帝是国内站,直连即可。无视系统/环境变量里的代理设置:
# Windows 系统代理经 Python 解析会给 https 协议配上 "https://" 前缀,
# 导致对代理发起 TLS 连接而失败(实测报 ProxyError)。
_session = requests.Session()
_session.trust_env = False

# 同一条目内: title:"..." ... aid:"123" ... show_time:1695600000
# 标题里的转义引号用 (?:[^"\\]|\\.) 跳过;aid 与 show_time 之间限制距离,
# 防止跨条目配对。
_ITEM_RE = re.compile(
    r'title:"((?:[^"\\]|\\.)*)"'
    r'.{0,600}?aid:"(\d+)"'
    r'.{0,200}?show_time:(\d+)',
    re.S,
)

_UNESCAPE_RE = re.compile(r"\\u([0-9a-fA-F]{4})")


class ScrapeError(Exception):
    """抓取/解析失败,消息可直接展示给用户。"""


def _unescape(text):
    # type: (str) -> str
    """还原 JS 字符串里的 \\uXXXX、\\/ 、\\" 转义。"""
    text = _UNESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
    return text.replace("\\/", "/").replace('\\"', '"')


def _get(url):
    # type: (str) -> str
    try:
        resp = _session.get(url, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise ScrapeError("网络请求失败:%s" % exc)
    if resp.status_code != 200:
        raise ScrapeError("请求 %s 返回状态码 %s" % (url, resp.status_code))
    resp.encoding = "utf-8"
    return resp.text


# 专题列表缓存:选择页与 /open 都要用,避免每次点击都重新抓专题页
_cache = {"time": 0.0, "reports": None}  # type: Dict[str, object]
_CACHE_TTL = 300.0


def fetch_reports(force=False):
    # type: (bool) -> List[Dict[str, str]]
    """返回专题页全部早报条目,新日期在前。"""
    now = time.time()
    cached = _cache["reports"]
    if not force and cached is not None and now - _cache["time"] < _CACHE_TTL:
        return cached  # type: ignore[return-value]

    html = _get(SPECIAL_URL)
    by_date = {}  # type: Dict[str, Dict[str, str]]
    for m in _ITEM_RE.finditer(html):
        title = _unescape(m.group(1))
        if "早报" not in title:
            continue  # 专题内偶尔混入其他条目
        dt = datetime.fromtimestamp(int(m.group(3)))
        date = dt.strftime("%Y-%m-%d")
        # NUXT 列表本身按新→旧排列,同日重复时保留先出现的
        by_date.setdefault(date, {
            "aid": m.group(2),
            "title": title,
            "date": date,
            "time": dt.strftime("%H:%M"),
        })
    if not by_date:
        raise ScrapeError("专题页解析不到早报列表,网站结构可能已变化")
    reports = sorted(by_date.values(), key=lambda r: r["date"], reverse=True)
    _cache["time"] = now
    _cache["reports"] = reports
    return reports


def recent_reports(days=7):
    # type: (int) -> List[Dict[str, str]]
    """最近 days 期早报(列表已按日期新→旧排序)。"""
    return fetch_reports()[:days]


def find_report_by_date(date):
    # type: (str) -> Dict[str, str]
    for report in fetch_reports():
        if report["date"] == date:
            return report
    raise ScrapeError("没有找到 %s 的早报,请返回选择页重选日期" % date)


def fetch_article_html(aid):
    # type: (str) -> str
    """下载早报文章页完整 HTML(含服务端渲染好的正文)。"""
    return _get(ARTICLE_URL.format(aid=aid))
