# 懂球帝早报网页化阅读工具

把懂球帝 APP 专用的早报文章转换成浏览器可直接阅读、新闻可直接点开的网页。

## 用法

```bash
pip install -r requirements.txt
python zaobao.py        # 或 python app.py
```

启动后自动打开浏览器进入 `http://127.0.0.1:5000`:选日期 → 打开早报,
程序按设备 User-Agent 自动选择电脑版/手机版转换,自动跳转阅读页。
生成文件保存在 `output/` 下(URL 里显式传 `version=pc|mobile` 可覆盖自动判定)。

Windows 7 / Python 3.8 与 Android Termux(`pkg install python` 后同上)均可运行。

## 原理(基于 2026-09 实测)

- 专题页 `dongqiudi.com/special/48` 是 Nuxt 渲染,文章列表在
  `window.__NUXT__` JS 数据块里(字段 `title` / `aid` / `show_time`),
  用正则配对提取;文章地址即 `articles/{aid}.html`。
- 早报正文里的新闻跳转实际形如 `dongqiudi:///news/{id}`
  (任务书假设的 `dongqiudi://article?id=` 一并支持),且同时出现在
  `<a href>` 和 NUXT 数据里——浏览器水合会用后者重建 DOM,所以必须
  整份 HTML 文本替换(含 `\u002F`、`\/` 转义形态),只改 href 会被还原。
- 页面样式由懂球帝的 JS 动态注入,因此阅读页保留原站脚本;相对资源地址
  在转换时绝对化指向懂球帝源站,**不能**用 `<base>` 标签替代——实测 base
  会改变页面基地址,导致 Nuxt 启动时路由推导失败、应用不挂载,页面上
  点赞/分享/查看回复等一切交互失灵。
- 阅读页以与原站一致的 `/articles/{文章号}.html?zb=pc|mobile` 路径提供
  (路径不在原站路由表内同样会导致应用不挂载);页面挂载后其接口请求是
  相对路径,由本服务的 `/api` 代理转发到懂球帝,实现同源取数——评论
  "查看回复"因此可用,无需 APP。`/images` 等运行时相对图片同理代理。
  旧 `/read/文件名` 地址仍可用,但为纯静态(无交互)。
- 按任务书要求只改新闻文章链接;作者/球队等 `dongqiudi:///user|team`
  链接保持原样(早报页通常剩 1 个作者链接)。
- 版本在 `/open` 处理时按请求 UA 判定(Mobile/Android/iPhone 等 → 手机版,
  其余 → 电脑版),因此在哪个设备上点开就按哪个设备转换。
- 选择页支持直接填文章号(aid)打开:专题列表偶尔滞后于实际发布
  (文章已出、列表未挂),此时按日期选不到,填文章号即可直达;
  日期从文章页 `article:published_time` meta 自动提取。
- 抓取始终直连懂球帝(会话 `trust_env=False`),无视系统/环境变量代理:
  Windows 系统代理被 Python 解析出 `https://` 前缀时会对代理发起 TLS,
  导致 ProxyError,直连则彻底绕开此坑。
