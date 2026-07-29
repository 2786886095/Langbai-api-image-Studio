# api生图 · AI 图片生成器

> 单图生成 · 漫画分镜 · 气泡嵌字 —— 一套 Web 内核，多端可用（浏览器 / PWA / Windows / macOS / iOS / 安卓 App）。

「api生图」是一款面向单图、漫画分镜和气泡嵌字工作流的图片生成软件。Web 前端与 Flutter 软件壳共用同一套项目数据和生成逻辑，支持 OpenAI 官方 Image API、GrsAI、OpenAI 兼容接口；Windows 与 Android v1.5.4 还可直接启动软件自带的 ChatGPT 网页生图网关。

## v1.5.4：Windows 与 Android 内置 ChatGPT 网页生图

- Windows 安装包已内置图片专用网关，启动软件时自动在 `127.0.0.1:18081–18100` 的可用端口运行，关闭软件后随主程序退出，不再要求用户另装 Python 或手动启动网关。
- Android APK 已内置移动端图片网关和 Python 图像处理运行时；用户无需安装额外网关，软件会在 App 进程内启动仅绑定 `127.0.0.1` 的本机服务。
- 支持两种账号导入方式：
  - Windows 可在独立的官方 ChatGPT 登录窗口完成登录，验证成功后登录窗口自动关闭；
  - Windows 与 Android 均可用系统默认浏览器打开 `https://chatgpt.com/api/auth/session`，全选复制页面内容，再粘贴到软件中智能提取 `accessToken`。
- 支持保存多个 ChatGPT 账号、随时切换当前账号，并可在当前账号明确返回 `401`、`429`、登录失效或额度不足时切换下一账号，仅重试当前图片。
- 每个异步生图任务在提交时绑定账号，避免并发任务因切换账号而串号。
- Session 令牌只保存在操作系统安全存储，并只在运行时发送给本机内置网关；不进入 Local Storage、历史记录、项目文件或导出 ZIP。
- 内置服务只暴露生图、参考图编辑、异步任务、健康检查和本机会话桥；文字接口保持 `404`。

> **适用范围与边界：** 内置 ChatGPT 网页生图随 Windows 与 Android 安装包提供。它是非官方网页兼容层，不等同于 OpenAI 官方 Image API，也不保证任意账号都有图片额度；ChatGPT 网页协议变化、Arkose/Turnstile 交互验证或账号风控出现后可能需要重新获取令牌或升级软件。iOS、macOS 继续使用官方 API、GrsAI 或自定义 API。

## 推荐 API 配置

- 推荐生图中转网站：[https://grsai.com/zh](https://grsai.com/zh)（不是广告，纯粹自己感觉好用）
- GrsAI 生图 API 地址：`https://grsai.dakka.com.cn/v1/api/generate`
- 软件内保留四种入口：`官方 API`、`ChatGPT 网页生图（Windows / Android）`、`GrsAI 生图 API`、`自定义 API`
- Windows 或 Android 选择 `ChatGPT 网页生图` 时，由软件从各自内置网关读取随机运行时地址和密钥；用户界面不保存或要求填写本机网关密钥
- ChatGPT 网页生图固定使用 `gpt-image-2`，单次请求固定 `n=1`；多图和漫画分镜由客户端拆成独立、可恢复的异步任务
- ChatGPT 网页生图支持文生图、最多 20 张参考图的语义编辑，以及软件内蒙版合成式局部重绘；“精确输出”通过覆盖裁切实现，可能裁掉边缘内容
- 官方 API 和 GrsAI 生图 API 会自动填入默认地址；自定义 API 可以保存，也可以设为默认使用
- 选择 `官方 API` 时使用 OpenAI 官方 `https://api.openai.com/v1` Image API，可单独设置 `low / medium / high / auto` 质量、背景、PNG/JPEG/WebP、压缩、审核强度和参考图保真度；这些参数随官方 API 配置保存
- 官方模型检测只保留 OpenAI 的 GPT Image 模型；检测失败时会保留内置官方列表并显示失败原因，不会混入 GrsAI 的 VIP/CL 等中转站模型
- `gpt-image-2` 会在生成前按尺寸、质量和张数显示人民币图片输出估价；生成后若官方响应包含 `usage`，结果卡和历史记录会保存实际 Token 与人民币费用
- USD/CNY 使用 Frankfurter 提供的 ECB 每日参考汇率，最多每 6 小时自动更新一次；失败时使用上次成功值，无缓存时明确回退到 `6.77`，也可手动刷新或用系统浏览器查看 OpenAI 官方最新价格
- 只有选择 `GrsAI 生图 API` 时才使用 GrsAI `/v1/api/generate` + `/v1/api/result` 异步协议和 504 提交重试；GrsAI 参数不会进入官方/自定义请求
- 选择 `自定义 API` 时按 OpenAI 兼容的 `generations / edits` 基础协议调用，不附加 OpenAI 官方、ChatGPT 网页或 GrsAI 专属字段
- 账号、套餐、网站侧配置请用浏览器打开网站处理，软件内不跳转网站

## ✨ 功能

- **三种工作流**：单图生成 + 漫画分镜批量生成 + 参考图气泡嵌字
- **多平台 API 适配**：OpenAI 官方 Image API、Windows / Android 内置 ChatGPT 网页生图、GrsAI generate/result、OpenAI 兼容 generations/edits
- **ChatGPT 多账号**：安全导入、手动切换、额度/登录失败自动切换、任务级账号绑定
- 参考图上传 / TXT 导入 / 自定义分辨率 / 官方与常用尺寸预设 / 有限并发控制
- **生图历史**（漫画按「项目」保存）、失败一键重试、可调重试次数
- **ZIP 打包导出**（桌面浏览器 + 安卓 SAF 目录授权）
- **软件内更新**：设置里可检查 GitHub Releases；Windows 会静默下载并运行安装器自动覆盖升级（弹出安装进度、装完自动重启），Android 会跳转到 GitHub 发布页由系统浏览器下载安装
- **国际化**：简体 / 繁體 / English / 日本語 / 한국어
- **深色（黑紫）/ 浅色（蓝白）双主题**，全端响应式

## 🏗️ 结构

| 文件 | 说明 |
|---|---|
| `index.html` / `app.js` / `style.css` | 纯前端 SPA 核心 |
| `lib/main.dart` | Flutter WebView 壳（Windows / 安卓，CI 同步构建 macOS / iOS 包） |
| `lib/chatgpt_multi_account.dart` | ChatGPT Session 识别、多账号元数据和系统安全存储 |
| `lib/embedded_chatgpt_gateway.dart` | Windows 内置网关生命周期、随机密钥和动态端口管理 |
| `lib/android_chatgpt_gateway.dart` | Android 内置网关生命周期、任务队列、随机密钥和动态端口管理 |
| `embedded_gateway/` | Windows 图片专用网关源码、PyInstaller 构建与隔离冒烟测试 |
| `windows/installer/setup.iss` | Inno Setup 安装脚本，CI 用它编译出 `AI-Image-Generator-Setup.exe` |
| `android/app/src/main/kotlin/.../MainActivity.kt` | 原生桥：下载 / SAF 目录 / native fetch / Android Python 生图 |
| `android/app/src/main/python/android_chatgpt_gateway.py` | Android ChatGPT 网页协议、参考图上传、结果轮询与精确尺寸处理 |
| `api-proxy.js` | 桌面浏览器本地 CORS 代理 |
| `sw.js` / `manifest.webmanifest` | PWA 支持 |
| `qa/regression-runner.js` | 浏览器端回归测试 |

## 🚀 运行

- **浏览器**：先 `node api-proxy.js`，复制终端显示的带令牌地址（形如 `http://127.0.0.1:8787/proxy?token=...`），再用本机 HTTP 服务打开 `index.html` 并将该地址填入「浏览器 CORS 转发地址」。
- 浏览器代理默认拒绝访问本机/局域网目标，避免被网页滥用；确实要连接本地 API 时，可先设置 `AI_PROXY_ALLOW_PRIVATE=1` 再启动 `api-proxy.js`。
- **桌面软件**：设置里的「电脑端网络代理」默认使用 `http://127.0.0.1:7890`，也可切到 SOCKS5、直连或自定义。
- **安卓**：`flutter build apk --release`。⚠️ 中文路径会导致 Dart AOT/着色器编译失败，请复制到纯 ASCII 路径再构建。
- **Windows 安装包**：先运行 `embedded_gateway/build-windows.ps1` 并把产出的 `langbai_chatgpt_gateway` 目录复制到 Flutter Release 目录下的 `chatgpt_gateway/`，再用 [Inno Setup](https://jrsoftware.org/isinfo.php) 编译 `windows/installer/setup.iss`。CI 已自动执行这一流程。安装到 `%LOCALAPPDATA%\AI Image Generator`，无需管理员权限；再次运行安装器会覆盖升级。
- **回归测试**：`node qa/regression-runner.js`（需本机 Edge/Chrome）。

## 🔑 关于密钥

API Key 由你在应用内填写，桌面与移动软件壳会迁移到系统安全存储，并从 `localStorage` 脱敏；纯浏览器版本仍由浏览器本地保存。ChatGPT Session 令牌同样保存在系统安全存储，但与各 API 配置分离。密钥和 Session **不随仓库上传**，不会写入源码、项目历史或导出文件。
