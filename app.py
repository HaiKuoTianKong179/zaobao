# -*- coding: utf-8 -*-
"""懂球帝早报网页化阅读工具 - Flask 主程序。

流程:选择页选日期和版本 → /open 抓取并转换 → 302 跳转 /read/<文件名>。
生成文件落在 output/ 下,可脱机重看(样式与图片仍需联网加载)。
"""
import os
import re
import threading

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
_OUTPUT_NAME_RE = re.compile(r"^zaobao_\d{8}_(pc|mobile)\.html$")

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
        report = scraper.find_report_by_date(date)
        html = scraper.fetch_article_html(report["aid"])
        converted, replaced = converter.convert(html, version)
    except scraper.ScrapeError as exc:
        return render_template("read.html", error=str(exc)), 502

    name = "zaobao_%s_%s.html" % (date.replace("-", ""), version)
    with open(os.path.join(OUTPUT_DIR, name), "w", encoding="utf-8") as f:
        f.write(converted)
    print("已生成 %s(替换 %d 个APP链接,剩余协议链接 %d 个)"
          % (name, replaced, converter.remaining_app_links(converted)))
    return redirect(url_for("read", name=name))


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
