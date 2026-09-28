# -*- coding: utf-8 -*-
"""把懂球帝 APP 专用跳转链接(dongqiudi:// 协议)改写为网页链接。

实测(2026-09)早报文章里的新闻跳转形如 dongqiudi:///news/6395027,
任务书中的 dongqiudi://article?id=6395022 形态一并支持。

要点:这些链接除出现在 <a href> 外,还出现在 window.__NUXT__ 的
JS 数据里——浏览器水合(hydration)时会用它重建 DOM,只改 href 会被
覆盖回去。所以必须对整份 HTML 文本做替换;JS 字符串里的斜杠可能是
\\u002F 或 \\/ 转义形态,三种形态都要匹配。

相对资源地址(如 /_nuxt/*.js)一律绝对化指向懂球帝源站:不能用
<base> 标签实现同样效果——实测 base 会改变页面的"基地址",导致
Nuxt 框架启动时路由推导失败、整个应用不挂载(点赞/分享/查看回复
全部失灵);而资源绝对化后脚本跨域加载不受限,应用正常挂载。
接口请求(fetch/XHR)是相对路径,落在本地服务上,由 app.py 的
/api 代理路由转发,实现同源取数。
"""
import re
from typing import Tuple

from bs4 import BeautifulSoup

PC_URL = "https://www.dongqiudi.com/articles/{id}.html"
MOBILE_URL = "https://m.dongqiudi.com/article/{id}.html"
ORIGIN = "https://www.dongqiudi.com"

# 一个斜杠的三种文本形态: / 、 \u002F 、 \/
_SLASH = r"(?:/|\\u002[Ff]|\\/)"
_NEWS_RE = re.compile(
    "dongqiudi:" + _SLASH + _SLASH + "(?:" + _SLASH + ")?news" + _SLASH + r"(\d+)")
_ARTICLE_RE = re.compile(
    "dongqiudi:" + _SLASH + _SLASH + r'article\?id=(\d+)')

# 相对资源地址绝对化:src="/x" / href="/x"(单斜杠开头;双斜杠开头的是
# 协议相对地址,本就是绝对地址,不动)
_REL_SRC_RE = re.compile(r'(src|href)="/(?!/)')
# 内联样式里的 url(/x)
_REL_CSS_RE = re.compile(r'url\(/(?!/)')


def convert(html, version="pc"):
    # type: (str, str) -> Tuple[str, int]
    """替换全文 APP 链接并把相对资源绝对化,返回 (新HTML, 替换数)。"""
    url_tpl = MOBILE_URL if version == "mobile" else PC_URL

    def repl(m):
        return url_tpl.format(id=m.group(1))

    html, n1 = _NEWS_RE.subn(repl, html)
    html, n2 = _ARTICLE_RE.subn(repl, html)
    html = _REL_SRC_RE.sub(lambda m: '%s="%s/' % (m.group(1), ORIGIN), html)
    html = _REL_CSS_RE.sub(lambda m: 'url(%s/' % ORIGIN, html)
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
