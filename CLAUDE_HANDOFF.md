# Claude Handoff: AI 图片生成器 v1.2.5

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.5`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.2.2 及更早的发布过程已经过期，不要按旧步骤操作。

## 重大发现：`webview_windows` 插件已经一年多没发布新版本，pub.dev 上是过期代码

这是本轮排查里最重要的结论，直接决定了后面好几个 bug 的修法，务必先读这段。

Windows 端用的 `webview_windows` 插件（离屏渲染 WebView2）**最新发布到 pub.dev 的版本是 0.4.0，发布于 2024-02-17**，此后再没有发布过新版本（用 `curl https://pub.dev/api/packages/webview_windows` 可以直接确认）。但插件的 GitHub 源码仓库（`jnschulze/flutter-webview-windows`）在这之后一直有人在提交修复，包括：

- **`#312` "Fix HTML `<select>` elements not opening"**（2024-10-08 合并）——这正是 v1.2.2 排查出来、后来靠"把 6 个原生 select 全部换成自绘组件"绕过去的那个 bug。上游代码里其实已经有官方修复了，只是没发布版本，所以我们当时只能用应用层workaround。
- **`#313` "Send cursor position when scrolling"**（2024-10-08 合并）+ **`#314` "Reduce scroll multiplier"**（同日合并）+ **`#302` "Fix two-finger touchpad scrolling not work"**（2024-11-07 合并）——这些是 v1.2.5 修的"设置弹窗滚轮无法滚动"问题的上游根因修复。

也就是说：**这两轮"exe 端有问题但 HTML 端正常"的诡异 bug，本质上都是同一个原因——依赖的插件版本太老，而插件作者不发新版本。** 以后如果再遇到"只有打包后的 Windows exe 才复现，浏览器端/CDP headless 测试都正常"的问题，第一时间应该去查 `jnschulze/flutter-webview-windows` 的 GitHub issues/PR 列表，很可能已经有人报过、甚至已经修过了，只是没发版。查询方法：

```
gh api "search/issues?q=repo:jnschulze/flutter-webview-windows+<关键词>+in:title,body" --jq '.items[] | "[\(.state)] #\(.number) \(.title)"'
```

**关于是否切换到 git 依赖直接拉取上游最新 commit（而不是 pub.dev 的 0.4.0）**：这是更彻底的修法，能一次性把 `#312`/`#313`/`#314`/`#302` 等修复全部拿到，pubspec.yaml 改法是：

```yaml
webview_windows:
  git:
    url: https://github.com/jnschulze/flutter-webview-windows.git
    ref: ed81bbe985c12759a44b9cca8170e19c73b961c0   # main HEAD as of 2025-06-26，含上述所有修复
```

（`.gitmodules` 是空文件，没有真正的子模块依赖，git 依赖方式可行。）**这个改动被 Claude Code 的自动权限分类器拦下来了，需要用户明确同意**（问过一次 `AskUserQuestion`，60 秒超时没回复，没有强行推进）。原因：这会让核心依赖脱离 pub.dev 官方发布渠道，改成跟着一个未打版本号的 commit，虽然是官方仓库不是野生 fork，但终究不是维护者正式测试/发布过的版本。**如果用户之后同意，应该重新执行这个 pubspec.yaml 改动**，可以把 v1.2.5 里"设置滚轮"的 JS workaround 保留作为双保险，也可以在切换依赖验证稳定后移除 workaround（但没有强烈理由必须移除，两者不冲突，可以都留着）。

## v1.2.5：设置弹窗（及其他嵌套滚动区域）鼠标滚轮无法滚动

用户带截图反馈（`v1.2.4` 版本号下）"如图设置里的滚轮依然无法滚动"。根因见上一节——`webview_windows` 0.4.0 转发滚轮事件不带光标坐标，Chromium 没法判断该滚动哪个嵌套的 `overflow:auto` 容器，事件很可能被派发到最外层 document/body，而 `openModal()` 会把 `document.body.style.overflow = "hidden"`，于是表现为"整个界面完全没反应"。

**修复**（`app.js`，不改依赖）：
- `isNativeWindowsWebview()`：判断是否运行在打包后的 Windows exe 里（`nativeDownload.available() && getRuntimePlatform() === "windows"`），后面几个"仅原生 Windows exe 才有"的插件缺陷判定都复用这个函数。
- `findScrollableAncestor(el)`：从事件目标往上找最近一个"确实有溢出内容 + `overflow-y: auto`/`scroll`"的祖先元素。
- `initManualWheelScrollFix()`：仅在 `isNativeWindowsWebview()` 为真时，给 `document` 挂一个委托的 `wheel` 监听器，事件到达时用上面两个函数找到该滚动的元素，直接改它的 `scrollTop` 并 `preventDefault()`。用委托而不是给每个滚动容器单独绑定，是因为像历史记录卡片里的滚动区域是运行时动态生成的，没法在启动时枚举完。
- **调用时机很关键**：`initManualWheelScrollFix()` 必须在 `nativeDownload`（`app.js` 里的 `const nativeDownload = (() => {...})()`，定义在文件靠后位置）初始化完之后才能调用，所以放在文件末尾 `initI18n(); registerServiceWorker(); initManualWheelScrollFix();` 这个启动序列里，不能提前调用（会因为 `const` 的暂时性死区报错）。

新增回归测试 `testManualWheelScrollFallback`：用 `Emulation.setUserAgentOverride` 模拟 Windows UA + mock `window.FlutterDownload`，验证对嵌套滚动容器派发 `WheelEvent` 后 `scrollTop` 确实移动了；另外验证纯浏览器环境下（没有 `FlutterDownload`）不会误触发这个 JS 接管（因为合成的、非 trusted 的 wheel 事件本来就不会触发浏览器原生滚动，如果我们的 fallback 也没装上，`scrollTop` 应该完全不变）。

## v1.2.4：exe 端参考图上传区域错误宣传"拖拽"支持

用户之前要求"应该不止我说存在问题，深度检测是否还有更多类似的问题"（对应 task #33），针对"依赖原生弹出层机制的 UI"做了更广的排查。查证方式：直接翻 `jnschulze/flutter-webview-windows` 的 GitHub issues，找到 **`#9` "Add drag and drop support"**（2021-05-15 提出，至今仍是 open 状态，最后一条评论 2022-03-27 还在问"所以现在还是不支持拖放吗"）——**HTML5 拖放在这个插件的离屏渲染模式下从未支持过**。

区分原理（供以后判断类似问题用）：
- **`<select>` 弹出层**（v1.2.2 的根因）是 Chromium 自己内部渲染的辅助弹出窗口，不在离屏渲染的截屏范围内，所以坏了。
- **原生文件选择对话框**（`<input type="file">` 点击触发的"打开文件"框）是 OS 级别的独立顶层窗口（Win32 `IFileOpenDialog`），完全不属于 Chromium 自己的渲染表面，所以**不会**受离屏渲染影响——这也是为什么搜遍 issue 列表都没有"文件选择对话框打不开"这类反馈的原因，机制上就不该受影响，已用 GitHub issue 搜索结果佐证过（`upload`/`offscreen` 关键词零命中）。
- **HTML5 拖放**依赖 OS 级 drop target 注册（`IDropTarget`），这个是真的需要插件显式实现转发逻辑的，`#9` 证实了这块一直没做。

**修复**：只改提示文案，不动拖放本身的事件监听（留着无害，纯浏览器/PWA 端真实拖放本来就能用）。`isDragDropUnsupported()` 复用 `isNativeWindowsWebview()`，为真时把参考图上传区域的提示语从"点击或拖拽上传参考图"换成"点击上传参考图"（5 语言都改了，新增 i18n key `uploadRefsClickOnly`）。回归测试 `testDragDropHintReflectsPlatform` 验证两种环境下文案分别正确。

## v1.2.3：漫画保存到文件夹 + 并发/依次生成开关补漏 + 重试历史记录修复

三个独立修复/功能的合并发布：

**1. 漫画分镜结果直接保存到自动创建的子文件夹**（用户明确要求"新增：直接保存为文件夹（不用ZIP）"）：`app.js` 新增 `saveComicResultsToFolder()`，用当前时间生成 `漫画_{本地时间}` 文件夹名，同一次保存的所有分镜图片共用这个文件夹；复用 `buildImagesZip()` 同款的容错取字节顺序（`blob` 缓存 → `cachePromise` → 重新拉取远程 URL）。`nativeDownload.saveFile` 签名新增第 5 个参数 `folder`。

- Windows 端 `lib/main.dart` 的 `_saveWindowsFile` 在 `images` 目录下创建/复用同名子目录。
- Android 端 `MainActivity.kt` 的 `saveFile` 用 `DocumentFile.findFile(name)?.takeIf{isDirectory} ?: tree.createDirectory(name)` 做 SAF 子目录。
- **踩过的坑**：`lib/main.dart` 里有两条独立的 `'saveFile':` 分支——Windows 专属的直接调用（约行 504）和 Android WebView 消息转发层 `_handleDownloadMessage`（约行 323，转发给 `_downloads.invokeMethod('saveFile', {...})`）。一开始只改了第一条，Android 端 `folder` 参数传不过去（Kotlin 代码编译通过、逻辑正确，但收到的永远是空字符串）。**以后改 native bridge 参数，两条分支都要搜、都要改。**

非 native（浏览器/PWA）环境下这个按钮直接隐藏（复用 `.no-native-download` body class 机制）。

**2. 并发/依次生成开关在漫画模式下完全不可见**：底层调度逻辑（`generateSingle`/`generateComic` 都读 `dom.sequentialMode.checked`，勾选顺序执行、不勾选 `concurrentLimitSettled` 最多 20 并发）早就存在，但 `<input id="sequentialMode">` 被嵌套在只有单图模式才显示的 `#nImagesField`（`class="single-only"`）里，切到漫画模式后整个字段被隐藏，用户没有任何办法在漫画模式下看到/控制这个开关。修复：把 `#sequentialToggle` 挪到两种模式共用的配置区域，没有改动任何调度逻辑本身。

**3. 重试生成的图片，旧历史记录没删**：`saveGenerationProject()`（漫画模式）只在整批生成完成后调用一次，之后重试某个分镜不会更新历史记录；`saveGenerationRecord()`（单图模式）永远 `unshift`，重试会产生重复记录。修复：新增 `currentComicHistoryId`/`card._historyRecordId` 跟踪 + `replaceSingleHistoryRecord()`/`updateComicHistoryPanel()` 两个更新函数，`retryResultCard()` 按模式分流调用。

## 版本号说明

v1.0.11 → v1.2.0 是用户明确指定的跳跃，不代表中间有跳过的版本。之后 v1.2.1 → v1.2.2 → v1.2.3 → v1.2.4 → v1.2.5 都是常规 +0.0.1 递增（v1.2.4/v1.2.5 是同一会话里连续排查出的独立 bug，各自单独发版，不是攒了多个改动一起发）。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来。

## 当前核心状态

- 应用版本：`APP_VERSION = "1.2.5"`；`pubspec.yaml` 为 `1.2.5+18`
- 前端缓存/query：`index.html` 中 `20260703-1-2-5`；Service Worker cache：`ai-image-generator-1-2-5-20260703`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,2,5,18`/`"1.2.5"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致校验过）
- v1.2.3/v1.2.4/v1.2.5 均已 commit、push、CI 四端构建通过、下载产物验证版本号+修复标记+Android 签名 SHA1、Windows 安装器额外做过本机静默安装+卸载验证、已创建对应 GitHub Release（各自附 SHA256SUMS.txt）
- `webview_windows` 依赖仍是 pub.dev 的 0.4.0（**未**切换成 git 依赖），见上面"重大发现"一节，等用户回复后再决定要不要切

## 已知未验证/延后事项

- **task #33（深度扫描其他原生弹出层依赖）大部分已有结论**：`<select>`（v1.2.2 已修）、拖放（v1.2.4 已修提示文案）、滚轮嵌套滚动（v1.2.5 已修）。还剩两个低优先级尾巴没处理：
  - `<datalist id="modelList">`（模型名输入框自动补全建议）理论上和 `<select>` 一样依赖原生弹出层，但 `#modelChoices` 自绘列表已经是可用替代方案，文本框手动输入也一直能用，优先级低，没有动它。
  - 原生文件选择对话框（`#refImage`/`#txtFileInput`/`.panel-img-input`）**已通过技术推理 + GitHub issue 搜索结果确认不受影响**（见上面 v1.2.4 一节的机制分析），不需要用户额外确认了，可以视为已解决。
- v1.2.5 的滚轮 workaround 只验证了"合成 wheel 事件能正确移动 scrollTop"（CDP 层面能做到的极限），没有真机 Windows 环境下用真实鼠标滚轮验证——理论上应该有效（机制分析 + 上游 issue 互相印证），但请用户实际用一下确认。
- 漫画 folder-save 功能（v1.2.3）同样没有真机 Windows/Android 端到端验证（子文件夹确实被创建、文件确实落地），只验证了 JS 编排层 + Dart/Kotlin 静态分析。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 不能改。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地——所有"重新打包/重新保存"逻辑都要优先用缓存字节。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗（`askConfirm`/`askPrompt`）。
- **`webview_windows` 插件卡在 pub.dev 0.4.0（2024-02）超过一年没更新，但上游 GitHub 仓库一直有人提交修复**——任何"只有打包后的 exe 才复现、HTML/浏览器端正常"的 bug，第一反应应该是去查这个插件的 GitHub issues，而不是死磕自己代码里的 CSS/JS（这条经验适用于 v1.2.2 的 select bug、v1.2.4 的拖放、v1.2.5 的滚轮，三次都是同一个模式）。
- `lib/main.dart` 里 Android 和 Windows 走两条完全独立的 native bridge 分发路径（Android 经 `_handleDownloadMessage` 转发到 `_downloads.invokeMethod`，Windows 直接在 `windows_webview` 的消息 switch 里处理），改 native bridge 参数/action 时两条都要检查、都要改。
- 这个代码库的 CSS 有反复出现的"重复声明"模式：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的。大改动后建议跑一次全文件选择器重复扫描。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`。
- 不要把任何 `<select>` 改回原生渲染，6 个已经全部是自绘 `.custom-select` 组件。
- 不要删掉 `initManualWheelScrollFix()`/`findScrollableAncestor()`，也不要把它们的触发条件从 `isNativeWindowsWebview()` 改成无条件启用（会在浏览器/PWA 端把原生已经正常的滚动行为替换成 JS 手动接管，可能丢失原生的平滑/惯性滚动手感）。
- 不要把 `#sequentialToggle` 挪回 `#nImagesField` 里面。
- 不要改 Windows 安装器的 AppId GUID；`[Run]` 不要加 `skipifsilent`；`[UninstallRun]` 的 taskkill 不要删；不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。

## 下一步建议

- 等用户回复是否同意把 `webview_windows` 切换成 git 依赖（见开头"重大发现"一节），如果同意，按那里给的 `ref` 直接改 `pubspec.yaml`。
- 找用户确认 v1.2.5 的滚轮修复和 v1.2.3 的 folder-save 功能在真机上表现是否符合预期。
- 如果条件允许，找一台真实 Android 设备和一台干净 Windows 机器做一次全功能端到端验证。
