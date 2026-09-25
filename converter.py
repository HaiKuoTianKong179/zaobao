# -*- coding: utf-8 -*-
"""把懂球帝 APP 专用跳转链接(dongqiudi:// 协议)改写为网页链接。

实测(2026-09)早报文章里的新闻跳转形如 dongqiudi:///news/6395027,
任务书中的 dongqiudi://article?id=6395022 形态一并支持。

要点:这些链接除出现在 <a href> 外,还出现在 window.__NUXT__ 的
JS 数据里——浏览器水合(hydration)时会用它重建 DOM,只改 href 会被
覆盖回去。所以必须对整份 HTML 文本做替换;JS 字符串里的斜杠可能是
\\u002F 或 \\/ 转义形态,三种形态都要匹配。

页面最终从 127.0.0.1 提供,注入 <base> 让相对路径的图片/脚本/样式
仍从懂球帝源站加载,保持原排版(实测样式由 Nuxt JS 动态注入,必须保留)。
"""
import re
from typing import Tuple

from bs4 import BeautifulSoup

PC_URL = "https://www.dongqiudi.com/articles/{id}.html"
MOBILE_URL = "https://m.dongqiudi.com/article/{id}.html"
BASE_HREF = "https://www.dongqiudi.com/"

# 一个斜杠的三种文本形态: / 、 \u002F 、 \/
_SLASH = r"(?:/|\\u002[Ff]|\\/)"
_NEWS_RE = re.compile(
    "dongqiudi:" + _SLASH + _SLASH + "(?:" + _SLASH + ")?news" + _SLASH + r"(\d+)")
_ARTICLE_RE = re.compile(
    "dongqiudi:" + _SLASH + _SLASH + r'article\?id=(\d+)')
_BASE_RE = re.compile(r"(<head[^>]*>)")


def convert(html, version="pc"):
    # type: (str, str) -> Tuple[str, int]
    """替换全文 APP 链接并注入 <base>,返回 (新HTML, 替换数)。"""
    url_tpl = MOBILE_URL if version == "mobile" else PC_URL

    def repl(m):
        return url_tpl.format(id=m.group(1))

    html, n1 = _NEWS_RE.subn(repl, html)
    html, n2 = _ARTICLE_RE.subn(repl, html)
    html = _BASE_RE.sub(
        lambda m: m.group(1) + '<base href="%s">' % BASE_HREF, html, count=1)
    return html, n1 + n2


def remaining_app_links(html):
    # type: (str) -> int
    """校验用:统计 DOM 中仍指向 dongqiudi: 协议的 <a> 数量。

    按任务书要求只改新闻文章链接,team/user 等个人主页链接保持原样,
    因此正常情况下该值不为 0(早报页通常剩 1 个作者链接)。
    """
    soup = BeautifulSoup(html, "html.parser")
    return sum(1 for a in soup.find_all("a", href=True)
               if a["href"].startswith("dongqiudi:"))
