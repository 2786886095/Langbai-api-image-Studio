# Codex 交接文档：api生图 / AI 图片生成器

> 更新：2026-06-30（Codex 接着 Claude 收尾）。本文为**当前最新**状态，取代旧的 `CLAUDE_HANDOFF.md`（那份是更早的导出修复轮）。
> 项目路径：`F:\AI\agent\图像生成`　|　GitHub：https://github.com/2786886095/Langbai-api-image-Studio （公开）

---

## 0. 一句话现状
本轮完成了 **UI 整体重设计（蓝白/黑紫 高级感）+ 布局重构 + 结果卡精简 + 移动端修复 + GrsAI 推荐入口**，同步并**重打了安卓 APK**，**上传了 GitHub**。回归全绿。
**待办**：Windows / iOS / macOS 三端打包。

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
7. **同步 android assets + 重打 APK**（见 §3）。**GitHub 上传**（见 §4）。

---

## 2. ⚠️ 必读 gotcha
- **中文路径会让 release APK 构建崩溃**：`flutter build apk --release` 在 `F:\AI\agent\图像生成` 下，Dart AOT / impeller 着色器编译器把中文路径变乱码（`图像生成`→`ͼ������`），snapshot generator 退出码 `-1073740791` 崩溃。
  - **解法（本轮验证可行）**：复制到**纯 ASCII 路径**构建。注意**用户名 `浪白` 也是中文**，所以别用 `%TEMP%`；我用的是 `C:\Users\Public\aigen_build`。
  - 流程：`robocopy 源 目标 /E /XD build .dart_tool .idea qa_screenshots backup_20260106_000000 .gradle /XF *.apk` → `flutter clean` → `flutter build apk --release` → 把 `目标\build\app\outputs\flutter-apk\app-release.apk` 复制回 `源\android\output\AI-Image-Generator-flutter.apk`。
  - 那一堆 `e: ...kotlin_module...metadata 1.8.0 expected 1.6.0` 是**既有依赖警告**，退出码 0、APK 正常生成，别被吓到。
- **改 web 资源后必须同步**到 `android/app/src/main/assets/`（5 文件：app.js / index.html / style.css / manifest.webmanifest / sw.js），否则壳里还是旧代码。可用 SHA256 逐一比对确认。
- **i18n 有两套机制**：
  1. `I18N` 词典 + `translateElement()`（app.js）——**主力**。按**中文文本节点**翻译，且翻译 `title/placeholder/aria-label` 属性。加可翻译文本就**写中文 + 在 `I18N` 加 5 语言条目**（zh-Hant/en/ja/ko）。`data-no-i18n` 跳过。
  2. `CLEAN_LOCALES` + `applyCleanLanguage()`——**硬编码逐个 `setText(selector,key)`**，**不**通用遍历 `[data-clean]`。光加 `data-clean` 不会自动翻译，必须在 applyCleanLanguage 里手写 setText。**优先用机制 1**。
- **回归测试结构耦合**（`qa/regression-runner.js`，CDP 驱动 Edge）：点击 `[data-mode="comic"]`、`#historyBtn`、`#exportBtn`、`.result-media-reload`、`.history-project-card .history-actions .btn`；收集 `.rail-item`（已空，不断言）；i18n 用例检查 badwords(`????`等) + 控件溢出。**改这些 DOM 要同步改测试**。
- **验证三件套**：`node --check app.js sw.js qa/regression-runner.js` → `node qa/regression-runner.js`（出 `All regression checks passed.`）→ `flutter analyze`（`No issues found!`）。
- scratchpad 有我写的截图/诊断脚本可复用：`shot.js`（4 态截图）、`mock-shot.js`（注入结果卡截图）、`check.js`（枚举元素坐标）。路径见对话，逻辑都是「静态服务器 + 无头 Edge + CDP」。

---

## 3. APK 当前状态
- 路径：`F:\AI\agent\图像生成\android\output\AI-Image-Generator-flutter.apk`
- 大小：`43392088` bytes　SHA256：`08D68A5FA941B96A5A68746EA17713B3630937A7098F2431AB11320B85CFA3CB`　时间：2026-06-30 19:18
- 仅 `android` 平台；依赖 `webview_flutter ^4.8.0` + `webview_flutter_android ^3.16.7`。

## 4. GitHub
- 仓库：`Langbai-api-image-Studio`（公开），remote `origin`，分支 `main`，首提交 `c921531`。
- git 身份（本地）：`user.name=Langbai`，`user.email=lb2710137168@gmail.com`。gh 已登录账号 `2786886095`（token 有 repo/workflow）。
- `.gitignore` 已排除 APK/build/.dart_tool/.gradle/backup_/qa_screenshots/qa-smoke.png。**无密钥泄露**（已扫）。
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

## 6. 🔜 待办：多端打包（用户已拍板方向）
- **Windows = 原生 .exe（WebView2）**：`webview_flutter` 不支持 Windows。需 `flutter create --platforms=windows .` + 加 `webview_windows` 包 + `lib/main.dart` 做**平台条件分支**（Windows 用 webview_windows，安卓/iOS 用 webview_flutter）。原生桥（下载/SAF/native-fetch，`MainActivity.kt`）是**安卓 Kotlin 专属**，Windows 上 `nativeDownload.available()` 会是 false，web 自动回退（blob 下载 + 桌面 proxy 处理 CORS）。**本机可构建**（注意仍可能踩中文路径坑→ ASCII 目录）。
- **iOS / macOS = 云端 Mac CI（GitHub Actions macos runner）**：本机（Windows）无法构建。
  - iOS：`webview_flutter` 已支持；出 `.ipa` 需**用户的 Apple 开发者签名证书**（待用户提供）。
  - macOS：`webview_flutter` **不支持**，需换 webview 包（候选 `flutter_inappwebview` 或 `desktop_webview_window`）。
  - 做法：`flutter create --platforms=ios,macos .` → 写 `.github/workflows/build.yml` 用 `macos-latest` runner `flutter build ios/macos`。
- **架构提醒**：`webview_flutter` 官方仅 Android+iOS。若想四端统一，可整体换 **`flutter_inappwebview`**（支持 Android/iOS/macOS/Windows），但要**重写 `lib/main.dart` + 原生桥**，风险高，**别轻易动已工作的安卓链路**——建议增量加平台、保留安卓现状。

---

## 7. 用户偏好 / 沟通方式
- **中文回复**。情绪偏急——**直接说做了什么、验证了什么**，别只丢方案。
- UI 已被反复退回多轮：改 UI 要**产品级**，别只微调颜色。
- 已确定设计决策：风格=**柔和圆润**；配色=**蓝白(浅)/黑紫(深)**；吉祥物只留 **logo + 空状态**；**视觉+布局都重做**。
- 习惯：手动编辑用精确替换；不要 `git reset --hard` 或回滚用户改动；前端改完务必跑 `node qa/regression-runner.js`。
