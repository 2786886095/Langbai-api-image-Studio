# Claude Handoff: AI 图片生成器 v1.2.7

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.7`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.2.2 及更早的发布过程已经过期，不要按旧步骤操作。

## 重大发现：`webview_windows` 插件已经一年多没发布新版本，pub.dev 上是过期代码

这是这几轮排查里最重要的结论，直接决定了后面好几个 bug 的修法，务必先读这段。

Windows 端用的 `webview_windows` 插件（离屏渲染 WebView2）**最新发布到 pub.dev 的版本是 0.4.0，发布于 2024-02-17**，此后再没有发布过新版本（用 `curl https://pub.dev/api/packages/webview_windows` 可以直接确认）。但插件的 GitHub 源码仓库（`jnschulze/flutter-webview-windows`）在这之后一直有人在提交修复，包括：

- **`#312` "Fix HTML `<select>` elements not opening"**（2024-10-08 合并）——这正是 v1.2.2 排查出来、后来靠"把 6 个原生 select 全部换成自绘组件"绕过去的那个 bug。上游代码里其实已经有官方修复了，只是没发布版本，所以我们当时只能用应用层 workaround。
- **`#313` "Send cursor position when scrolling"**（2024-10-08 合并）+ **`#314` "Reduce scroll multiplier"**（同日合并）+ **`#302` "Fix two-finger touchpad scrolling not work"**（2024-11-07 合并）——这些是 v1.2.5/v1.2.6 修的"设置弹窗滚轮无法滚动"问题的上游根因修复。

也就是说：**这三轮"exe 端有问题但 HTML 端正常"的诡异 bug，本质上都是同一个原因——依赖的插件版本太老，而插件作者不发新版本。** 以后如果再遇到"只有打包后的 Windows exe 才复现，浏览器端/CDP headless 测试都正常"的问题，第一时间应该去查 `jnschulze/flutter-webview-windows` 的 GitHub issues/PR 列表，很可能已经有人报过、甚至已经修过了，只是没发版。查询方法：

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

（`.gitmodules` 是空文件，没有真正的子模块依赖，git 依赖方式可行。）**这个改动被 Claude Code 的自动权限分类器拦下来了，需要用户明确同意**（问过一次 `AskUserQuestion`，60 秒超时没回复，没有强行推进）。原因：这会让核心依赖脱离 pub.dev 官方发布渠道，改成跟着一个未打版本号的 commit，虽然是官方仓库不是野生 fork，但终究不是维护者正式测试/发布过的版本。**如果用户之后同意，应该重新执行这个 pubspec.yaml 改动**，可以把现有的"设置滚轮" JS workaround 保留作为双保险，也可以在切换依赖验证稳定后移除 workaround（但没有强烈理由必须移除，两者不冲突，可以都留着）。

## v1.2.7：`event.target` 本身报错——鼠标在模型列表上，滚轮却滚了主界面

用户反馈"把鼠标定位到选择模型，带动的却是全局的滚轮"。这是 v1.2.5/v1.2.6 那类 bug 的**第三种表现形式**，根因还是同一个插件缺陷（上游 `#313`），但具体机制不一样，值得记录清楚：

前两版修复（`findScrollableAncestor`/`resolveManualWheelScrollTarget`）都是拿 `event.target` 往上走 DOM 树找可滚祖先。这个思路有个隐藏假设：`event.target` 准确反映了鼠标实际悬停的元素。**这个假设在 `webview_windows` 转发滚轮事件时不成立**——实测（构造一个刻意把 `event.target` 设为 `.input-panel`、但 `clientX`/`clientY` 坐标落在 `#modelChoices` 模型列表上的滚轮事件）证实：如果只信任 `event.target`，往上找的时候会直接跳过光标真正悬停的嵌套区域（`#modelChoices` 从来都不在 `.input-panel` 的祖先链上，是兄弟/表亲关系），找到的是外层更大的可滚容器。

**修复**（`app.js`）：新增 `resolveWheelEventStartElement(event)`，优先用 `document.elementFromPoint(event.clientX, event.clientY)` 基于坐标重新做一次独立的命中测试（这个坐标是 WebView2 用来定位滚动注入点的必需参数，比 `event.target` 更基础、更不容易出错），只有坐标不可用时才退回 `event.target`。`installGlobalWheelScrollBridge()` 和 `resolveManualWheelScrollTarget()` 两处都改成先过一遍这个函数，不再直接用 `event.target`。

**这次验证方法值得记下来复用**：CDP 没法直接复现"真实环境下 `event.target` 报错"这件事本身（合成事件的 `target` 永远是你指定的、正确的那个），但可以反过来**构造一个人为错误的 target**（`element.dispatchEvent()` 在一个错误的元素上，但把 `clientX`/`clientY` 设成正确坐标）来验证"就算 target 错了，代码能不能靠坐标纠正回来"——用 `git stash` 只挡住 `app.js` 的改动、跑一遍新测试确认真的会失败（复现了滚主界面而不是滚列表），再 `git stash pop` 恢复，跑一遍确认变绿，这样能确定这个回归测试真的在测这个 bug，不是巧合过了。

## v1.2.6：设置弹窗打开时滚轮误滚了主界面（v1.2.5 workaround 的补强）

v1.2.5 发布后用户带截图继续反馈"设置里的滚轮依然无法滚动"——更准确地说是**滚轮把主界面（`.input-panel`）滚动了，弹窗本身没动**。根因：这个项目里除了 v1.2.5 新增的 `initManualWheelScrollFix()`（弹窗内嵌套滚动 workaround），还有一个更早就存在的 `installGlobalWheelScrollBridge()`（专门给 `.input-panel` 主输入面板做滚轮转发，因为它本身也是离屏渲染下会被同一个插件缺陷影响的滚动容器）。这两个监听器互相不知道对方的存在：`webview_windows` 把滚轮事件误派给 `.input-panel`/`body`/`document` 而不是弹窗内部元素时，`initManualWheelScrollFix()` 在自己的目标元素下找不到可滚容器就放弃了，`installGlobalWheelScrollBridge()` 一看"这个事件目标底下没有能滚的东西"就顺手把主输入面板滚了——刚好复现用户说的"设置弹窗不动，主界面在动"。

**修复**（`app.js`，仍然不改依赖）：
- 抽出公共小函数 `canScrollVertically(el)`、`scrollElementByWheelDelta(el, deltaY)`、`getWheelDeltaY(event, target)`（归一化 `DOM_DELTA_PIXEL`/`DOM_DELTA_LINE`/`DOM_DELTA_PAGE` 三种滚轮单位，避免触控板/某些鼠标滚出来的 delta 不是像素导致滚得过慢或过快）。
- 新增覆盖层感知：`isOverlayVisible(overlay)`、`getVisibleBlockingOverlays()`（枚举设置弹窗、历史弹窗、`.ask-dialog-overlay`、`.lightbox`）、`getTopVisibleOverlay()`（按 z-index/DOM 顺序取最上层那个）、`getOverlayPrimaryScroller(overlay)`（该覆盖层里该滚的元素——优先 `.modal-card`，找不到就在整个覆盖层子树里找第一个真的能滚的）。
- `updateBodyScrollLock()`：统一根据"当前是否有可见覆盖层"决定 `document.body.style.overflow` 是否锁死，`openModal`/`closeModal`/`openAskDialog`/`openLightbox` 全部改成调用它，不再各自手写 `document.body.style.overflow = "hidden"/""`。
- `resolveManualWheelScrollTarget(event)`：如果当前有可见覆盖层，优先滚那个覆盖层自己的可滚容器（`getOverlayPrimaryScroller`），只有事件目标确实落在覆盖层内部的其他滚动容器时才改滚那个更具体的容器；没有覆盖层时退回普通的"从事件目标往上找可滚祖先"。
- `initManualWheelScrollFix()` 改成 **capture 阶段**监听（`{ passive: false, capture: true }`），确保先于 `installGlobalWheelScrollBridge()`（bubble 阶段）拿到事件；找到目标就滚+`preventDefault`+`stopPropagation`；即使没找到具体目标，只要当前有覆盖层打开（比如 ask-dialog/lightbox 这种内容本身不需要滚动的覆盖层），也会拦截事件并阻止冒泡，防止事件穿透到 `installGlobalWheelScrollBridge()` 手里去滚主界面。
- `installGlobalWheelScrollBridge()` 本身也加了一行 `if (getTopVisibleOverlay()) return;`——只要有覆盖层打开就完全不碰主界面滚动，双重保险。
- `style.css`：`.modal`、`.modal-card` 加 `overscroll-behavior: contain`，作为浏览器侧的 scroll chaining 兜底防护（跟 JS 修复不冲突，纯浏览器/PWA 端也受益）。

**回归测试**（`testManualWheelScrollFallback` 大幅扩展）：覆盖层打开时，wheel 目标是 `.input-panel` 也必须滚 `.modal-card` 且 `.input-panel.scrollTop` 保持 0；wheel 目标是 `body` 同理；`deltaMode = DOM_DELTA_LINE` 的滚轮也能正确滚动弹窗；`ask-dialog`/`lightbox` 这类本身不需要滚动的覆盖层打开时，会锁 body 滚动、并阻止误派发的 wheel 事件滚到主界面。

## v1.2.5：设置弹窗（及其他嵌套滚动区域）鼠标滚轮无法滚动（第一版）

用户带截图反馈（`v1.2.4` 版本号下）"如图设置里的滚轮依然无法滚动"。根因见上一节——`webview_windows` 0.4.0 转发滚轮事件不带光标坐标，Chromium 没法判断该滚动哪个嵌套的 `overflow:auto` 容器，事件很可能被派发到最外层 document/body，而弹窗打开时 body 会被锁 `overflow:hidden`，于是表现为"整个界面完全没反应"。

第一版修复思路（`isNativeWindowsWebview()` 判断原生 Windows exe + `findScrollableAncestor(el)` 从事件目标往上找可滚祖先 + `initManualWheelScrollFix()` 挂 `document` 级委托 `wheel` 监听器）在"事件目标就在弹窗内部"这个理想路径下是对的，但没考虑"事件目标被派发到弹窗外部元素"的情况——这正是 v1.2.6 补强的部分，见上一节。**调用时机提醒仍然有效**：`initManualWheelScrollFix()` 必须在 `nativeDownload` 初始化完之后才能调用（文件末尾 `initI18n(); registerServiceWorker(); initManualWheelScrollFix();` 这个启动序列里，不能提前调用，会因为 `const` 的暂时性死区报错）。

## v1.2.4：exe 端参考图上传区域错误宣传"拖拽"支持

用户之前要求"应该不止我说存在问题，深度检测是否还有更多类似的问题"，针对"依赖原生弹出层机制的 UI"做了更广的排查。查证方式：直接翻 `jnschulze/flutter-webview-windows` 的 GitHub issues，找到 **`#9` "Add drag and drop support"**（2021-05-15 提出，至今仍是 open 状态，最后一条评论 2022-03-27 还在问"所以现在还是不支持拖放吗"）——**HTML5 拖放在这个插件的离屏渲染模式下从未支持过**。

区分原理（供以后判断类似问题用）：
- **`<select>` 弹出层**（v1.2.2 的根因）是 Chromium 自己内部渲染的辅助弹出窗口，不在离屏渲染的截屏范围内，所以坏了。
- **原生文件选择对话框**（`<input type="file">` 点击触发的"打开文件"框）是 OS 级别的独立顶层窗口（Win32 `IFileOpenDialog`），完全不属于 Chromium 自己的渲染表面，所以**不会**受离屏渲染影响——已用 GitHub issue 搜索结果佐证过（`upload`/`offscreen` 关键词零命中）。
- **HTML5 拖放**依赖 OS 级 drop target 注册（`IDropTarget`），这个是真的需要插件显式实现转发逻辑的，`#9` 证实了这块一直没做。

**修复**：只改提示文案，不动拖放本身的事件监听（留着无害，纯浏览器/PWA 端真实拖放本来就能用）。`isDragDropUnsupported()` 复用 `isNativeWindowsWebview()`，为真时把参考图上传区域的提示语从"点击或拖拽上传参考图"换成"点击上传参考图"（5 语言都改了，新增 i18n key `uploadRefsClickOnly`）。回归测试 `testDragDropHintReflectsPlatform` 验证两种环境下文案分别正确。

## v1.2.3：漫画保存到文件夹 + 并发/依次生成开关补漏 + 重试历史记录修复

三个独立修复/功能的合并发布：

**1. 漫画分镜结果直接保存到自动创建的子文件夹**（用户明确要求"新增：直接保存为文件夹（不用ZIP）"）：`app.js` 新增 `saveComicResultsToFolder()`，用当前时间生成 `漫画_{本地时间}` 文件夹名，同一次保存的所有分镜图片共用这个文件夹；复用 `buildImagesZip()` 同款的容错取字节顺序（`blob` 缓存 → `cachePromise` → 重新拉取远程 URL）。`nativeDownload.saveFile` 签名新增第 5 个参数 `folder`。

- Windows 端 `lib/main.dart` 的 `_saveWindowsFile` 在 `images` 目录下创建/复用同名子目录。
- Android 端 `MainActivity.kt` 的 `saveFile` 用 `DocumentFile.findFile(name)?.takeIf{isDirectory} ?: tree.createDirectory(name)` 做 SAF 子目录。
- **踩过的坑**：`lib/main.dart` 里有两条独立的 `'saveFile':` 分支——Windows 专属的直接调用（约行 504）和 Android WebView 消息转发层 `_handleDownloadMessage`（约行 323，转发给 `_downloads.invokeMethod('saveFile', {...})`）。一开始只改了第一条，Android 端 `folder` 参数传不过去。**以后改 native bridge 参数，两条分支都要搜、都要改。**

非 native（浏览器/PWA）环境下这个按钮直接隐藏（复用 `.no-native-download` body class 机制）。

**2. 并发/依次生成开关在漫画模式下完全不可见**：底层调度逻辑（`generateSingle`/`generateComic` 都读 `dom.sequentialMode.checked`）早就存在，但 `<input id="sequentialMode">` 被嵌套在只有单图模式才显示的 `#nImagesField` 里，切到漫画模式后整个字段被隐藏。修复：把 `#sequentialToggle` 挪到两种模式共用的配置区域。

**3. 重试生成的图片，旧历史记录没删**：新增 `currentComicHistoryId`/`card._historyRecordId` 跟踪 + `replaceSingleHistoryRecord()`/`updateComicHistoryPanel()` 两个更新函数，`retryResultCard()` 按模式分流调用。

## 版本号说明

v1.0.11 → v1.2.0 是用户明确指定的跳跃，不代表中间有跳过的版本。之后 v1.2.1 → v1.2.7 都是常规 +0.0.1 递增（v1.2.4~v1.2.7 是同一会话里连续排查出的独立问题各自单独发版，不是攒了多个改动一起发；v1.2.5/v1.2.6/v1.2.7 是同一个滚轮 bug 三次不同角度的补强，每次都是用户复测后发现还有遗漏场景）。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来。

## 当前核心状态

- 应用版本：`APP_VERSION = "1.2.7"`；`pubspec.yaml` 为 `1.2.7+20`
- 前端缓存/query：`index.html` 中 `20260703-1-2-7`；Service Worker cache：`ai-image-generator-1-2-7-20260703`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,2,7,20`/`"1.2.7"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致校验过）
- v1.2.3~v1.2.7 均已 commit、push、CI 四端构建通过、下载产物验证版本号+修复标记+Android 签名 SHA1、Windows 安装器额外做过本机静默安装验证（卸载清理这一步用户明确说不用每次都做，见下方"关键事实"）、已创建对应 GitHub Release（各自附 SHA256SUMS.txt）
- `webview_windows` 依赖仍是 pub.dev 的 0.4.0（**未**切换成 git 依赖），见上面"重大发现"一节，等用户回复后再决定要不要切

## 已知未验证/延后事项

- **"深度扫描其他原生弹出层依赖"排查已基本完结**：`<select>`（v1.2.2 已修）、拖放（v1.2.4 已修提示文案）、滚轮嵌套滚动（v1.2.5/v1.2.6/v1.2.7 三轮修复，覆盖弹窗内目标、误派发到主界面/body、非弹窗嵌套区域如模型列表、event.target 本身报错这几种场景）。还剩两个低优先级尾巴没处理：
  - `<datalist id="modelList">`（模型名输入框自动补全建议）理论上和 `<select>` 一样依赖原生弹出层，但 `#modelChoices` 自绘列表已经是可用替代方案，优先级低，没有动它。
  - 原生文件选择对话框已通过技术推理 + GitHub issue 搜索结果确认不受影响，视为已解决。
- v1.2.7 的 `elementFromPoint` 坐标纠正修复已用"故意构造错误 target、正确坐标"的方式验证过回归测试真的在测这个 bug（`git stash` 挡住修复重跑确认会失败、恢复后确认变绿），但**仍然没有真机 Windows exe 用真实鼠标滚轮做端到端验证**（CDP 能验证的是"代码逻辑对不对"，验证不到真实 `webview_windows` 插件在各种硬件/滚轮设备上具体会把 `event.target`/坐标报成什么样）。如果用户继续反馈类似问题，先确认安装的是不是 v1.2.7 或更新版本。
- 漫画 folder-save 功能（v1.2.3）同样没有真机 Windows/Android 端到端验证（子文件夹确实被创建、文件确实落地），只验证了 JS 编排层 + Dart/Kotlin 静态分析。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 不能改。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地——所有"重新打包/重新保存"逻辑都要优先用缓存字节。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗（`askConfirm`/`askPrompt`）。
- **`webview_windows` 插件卡在 pub.dev 0.4.0（2024-02）超过一年没更新，但上游 GitHub 仓库一直有人提交修复**——任何"只有打包后的 exe 才复现、HTML/浏览器端正常"的 bug，第一反应应该是去查这个插件的 GitHub issues，而不是死磕自己代码里的 CSS/JS。
- **页面里所有"可见覆盖层"（设置弹窗、历史弹窗、ask-dialog、lightbox）现在统一由 `getVisibleBlockingOverlays()`/`getTopVisibleOverlay()`/`updateBodyScrollLock()` 管理**：新增任何新的模态/覆盖层组件时，如果它也需要"打开时锁 body 滚动 + 参与滚轮误派发防护"，应该接入这套机制，而不是各自重新手写 `document.body.style.overflow`。
- **不要相信滚轮事件的 `event.target`**：`webview_windows` 转发滚轮事件时 `event.target` 可能跟光标实际视觉位置对不上（上游 `#313`）。任何要"从滚轮事件找该滚动哪个元素"的新代码，都应该先过一遍 `resolveWheelEventStartElement(event)`（用 `elementFromPoint(clientX, clientY)` 坐标纠正），不要直接拿 `event.target` 做 DOM 树祖先查找。
- `lib/main.dart` 里 Android 和 Windows 走两条完全独立的 native bridge 分发路径（Android 经 `_handleDownloadMessage` 转发到 `_downloads.invokeMethod`，Windows 直接在 `windows_webview` 的消息 switch 里处理），改 native bridge 参数/action 时两条都要检查、都要改。
- 这个代码库的 CSS 有反复出现的"重复声明"模式：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的。大改动后建议跑一次全文件选择器重复扫描。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`。
- 不要把任何 `<select>` 改回原生渲染，6 个已经全部是自绘 `.custom-select` 组件。
- 不要删掉 `initManualWheelScrollFix()`/`installGlobalWheelScrollBridge()`/`updateBodyScrollLock()`/`resolveWheelEventStartElement()` 这套滚轮+覆盖层管理机制，也不要把它们的触发条件从 `isNativeWindowsWebview()` 改成无条件启用（会在浏览器/PWA 端把原生已经正常的滚动行为替换成 JS 手动接管，可能丢失原生的平滑/惯性滚动手感）。
- 不要把 `#sequentialToggle` 挪回 `#nImagesField` 里面。
- 不要改 Windows 安装器的 AppId GUID；`[Run]` 不要加 `skipifsilent`；`[UninstallRun]` 的 taskkill 不要删；不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。

## 下一步建议

- 等用户回复是否同意把 `webview_windows` 切换成 git 依赖（见开头"重大发现"一节），如果同意，按那里给的 `ref` 直接改 `pubspec.yaml`。
- 找用户确认 v1.2.7 的滚轮修复和 v1.2.3 的 folder-save 功能在真机上表现是否符合预期。
- 如果条件允许，找一台真实 Android 设备和一台干净 Windows 机器做一次全功能端到端验证。
