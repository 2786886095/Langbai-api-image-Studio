# Claude Handoff: AI 图片生成器 v1.3.1

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.3.1`

**没有 v1.2.8 的 Release**：v1.2.8（模型列表改成下拉框）commit 已推送、CI 也过了，但发布验证过程中用户就已经发现了 flex-shrink bug（见下方 v1.2.8/v1.2.9 一节），所以没有创建 v1.2.8 的 GitHub Release，直接把修复并入 v1.2.9 一起发布。如果看到 git log 里有 v1.2.8 的 commit 但 GitHub Releases 里没有对应 tag，这是预期状态，不是遗漏。

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.2.2 及更早的发布过程已经过期，不要按旧步骤操作。

## 重大发现：`webview_windows` 插件卡在 pub.dev 0.4.0 超过一年，v1.3.0 已切换成 git 依赖

这是本轮排查里最重要的结论，直接决定了好几轮 bug 的修法和最终的架构决策，务必先读这段。

Windows 端用的 `webview_windows` 插件（离屏渲染 WebView2）**最新发布到 pub.dev 的版本是 0.4.0，发布于 2024-02-17**，此后再没有发布过新版本。但插件的 GitHub 源码仓库（`jnschulze/flutter-webview-windows`）在这之后一直有人在提交修复，包括：

- **`#312` "Fix HTML `<select>` elements not opening"**（2024-10-08 合并）——v1.2.2 排查出来、当时靠"把 6 个原生 select 全部换成自绘组件"绕过去的那个 bug。
- **`#313` "Send cursor position when scrolling"** + **`#314` "Reduce scroll multiplier"**（2024-10-08 合并）+ **`#302` "Fix two-finger touchpad scrolling not work"**（2024-11-07 合并）——v1.2.5/v1.2.6/v1.2.7 反复修的"滚轮误滚"问题的上游根因修复。

**v1.3.0 起，`pubspec.yaml` 的 `webview_windows` 依赖已经从 pub.dev 的 `^0.4.0` 改成指向上游仓库的 git commit**（用户在连续 6 轮 JS 层面补丁仍然没能彻底根治滚轮问题后，明确同意切换）：

```yaml
webview_windows:
  git:
    url: https://github.com/jnschulze/flutter-webview-windows.git
    ref: ed81bbe985c12759a44b9cca8170e19c73b961c0   # main HEAD as of 2025-06-26
```

`flutter pub get`/`flutter analyze`/`flutter test` 全部验证过没问题，GitHub Actions 四端构建（尤其是 Windows，这是唯一真正用到这个插件的平台）也验证过能正常编译。**现有的 JS 层面 workaround（自绘下拉框、滚轮坐标纠正/mousemove 追踪等）全部保留，不要因为切换了依赖就删掉**——没有强烈理由必须移除，两者不冲突，多一层保险没有坏处。

**以后如果再遇到"只有打包后的 Windows exe 才复现，浏览器端/CDP headless 测试都正常"的问题**，第一时间查 `jnschulze/flutter-webview-windows` 的 GitHub issues/PR 列表：

```
gh api "search/issues?q=repo:jnschulze/flutter-webview-windows+<关键词>+in:title,body" --jq '.items[] | "[\(.state)] #\(.number) \(.title)"'
```

**但不要假设查到的每个问题都有救**——`#304`"输入法候选框位置跟不上输入框"就是反例，2024-07-24 提出至今 open，**连我们现在切换到的这个 commit 里都没有修复**。这类问题和 select/滚轮不一样：select/滚轮是"插件转发的数据不对，我们能在自己的 JS 里读原始数据、自己纠正"；IME 候选框具体渲染在屏幕哪个位置，是 Windows 输入法框架和 WebView2 引擎之间的事，网页 JS 完全够不着，没有 workaround 空间。遇到这类问题如实告诉用户"这是已知的插件架构限制，没有已知修法"，不要为了看起来"解决了"去发明一个根本不起作用的假修复。

已经系统性地对照 `jnschulze/flutter-webview-windows` 全部 100+ 条 open issue 排查过一遍本项目实际会用到的场景（详见下方"v1.3.0 之后的深度扫描结论"一节），确认没有其他遗漏的高优先级问题。

## v1.3.1：`chooseDir` 超时太短 + 提示文案误写成"Android"

用户反馈"有时显示失败原因 Android 保存通道超时"，追问后确认**这条提示在电脑端（Windows）也出现过**——这才是关键线索。`nativeDownload` 内部的 `request()` 超时逻辑是 Windows 和 Android 共用的同一份 JS 代码（两个平台都通过同一个 `FlutterDownload.postMessage` 桥接），但超时报错文案硬编码写死了"Android"，导致 Windows 用户看到会一头雾水。

真正的根因：`chooseDir(kind)`（选择保存文件夹）用的是所有原生调用共用的默认超时（120 秒），但选文件夹这件事完全由用户自己把控节奏——不管是 Android 系统目录选择器还是 Windows 的 `file_selector.getDirectoryPath` 对话框，用户切出去看看别的、犹豫一下，都可能超过 2 分钟，然后就被 JS 侧的 `setTimeout` 判定为"超时"直接 reject，即使原生那边操作其实还没做完/用户还没选完。代码里已经有先例：`downloadUpdate`（下载更新包，同样是耗时不确定的操作）用的是 15 分钟超时，`chooseDir` 之前没有比照处理。

**修复**（`app.js` 的 `nativeDownload` IIFE 内）：
- `chooseDir(kind) { return request("chooseDir", { kind }, 15 * 60 * 1000); }`——超时从默认 120 秒提到 15 分钟，和 `downloadUpdate` 一致。
- `request()` 内部超时的 reject 消息从写死的 `"Android 保存通道超时"` 改成 `` `原生功能调用超时（${action}），请重试` ``——不再点名平台，且带上具体是哪个 action 超时，以后再有类似报告能直接定位。

**没有加专门的回归测试**：这个改动是纯粹的超时数值调整+错误文案调整，逻辑本身没有分支/条件需要覆盖，`node qa\regression-runner.js` 全绿（确认没有破坏其他东西）+ 代码走查即可，没有为了"看起来严谨"而画蛇添足加测试。

## v1.3.0 之后的深度扫描结论

用户要求"彻底扫描程序，不要再出现类似的问题"。逐条对照 `jnschulze/flutter-webview-windows` 的全部 open issue（截至排查时 100+ 条）与本项目实际功能用到的浏览器特性，结论：

- **`#317`"粘贴内容导致 WebView 卡死"**——只发生在 `contenteditable="true"` 的富文本编辑区域。本项目所有输入框都是普通 `<input>`/`<textarea>`，全局搜索确认没有任何 `contenteditable` 元素，**不受影响，已排除**。
- **`#238`/`#220`"网页内容渲染模糊"**——上游 issue 讨论串里指向"电脑显示缩放比例不是 100%"可能是诱因，但没有定论、没有已知修法。如果用户在高 DPI 缩放显示器上反馈画面发糊，这可能是原因，但目前没有可行的应用层修复手段，如实告知即可。
- **`#304`"IME 候选框位置跟不上输入框"**——见上一节，确认无解。
- 视频/音频播放、全屏 API、打印、`<input type="color"/"date"/"time">` 等特殊原生控件、右键菜单自定义——全局搜索确认本项目均未使用，对应的已知插件问题不适用。
- 剪贴板复制（本项目"复制链接"等功能用到）——没有查到相关 open issue，判断不受影响。
- `<datalist id="modelList">`（模型名输入框自动补全建议）——原生弹出层机制理论上和 `<select>` 类似，可能有同样的离屏渲染问题，但没有查到专门的上游 issue 佐证。`#modelChoices` 自绘下拉框已经是可用替代方案，文本框手动输入也一直能用，维持原有的低优先级判断，没有再动它。

## v1.2.10：滚轮误滚问题的第五、六轮补强

v1.2.7 的 `elementFromPoint(event.clientX, event.clientY)` 坐标纠正只解决了"`event.target` 错、但坐标对"的情况。用户反馈模型下拉框滚轮依然不好使后，确认插件转发滚轮事件时**坐标本身也可能不可靠**（不只是 target），单纯信任同一个 wheel 事件自带的任何字段都靠不住。加了两层独立防护（`app.js`）：

1. **`getVisibleBlockingOverlays()` 现在把打开的 `.custom-select-list` 下拉列表也算作"阻塞型覆盖层"**。就算滚轮事件的目标和坐标解析都错了，`resolveManualWheelScrollTarget()` 已有的逻辑会发现"解析出来的滚动目标不在当前打开的覆盖层里"，转而 fallback 到覆盖层自己的 `getOverlayPrimaryScroller()`——这一层单独就足以修好"下拉框打开时滚轮失效"的场景，且完全不依赖滚轮事件本身的任何数据，只看"现在有没有下拉框正开着"这个纯 DOM 状态。
2. **新增独立于滚轮事件的 `mousemove` 捕获阶段监听器**，持续记录 `_lastKnownPointerX/Y`，在 `resolveWheelEventStartElement()` 里作为比滚轮事件自带坐标更优先的定位来源（鼠标移动是比滚轮转发更基础的事件，不太可能共享同一个插件缺陷）。

两层任意一层单独生效就能修好已知场景，一起加上是为了在插件转发数据更不可靠时也有兜底。**验证方法**：新增的回归测试故意构造"滚轮事件目标和坐标都指向主面板，但光标之前真实移动到过下拉框上"的场景，用 `git stash` 隔离验证过——不加这两个修复时测试真的会失败（下拉框不动、主面板反而滚动），加上后通过。

## v1.2.8/v1.2.9：模型选择改成下拉框 + 一个不是 webview_windows 的锅、自己代码的真 bug

用户反馈"模型选择列表也跟别的列表做的一样啊，现在做的太难用了"——`#modelChoices`（检测到的模型列表）从 v1.2.2 起一直是常驻展开的按钮网格，跟其他 6 个已经改成下拉框的字段风格不一致，也是滚轮误滚问题的常见触发点。**v1.2.8** 把它改成和其他 6 个一样的 `.custom-select` 组件：隐藏原生 `<select id="modelChoices">` 做状态容器，选中后通过 `change` 监听把值同步到 `#model` 文本框。

**v1.2.8 commit 推送后、还没创建 Release 之前**，用户带截图反馈"模型列表都重叠到一起了，根本看不清"。第一反应怀疑又是 webview_windows 的锅，但这次先用 CDP 在 headless Edge 里拿真实的 13 个模型直接复现出了一模一样的重叠——**证明是自己代码的真 bug**：`.custom-select-list` 是 `display:flex; flex-direction:column; max-height:240px; overflow-y:auto`，子项 `.custom-select-option` 没设 `flex-shrink:0`，内容超出 `max-height` 时 flexbox 会把所有子项压缩到塞进容器里（而不是让容器滚动），压缩后每项的高度比自己的 `padding` 还小，文字必然溢出糊到相邻行上。**v1.2.9** 加了一行 `flex-shrink: 0` 修复，所有下拉框共享同一个 CSS 类，这个修复对全部 6+1 个下拉框都生效。

**这个教训的通用价值**：遇到"打包后才复现"的问题，不要因为最近几次都是同一个插件的锅就路径依赖，每次都先花两分钟在普通浏览器里用真实数据量复现一次再下结论。

## v1.2.3~v1.2.7：早期滚轮/漫画功能相关改动

- **v1.2.3**：漫画分镜结果新增"保存到文件夹"（`saveComicResultsToFolder()`，`nativeDownload.saveFile` 新增 `folder` 参数）；并发/依次生成开关从单图模式专属字段挪到两模式共用区域；重试生成的图片后历史记录原地更新不再留旧图。**踩过的坑**：`lib/main.dart` 里 Windows 和 Android 走两条独立的 native bridge 分发路径，改参数时曾经只改了一条，导致 Android 端一直收到空的 `folder` 值。
- **v1.2.4**：确认 exe 端拖放上传参考图从未真正工作过（上游 `#9`，2021 年至今 open），改成只在原生 Windows exe 里把提示文案从"点击或拖拽"改成"点击上传"。
- **v1.2.5~v1.2.7**：滚轮误滚问题的前三轮修复，从"弹窗内滚轮不生效"到"滚轮误滚了主界面/body"到"`event.target` 本身报错导致滚错元素"，逐步定位到根因就是 webview_windows 转发滚轮事件不带准确的光标信息。

## 关键改动文件一览（app.js 里最重要的几组函数）

- **滚轮 + 覆盖层管理**：`canScrollVertically()`、`scrollElementByWheelDelta()`、`getWheelDeltaY()`、`resolveWheelEventStartElement()`（含 mousemove 追踪）、`isOverlayVisible()`、`getVisibleBlockingOverlays()`（含打开的下拉框）、`getTopVisibleOverlay()`、`getOverlayPrimaryScroller()`、`updateBodyScrollLock()`、`findScrollableAncestor()`/`getScrollableAncestor()`、`resolveManualWheelScrollTarget()`、`initManualWheelScrollFix()`（capture 阶段）、`installGlobalWheelScrollBridge()`（bubble 阶段）。这套机制必须在文件末尾 `nativeDownload` 初始化完之后才能启用某些判定（`isNativeWindowsWebview()` 依赖 `nativeDownload.available()`）。
- **自绘下拉框**：`initCustomSelect(selectEl)` + `_customSelectRegistry`，7 个字段共用（`apiProvider`/`savedApis`/`nImages`/`savedSizes`/`autoFillTemplate`/`desktopProxyMode`/`modelChoices`）。
- **原生下载桥接**：`nativeDownload` IIFE，`request(action, payload, timeoutMs=120000)` 是所有原生调用的公共超时/重试骨架，`chooseDir`/`downloadUpdate` 各自覆盖了更长的超时。
- **历史记录**：`currentComicHistoryId`/`card._historyRecordId` 跟踪 + `replaceSingleHistoryRecord()`/`updateComicHistoryPanel()`。

## 版本号说明

v1.0.11 → v1.2.0 是用户明确指定的跳跃。之后到 v1.2.10 都是常规 +0.0.1 递增（v1.2.4~v1.2.10 是同一会话里连续排查出的独立问题各自单独发版）。**v1.3.0 是用户明确要求的版本号**（"之后发布1.3.0"），对应 webview_windows 依赖切换这个架构级改动，不是常规 +0.0.1（如果按常规应该是 v1.2.11）。v1.3.1 之后恢复常规 +0.0.1 递增。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来。

## 当前核心状态

- 应用版本：`APP_VERSION = "1.3.1"`；`pubspec.yaml` 为 `1.3.1+25`
- 前端缓存/query：`index.html` 中 `20260703-1-3-1`；Service Worker cache：`ai-image-generator-1-3-1-20260703`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,3,1,25`/`"1.3.1"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致校验过）
- v1.2.3~v1.2.7、v1.2.9、v1.2.10、v1.3.0、v1.3.1 均已创建 GitHub Release；v1.2.8 只有 commit+CI 通过，没有 Release
- `webview_windows` 依赖已切换成 git 依赖（见上面"重大发现"一节），不再是 pub.dev 的 0.4.0

## 已知未验证/延后事项

- v1.3.0 依赖切换后的 CI 构建已验证四端成功，但**没有真机 Windows exe 端到端验证**依赖切换本身是否解决了 IME 之外的其他潜在问题（比如是否真的不再需要 JS workaround，但目前没有移除 workaround 的计划，所以这不是阻塞项）。
- v1.2.10 的滚轮修复（overlay 扩展 + mousemove 追踪）已用"故意构造 target 和坐标都错、但真实 mousemove 位置对"的场景验证过，包括用 git stash 确认回归测试真的会失败/通过，但**仍然没有真机 Windows exe 用真实鼠标滚轮做端到端验证**。
- IME 候选框位置问题（上游 `#304`）**确认无解**，如果用户继续反馈，只需要确认"最终输入的文字是否正确进入了输入框"（如果连这个都不对，是完全不同性质的问题，需要重新排查）。
- v1.3.1 的 `chooseDir` 超时修复没有真机验证"用户真的在选择文件夹时超过 2 分钟"的场景，只是逻辑合理性上的修复。
- 漫画 folder-save 功能（v1.2.3）没有真机 Windows/Android 端到端验证。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 不能改。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗（`askConfirm`/`askPrompt`）。
- **`webview_windows` 依赖已经是 git commit（见"重大发现"），不再是 pub.dev 0.4.0**——但依然要警惕这个插件的架构性限制（离屏渲染下 IME/某些原生 UI 元素位置报告不准确），不是所有问题切换依赖就能解决。
- **不要相信滚轮事件的 `event.target` 或 `clientX`/`clientY`**：两者都可能被插件转发错。任何"从滚轮事件找该滚动哪个元素"的新代码都应该走 `resolveWheelEventStartElement(event)`（mousemove 追踪优先，wheel 坐标其次，`event.target` 最后兜底），不要直接信任其中任何一个字段。
- **`display:flex; flex-direction:column` 容器配 `max-height`+`overflow-y:auto` 时，子项必须显式设置 `flex-shrink:0`**，否则内容超出高度限制时会被压缩变形而不是让容器滚动。
- **`nativeDownload` 的 `request()` 超时对于"用户节奏主导"的操作（选文件夹、下载大文件）需要给足够长的超时**（15 分钟起），不要用默认的 120 秒；错误消息也不应该硬编码平台名，这个函数在 Windows/Android 上是同一份代码。
- `lib/main.dart` 里 Android 和 Windows 走两条完全独立的 native bridge 分发路径，改 native bridge 参数/action 时两条都要检查、都要改。
- 这个代码库的 CSS 有反复出现的"重复声明"模式：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的。大改动后建议跑一次全文件选择器重复扫描。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`。
- 不要把任何 `<select>` 改回原生渲染，7 个（含模型列表）已经全部是自绘 `.custom-select` 组件。
- 不要删掉滚轮+覆盖层管理这套机制（`initManualWheelScrollFix`/`installGlobalWheelScrollBridge`/`updateBodyScrollLock`/`resolveWheelEventStartElement`/mousemove 追踪），也不要把触发条件从 `isNativeWindowsWebview()` 改成无条件启用。
- 不要把 `webview_windows` 依赖改回 pub.dev 的 `^0.4.0`。
- 不要把 `#sequentialToggle` 挪回 `#nImagesField` 里面；不要把 `#modelChoices` 改回常驻展开的按钮网格；不要删掉 `.custom-select-option` 的 `flex-shrink: 0`。
- 不要把 `chooseDir` 的超时改回默认的 120 秒。
- 不要改 Windows 安装器的 AppId GUID；`[Run]` 不要加 `skipifsilent`；`[UninstallRun]` 的 taskkill 不要删；不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。

## 下一步建议

- 找用户确认 IME 候选框位置问题（无解，已如实告知）是否影响实际打字体验（文字最终是否正确进入输入框）。
- 找用户确认 v1.3.1 的 chooseDir 超时修复、v1.3.0 依赖切换在真机上表现是否符合预期。
- 如果条件允许，找一台真实 Android 设备和一台干净 Windows 机器做一次全功能端到端验证。
