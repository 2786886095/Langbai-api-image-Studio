# Codex 交接文档：api生图 / AI 图片生成器

> 更新：2026-06-30（Codex 接着 Claude 收尾）。本文为**当前最新**状态，取代旧的 `CLAUDE_HANDOFF.md`（那份是更早的导出修复轮）。
> 项目路径：`F:\AI\agent\图像生成`　|　GitHub：https://github.com/2786886095/Langbai-api-image-Studio （公开）

---

## 0. 一句话现状
本轮完成了 **UI 整体重设计（蓝白/黑紫 高级感）+ 布局重构 + 结果卡精简 + 移动端修复 + GrsAI 推荐入口 + Windows 原生包 + iOS/macOS 工程骨架 + 跨端 CI**，同步并**重打了安卓 APK**，**上传了 GitHub**。回归全绿。
**待办**：Apple 签名证书接入、GitHub Actions 在远端实际跑一轮并下载 iOS/macOS artifacts。

---

## 1. 本轮已完成（全部回归绿 + 截图自检）
1. **配色 token 重写**（`style.css` 顶部 `:root`/`[data-theme=dark]` 与 `[data-theme=light]`）：
   - 深色=**黑紫**：`--bg:#0c0a12`，`--primary:#8b7cf6`（薰衣草紫）。
   - 浅色=**蓝白**：`--bg:#eef2fb`，`--primary:#2f6bf3`（高级蓝）。
   - `--radius:16px`、`--radius-sm:10px`、柔阴影。还修了一处硬编码旧色 `[data-theme=light] .result-media` 的 `#eef1ea`、`.btn-primary` 文字色。
2. **布局/IA 重构**（`index.html` + `app.js` + `style.css`）：
   - **删掉 `<nav class="side-rail">`**（冗余导航）；`.main-layout` 由三栏改两栏（`style.css` 两处：Deck Refresh 段 + `@media max-width:1240px`）。
   - 导出入口移到**头部** `#exportBtn`（绑定 `handleExportAction`，见 app.js `$("#exportBtn")?.addEventListener` 在 #1156 区附近）。
   - 删**平台条** `.platform-strip`；删 app.js 里失效的 `railLabels` 与 `platform-pill` i18n 死代码。
   - 上传区吉祥物 `<img class="upload-mascot">` → `<span class="ui-icon ui-icon-image">`。
3. **结果卡精简**（`app.js`）：新增 `makeCardActionBtn(iconName,key,onClick)`；成功卡 4 按钮 + 失败卡 2 按钮 → **单行纯图标按钮**（带 title/aria-label）。`style.css` `.result-actions` 由 grid 改 flex + `.card-action`。
4. **移动端回归修复**：原 `@media max-width:560px` 里 `.header-actions #historyBtn,#settingsBtn{display:none}`（旧设计靠侧栏提供，侧栏删了就丢了历史/设置入口）——**已删除该规则**，4 图标在窄屏都显示（诊断脚本 check.js 确认坐标无溢出）。
5. **缓存版本**升级：`index.html` 两处 `?v=20260630-grsai`、`sw.js` `CACHE_NAME="ai-image-generator-grsai-20260630"`、`<meta theme-color>` 改 `#0c0a12`。
6. **GrsAI 推荐入口已落地**：API 地址 placeholder / 一键填入按钮均使用 `https://grsai.dakka.com.cn`，推荐链接指向 `https://grsai.com/zh/dashboard/announcements`，已加 5 语言 i18n。
7. **Windows 原生壳已落地**：`webview_windows` + WebView2，复用 `FlutterDownload` JS 桥，Windows 端原生处理 `nativeFetch` / 导出保存，默认保存到用户 Downloads。
8. **iOS/macOS 平台骨架已生成**：`ios/`、`macos/` 已加入，图标已替换为吉祥物；macOS entitlement 已补网络客户端和用户文件读写权限。
9. **跨端 CI 已加入**：`.github/workflows/build-all-platforms.yml` 覆盖 Android APK、Windows ZIP、macOS app、iOS unsigned app。
10. **同步 android assets + 重打 APK**（见 §3）。**GitHub 上传**（见 §4）。

---

## 2. ⚠️ 必读 gotcha
- **中文路径会让 release APK 构建崩溃**：`flutter build apk --release` 在 `F:\AI\agent\图像生成` 下，Dart AOT / impeller 着色器编译器把中文路径变乱码（`图像生成`→`ͼ������`），snapshot generator 退出码 `-1073740791` 崩溃。
  - **解法（本轮验证可行）**：复制到**纯 ASCII 路径**构建。注意**用户名 `浪白` 也是中文**，所以别用 `%TEMP%`；我用的是 `C:\Users\Public\aigen_build`。
  - 流程：`robocopy 源 目标 /E /XD build .dart_tool .idea qa_screenshots backup_20260106_000000 .gradle /XF *.apk` → `flutter clean` → `flutter build apk --release` → 把 `目标\build\app\outputs\flutter-apk\app-release.apk` 复制回 `源\android\output\AI-Image-Generator-flutter.apk`。
  - 那一堆 `e: ...kotlin_module...metadata 1.8.0 expected 1.6.0` 是**既有依赖警告**，退出码 0、APK 正常生成，别被吓到。
- **改 web 资源后必须同步**到 `android/app/src/main/assets/`（5 文件：app.js / index.html / style.css / manifest.webmanifest / sw.js），否则壳里还是旧代码。可用 SHA256 逐一比对确认。
- **Windows 本地构建 gotcha**：当前 Flutter 3.24 工具对 VS2026 识别不完整，会硬用 `Visual Studio 16 2019` generator。已验证可行做法：先让 Flutter 生成 ephemeral，然后手动跑 VS2026 CMake：
  - `cmake -S windows -B build/windows/x64 -G "Visual Studio 18 2026" -A x64 -DFLUTTER_TARGET_PLATFORM=windows-x64`
  - `cmake --build build/windows/x64 --config Release --target INSTALL`
  - GitHub `windows-latest` 通常是 VS2022，预计 `flutter build windows --release` 可直接跑。
- **Windows 运行包不是单 exe**：必须保留 `data/`、`flutter_windows.dll`、`webview_windows_plugin.dll`、`WebView2Loader.dll`。项目输出 zip 已包含完整运行目录。
- **i18n 有两套机制**：
  1. `I18N` 词典 + `translateElement()`（app.js）——**主力**。按**中文文本节点**翻译，且翻译 `title/placeholder/aria-label` 属性。加可翻译文本就**写中文 + 在 `I18N` 加 5 语言条目**（zh-Hant/en/ja/ko）。`data-no-i18n` 跳过。
  2. `CLEAN_LOCALES` + `applyCleanLanguage()`——**硬编码逐个 `setText(selector,key)`**，**不**通用遍历 `[data-clean]`。光加 `data-clean` 不会自动翻译，必须在 applyCleanLanguage 里手写 setText。**优先用机制 1**。
- **回归测试结构耦合**（`qa/regression-runner.js`，CDP 驱动 Edge）：点击 `[data-mode="comic"]`、`#historyBtn`、`#exportBtn`、`.result-media-reload`、`.history-project-card .history-actions .btn`；收集 `.rail-item`（已空，不断言）；i18n 用例检查 badwords(`????`等) + 控件溢出。**改这些 DOM 要同步改测试**。
- **验证三件套**：`node --check app.js sw.js qa/regression-runner.js` → `node qa/regression-runner.js`（出 `All regression checks passed.`）→ `flutter analyze`（`No issues found!`）。
- scratchpad 有我写的截图/诊断脚本可复用：`shot.js`（4 态截图）、`mock-shot.js`（注入结果卡截图）、`check.js`（枚举元素坐标）。路径见对话，逻辑都是「静态服务器 + 无头 Edge + CDP」。

---

## 3. 本地产物当前状态
- 路径：`F:\AI\agent\图像生成\android\output\AI-Image-Generator-flutter.apk`
- 大小：`43392159` bytes　SHA256：`D357392EFA6027CFA2940482DB6F3909FB04A6F00B38DABDD6EAF4C6C8C3B77A`　时间：2026-06-30 19:46
- Windows ZIP：`F:\AI\agent\图像生成\windows\output\AI-Image-Generator-windows.zip`
- Windows ZIP SHA256：`49DB1A2C23A471DDDE962AD63D802D4958B2FDD3BBCC9902B0EF08F66EED0D8C`
- Windows exe SHA256：`6A29F2429512EDCA4FE15D8D2C77E6D2F8561225DAE6FAF3E9EA19D46D3B849B`
- Windows 启动冒烟：运行 6 秒未崩溃。
- 当前平台：Android 本地 APK、Windows 本地 ZIP；iOS/macOS 已有工程和 CI，但本机 Windows 无法实际构建 Apple 产物。

## 4. GitHub
- 仓库：`Langbai-api-image-Studio`（公开），remote `origin`，分支 `main`，首提交 `c921531`。
- git 身份（本地）：`user.name=Langbai`，`user.email=lb2710137168@gmail.com`。gh 已登录账号 `2786886095`（token 有 repo/workflow）。
- `.gitignore` 已排除 APK/build/.dart_tool/.gradle/backup_/qa_screenshots/qa-smoke.png/windows output。**无密钥泄露**（已扫）。
- 注：`CLAUDE_HANDOFF.md`（旧）和 `qa/` 已随首提交进库；`CODEX_HANDOFF.md` 本轮更新后应提交；APK 未进库。

---

## 5. ✅ 已完成：GrsAI 推荐
用户要求：**推荐 GrsAI 作为第三方 API**（链接 https://grsai.com/zh/dashboard/announcements），**API 地址默认/推荐填 `https://grsai.dakka.com.cn`**。

已落地：
1. `index.html` API 地址 field：
   - placeholder 为 `https://grsai.dakka.com.cn`；
   - input 下方新增 `.grsai-tip`：推荐说明、`grsai.com` 链接、一键填入按钮 `#useGrsaiEndpoint`。
2. `app.js`：
   - `I18N` 新增 `https://grsai.dakka.com.cn`、`推荐使用 GrsAI 第三方 API`、`填入推荐地址` 的 5 语言条目；
   - 默认 placeholder 覆盖逻辑已改为 `https://grsai.dakka.com.cn`；
   - `#useGrsaiEndpoint` 点击后填入并聚焦 `https://grsai.dakka.com.cn`。
3. `style.css`：新增 `.grsai-tip` 紧凑排版。
4. `index.html` / `sw.js` 缓存版本升级到 `20260630-grsai`。
5. 已同步 Android assets，已重打 APK。

已验证：
- `node --check app.js sw.js qa/regression-runner.js`
- `node .\qa\regression-runner.js`
- `flutter analyze`
- 截图：`qa_screenshots/grsai/grsai-api-config.png`
- APK 包内检查：存在 `https://grsai.dakka.com.cn`，不存在旧 placeholder `https://jeniya.top 或 https://grsai.com`。

---

## 6. ✅ 多端打包状态
- **Windows 原生 .exe（WebView2）已完成**：
  - 已生成 `windows/` 平台；
  - 已加 `webview_windows ^0.4.0`；
  - `lib/main.dart` 按平台分支：Windows 用 `webview_windows`，其他平台用 `webview_flutter`；
  - Windows 注入 `FlutterDownload.postMessage` shim，让现有前端继续使用同一套原生桥；
  - Windows 原生实现 `nativeFetch` / `saveFile` / `chooseDir`，导出保存到 `%USERPROFILE%\Downloads\AI Image Generator\...`；
  - 已生成并验证 `windows/output/AI-Image-Generator-windows.zip`。
- **iOS / macOS 工程已生成**：
  - 已生成 `ios/` 与 `macos/`；
  - `webview_flutter_wkwebview 3.22.0` 的 pubspec 明确支持 `ios` 和 `macos`，无需换 `flutter_inappwebview`；
  - iOS/macOS 图标已替换为吉祥物；
  - macOS Release entitlement 已加网络客户端和用户文件读写权限。
- **CI 已加入**：
  - `.github/workflows/build-all-platforms.yml` 包含 Android / Windows / macOS / iOS unsigned 四个 job。
- **仍未完成 / 需要外部条件**：
  - iOS 可在 GitHub macOS runner 生成 unsigned app，但安装/上架仍需 Apple Developer Team、证书、provisioning profile；
  - macOS 可在 GitHub macOS runner 构建 unsigned app，分发给普通用户仍建议签名/notarize；
  - 需要推送后到 GitHub Actions 手动或 push 触发跑一轮，确认远端 macOS/iOS artifact。

---

## 7. 用户偏好 / 沟通方式
- **中文回复**。情绪偏急——**直接说做了什么、验证了什么**，别只丢方案。
- UI 已被反复退回多轮：改 UI 要**产品级**，别只微调颜色。
- 已确定设计决策：风格=**柔和圆润**；配色=**蓝白(浅)/黑紫(深)**；吉祥物只留 **logo + 空状态**；**视觉+布局都重做**。
- 习惯：手动编辑用精确替换；不要 `git reset --hard` 或回滚用户改动；前端改完务必跑 `node qa/regression-runner.js`。
