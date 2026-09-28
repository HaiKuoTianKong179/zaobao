# -*- coding: utf-8 -*-
"""懂球帝早报网页化阅读工具 - Flask 主程序。

流程:选择页选日期和版本 → /open 抓取并转换 → 302 跳转 /read/<文件名>。
生成文件落在 output/ 下,可脱机重看(样式与图片仍需联网加载)。
"""
import os
import re
import threading
from datetime import datetime

from flask import Flask, Response, abort, redirect, render_template, request, url_for

import browser
import converter
import scraper

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

HOST = "127.0.0.1"
PORT = 5000

app = Flask(__name__)

# 只允许读取 output/ 里本工具生成的文件名,防路径穿越
# (aid 直连生成的文件名多一段文章号,防同日两篇互相覆盖)
_OUTPUT_NAME_RE = re.compile(r"^zaobao_\d{8}(?:_\d{1,12})?_(pc|mobile)\.html$")

# 手机浏览器 UA 特征;命中即视为手机版(新版 iPad Safari 伪装成桌面 Mac,会被判为电脑版)
_MOBILE_UA_RE = re.compile(r"Mobile|Android|iPhone|iPod|IEMobile|Opera Mini", re.I)


def _detect_version():
    # type: () -> str
    ua = request.headers.get("User-Agent", "")
    return "mobile" if _MOBILE_UA_RE.search(ua) else "pc"


@app.route("/")
def index():
    error = None
    reports = []
    try:
        reports = scraper.recent_reports()
    except scraper.ScrapeError as exc:
        error = str(exc)
    return render_template("select.html", reports=reports, error=error,
                           version=_detect_version())


@app.route("/open")
def open_report():
    date = request.args.get("date", "")
    # 版本由设备 UA 自动判定;URL 里显式传 pc/mobile 可覆盖(测试/手动用)
    version = request.args.get("version", "")
    if version not in ("pc", "mobile"):
        version = _detect_version()
    try:
        aid = request.args.get("aid", "").strip()
        if aid:
            # 直接按文章号处理(专题列表缺期时的后门);只允许纯数字,
            # 防止把任意内容拼进上游 URL
            if not re.match(r"^\d{1,12}$", aid):
                return render_template(
                    "read.html", error="文章号格式不正确,应为纯数字。"), 400
            html = scraper.fetch_article_html(aid)
            date = scraper.extract_article_date(html) or \
                datetime.now().strftime("%Y-%m-%d")
            report = {"aid": aid, "date": date}
        else:
            report = scraper.find_report_by_date(date)
            html = scraper.fetch_article_html(report["aid"])
        converted, replaced = converter.convert(html, version)
    except scraper.ScrapeError as exc:
        return render_template("read.html", error=str(exc)), 502

    # aid 直连时文件名带文章号,避免同日两篇文章互相覆盖
    if aid:
        name = "zaobao_%s_%s_%s.html" % (date.replace("-", ""), aid, version)
    else:
        name = "zaobao_%s_%s.html" % (date.replace("-", ""), version)
    with open(os.path.join(OUTPUT_DIR, name), "w", encoding="utf-8") as f:
        f.write(converted)
    print("已生成 %s(替换 %d 个APP链接,剩余协议链接 %d 个)"
          % (name, replaced, converter.remaining_app_links(converted)))
    # 用与原站一致的 /articles/{aid}.html 路径提供阅读页:Nuxt 前端启动
    # 时按路径匹配路由,/read/... 这类路径不在路由表中会导致应用不挂载
    # (点赞/分享/查看回复全部失灵),带上 zb 参数区分电脑/手机版
    return redirect(url_for("serve_article", aid=report["aid"], zb=version))


@app.route("/articles/<aid>.html")
def serve_article(aid):
    if not re.match(r"^\d{1,12}$", aid):
        abort(404)
    version = request.args.get("zb", "")
    if version not in ("pc", "mobile"):
        version = _detect_version()
    matches = sorted(
        f for f in os.listdir(OUTPUT_DIR)
        if f.endswith("_%s_%s.html" % (aid, version)))
    if matches:
        name = matches[-1]  # 同文章同版本可能跨日期,取最新
    else:
        # 该文章从未生成过(直接访问 URL 的场景):现场抓取转换
        try:
            html = scraper.fetch_article_html(aid)
            converted, _ = converter.convert(html, version)
        except scraper.ScrapeError as exc:
            return render_template("read.html", error=str(exc)), 502
        date = scraper.extract_article_date(html) or \
            datetime.now().strftime("%Y-%m-%d")
        name = "zaobao_%s_%s_%s.html" % (date.replace("-", ""), aid, version)
        with open(os.path.join(OUTPUT_DIR, name), "w", encoding="utf-8") as f:
            f.write(converted)
    with open(os.path.join(OUTPUT_DIR, name), encoding="utf-8") as f:
        return Response(f.read(), mimetype="text/html; charset=utf-8")


@app.route("/read/<name>")
def read(name):
    if not _OUTPUT_NAME_RE.match(name):
        abort(404)
    path = os.path.join(OUTPUT_DIR, name)
    if not os.path.isfile(path):
        return render_template(
            "read.html", error="文件不存在或尚未生成,请返回选择页重新打开。"), 404
    with open(path, encoding="utf-8") as f:
        return Response(f.read(), mimetype="text/html; charset=utf-8")


# /api 代理:阅读页挂载后,页面 JS 的接口请求(评论/回复等)是相对路径,
# 落在本服务上,由这里转发到懂球帝——页面视角即同源,跨域问题消失。
# /images 同理:页面运行时仍会产生少量相对图片请求(如浮窗图标),
# 转发兜底,结果做内存缓存。
_PROXY_ORIGIN = "https://www.dongqiudi.com"
_PROXY_CACHE = {}


def _proxy_response(path, cacheable):
    # type: (str, bool) -> Response
    if cacheable and path in _PROXY_CACHE:
        content, ctype = _PROXY_CACHE[path]
        return Response(content, mimetype=ctype)
    url = _PROXY_ORIGIN + path
    if request.query_string:
        url += "?" + request.query_string.decode("ascii", "ignore")
    try:
        content, ctype = scraper.fetch_raw(url)
    except scraper.ScrapeError:
        abort(502)
    if cacheable:
        _PROXY_CACHE[path] = (content, ctype)
    return Response(content, mimetype=ctype)


@app.route("/api/<path:subpath>")
def proxy_api(subpath):
    return _proxy_response(request.path, cacheable=False)


@app.route("/images/<path:subpath>")
def proxy_images(subpath):
    return _proxy_response(request.path, cacheable=True)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    url = "http://%s:%d" % (HOST, PORT)
    print("懂球帝早报阅读工具启动:%s" % url)
    threading.Timer(0.8, browser.open_url, args=[url]).start()
    try:
        app.run(host=HOST, port=PORT)
    except OSError as exc:
        print("启动失败:端口 %d 可能被占用(%s)。关闭占用程序后重试。" % (PORT, exc))


if __name__ == "__main__":
    main()
