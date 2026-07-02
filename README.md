# api生图 · AI 图片生成器

> 单图生成 · 漫画分镜批量生成 —— 一套 Web 内核，多端可用（浏览器 / PWA / Windows / macOS / iOS / 安卓 App）。

「api生图」是一个零构建、纯前端的 AI 图片生成器：用你自己的图片生成 API（GrsAI / OpenAI 兼容 / SiliconFlow / Gemini 等）出图，并通过 Flutter WebView 壳覆盖桌面端与移动端。

## 推荐 API 配置

- 推荐生图中转网站：[https://grsai.com/zh](https://grsai.com/zh)（不是广告，纯粹自己感觉好用）
- GrsAI 生图 API 地址：`https://grsai.dakka.com.cn/v1/api/generate`
- 软件内可选三种 API：`官方 API`、`GrsAI 生图 API`、`自定义 API`
- 官方 API 和 GrsAI 生图 API 会自动填入默认地址；自定义 API 可以保存，也可以设为默认使用
- 只有选择 `GrsAI 生图 API` 时才使用 GrsAI 官方 `/v1/api/generate` 协议；选择 `官方 API` / `自定义 API` 时优先按 OpenAI 兼容通用协议调用
- 账号、套餐、网站侧配置请用浏览器打开网站处理，软件内不跳转网站

## ✨ 功能

- **双模式**：单图生成 + 漫画分镜批量生成
- **多平台 API 适配**：GrsAI 官方 generate/result、OpenAI 通用（generations / edits）等
- 参考图上传 / TXT 导入 / 自定义分辨率 / 有限并发控制
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
| `windows/installer/setup.iss` | Inno Setup 安装脚本，CI 用它编译出 `AI-Image-Generator-Setup.exe` |
| `android/app/src/main/kotlin/.../MainActivity.kt` | 原生桥：下载 / SAF 目录 / native fetch |
| `api-proxy.js` | 桌面浏览器本地 CORS 代理 |
| `sw.js` / `manifest.webmanifest` | PWA 支持 |
| `qa/regression-runner.js` | 浏览器端回归测试 |

## 🚀 运行

- **浏览器**：先 `node api-proxy.js`，再用任意 HTTP 服务打开 `index.html`，在「浏览器 CORS 转发地址」填 `http://127.0.0.1:8787/proxy`。
- **桌面软件**：设置里的「电脑端网络代理」默认使用 `http://127.0.0.1:7890`，也可切到 SOCKS5、直连或自定义。
- **安卓**：`flutter build apk --release`。⚠️ 中文路径会导致 Dart AOT/着色器编译失败，请复制到纯 ASCII 路径再构建。
- **Windows 安装包**：`flutter build windows --release` 之后用 [Inno Setup](https://jrsoftware.org/isinfo.php) 编译 `windows/installer/setup.iss`（`ISCC.exe windows\installer\setup.iss /DMyAppVersion=x.x.x`），产出 `AI-Image-Generator-Setup.exe`。安装到 `%LOCALAPPDATA%\AI Image Generator`，无需管理员权限；再次运行同一个安装器会自动关闭正在运行的旧版本并覆盖升级。
- **回归测试**：`node qa/regression-runner.js`（需本机 Edge/Chrome）。

## 🔑 关于密钥

API Key 由你在应用内填写，仅保存在本机浏览器 `localStorage`，**不随仓库上传**，不会出现在代码里。
