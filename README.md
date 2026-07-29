# api生图 · AI 图片生成器

> 单图生成 · 漫画分镜 · 气泡嵌字 —— 一套 Web 内核，多端可用（浏览器 / PWA / Windows / macOS / iOS / 安卓 App）。

「api生图」是一款面向单图、漫画分镜和气泡嵌字工作流的中文图片生成软件。Web 前端与 Flutter 软件壳共用同一套项目数据和生成逻辑，支持 OpenAI 官方 Image API、ChatGPT 网页生图、Gemini 网页生图、GrsAI 与 OpenAI 兼容接口。

## v1.6.3：Gemini 任务续接与全局分辨率

- 修复 Gemini 点击“临时对话”触发页面重载后任务执行上下文丢失、永远卡在“准备临时对话”的根因。
- 页面重载后继续领取同一任务和同一 claim，不再跳到后面的任务；同一账号只允许一个顶层页面执行任务。
- 移除客户端与隐藏浏览器的 12 分钟硬超时；任务会持续跟踪到成功、明确失败或用户取消，不会把仍在运行的任务误报成 HTTP 504。
- Gemini 面板移除重复的尺寸模式、网页比例、裁切和质量选项，统一使用软件全局分辨率，并固定采用无拉伸安全区裁切输出。

## v1.6.2：账号会话恢复与 Gemini 登录修复

- Windows 更新或重启后，软件会从系统安全存储恢复当前 ChatGPT 网页账号令牌，并重新注入本次新启动的内置网关；不会清空或覆盖现有账号。
- 当前 ChatGPT 账号的安全存储条目损坏时，可回退到其他已保存账号，同时保留原账号元数据，方便用户后续重新导入。
- Gemini 登录页检测到已登录且输入框可用后，会通过本机鉴权通道保存账号并自动收起。
- Windows Gemini WebView 改为遵守 Flutter 组件边界，返回、刷新和关闭工具栏不会再被网页覆盖。
- Google 登录重定向结束后会重新执行带防重复保护的页面探测，减少“已经登录但软件没有保存”的情况。

## v1.6.1：Gemini 网页生图（软件内登录）

- 新增独立的 `Gemini 网页生图` 供应商，不复用或覆盖 ChatGPT、官方 OpenAI、GrsAI、自定义 API 的配置与账号。
- Windows、Android、macOS、iOS 均由软件内置浏览器打开 Gemini 登录页；登录状态确认后登录界面自动收起，后续任务继续在隐藏浏览器中执行。
- 支持添加多个 Gemini 账号、手动切换，以及当前账号明确额度不足或登录失效后的自动切换；账号会话只保存在当前设备，不跨设备同步。
- 软件只保存本机随机连接密钥、脱敏账号元数据和任务检查点；登录会话留在操作系统 WebView 的本地隔离存储中，不进入历史项目或导出文件。
- 每张图片固定创建独立的 Gemini 临时对话任务，生成前后检查普通历史列表是否发生变化，并通过带鉴权的本机回环服务下载完整尺寸图片。
- 支持原生完整尺寸、严格原生、精确输出和本地 4K 四种尺寸模式；软件读取图片真实像素，等比裁切或包含缩放，不做非等比拉伸，并保存尺寸审计。
- 本地可排队 1–100 张；界面会按内置浏览器实际报告的能力限制有效并发。任务提交后保存任务 ID，软件重启后继续轮询原任务，不重复提交。
- 图片生成成功后立即进入软件本地缓存；只有点击下载、导出 ZIP 或保存到文件夹时，才写入用户选择的输出目录。

> **平台边界：** Gemini 网页结构或 Google 登录策略变化后仍可能需要更新软件。四端安装包会验证内置浏览器、账号切换和任务桥；真实账号的额度、审核与区域可用性由 Google 决定。

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
- 软件内保留五种入口：`官方 API`、`ChatGPT 网页生图（Windows / Android）`、`Gemini 网页生图（四端）`、`GrsAI 生图 API`、`自定义 API`
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
- **多平台 API 适配**：OpenAI 官方 Image API、Windows / Android 内置 ChatGPT 网页生图、四端内置 Gemini 网页生图、GrsAI generate/result、OpenAI 兼容 generations/edits
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
