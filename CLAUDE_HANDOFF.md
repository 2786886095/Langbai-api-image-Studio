# Claude Handoff: AI 图片生成器 v1.3.5

更新时间：2026-07-04
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.3.5`

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

**v1.3.3 更新**：依赖来源又变了一次，见下方"v1.3.3"一节——现在指向的不再是 `jnschulze/flutter-webview-windows` 官方仓库的 commit，而是 `theblitzapp/flutter-webview-windows` 这个 fork 的一个 commit（在同一个 base commit 上只多打了一个官方仓库还没合并的补丁）：

```yaml
webview_windows:
  git:
    url: https://github.com/theblitzapp/flutter-webview-windows.git
    ref: 571ac6168960ce434f6f8ed5172f06378028ef48
```

以后如果官方仓库把这个补丁（PR #328）合并发布了正式版本，可以考虑切回官方仓库/pub.dev，但**不要在没有验证补丁确实包含的情况下贸然切回**。

## v1.3.5：新增"嵌字模式"（Caption Mode）—— 本次会话最大的一块新功能

### 起因

用户想做"给图片批量加文字气泡"的功能，反馈"如果参考图片太多，会显示 HTTP 413 Request Entity Too Large"——因为当时的做法是把所有参考图一次性塞进单图模式的全局参考图池，一次请求打包所有图片，图一多必然超限。用户提出想要一种全新的板块模式，把图片按顺序 1.2.3...n 分别单独发送，从架构上避开这个问题。

**这次遇到多个并发需求堆积时，用户明确选择"先把新需求都说清楚"而不是"先发布当前修复"**——这是个值得记住的信号：用户并不总是想要最快拿到修复，有时更在意方向对不对。追问后确认了两个关键设计决策（否则会走错方向、返工代价很大）：
1. 气泡文字**靠 AI 模型画上去**（发提示词），不是本地 Canvas 图像编辑。
2. 上传方式是**一次性选好全部 N 张图**，软件内部自动按顺序依次发送，不要求用户手动一张张传。

拿到这两个答案后，因为这是"新增功能/多文件改动/存在多种可行架构"的典型场景，走了一次完整的 Plan Mode（`EnterPlanMode`→`Explore` 子agent 调研漫画模式架构→写计划文件→`ExitPlanMode` 拿到用户批准）才动手实现，而不是像之前几个小修复那样直接改。

### 架构：漫画分镜模式的简化变体，不是从零发明

**关键发现**：漫画分镜模式（`generateComic()`）本来就是"每个分镜单独发一个请求，只带自己的参考图"的架构——这正好是嵌字模式想要的"不打包"效果。所以嵌字模式在实现上刻意大量复用漫画模式已有的函数/模式，只是把"多分镜、每个手动传图、可选参考图"简化成"一次批量选图、自动建N行、每行必须有一张图"：

- 新增第三个 `currentMode` 值 `"caption"`，新增 `.mode-tab[data-mode="caption"]`。
- 新增 `#captionSection`（复用 `.comic-only` 卡片样式），内部：批量上传区（`#captionBulkInput` + `#captionUploadZone`，套用全局参考图上传器 `addReferenceImages()` 的多文件处理套路，但每个文件对应新建一行而不是塞进共享数组）+ `#captionTable`/`#captionTbody`（表格结构抄漫画的 `#panelTable`/`panelRowTemplate`，行内的图片列直接复用 `.panel-img-btn`/`.panel-img-input`/`.panel-img-preview`/`.panel-img-name`/`.panel-img-clear` 这几个 CSS 类名——纯样式复用，JS 里都是 `row.querySelector(...)` 局部作用域，不会和漫画表格冲突）。
- 新函数（`app.js`）：`addCaptionRow(prefilledRef)`（镜像 `addPanelRow()`，但支持一进来就带图）、`addCaptionRowsFromFiles(fileList)`（`Promise.all(files.map(readImageReference))` → `sortReferencesByName()` 按文件名自然序排好 → 依次建行，新增的行追加在已有行后面、不跟已有行重新合并排序）、`collectCaptionRows()`（镜像 `collectPanels()`）、`generateCaptions()`（镜像 `generateComic()` 的整体编排：一次性建好所有占位卡片 → 每行一个独立的 `callImageAPI()` 调用 → `concurrentLimitSettled`/`sequentialMode` 二选一 → 全部完成后 `saveGenerationProject({type:"caption-project", mode:"caption", ...})` 合并存一条历史记录）。
- **每行的输出尺寸自动跟随该行图片自己的原始尺寸**（`` `${ref.width}x${ref.height}` ``，取不到才兜底用全局尺寸预设），**不做每行自定义尺寸/重试次数覆盖**（漫画模式有这两个per-panel覆盖，嵌字模式故意简化掉，重试次数统一用全局设置）——这是跟漫画模式的刻意差异，不是漏做。
- **每行只发自己那一张图，不合并全局参考图池**：`references = [row.reference]`，不像漫画的 `getPanelRequestReferences()` 那样把全局参考图也合并进来——这是避免 413 的关键，所以**全局参考图片字段在嵌字模式下整个隐藏**（`switchMode()` 里新增 `dom.referenceField.classList.toggle("hidden", isCaption)`），避免用户以为传了会生效。

### 复用现有历史记录机制时挖出的两个真 bug（不是嵌字模式引入的，是本来就有的）

排查"漫画模式的历史记录机制能不能直接给嵌字模式复用"时，发现 `saveGenerationProject(project)` 内部**硬编码**了 `type: "comic-project", mode: "comic"`，直接忽略传进来的 `project.type`/`project.mode`——之前只有 `generateComic()` 一个调用方，传的值恰好跟硬编码值一样，所以这个 bug 从来没被触发过；换成 `generateCaptions()` 传 `type:"caption-project", mode:"caption"` 时，会被这行硬编码逻辑悄悄改回 comic，导致嵌字项目在历史记录里被错误标记成漫画项目。同理 `restoreHistoryItem()` 里恢复历史项目、重新渲染每张图片卡片那段代码，也硬编码了 `retryContext: { mode: "comic", ... }`。还有 `replacePlaceholder()`（所有模式共用的核心函数）内部三处 `options.retryContext?.mode === "comic"` 判断（决定要不要用 `getPanelOnlyPrompt()` 剥离全局提示词前缀），以及 `getCurrentResultImages()`（ZIP导出用）里同样的判断——这几处都只认"comic"，不认"caption"，导致嵌字模式的历史记录/重试/导出会把"全局提示词+气泡文字"的合并结果误存成"气泡文字"字段本身。**这些全部已修复**（改成同时接受 comic 和 caption，或直接用 `project.type || "comic-project"` 这种"用传入值兜底"而不是硬编码）。**教训**：往一个"目前只有一种调用方式"的共享函数里加第二种调用方时，不要只看它的参数签名是否通用，要实际读它的函数体是否偷偷写死了第一种调用方的具体值。

### 复用漫画模式时刻意去掉的一处行为

`switchMode()` 切到漫画模式时会自动建一个空分镜行（`if (dom.panelTbody.children.length === 0) addPanelRow();`），一开始给嵌字模式抄了同样的逻辑，结果实测发现很别扭：用户切到嵌字模式标签页，会先看到一个孤零零的空行，然后批量上传的图片全部追加在这个空行后面，看起来像个界面 bug。**已移除**嵌字模式这部分的自动建行逻辑——嵌字模式的行完全由批量上传驱动，不需要"随时保底至少一行"这个漫画模式的假设（历史记录恢复路径里仍保留了"如果一条记录都没有就至少建一行"的兜底，那是防御性的边界情况，跟这里不是一回事）。**这个发现本身就值得记住**：复用别的模式的交互模式时，不要不加检验地照抄每一个细节，跑一遍真实截图/交互看看是否真的合理。

### 验证方式

- headless Edge 截图确认整个流程：切换到嵌字模式 → 批量上传 3 张文件名故意乱序的图（`cap-2.png`/`cap-10.png`/`cap-1.png`）→ 确认自动生成 3 行且按自然序排列（1, 2, 10，不是upload顺序也不是字符串字典序）→ 每行缩略图/文件名/气泡文字输入框都正确渲染。
- 新增 `qa/regression-runner.js` 的 `testCaptionMode`，覆盖：批量上传自然序排序、每次生成请求真的只带 1 张图（这是这个功能存在的全部意义，用 mock `window.fetch` 拦截 GrsAI 的 `/v1/api/generate` 请求体里 `body.images.length` 断言）、结果合并存成一条 `caption-project` 历史记录、单独重试某一行只会多打一次请求（不会牵连其它行）、从历史记录恢复能正确切回嵌字模式并回填每行的图片和气泡文字。**用 `git stash` 隔离验证过**：只 stash 掉 `app.js`/`index.html`/`style.css`（保留新测试），确认测试会在找不到 `[data-mode="caption"]` 时崩溃报错，证明测试真的在测这个功能而不是摆设；恢复后全部 21 项检查通过。
- **没有做过真机 Windows exe/Android 端到端验证**——尤其是批量上传的拖拽交互在打包后的 exe 里是否符合已知的 `isDragDropUnsupported()` 判断（理论上应该没问题，因为完全复用了同一个判断函数和同一套 CSS/HTML 结构，但没有实机确认过）。

## v1.3.4：参考图列表溢出修复 + 模型选择改成真正的输入框内联下拉（combobox）

用户连续报了好几个问题，这一版一次修了两个（第三个"嵌字模式"新功能已明确要求先讨论清楚需求再动手，故意没有包含在这版里，见文末"下一步建议"）。

**参考图太多时会溢出、根本选不了/加不了图**：根因和历史上 `.config-section[open] .config-body` 那次一模一样——`.compact-reference-field .thumb-grid`（`style.css` 里两处，基础规则 124px + `@media (min-width:981px)` 断点下的 96px 覆写）加了自己的 `max-height`+`overflow:auto`，而它的外层 `.input-panel` 本来就已经是 `overflow-y:auto` 的滚动容器了——变成"外层能滚、内层也能滚"的嵌套滚动区域，参考图一多，内层这个小滚动区域就把"+添加更多"按钮和后面的图挤到自己那几十像素高的小滚动条下面，看起来像是"溢出了选不到"。用 CDP 在 headless Edge 里造了 50 张不同颜色的假图复现确认（第一次用完全相同颜色的假图片测试时被 `dedupeReferences()` 按 dataUrl 去重成了 1 张，排查过程中发现的，以后用假图做类似测试记得让每张图内容不同）。**修复**：直接删掉这两处 `max-height`/`overflow`，跟"config-body"那次的教训一致——不要在已经有外层滚动的容器里再嵌一层，让 `.thumb-grid` 自然撑高，交给 `.input-panel` 的外层滚动来到达。已用真实浏览器 1280×800 视口验证：50 张参考图时外层面板能正常滚动到"+"按钮且可点击命中。

**模型选择要求改成"点击输入框本身弹出列表"**：用户原话"我不想要再多出个列表给我选，我想要直接在填写模型的地方可以点击弹出列表给我选"。排查发现 `#model` 输入框其实一直有个暗示这个意图的 placeholder 文案"已加载 N 个模型，点击选择"（`loadFallbackModels()`/`loadGrsaiModels()`），但点击输入框本身实际什么都不会发生——真正可点的是旁边一个独立的 `#modelChoicesCustomSelect` 下拉框（v1.2.8/v1.2.9 加的），这是设计意图和实现不一致的一个既有小 bug，用户这次反馈正好点中了它。**修复**（`index.html`/`style.css`/`app.js`）：
- 删掉了原生 `<datalist id="modelList">`（连同 `#model` 的 `list="modelList"` 属性）和独立可见的 `#modelChoicesCustomSelect`（含 `#modelChoicesTrigger` 按钮）。之所以连 datalist 一起删，不只是为了界面简洁：datalist 弹出层也是浏览器原生弹出层，跟当年 `<select>` 的问题（`#312`）同一类风险——虽然没查到专门的上游 issue 佐证 webview_windows 对 datalist 有同样的离屏渲染问题，但既然都统一到自绘下拉框了，没有理由单独留一个原生弹出层机制在这个输入框上，况且浏览器/PWA 端如果两个弹出层（原生 datalist + 自绘列表）同时命中还会有视觉冲突。
- `#modelChoicesCustomList`（弹出列表本身）挪到 `.model-input-row`（`#model` 输入框和"检测"按钮所在的行）内部，`.model-input-row` 加 `position:relative` 作为定位锚点，让列表正确悬浮在输入框整行下方。
- 新增 `initModelCombobox(selectEl, inputEl)`（`app.js`，紧跟在 `initCustomSelect` 之后）：点击 `#model` 输入框本身开合列表，选中后填入输入框值（复用已有的 `dom.modelChoices` change 监听器同步逻辑，没有改动那部分）；**手动打字自定义模型名的能力完整保留**——打字时（`input` 事件）如果列表还开着会自动关闭，不会挡住正在输入的内容；参与既有的全局"点击外部关闭/Escape 关闭"注册表（`_customSelectRegistry`），行为跟其它 6 个下拉框一致；列表为空（还没检测到任何模型）时点击输入框不会弹出空列表。
- `#model` 新增 `.has-model-choices` CSS 类（`setModelChoices()` 里按 `ids.length` 切换），仅在真的有可选模型时才显示下拉箭头背景图标提示"这里能点开列表"，跟其它 `.custom-select-trigger` 用的是同一个箭头图标，视觉保持一致。
- 已用 headless Edge 截图确认视觉效果正常（弹出列表紧贴输入框+检测按钮下方，宽度对齐，不遮挡任何内容）。

**回归测试**：`qa/regression-runner.js` 新增 `testModelComboboxBehavior`（专门测：未检测时点击不弹空列表、检测后点击弹出且能选中、打字关闭列表且不影响手动输入的值、点击外部关闭），并更新了 `testApiConfig`（改点 `#model` 而不是旧的 `#modelChoicesTrigger`，`options[0]` 现在就是第一个真实模型而不是占位项，因为占位选项在新的 `renderOptions()` 里被过滤掉了）、`testModelChoicesWheelScroll`（同样改成点 `#model`）。**用 `git stash` 隔离验证过**：只 stash 掉 `app.js`/`index.html`/`style.css`（保留新测试），跑测试确认会在 `testApiConfig` 崩溃报错（`options[0]` 是 `undefined`，因为旧代码点 `#model` 什么都不会发生），证明新测试真的在测这个行为，不是摆设；`git stash pop` 恢复后全部 20 项检查通过。

## v1.3.3：桌面图标/desktop 区域卡死的真正根因找到了，v1.3.2 的猜测是错的

**先纠正 v1.3.2 的错误结论**：v1.3.2 把"桌面图标点不了"归因于"Webview 组件收到退化尺寸（尺寸接近 0，比如窗口最小化）时离屏渲染表面损坏"，加了 `WidgetsBindingObserver`/`didChangeMetrics()`/`isDegenerateWindowSize()` 防护。v1.3.2 发布后用户明确反馈："软件依然会对屏幕有占用，比如我把软件移动了位置，但它原来在的那块区域桌面依然啥也点击不了"——**触发条件是移动窗口，不是最小化/缩小尺寸**。Flutter 的 `didChangeMetrics()`/`onMetricsChanged` 只在窗口**尺寸**变化时触发，纯粹的窗口**位置**移动根本不会触发这个回调，所以 v1.3.2 的修复对这个场景完全没有覆盖，**从一开始就没对症**。这是本轮排查中一次明确的"猜错了根因就先発布了修复"的教训，下面记录真正原因，以后不要重复往"尺寸/生命周期"方向猜。

**真正根因**（在 `jnschulze/flutter-webview-windows` 的 C++ 源码 `windows/webview.cc` 里）：`Webview::SetSurfaceSize()` 每次都把离屏渲染用的原生 WebView2 宿主窗口的 `RECT bounds` 硬编码定位在 `(left=0, top=0, right=width, bottom=height)`——也就是**主显示器屏幕坐标的左上角**，这个区域恰好是大多数 Windows 桌面摆放图标的地方。这个宿主窗口虽然设计意图是给 Flutter 通过 Windows.Graphics.Capture 抓图合成用的"离屏"窗口，但它本身是一个真实存在、有真实屏幕坐标的原生窗口，会实实在在地拦截 `(0,0)` 到 `(width,height)` 这个屏幕区域的鼠标输入——**跟 Flutter 应用窗口本身在哪、有没有被移动、有没有最小化完全无关**，只要 WebView 初始化过、这个宿主窗口存在，它就钉死在屏幕左上角挡住桌面。这也精确解释了上游 issue 里的原始描述：`#262`"transparent mask covered the desktop"、`#207`"left half of computer windows can't be clicked"——都是"左上角/左半边"，因为 `(0,0)` 正是左上角。

上游已经有人诊断到同一个问题并提交了修复 **PR #328 "fix: invisible window blocking clicks on the desktop"**（`Closes #262`），核心改动：

```cpp
const LONG kBoundsOffset = -32000;
RECT bounds;
bounds.left = kBoundsOffset;
bounds.top = kBoundsOffset;
bounds.right = kBoundsOffset + static_cast<LONG>(scaled_width);
bounds.bottom = kBoundsOffset + static_cast<LONG>(scaled_height);
```

把宿主窗口的坐标整体偏移到 `(-32000, -32000)`，这是 Win32 生态里经典的"移到任何显示器都够不到的地方"技巧，这样这个真实窗口就再也不会跟任何用户实际看得见、点得到的屏幕区域重叠。**这个 PR 至今没有被官方仓库合并**（截至排查时 `state: open`，`merged_at: null`），但 PR 的 head 是 `theblitzapp/flutter-webview-windows` fork 上的一个 commit（`571ac6168960ce434f6f8ed5172f06378028ef48`），`mergeable_state: clean`，而且这个 commit 的 base 恰好就是我们 v1.3.0/v1.3.2 已经在用的那个官方 commit（`ed81bbe985c12759a44b9cca8170e19c73b961c0`）——所以直接把 `pubspec.yaml` 的 `ref` 换成这个 fork commit 就等于"我们当前依赖 + 只多这一个修复"，没有引入其它未知改动。

**修复**（`pubspec.yaml`）：`webview_windows` 的 git `url`/`ref` 换成上面的 fork/commit（用户已明确同意这次依赖来源变更）。`flutter pub get`/`flutter analyze`/`flutter test` 全部验证过没问题；本机没有可用的 Visual Studio 工具链，无法本地 `flutter build windows` 验证新 C++ 代码真的能编译，**验证依赖 CI 的 Windows job**（CI 用的是 GitHub 托管的 windows-latest runner，有完整工具链）。已经在拉取到本地的 pub cache 源码里 grep 确认 `kBoundsOffset`/`-32000` 这几行确实存在于拉到的版本（不是只信任 commit SHA，真的读了源码内容）。

**v1.3.2 的 `WidgetsBindingObserver`/`isDegenerateWindowSize()` 防护保留，没有删**——虽然它没解决用户报的这个具体场景，但它防的是"窗口尺寸真的退化到 0"这个正交的场景（依然可能发生，比如某些极端最小化实现），留着不冲突，删掉没有收益。**没有真机验证过"移动窗口后原来的区域是否恢复可点击"这个具体场景**（本机没有多显示器/没有復现环境去手动移动窗口测试），这是本次修复最大的未验证项，见下方"已知未验证/延后事项"。

## v1.3.2：桌面图标卡死（#262/#207，诊断方向错误，已被 v1.3.3 修正）+ `nativeFetch` 超时太短

两个独立 bug 一起发版。

**桌面图标点不了**：用户反馈"软件使用后会异常占用屏幕 导致桌面上图标都点机不了"——用过软件之后，即使窗口不在前台，桌面左侧图标区域也点不了，像是有一层透明遮罩盖住了。查 `jnschulze/flutter-webview-windows` issue 列表命中 `#262`/`#207`：webview_windows 是离屏渲染（Windows.Graphics.Capture）架构，如果 Webview 组件在树上保持挂载的同时收到一次退化尺寸（宽或高接近 0，典型场景是窗口被最小化时 Flutter 引擎报告的 metrics），会导致离屏渲染表面损坏，留下一个卡住的透明覆盖层挡在桌面上，这个覆盖层不受 Flutter 应用窗口本身的显示/隐藏状态控制。

**修复**（`lib/main.dart`，`_WindowsWebShellState`）：
- 新增顶层纯函数 `bool isDegenerateWindowSize(Size size) => size.width < 2 || size.height < 2;`——单独抽出来是为了不依赖真实 `WebviewController` 就能单元测试（`test/window_size_test.dart`，3 个用例）。
- `_WindowsWebShellState` 加上 `with WidgetsBindingObserver`，在 `initState()` 里 `WidgetsBinding.instance.addObserver(this)`，`dispose()` 里对应 `removeObserver`。
- 新增 `didChangeMetrics()` 回调，读取 `WidgetsBinding.instance.platformDispatcher.views.first.physicalSize`，用 `isDegenerateWindowSize()` 判断，结果存进 `_isWindowSizeDegenerate` 状态。
- `_buildBody()` 在渲染 `Webview(_controller)` 之前先检查这个标志位，退化时返回 `SizedBox.shrink()` 占位，**不 dispose controller**（窗口恢复正常尺寸后 `didChangeMetrics()` 会再次触发，自动换回真正的 Webview）。

这个方案没有引入新依赖（考虑过 `window_manager` 包，但 `WidgetsBindingObserver` 是 Flutter 内置、非 deprecated 的标准 API，能解决问题就不加新依赖)。`flutter analyze` 干净，`flutter test` 10/10 通过（含 3 个新用例）。**没有真机验证过"最小化再还原窗口"这个具体场景**，只验证了 `isDegenerateWindowSize()` 本身的边界值逻辑，见下方"已知未验证/延后事项"。

**`nativeFetch` 频繁超时**：用户反馈"还有经常出现调用超时"，追问后确认具体报错是"失败原因 原生功能调用超时（nativeFetch），请重试"——说明不只是 v1.3.1 修过的 `chooseDir`，图片生成请求本身也会撞到同一个 120 秒默认超时。生图请求经常比普通网络请求慢得多（复杂模型、排队、GrsAI 异步轮询等都可能超过 2 分钟），120 秒对这类请求明显太短。

**修复**（`app.js`）：
- `nativeFetchPayload(payload, timeoutMs)` 新增可选的 `timeoutMs` 参数，透传给底层的 `request()`。
- `smartFetch()` 里两处调用 `nativeDownload.nativeFetchPayload(payload, ...)` 的地方（正常路径 + fetch 失败后的降级路径）都显式传入 `5 * 60 * 1000`（5 分钟）。
- `testDesktopProxy()` 那处调用**没有改**，继续用默认的 120 秒——它测的是到 GitHub Release API 的连通性，本来就该快，不需要放宽超时。

没有加专门的回归测试（纯数值调整，`node qa\regression-runner.js` 全绿即可）。**没有真机验证过"生图请求真的跑到 2-5 分钟"这个具体场景**，只是逻辑合理性上的修复，见下方"已知未验证/延后事项"。

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

v1.0.11 → v1.2.0 是用户明确指定的跳跃。之后到 v1.2.10 都是常规 +0.0.1 递增（v1.2.4~v1.2.10 是同一会话里连续排查出的独立问题各自单独发版）。**v1.3.0 是用户明确要求的版本号**（"之后发布1.3.0"），对应 webview_windows 依赖切换这个架构级改动，不是常规 +0.0.1（如果按常规应该是 v1.2.11）。v1.3.1 之后恢复常规 +0.0.1 递增，v1.3.3 也是常规递增（用户没有指定具体版本号）。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来。

## 当前核心状态

- 应用版本：`APP_VERSION = "1.3.5"`；`pubspec.yaml` 为 `1.3.5+29`
- 前端缓存/query：`index.html` 中 `20260704-1-3-5`；Service Worker cache：`ai-image-generator-1-3-5-20260704`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,3,5,29`/`"1.3.5"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致校验过）
- v1.2.3~v1.2.7、v1.2.9、v1.2.10、v1.3.0~v1.3.4 均已创建 GitHub Release；v1.2.8 只有 commit+CI 通过，没有 Release；**v1.3.5 截至本次交接是否已推送/发布取决于用户对推送的确认，见下方"下一步建议"**
- `webview_windows` 依赖现在指向 `theblitzapp/flutter-webview-windows` fork 的 commit（见上面"v1.3.3"一节），不再是 `jnschulze` 官方仓库的 commit，也不再是 pub.dev 的 0.4.0
- 模型字段（`#model`）现在自己就是下拉触发器（见"v1.3.4"一节），原生 `<datalist id="modelList">` 和独立的 `#modelChoicesCustomSelect` 都已删除；`#modelChoices`（隐藏 `<select>`）仍然是数据状态源，没有变
- **新增第三个生成模式"嵌字模式"（`currentMode === "caption"`，见上面"v1.3.5"一节）**：批量上传图片、每张图自动生成一行、每行单独发一次生成请求（只带自己的图，不打包），气泡文字靠 AI 模型画上去。架构上大量复用漫画分镜模式的现有函数/机制，具体差异见"v1.3.5"一节的"刻意简化"部分。

## 已知未验证/延后事项

- v1.3.0 依赖切换后的 CI 构建已验证四端成功，但**没有真机 Windows exe 端到端验证**依赖切换本身是否解决了 IME 之外的其他潜在问题（比如是否真的不再需要 JS workaround，但目前没有移除 workaround 的计划，所以这不是阻塞项）。
- v1.2.10 的滚轮修复（overlay 扩展 + mousemove 追踪）已用"故意构造 target 和坐标都错、但真实 mousemove 位置对"的场景验证过，包括用 git stash 确认回归测试真的会失败/通过，但**仍然没有真机 Windows exe 用真实鼠标滚轮做端到端验证**。
- IME 候选框位置问题（上游 `#304`）**确认无解**，如果用户继续反馈，只需要确认"最终输入的文字是否正确进入了输入框"（如果连这个都不对，是完全不同性质的问题，需要重新排查）。
- v1.3.1 的 `chooseDir` 超时修复没有真机验证"用户真的在选择文件夹时超过 2 分钟"的场景，只是逻辑合理性上的修复。
- 漫画 folder-save 功能（v1.2.3）没有真机 Windows/Android 端到端验证。
- v1.3.2 的 `nativeFetchPayload` 超时延长（5 分钟）没有真机验证"生图请求真的跑到 2-5 分钟"的场景，只是逻辑合理性上的修复。如果用户后续反馈超时问题仍然存在，说明 5 分钟可能还不够，需要问清楚具体是哪个模型/哪种请求方式（同步一次性 vs GrsAI 异步轮询）超时，可能需要给不同请求类型不同的超时而不是一刀切 5 分钟。
- **v1.3.3 的 fork 依赖切换（`-32000` 偏移修复）没有真机验证"移动窗口后原位置桌面区域是否恢复可点击"这个用户实际报告的具体场景**——本机既没有 Visual Studio 工具链能本地编译验证，也没有条件手动复现"移动窗口/拖动到其它位置"。CI 的 Windows job 只能验证编译通过，不能验证运行时行为。**这是当前最高优先级的待验证项**，接手后第一件事应该是等 CI 出安装包，实机装上后手动移动窗口位置，确认原来窗口所在的桌面区域能不能正常点击图标/桌面元素了。如果验证后问题仍然存在，说明这次的诊断/修复也不对症，需要重新排查（比如可能不是 `SetSurfaceSize` 这一处硬编码坐标，插件里可能还有其它地方也用了类似的坐标逻辑）。
- **v1.3.3 依赖来源是 fork 而非官方仓库**，长期看有一定维护风险（fork 作者可能不再维护/删库），如果官方 PR #328 后续被合并发布，应该考虑切回官方来源，但要先验证官方发布的版本确实包含这个修复再切。
- v1.3.4 的参考图溢出修复、模型 combobox 改造都已经过 headless Edge 行为验证（回归测试 + 截图）和 `git stash` 隔离验证新测试真的会失败/通过，但**都没有真机 Windows exe 端到端验证**——尤其是模型 combobox，桌面/Android/PWA 三端的实际点击体验、以及原生 Windows exe 里点击输入框弹出列表的手感（会不会又踩到 webview_windows 的什么离屏渲染坑）都还没有真机确认过。
- **v1.3.5 的嵌字模式没有做过任何真机 Windows exe/Android 端到端验证**，只有 headless Edge 截图 + 回归测试。批量上传的拖拽交互在打包后的 exe 里理论上应该没问题（完全复用了 `isDragDropUnsupported()` 判断和同一套 CSS/HTML 结构），但没有实机确认过；实际生成效果（AI 是否真的能理解"在图片右上角加气泡文字"这类指令、气泡位置/样式是否符合预期）完全没有用真实 API 测试过，因为回归测试全程 mock 了 `window.fetch`。这是目前优先级最高的待验证项。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 不能改。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗（`askConfirm`/`askPrompt`）。
- **`webview_windows` 依赖现在指向 `theblitzapp/flutter-webview-windows` fork 的一个 commit（见"v1.3.3"一节），不再是 pub.dev 0.4.0，也不再是 `jnschulze` 官方仓库的 commit**——但依然要警惕这个插件的架构性限制（离屏渲染下 IME/某些原生 UI 元素位置报告不准确），不是所有问题切换依赖就能解决。**遇到"只有打包后 exe 才复现，且影响范围可能超出应用自身窗口边界"的诡异 bug，不要只往"尺寸/生命周期"方向猜**（v1.3.2 就猜错了方向），应该直接去查这个插件 C++ 源码本身怎么处理离屏渲染窗口的屏幕坐标定位（`windows/webview.cc` 的 `SetSurfaceSize()`），这类"真实原生窗口占用真实屏幕坐标"的问题往往和 Flutter 应用窗口自身的移动/尺寸/生命周期完全无关。
- **不要相信滚轮事件的 `event.target` 或 `clientX`/`clientY`**：两者都可能被插件转发错。任何"从滚轮事件找该滚动哪个元素"的新代码都应该走 `resolveWheelEventStartElement(event)`（mousemove 追踪优先，wheel 坐标其次，`event.target` 最后兜底），不要直接信任其中任何一个字段。
- **`display:flex; flex-direction:column` 容器配 `max-height`+`overflow-y:auto` 时，子项必须显式设置 `flex-shrink:0`**，否则内容超出高度限制时会被压缩变形而不是让容器滚动。
- **不要在一个本来就有 `overflow-y:auto` 的外层容器（如 `.input-panel`）内部，再给某个子区域单独加一层 `max-height`+`overflow:auto`**：这会做出"外层能滚、内层也能滚"的嵌套滚动区域，内层通常又矮又容易把关键按钮/内容挤到自己那个小滚动条下面，看起来像是"溢出选不到/点不到"。这个模式在这个代码库里至少踩过两次（`.config-section[open] .config-body` 挡住保存按钮；`.compact-reference-field .thumb-grid` 挡住参考图和加号按钮），教训是一致的：新增任何"可能变长的列表/网格"时，默认让它自然撑高、交给外层滚动，不要想当然地加一层自己的滚动。
- **`nativeDownload` 的 `request()` 超时对于"用户节奏主导"或"后端本身就慢"的操作（选文件夹、下载大文件、生图请求/GrsAI 轮询）需要给足够长的超时**（选文件夹/下载 15 分钟，生图请求 5 分钟），不要用默认的 120 秒；错误消息也不应该硬编码平台名，这个函数在 Windows/Android 上是同一份代码。
- **Windows 端渲染原生 `Webview` 组件前，要防御"退化尺寸"（宽或高接近 0，典型场景是窗口最小化）**：webview_windows 是离屏渲染架构，给它一次退化尺寸的布局约束会损坏渲染表面、留下卡住的透明覆盖层挡住桌面（上游 `#262`/`#207`）。`_WindowsWebShellState` 已经用 `WidgetsBindingObserver.didChangeMetrics()` + `isDegenerateWindowSize()` 防住了这个场景，退化时换成 `SizedBox.shrink()` 而不是继续渲染 `Webview`。以后任何触碰这个 State 类的改动都要保留这套检测，不要因为"看起来没在用"就删掉。
- `lib/main.dart` 里 Android 和 Windows 走两条完全独立的 native bridge 分发路径，改 native bridge 参数/action 时两条都要检查、都要改。
- 这个代码库的 CSS 有反复出现的"重复声明"模式：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的。大改动后建议跑一次全文件选择器重复扫描。
- **给一个"目前只有一种调用方式"的共享函数（`saveGenerationProject`/`replacePlaceholder`/`getCurrentResultImages` 这类）新增第二种调用方（新模式）时，不要只看参数签名是否通用——要实际读函数体，确认没有偷偷硬编码写死第一种调用方的具体值**。v1.3.5 加嵌字模式时就在 `saveGenerationProject()` 里挖出这个真 bug：函数体内部硬编码了 `type:"comic-project", mode:"comic"`，直接无视传进去的 `project.type`/`project.mode`，只是因为之前唯一的调用方（`generateComic()`）传的值恰好和硬编码值一样，这个 bug 才从来没被触发过。同一类问题在 `replacePlaceholder()`/`getCurrentResultImages()`/`restoreHistoryItem()` 里也各挖出一处，全部是形如 `xxx.mode === "comic"` 的字面量判断，加新模式时都要搜一遍 `"comic"` 字符串逐个确认要不要加上新模式。
- **给漫画模式这类"多行批量生成"模式当参考实现新模式时，别把它的每个交互细节都当成必须照抄的规范**——v1.3.5 一开始照抄了漫画模式"切换模式时自动建一个空行"的逻辑，实测发现对于"批量上传驱动"的新模式（嵌字模式）体验很别扭（会先出现一个孤零零的空行）。跑一遍真实截图/交互过一遍，才发现这个细节不该照抄。复用别人的架构是对的，但要验证每个细节在新场景下是否真的合理，而不是不假思索全盘照搬。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`。
- 不要把任何 `<select>` 改回原生渲染，7 个（含模型列表）已经全部是自绘 `.custom-select` 组件。
- 不要删掉滚轮+覆盖层管理这套机制（`initManualWheelScrollFix`/`installGlobalWheelScrollBridge`/`updateBodyScrollLock`/`resolveWheelEventStartElement`/mousemove 追踪），也不要把触发条件从 `isNativeWindowsWebview()` 改成无条件启用。
- 不要把 `webview_windows` 依赖改回 pub.dev 的 `^0.4.0`，也不要在没有先验证补丁确实存在的情况下改回 `jnschulze` 官方仓库（官方仓库截至 v1.3.3 还没合并 `-32000` 坐标偏移那个修复，见"v1.3.3"一节）。
- 不要把 `#sequentialToggle` 挪回 `#nImagesField` 里面；不要把 `#modelChoices` 改回常驻展开的按钮网格；不要删掉 `.custom-select-option` 的 `flex-shrink: 0`。
- 不要给 `.compact-reference-field .thumb-grid` 重新加 `max-height`/`overflow:auto`（v1.3.4 刚删掉，原因见上面新增的"嵌套滚动"教训）。
- 不要把模型字段（`#model`）改回"文本框 + 独立可见下拉框"两个控件的样子，也不要重新加回原生 `<datalist id="modelList">`——现在 `#model` 输入框本身就是下拉触发器（`initModelCombobox`），这是用户明确要求的交互方式（v1.3.4）。
- 不要把 `chooseDir` 的超时改回默认的 120 秒；不要把 `smartFetch()` 里两处 `nativeFetchPayload` 调用的 5 分钟超时删掉/改回默认值。
- 不要删掉 `_WindowsWebShellState` 的 `WidgetsBindingObserver`/`didChangeMetrics()`/`isDegenerateWindowSize()` 退化尺寸检测，也不要让 `_buildBody()` 在退化尺寸时继续渲染真正的 `Webview`。
- 不要改 Windows 安装器的 AppId GUID；`[Run]` 不要加 `skipifsilent`；`[UninstallRun]` 的 taskkill 不要删；不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。
- 不要把嵌字模式（`generateCaptions()`）改成合并全局参考图池（`referenceImages`）到每行请求里——每行只发自己那一张图是这个功能存在的全部意义（避免 HTTP 413），不要为了"跟漫画模式保持一致"就加上合并逻辑。
- 不要给嵌字模式重新加回"切换模式时自动建一个空行"的逻辑（`switchMode()` 的 `isCaption` 分支里故意没有像漫画模式那样调 `addCaptionRow()`）——嵌字模式完全靠批量上传驱动，加回这个空行会导致批量上传的图片前面多出一个孤零零的空行，见"v1.3.5"一节。
- 不要在 `saveGenerationProject()`/`replacePlaceholder()`/`isHistoryProject()`/`restoreHistoryProjectEditor()`/`getCurrentResultImages()` 这些共享历史记录函数里把 `mode === "caption"` 的分支删掉、改回只认 `"comic"`。

## 下一步建议

- **最优先**：找用户用真实 API Key 实机测试嵌字模式（v1.3.5）——批量上传几张真图、填气泡文字、点生成，看 AI 是否真的能理解"在图片右上角加白色对话气泡，文字是XXX"这类指令、生成效果是否可用。这是本次会话里唯一完全没有用真实 API 验证过的功能（回归测试全程 mock 了网络请求，只验证了"发了几次请求、每次带几张图、历史记录存没存对"，没有验证"AI 生成的图好不好看"）。如果效果不理想，需要跟用户一起打磨气泡文字输入框的引导文案/是否需要额外的固定提示词模板。
- 找用户确认 v1.3.3 的 fork 依赖切换（`-32000` 坐标偏移）是否真的解决了"移动窗口后原位置桌面区域点不了"的问题——这是该修复完全没有真机验证过的部分（本机无 VS 工具链、也没有条件手动复现）。如果用户反馈问题依旧，说明诊断/修复不对症，需要重新去查 `windows/webview.cc` 里是否还有其它地方也用了类似的硬编码屏幕坐标逻辑。
- 找用户确认 v1.3.4 的两个修复（参考图溢出、模型 combobox）真机体验是否符合预期，尤其是模型输入框点击弹出列表这个新交互在打包后的 Windows exe 里手感如何。
- 找用户确认 IME 候选框位置问题（无解，已如实告知）是否影响实际打字体验（文字最终是否正确进入输入框）。
- 找用户确认 v1.3.1 的 chooseDir 超时修复、v1.3.2 的 nativeFetch 超时延长在真机上表现是否符合预期。
- **有两件事用户明确要求"先说清楚需求再动手"，v1.3.5 没有包含，需要接手后继续跟进澄清**：
  1. 更新提醒不够醒目——已经查明启动时的全屏确认弹窗逻辑本身没问题（`checkForUpdatesOnLaunch`，只要 GitHub 有更新的 Release 就会弹），用户之前没看到纯粹是因为当时确实没有比 v1.3.1 更新的 Release，v1.3.3 发布后这个问题可能已经自然消失，需要用户确认重新启动后是否看到了弹窗。
  2. 用户对更新提醒还提过"想要更持久的提示"这个方向（不只是启动一次性弹窗），具体想要什么形式（常驻顶部横幅？设置里的红点？）还没问清楚。
- 用户此前有一条尚未处理的陈述："还有图片其实已经缓存在本地，默认保存在setup安装的outputs里面，用户也可自行在软件内保存图片和压缩包到其它路径"——意图不明确（是要确认现状、报 bug、还是要求新功能？），至今没有回头处理。接手后如果用户没有主动重提，不要臆测着直接改代码，应该先追问清楚具体诉求。
- 如果条件允许，找一台真实 Android 设备和一台干净 Windows 机器（最好有多显示器/能实际移动窗口测试）做一次全功能端到端验证。
