# -*- coding: utf-8 -*-
"""自动打开浏览器。Windows 下 webbrowser 即可;Termux 环境回退到
termux-open-url(需 pkg install termux-tools)。"""
import shutil
import subprocess
import webbrowser


def open_url(url):
    # type: (str) -> bool
    try:
        if webbrowser.open(url):
            return True
    except Exception:
        pass
    termux_open = shutil.which("termux-open-url")
    if termux_open:
        try:
            subprocess.Popen([termux_open, url])
            return True
        except OSError:
            pass
    return False
