# Codex Handoff: AI 图片生成器 v1.2.6

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.6`

## 本轮结论

这份文档上次更新还停在 `v1.0.6`，中间隔了很多轮（`v1.0.7`~`v1.2.0` 的完整历史、决策依据、踩过的坑，都在 `CLAUDE_HANDOFF.md` 里，那份文档每次发布都会整篇重写，是更权威的最新状态源）。这一轮（`v1.2.1` → `v1.2.6`）的核心主线是：**用户反复反馈"打包后的 Windows exe 有问题，但 HTML/浏览器端完全正常"，排查到底之后发现是同一个根因反复出现**——Windows 端用的 `webview_windows` 插件（离屏渲染 WebView2）从 2024-02 发布 `0.4.0` 之后再没发布过新版本到 pub.dev，但插件的 GitHub 源码仓库这之后一直有人在合并修复，只是没人打版本号发出来。

已完成（按版本顺序）：

- **v1.2.1**：启动时静默检测更新，有新版本用页面内确认弹窗问是否立即更新。
- **v1.2.2**（根因排查的第一次突破）：定位到"设置无法滑动/API 配置列表打不开"的真正原因——原生 `<select>` 下拉框展开的选项列表是 Chromium 内部另开的辅助弹窗，不在离屏渲染的截屏范围内，所以在 exe 里完全不显示/点不到。把 6 个原生 `<select>` 全部换成自绘的 `.custom-select` 组件。
- **v1.2.3**（三个独立修复/功能合并发布）：漫画分镜生成结果新增"保存到文件夹"；并发/依次生成开关从"只有单图模式能看到"的字段里挪出来放到共用区域；重试生成的图片后历史记录原地更新，不再留旧图或产生重复记录。
- **v1.2.4**：确认 exe 端拖放上传参考图从未真正工作过（上游 issue `#9` 常年 open），改成只在原生 Windows exe 里把提示文案从"点击或拖拽"改成"点击上传"。
- **v1.2.5**：第一版"设置弹窗鼠标滚轮无法滚动"修复——`isNativeWindowsWebview()` 判断原生 Windows exe + `findScrollableAncestor()` 找可滚祖先 + `initManualWheelScrollFix()` 挂 document 级委托监听器。**这一版有遗留问题**：只处理了"wheel 事件目标就在弹窗内部"的情况。
- **v1.2.6**：用户复测后反馈"滚轮把主界面滚了，设置弹窗还是不动"——排查发现代码库里另有一个更早存在的 `installGlobalWheelScrollBridge()`（专门给主输入面板 `.input-panel` 做滚轮转发，同样是绕这个插件缺陷），跟 v1.2.5 新加的 `initManualWheelScrollFix()` 互不知情：事件被 `webview_windows` 误派给 `.input-panel`/`body` 时，`initManualWheelScrollFix()` 在自己目标下找不到可滚容器就放弃了，`installGlobalWheelScrollBridge()` 一看目标底下没有能滚的东西就顺手滚了主界面。修复思路是让两个监听器共享"当前是否有可见覆盖层"的判断（新增 `getVisibleBlockingOverlays()`/`getTopVisibleOverlay()`/`getOverlayPrimaryScroller()`/`updateBodyScrollLock()`），弹窗打开时主界面监听器直接不介入，弹窗内监听器改成 capture 阶段先拿到事件、且能正确解析"事件目标被误派到弹窗外部"这种情况。**这一版顺带把 `openModal`/`closeModal`/`openAskDialog`/`openLightbox` 里各自手写的 `document.body.style.overflow` 统一收敛到 `updateBodyScrollLock()`**，以后新增覆盖层/弹窗组件时应该接入这套机制而不是重新手写。

**没有落地、需要用户决定的事**：`webview_windows` 依赖是否从 pub.dev 的 `0.4.0` 切换成 git 依赖指向上游最新 commit（`ed81bbe985c12759a44b9cca8170e19c73b961c0`），能一次性拿到 `<select>`/滚轮问题的官方修复（而不是应用层 workaround）。这个改动会被 Claude Code 的权限分类器拦下要求用户明确同意（改了依赖来源），已经问过一次没等到回复，目前**没有改**，`pubspec.yaml` 仍然是 `webview_windows: ^0.4.0`。如果 Codex 这边被要求处理类似"依赖来源变更"的操作，同样应该先跟用户确认，不要自己判断"看起来安全就直接改"。

## 关键改动文件（v1.2.1 → v1.2.6 累计）

- `app.js`
  - `APP_VERSION = "1.2.6"`
  - 新增 `initCustomSelect(selectEl)` + `_customSelectRegistry`：6 个自绘下拉框共用的组件逻辑
  - 新增 `currentComicHistoryId`/`card._historyRecordId` 跟踪 + `replaceSingleHistoryRecord()`/`updateComicHistoryPanel()`：重试后原地更新历史记录
  - 新增 `saveComicResultsToFolder()`：漫画结果保存到自动创建的子文件夹；`nativeDownload.saveFile(kind, fileName, mimeType, base64, folder = "")` 新增第 5 个参数
  - 新增 `isNativeWindowsWebview()`（判断是否运行在打包后 Windows exe 里的公共判定），`isDragDropUnsupported()` 复用它
  - **滚轮+覆盖层管理这套机制（v1.2.5+v1.2.6 合计）**：`canScrollVertically()`、`scrollElementByWheelDelta()`、`getWheelDeltaY()`（归一化 pixel/line/page 三种 deltaMode）、`isOverlayVisible()`、`getVisibleBlockingOverlays()`、`getTopVisibleOverlay()`、`getOverlayPrimaryScroller()`、`updateBodyScrollLock()`、`findScrollableAncestor()`、`resolveManualWheelScrollTarget()`、`initManualWheelScrollFix()`（capture 阶段监听）、`installGlobalWheelScrollBridge()`（bubble 阶段监听，覆盖层打开时直接让路）。**这套机制必须在文件末尾 `nativeDownload` 初始化完之后才能启用**（`initI18n(); registerServiceWorker(); initManualWheelScrollFix();` 这个启动序列，提前调用会因为 `const nativeDownload` 的暂时性死区报错）。
  - `#sequentialToggle`（并发/依次生成开关）从 HTML 里的 `.n-images-row` 移到共用配置区域
  - i18n：新增 `sequentialHint`/`saveToFolder`/`savingToFolder`/`folderSaved`/`uploadRefsClickOnly` 等 key，5 语言全覆盖
- `index.html`
  - 资源 query 升到 `20260703-1-2-6`
  - 6 个原生 `<select>` 全部包了一层 `.custom-select`
  - 新增 `#saveComicFolder` 按钮（`class="hidden"`，只在漫画模式 + 原生 Windows exe 下显示）
- `style.css`
  - 新增 `.custom-select`/`.custom-select-trigger`/`.custom-select-list`/`.custom-select-option` 系列规则、`.ui-icon-folder`
  - `.no-native-download #saveComicFolder { display: none !important; }`
  - `.modal`/`.modal-card` 新增 `overscroll-behavior: contain`（v1.2.6，浏览器侧 scroll chaining 兜底）
- `lib/main.dart`
  - `_saveWindowsFile` 新增第 4 个可选参数 `folder`
  - **Android 消息转发层 `_handleDownloadMessage` 的 `'saveFile'` 分支也要同步传 `folder`**（这是 Windows 和 Android 两条独立 native bridge 路径中的另一条，第一次改的时候漏了）
- `android/app/src/main/kotlin/.../MainActivity.kt`
  - `saveFile()` 新增 `folder` 参数，用 SAF `DocumentFile.findFile(name)?.takeIf{isDirectory} ?: tree.createDirectory(name)` 做子目录
- `qa/regression-runner.js`
  - 新增 `testCustomSelects`、`testRetryReplacesHistoryEntry`、`testSequentialToggleSharedAcrossModes`、`testSaveComicFolder`、`testDragDropHintReflectsPlatform`、`testManualWheelScrollFallback`
  - `testManualWheelScrollFallback`（v1.2.6 大幅扩展）覆盖：弹窗内目标、误派发到 `.input-panel`、误派发到 `body`、line-mode wheel delta、ask-dialog、lightbox 六种场景
  - 涉及 Windows 环境的测试用 `Emulation.setUserAgentOverride` 模拟 Windows UA + `Page.addScriptToEvaluateOnNewDocument` 在导航前注入 `window.FlutterDownload` mock（**关键坑**：mock 必须在 `loadFresh()` 触发的整页导航**之前**注入，导航后旧上下文里 `cdp.eval` 设的变量会全部丢失）
- `sw.js`：`CACHE_NAME = "ai-image-generator-1-2-6-20260703"`
- `pubspec.yaml`：`version: 1.2.6+19`；`webview_windows` 依赖**未改**，仍是 `^0.4.0`
- `windows/runner/Runner.rc`：`VERSION_AS_NUMBER 1,2,6,19` / `VERSION_AS_STRING "1.2.6"`
- `android/app/src/main/assets/`：已同步 `app.js`/`index.html`/`style.css`/`sw.js`（SHA256 校验过一致）

## 已通过验证

```powershell
node --check app.js
node --check qa\regression-runner.js
node --check sw.js
flutter analyze
flutter test
node qa\regression-runner.js
```

回归输出（v1.2.6，全部通过）：

```text
[qa] Custom dropdown lists (replacing native <select> popups) open, select, and close correctly
[qa] API config save, restore, delete, and mobile scroll
[qa] Reference image sorting, single file picker click, and auto-fill template
[qa] Comic generation history as project, restore, and ZIP export
[qa] Retrying a generated image updates its history entry in place instead of leaving a stale duplicate
[qa] Concurrent/sequential generation toggle must be visible and usable in both single-image and comic mode
[qa] Comic-mode 'save to folder' button is mode-gated and saves every panel through the native bridge into one shared auto-created folder
[qa] 400-only retry, clear while generating, reload failed image, and i18n layout
[qa] Desktop proxy settings and native payload propagation
[qa] GrsAI official generate/result adapter behavior
[qa] Settings update controls and platform package selection
[qa] Startup update check should prompt once and respect the user's choice
[qa] Drag-and-drop hint text must not promise drag support inside the packaged Windows exe...
[qa] Native Windows exe must manually redirect wheel-scroll to the nested scrollable ancestor...
[qa] Android update check should redirect to GitHub release page, not install in-app
[qa] All regression checks passed.
```

`flutter test`：7 个测试全过。`flutter analyze`：`No issues found!`。

## 发布验证状态

- v1.2.3~v1.2.6：GitHub Actions 四端构建（macOS / Android / Windows / iOS unsigned）全部 success。
- 每个版本发布前都下载 CI 产物解包验证：四端 `app.js` 的 `APP_VERSION` 字符串匹配、对应修复的函数名/标记字符串确认已编译进产物。
- Android release APK 签名 SHA1 每次都核对，固定为：
  `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`
- **Windows 端额外做了本机验证**（本机没有 Visual Studio 不能自己 build，但装了 Inno Setup）：用 CI 产物的 `AI-Image-Generator-Setup.exe` 在本机做一次真实 `/VERYSILENT` 静默安装 → 核对安装后 `data\flutter_assets\app.js` 的版本号和修复标记 → 再 `/VERYSILENT` 静默卸载确认干净。每个版本都做了这一步，不是只看 CI 绿灯。
- 各版本 GitHub Release：
  - `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.3`
  - `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.4`
  - `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.5`
  - `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.6`

## 发布说明建议（v1.2.1 → v1.2.6 汇总）

```text
v1.2.1 新增启动时自动检测更新并弹窗询问。v1.2.2 定位并修复了"设置无法滑动/API 配置列表打不开"的根因——Windows 端 webview_windows 插件离屏渲染下原生 <select> 弹出层不显示，6 个下拉框全部换成自绘组件。v1.2.3 新增漫画分镜结果直接保存到文件夹、把并发/依次生成开关补到漫画模式也能用、修复重试图片后历史记录留旧图的问题。v1.2.4 修正了 exe 端拖放上传参考图的误导性提示（这个渲染模式下拖放从未支持过）。v1.2.5 修复了设置弹窗等嵌套滚动区域鼠标滚轮无法滚动的问题；v1.2.6 补强了同一个修复在"滚轮事件被误派发到主界面/body"这种边界情况下的处理，避免设置弹窗不动、主界面被误滚动。以上多个问题的共同根因是 webview_windows 插件已经一年多没有发布新版本，虽然上游代码库有对应修复但从未打包发布，目前用应用层 workaround 绕过；是否切换到指向上游最新代码的依赖还在等待确认。
```

## 注意

- `CLAUDE_HANDOFF.md` 保留更早的历史（`v1.0.6` 及更早的完整决策依据、Windows Inno Setup 安装器踩坑记录、Android 签名流程）和每个"仅原生 Windows exe 复现"类 bug 的详细排查过程，这份文档没有重复摘抄，只讲这一轮结论。
- **Android 正式签名密钥（`C:\aigen-signing\ai-image-generator-release.jks`）不要重新生成**，否则会破坏覆盖更新链。
- **Windows 安装器 AppId GUID（`83D775F4-F8FD-418B-B3AF-5C4397ABF5E0`）不要改**。
- 不要把已经自绘的 6 个 `.custom-select` 组件改回原生 `<select>`，也不要把滚轮+覆盖层管理这套机制（`initManualWheelScrollFix`/`installGlobalWheelScrollBridge`/`updateBodyScrollLock`）的触发条件从"仅原生 Windows exe"改成无条件启用。
- 新增任何新的模态/覆盖层组件（弹窗、灯箱等）时，如果它需要"打开时锁 body 滚动 + 参与滚轮误派发防护"，应该接入 `updateBodyScrollLock()`/`getVisibleBlockingOverlays()` 这套机制，不要自己重新手写 `document.body.style.overflow`。
- 任何"只有打包后的 exe 才复现、浏览器端正常"的新反馈，先查 `webview_windows` 插件的 GitHub issue 列表（`gh api "search/issues?q=repo:jnschulze/flutter-webview-windows+<关键词>+in:title,body"`），大概率已经是同一类已知限制。
- 本轮 v1.2.6 的修复本身是在另一个并行会话（用户同时在跑）里完成、以未提交的工作区改动形式出现的，接手后先用 `git status`/`git diff` 确认当前工作区是否还有类似的未提交改动再继续，不要假设工作区一定是干净的。
