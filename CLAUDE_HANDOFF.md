# Claude Handoff: AI 图片生成器 v1.3.18

更新时间：2026-07-15
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
本交接对应源码版本：`v1.3.18+42`；线上发布状态以 GitHub Releases 实际页面为准。

## v1.3.18 当前状态（优先读）

`v1.3.18` 修复项目文件夹命名：输入名称后实际文件夹使用该名称；未输入时漫画与嵌字分别使用不同默认前缀；三种情况都追加 `YYYY-MM-DD_HH-mm-ss`。此前 `v1.3.17` 的代理、HTTP-400-only 重试、首次请求取消、图片重载、历史缓存、导出、更新安全、secure storage、PWA 与跨端桥修复全部保留。最新测试与发布清单集中写在根目录 `CODEX_HANDOFF.md`；请先读该文件。

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

## v1.3.16：新增"安装目录"设置，让用户能手动选择应用内更新要覆盖到哪个位置

用户看到 v1.3.15 的修复说明后追问"选择路径安装的功能呢"，追问澄清后确认诉求是："更新时也要能选择目录，比如我想覆盖这个 F:\AI\picture\AI Image Generator 旧版更新"。v1.3.15 的修复是让更新**自动**精确覆盖"当前正在运行的这份程序"所在目录——但这个假设有个漏洞：如果用户当前运行的不是他想更新的那份（比如同时装过好几份、或者想专门去更新一份没在跑的旧安装），完全没有办法干预。这次要加的是一个真正的手动选择入口。

### 修法

**`lib/main.dart`**：仿照已有的"选择图片/ZIP 下载目录"（`_chooseWindowsDownloadDir`/`_windowsSavedDownloadDirs`）模式，新增一套独立的安装目录覆盖机制，跟 `downloadDirs` 是 `settings.json` 里平级的两个字段（`installDir` 只有单个值，不是按 kind 分类的字典）：

- `_windowsInstallDirOverride()`：读取用户手动选过的覆盖路径，没选过返回 `null`。
- `_saveWindowsInstallDir(path)`：保存/清除覆盖值（`path == null` 时从 JSON 里删掉这个 key，代表"恢复自动"）。
- `_defaultWindowsInstallDir()`：跟 v1.3.15 一样，`File(Platform.resolvedExecutable).parent.path`。
- `_effectiveWindowsInstallDir()`：覆盖值优先，没有则退回默认值——`_downloadWindowsUpdate()` 现在调用这个函数取 `/DIR=` 的值，而不是直接内联计算。
- `_chooseWindowsInstallDir()`/`_resetWindowsInstallDir()`：分别对应"选择目录"/"恢复自动"两个按钮，前者用 `file_selector.getDirectoryPath()` 弹出目录选择器。
- 三个新的原生桥接 action：`getInstallDir`（查询当前生效值+是否手动覆盖）、`chooseInstallDir`、`resetInstallDir`，全部只加在 Windows 的分发分支（`_handleWindowsBridgeMessage`），安卓那条分支完全不受影响——安卓的"检查更新"本来就是跳 GitHub 发布页，没有"安装目录"这个概念。

**`app.js`**：`nativeDownload` 新增 `getInstallDir()`/`chooseInstallDir()`/`resetInstallDir()` 三个请求包装；新增 `refreshInstallDirLabel()` 负责查询并回填标签文字、控制"恢复自动"按钮的显隐（`isOverride` 为 false 时隐藏，因为没有覆盖值就没有"恢复"这个动作可言）；`document.body.classList.toggle("windows-native", isNativeWindowsWebview())`——这是新增的第三个 body class，专门用来只在**原生 Windows exe**（不是安卓/浏览器/PWA，也不是"任意 native-download 环境"，因为 `native-download` 这个既有 class 是安卓+Windows 共用的）里控制这个设置行的显隐，没有复用已有的 `native-download`/`no-native-download`。

**`index.html`**：在"软件更新"设置区块加一行 `#installDirRow`（默认 `hidden`，跟 `#installDirHint` 一起只在原生 Windows exe 里由 JS 摘掉 `hidden`），一个标签+当前路径显示，两个按钮"选择目录"/"恢复自动"（后者默认也 `hidden`，直到真的存在手动覆盖值才显示）。

### 没有做但要知道的事

- **手动选择的安装目录不会做任何合法性校验**（比如是不是一个已经装过这个软件的目录、里面有没有 `ai_image_generator.exe`）——用户可以选择任意目录，Inno Setup 的 `/DIR=` 参数本身也不要求目标目录已存在或包含旧版本，选错目录只会导致"更新装到了一个新地方"而不是报错。如果以后需要防呆，需要在 Dart 侧或者选择目录之后加一层校验（比如检查目标目录下是否存在 `ai_image_generator.exe`/`unins000.exe`），这次没有做。
- **覆盖值一旦设置就会一直生效，不会因为"当前运行的 exe 换了个位置"而自动失效**——如果用户设置了覆盖值指向 F 盘的旧安装，之后又手动启动了 C 盘那份运行，下次应用内更新依然会去覆盖 F 盘那份（因为覆盖值优先级高于"当前运行位置"），这是刻意的设计（用户明确说了要能指定覆盖到别的位置），不是 bug。
- 这个功能没有做真机端到端验证（跟 v1.3.15 一样，本机没有条件搭建"多个安装目录"的真实场景），只验证了 `flutter analyze` 干净、`qa/regression-runner.js` 新增的 `testWindowsInstallDirControl` 用 mock 的原生桥接验证了 UI 显隐/回填/点击流程本身的正确性（用 `Page.addScriptToEvaluateOnNewDocument` 在页面脚本运行之前就注入 `FlutterDownload`，模拟真实 WebView2 宿主"在页面脚本执行之前就把原生桥接对象注入好"的时序——如果直接在页面加载完之后才用普通 `cdp.eval` 定义 `window.FlutterDownload`，会因为时序不对导致 `installDirRow` 的显隐判断（一次性在启动时计算）测出假阴性，这是写这个测试时踩的一个坑，记录下来避免以后写类似"检测原生桥接是否存在"的测试时重蹈覆辙）。

## v1.3.15：Windows 端"软件内更新"没有覆盖到用户原本选的安装路径，而是每次都在 C 盘重新装一份

用户反馈："软件内更新时应该更新到第一次选择的安装路径 覆盖更新 现在全部堆积到c盘 还占据了一堆空间 比如我装在F:\AI\picture\AI Image Generator该路径 就要在该路径更新"。

### 排查

`lib/main.dart` 的 `_downloadWindowsUpdate()` 下载完 Setup.exe 之后，一直是这样启动安装器的：

```dart
await Process.start(
  file.path,
  ['/SILENT', '/NORESTART', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'],
  mode: ProcessStartMode.detached,
);
```

没有传 `/DIR=`。Inno Setup 本身确实有"静默安装时自动沿用上次安装目录"的内置机制（`UsePreviousAppDir`，默认就是开着的，靠 `AppId` 在注册表里查上次装在哪），`windows/installer/setup.iss` 里 `AppId` 也一直没变过，理论上不用显式传参数应该也能穿透。但这条内置机制依赖注册表记录能被正确查到——一旦查不到（比如提权状态跟上次不一致、或者用户当初是用旧版本装的没留下预期位置的记录等任何一种注册表对不上的情况），Inno Setup 会**静默**退回 `setup.iss` 里 `DefaultDirName={localappdata}\{#MyAppNameEn}` 这个默认值，不会报错也不会提示用户——用户看到的就是"每次更新都在 C 盘新建一份"，而实际在用的那份（比如 F 盘）没有被覆盖，旧版本还留在原地占地方。这是这次真正的根因：**不是"选不到之前的路径"，而是"当自动探测失效时，没有任何兜底手段能保证更新装到当前正在运行的这个位置"**。

### 修法

不再依赖 Inno Setup 自己的注册表探测，直接用**当前正在运行的这个 exe 自己的路径**算出安装目录，显式传 `/DIR=`：

```dart
final installDir = File(Platform.resolvedExecutable).parent.path;
await Process.start(
  file.path,
  ['/SILENT', '/NORESTART', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS', '/DIR=$installDir'],
  mode: ProcessStartMode.detached,
);
```

`Platform.resolvedExecutable` 拿到的就是用户当前实际在跑的这个安装（无论装在 C 盘默认位置、F 盘、还是任何自定义路径），用它的父目录做 `/DIR=` 保证 100% 精确覆盖原地，不用猜、不依赖任何可能对不上的注册表状态。`PrivilegesRequired=lowest` 已经是既有配置，`/DIR=` 指向非 Program Files 的自定义路径（比如 F 盘）不需要额外提权就能装。

### 验证

- `flutter analyze` 干净。
- **这处改动没有对应的自动化回归测试**：`qa/regression-runner.js` 跑在浏览器/CDP 环境里，够不着 `lib/main.dart` 这段纯 Dart 原生代码，`test/` 目录下也没有针对 `Process.start` 参数的既有测试可以扩展。如果以后要给这类"拼装外部进程启动参数"的逻辑加自动化验证，思路应该是把"计算 `/DIR=` 参数值"这部分抽成一个不依赖 `Process.start` 的纯函数单独做单元测试，而不是去 mock `Process.start` 本身。
- **没有做过真机的"从 F 盘装的旧版本，触发应用内更新，确认新版本真的原地覆盖在 F 盘、C 盘没有多出一份"这种端到端验证**——本机开发环境只有一份装在默认路径的测试安装，没有条件复现"用户自定义路径 + 触发真实的应用内静默更新"这个完整链路。如果以后这个问题再被反馈，说明这个修法也没有命中，需要用户提供更多细节（比如更新时机器上到底有没有产生新的安装目录、旧版本残留具体在哪）。

### 顺带澄清的另一件事（不是 bug，没有代码改动）

同一条消息之后用户还说"只下载相关系统的安装包 我看到之前混杂着各种系统的安装包"。追问之后确认用户看到的是 Claude 自己在验证 v1.3.14 四端 CI 产物时用的临时 scratchpad 目录（下载 Android/iOS/macOS/Windows 四份产物到同一个文件夹用于校验），不是软件"检查更新"这条路径本身的行为——`app.js` 的 `selectUpdateAsset(release, platform)` 本来就已经按 `getRuntimePlatform()` 用正则只挑当前系统对应的那一个安装包（`downloadLatestUpdate()` 只会调用一次 `nativeDownload.downloadUpdate()`，传的是这一个 URL），代码层面找不到任何会同时下载多平台安装包的路径。**没有做任何改动**，记录下来是为了避免以后又把这条线索错当成同一个 bug 重新排查一遍。

### 没有做但要知道的事

- 这次修的只是"以后的更新会不会装对地方"，**不会**帮已经被装错到 C 盘的旧版本自动清理或迁移——如果用户 C 盘已经堆了好几个版本的残留安装，需要手动去 `%LOCALAPPDATA%\AI Image Generator` 检查、手动卸载/删除，这次没有加任何自动清理逻辑（属于故意不做，清理别人磁盘上的文件风险和收益不成比例，不该自作主张）。
- Android 端不受影响——安卓的"检查更新"从 v1.0.7 起就是直接跳转 GitHub 发布页由用户自己下载安装（见更下方 v1.0.7 一节），没有应用内静默安装这个概念，这次的问题和修法都只针对 Windows。

## v1.3.14：澄清"取消生成"的真实诉求——单张图片自己也要能取消，不只是批量整体取消

v1.3.12 加了"取消生成"（批量整体取消）之后，用户追加了一句澄清："我说的取消生成是指单个图片能够取消生成，但也保留现在的所有图片取消生成"。也就是说 v1.3.12 理解得不完整——批量取消要保留，但用户真正想要的还包括"单张图片自己也能取消"，而且是**任何时候**都能取消，不是只有撞上自动重试之后才能取消。

### 现状排查

v1.3.11 加的"停止重试"按钮（`.stop-card-retry`）实际上已经具备"取消单张卡片"的底层能力（每张卡片自己的 `card._cardRetryAbortController`），但只在 `updateCardRetryAttempt()` 被调用时才会 `classList.remove("hidden")`——也就是只有这张卡片已经失败过一次、进入自动重试阶段，这个按钮才会显示出来。如果一张图片还在**第一次、正常**的生成过程中（还没失败、没有进入重试），用户完全没有办法单独取消它，只能等它自己成功/失败，或者用 v1.3.12 那个批量按钮把所有图片一起取消掉。这就是用户说"但也保留现在的所有图片取消生成"这半句提醒我们没做全的地方。

### 修法

1. **`addResultPlaceholder()`/`renderRetryLoading()` 里 `.stop-card-retry` 按钮初始就不带 `hidden` class**——从卡片一进入 loading 状态（不管是首次生成还是人工点的重试）就可以点，不用等 `updateCardRetryAttempt()` 才显示出来。`updateCardRetryAttempt()` 里原来那行 `classList.remove("hidden")` 保留，当成防御性代码（万一以后有路径创建卡片时漏加可见状态），但不再是"揭示"这个按钮的唯一途径。
2. **按钮文案从"停止重试"改成"取消"（i18n key `stopCardRetry` 的值，key 名不变）**——"停止重试"这个措辞在按钮现在也能在"还没失败过、根本没有重试"的场景下点击时就说不通了，5 个语言全部改成更通用的"取消"/"Cancel"/"キャンセル"/"취소"。
3. **点击后卡片的失败提示文案从"已手动停止重试"改成"已手动取消"（5 处字面量全部替换）**——同样是因为这个动作现在覆盖两种场景（取消首次生成 / 停止自动重试），"停止重试"在首次取消的场景下不准确。

`qa/regression-runner.js` 新增 `testCancelDuringFirstAttempt`：单图模式发两张图（`nImages=2`），mock 让第一个实际发出的请求永远挂起（模拟"还在第一次生成中，还没失败过"），另一个正常成功；验证挂起那张的取消按钮从一开始就可见（不需要等任何失败/重试）、点击后正确取消且不触发任何重试、不影响另一张正常完成。已有的 `testCardRetryAttemptDisplayAndStop`（撞上 504 走自动重试再取消）改了断言里的失败文案匹配（"已手动取消"），其余行为不变——两个测试合起来覆盖了"首次生成中取消"和"自动重试中取消"两种场景，都能正确工作。用 `git stash` 验证过：如果把按钮初始状态改回带 `hidden`，`testCancelDuringFirstAttempt` 里"按钮必须立刻可见"这条断言会精确失败（其它断言不受影响，因为隐藏状态下用 JS 直接 `.click()` 依然能触发底层的 abort，只是可见性不对）。

### 没有做但要知道的事

- **`retryAllFailedResults()`（批量重试失败项）依然没有独立的取消入口**——这次澄清的范围是"单张图片的生成/自动重试"，不包括"重试全部失败"这个批量流程，不要顺手往那边加。
- 三个"取消"相关的入口目前是：(1) 顶部"取消生成"红色按钮——批量层面，(2) 每张卡片自己的"取消"按钮——单张层面、任何 loading 阶段都能点（本次改动的范围），(3) 无。没有第三层"取消某一次自动重试但保留这张卡片继续原样失败状态"之类的中间态，如果用户以后还要更细粒度的控制，需要重新明确诉求。

这版是同一次会话里连续收到的三条用户反馈，问题看似不相关，但都值得完整记录排查过程。

### 反馈 1：`有时候点击上传图片点不到`/`点不动`（追问确认是嵌字模式批量上传区）

根因：`openFileInputOnce(input)`（`app.js` 顶部，所有"点击上传"入口共用的一个小工具函数）内部有一个 900ms 的锁定窗口——如果同一个 input 在 900ms 内被要求"再打开一次文件选择框"，第二次调用会被直接吞掉、什么都不做。这个锁本来的用途应该是防止同一次物理点击被派发成两个 click 事件导致重复弹窗（这种重复只会相隔几十毫秒）。但 900ms 太长了：原生文件选择框弹出本身可能有明显延迟（尤其冷启动/慢磁盘环境），用户看不到反馈会不耐烦地再点一次——这一下会被直接吞掉，表现为"点了没反应"。嵌字模式的批量上传区因为设计上本来就需要反复点着用（先传一批、后面再传更多），这个问题在那里最容易被撞到。

**修法**：把锁定窗口从 900ms 缩短到 400ms（对应的清理定时器从 1200ms 缩短到 500ms）。依然能挡住真正意义上的"同一次点击触发两次"（那种重复是几十毫秒级别），但不会再误伤用户等了将近半秒之后的正常重试点击。`qa/regression-runner.js` 新增 `testUploadDebounceWindow`：验证近乎同时的两次点击只会真正打开一次选择框（锁依然有效），但间隔 500ms 的两次点击会打开两次（不再被误伤）——用 `git stash` 验证过旧的 900ms 值确实会让第二个场景失败。

### 反馈 2：`点了取消重试没有反应`（追问确认是卡片自己的"停止重试"按钮，即 v1.3.11 那个功能）

这个反馈揭出了一个比 v1.3.10/v1.3.11 当时评估的更严重的问题。回顾：v1.3.10 把生图请求的 JS 侧超时整个取消了（`nativeDownload.nativeFetchPayload(payload, null)`），v1.3.11 给每张卡片加了"停止重试"按钮，按钮点击时会 `abort()` 一个每张卡片自己的 `AbortController`。但排查发现：**`nativeDownload.request()`/`nativeFetchPayload()` 从来没有接受过 `AbortSignal` 参数**——`smartFetch()` 调用原生桥接那两处，虽然自己接了 `signal` 参数、调用前后也有 `throwIfAborted(signal)` 检查，但中间实际发起原生调用的那一行 `await nativeDownload.nativeFetchPayload(payload, null)` 完全没有把 `signal` 传进去！这意味着：一旦某张卡片的生图请求走到了原生桥接（打包后的 Windows/Android 真机上必然如此），且这次原生调用正在"进行中"（现在还不设超时，可能是一段不确定的时长），点击"停止重试"按钮除了让 JS 侧标记自己要 abort 之外，**没有任何实际效果**——`throwIfAborted(signal)` 只会在原生调用自己返回之后才被执行到，用户看到的就是点了按钮之后界面毫无反应，要等那次原生调用自己结束才会有动静。这是"点了没反应"最直接、最常见的触发路径，不是什么边缘情况。

**修法**：给 `nativeDownload.request(action, payload, timeoutMs, signal)` 加第四个参数——如果传入的 `signal` 已经是 `aborted` 状态直接拒绝；否则给这次调用注册一个 `abort` 监听器，一旦触发就立刻把这个 `pending` 里的记录删掉并 reject（用 `createAbortError()`）。`nativeFetchPayload(payload, timeoutMs, signal)` 透传这第三个参数，`smartFetch()` 两处调用都把自己的 `signal` 传进去。**注意这依然不是真正的原生级取消**——原生那边已经发出去的那次 HTTP 请求本身没有被真正砍断（原生桥接目前没有"根据 id 主动终止某个在途请求"的能力，需要动 `lib/main.dart` 两条平台分支才能做到），只是 JS 侧不再等它、界面立刻能给用户一个"已经停止"的反馈——但这已经是用户实际要的"点了要有反应"，跟"底层网络连接是否真的被切断"是两个不同层次的问题，后者目前的代价只是原生那次调用的字节在后台白跑一趟，不影响正确性。`qa/regression-runner.js` 的 `testNativeDownloadTimeoutOptOut` 新增了 Case 3：验证一个 `timeoutMs=null` 且带 `signal` 的调用，在原生侧完全不响应的情况下，`abort()` 之后必须立刻 reject（`AbortError`），不需要等待任何东西——用 `git stash` 验证过这条新断言在没加 signal 参数之前确实会失败（`abortableSettledAfterAbort` 停在 `false`，永远等不到）。

### 反馈 3：`恢复项目应该彻底还原...包括上传的参考图...包括没生成完的图片` / `重新导入图片都没办法参考了`

排查发现两个独立的问题叠在一起：

1. **参考图从来没有被保存过**：`replacePlaceholder()` 构建的结果记录（`record`）里压根没有 `references` 字段，`saveGenerationProject()` 把它原样存进历史记录——所以不管这一张成功还是失败，参考图数据从一开始就没进过 localStorage，"恢复项目"当然什么都恢复不出来。**这不是这次新引入的 bug，是从漫画分镜模式最初实现起就没做过的功能缺口**。
2. **失败的分镜/嵌字行不会被漏掉（这部分其实一直是对的，排查后确认不用修）**：`generateComic()`/`generateCaptions()` 保存项目时的 `panels` 数组本来就是遍历全部分镜/行（`panelTasks`/`rowTasks`），而不是只遍历成功结果（`projectImages`），每条都带 `status: "success"|"failed"`——这意味着提示词/尺寸/重试次数这些元数据，失败的行本来就会被保留、恢复时也本来就会重建对应的行。用户反馈"包括没生成完的图片"这半句，实测下来其实一直成立，真正缺失的只有参考图这一项。

**修法**：
1. `generateComic()`/`generateCaptions()` 保存项目时，`panels[]` 每一项新增 `references: serializableReferences(panel.references)`（漫画模式用 `panel.references`，即这一行自己的参考图，**不是** `getPanelRequestReferences(panel)` 合并了全局参考图池之后的那份——全局池不属于某一个分镜，存错了在恢复时会把全局图误当成分镜自己的图塞回某一行）。新增 `serializableReferences()` 把参考图对象里不可序列化的 `file`（浏览器 `File` 对象，`JSON.stringify` 会把它变成没用的 `{}`）去掉，只留 `fileName`/`dataUrl`/`width`/`height`。
2. 漫画模式补上一个跟嵌字模式对齐的能力：新增 `applyPanelRowImage(row, ref)`（从原来揉在 `imgInput` change 事件里的内联逻辑抽出来，人工上传和恢复项目共用同一份渲染代码），`addPanelRow(prefilledRef = null)` 新增可选参数，创建行的同时就能把参考图套上去（完全对应嵌字模式早就有的 `addCaptionRow(prefilledRef)` 用法）。
3. `restoreHistoryProjectEditor()` 两个分支分别改成 `addPanelRow(panel.references?.[0] || null)` / `addCaptionRow(panel.references?.[0] || null)`，把保存的参考图真正接回恢复出来的行上。
4. `compactHistoryItem()`（localStorage 超限时的兜底压缩）额外把每条历史记录里 `panels[].references` 清空——参考图的 `dataUrl` 是这类记录里最占地方的部分，storage 都已经超限的场景下，优先丢参考图（恢复会因此拿不回参考图，但提示词等其它信息还能保住）比继续保留、导致更多旧记录被挤掉要好。

`qa/regression-runner.js` 新增 `testComicProjectRestorePreservesReferencesAndFailures`/`testCaptionProjectRestorePreservesReferencesAndFailures`：各自搭一个"一张成功、一张失败、各自带不同参考图"的项目，验证保存的 `panels[]` 每条都带着自己的参考图、失败的那条也在（`status` 数组是 `["success","failed"]`），恢复之后两行的提示词和参考图缩略图都正确接回去、缩略图确实可见（不是存在内存里但预览还隐藏着）。**排查这两个测试本身踩了一个坑，值得记录**：一开始 mock 的 `window.fetch` 只拦截了 `/v1/images/generations`（纯 JSON body），结果两个分镜全部"失败"（`Failed to fetch`）——用 `debugSeenUrls` 打印出实际请求的 URL 才发现，带参考图的请求走的是 OpenAI 兼容适配器的 `/v1/images/edits`（`multipart/form-data`），跟不带参考图的纯文本生成完全是两个端点、两种 body 格式。**教训**：mock 网络请求时，如果测试场景涉及参考图，不能想当然沿用其它测试"不带参考图"时验证过的端点/请求体格式，要么直接确认真实分支会走哪个端点，要么像这次一样打印真实请求 URL 反查。

### 没有做但要知道的事

- **原生级别的真正取消依然没做**（v1.3.10/v1.3.11 都提过的同一个空白点，这次只是把"JS 侧至少会给反馈"这一半补上了）——如果以后还需要"原生那次 HTTP 请求本身也要被真正掐断"（比如为了省流量/服务端配额，而不只是"界面看起来已经停了"），需要往 `lib/main.dart` 加"根据 id 主动关闭某个在途 HttpClient"的支持，Android/Windows 两条桥接分支都要改。
- **"整批全部失败，一张都没成功"这种场景依然不会存进历史记录**：`saveGenerationProject()` 一开始就 `if (!sourceImages.length) return;`（`generateComic`/`generateCaptions` 外层也有 `if (completed > 0)` 才调用它的门槛），`saveHistory()` 自己还有一层"没有缩略图的记录直接被过滤掉"的逻辑（`getHistoryThumbnail(item)` 返回空字符串就会被 `.filter()` 挡在外面）。这次只确认并修好了"至少一张成功、其它失败"这种更常见的场景（元数据/参考图都能正常恢复），"一张都没成功"这种更极端的场景**没有触碰**——如果用户明确也需要这种情况可恢复，需要额外过三层gate（调用方的 `completed > 0`、`saveGenerationProject` 自己的空数组早退、`saveHistory` 的缩略图过滤），而且还要确认历史列表 UI 能不能正常渲染一条没有缩略图的项目卡片，这次没有验证过，不要假设已经支持。

用户在 v1.3.11 之后又提了一句"也加入取消生成功能"。排查发现 `beginGeneration()` 一直是把生成按钮**禁用**（`disabled = true`）并显示"生成中……"，生成过程中这个按钮完全点不动、没有任何办法主动打断整批生成——唯一能间接触发 `stopCurrentGeneration()` 的路径是切换模式、点"清空分镜"/"清空嵌字行"/"清空结果"，都是别的按钮的副作用，不是一个专门、显眼的"取消"入口。v1.3.11 刚给"单张卡片的自动重试"加了停止按钮，这次是把同样的"能主动喊停"能力补到"整批生成"这个更高的层级。

### 修法

1. **`beginGeneration()` 不再禁用按钮，而是把它切换成"取消生成"状态**：`dom.generateBtn.disabled` 保持 `false`，加上 `is-cancel` class，文字/图标换成 `setButtonText(dom.generateBtn, "x", "cancelGeneration")`（新增的 `cancelGeneration` i18n key，5 个语言都加了）。因为 `generateSingle()`/`generateComic()`/`generateCaptions()` 各自原来还有一行 `setIconText(dom.generateBtn, "spark", "生成中……")` 紧跟在 `beginGeneration()` 后面执行，会把这个新状态立刻覆盖掉，所以这三行**必须删掉**，让 `beginGeneration()` 集中管理按钮状态。
2. **点击处理改成先判断状态**：`dom.generateBtn` 的 click 监听器现在先检查 `classList.contains("is-cancel")`，是的话调用 `stopCurrentGeneration("已取消生成")` 并直接返回，不再进入 `generateSingle`/`generateComic`/`generateCaptions` 的分发逻辑。`stopCurrentGeneration()` 内部本来就会调 `resetGenerateButton()`，顺带处理了"取消后按钮变回正常状态"，这次只补了 `resetGenerateButton()` 里也要 `classList.remove("is-cancel")`。
3. **CSS**：`.btn-primary.is-cancel` 换成 `var(--error)` 背景+白字，去掉紫色的 `box-shadow`（不然红底配紫色光晕很奇怪）。
4. **顺带修的一个连带问题**：点"取消生成"（批量层面的 abort，跟 v1.3.11 那个"单张卡片自己的停止按钮"是两回事）之前，`generateSingle()`/`generateComic()`/`generateCaptions()` 的 catch 分支只在 `cardAbort.signal.aborted`（单卡自己点了停止）时才把卡片标成失败，**整批取消时这个条件是 false**，卡片会静默 return，永远停在转圈状态——以前"取消生成"这个动作本来就很少被直接触发（都是间接副作用，副作用发生时通常伴随清空整个结果区，卡片本身也被一并清掉了，所以这个 bug 一直没被注意到）。现在有了直接、显眼的取消按钮，这个问题必须一起修：三处 catch 分支都改成"只要是 AbortError 就标记失败"（区分文案：`cardAbort.signal.aborted` 时是"已手动停止重试"，否则是"已取消生成"），不再要求 `isGenerationCurrent(run)`；非 AbortError 的真实错误依然保留原来"只有 run 还是当前这一轮才标记失败"的判断。

### 没有做但要知道的事

- **`retryAllFailedResults()`（"全部失败重试"批量重试）没有加对应的取消按钮**——用户这次要求的是"生成"，不是"重试全部失败"，两者是不同的按钮/流程。如果以后用户也想要这个，需要单独确认范围再做，不要自作主张顺手加上。
- **"取消生成"是直接执行、没有二次确认弹窗**——跟 v1.3.11 单张卡片的"停止重试"按钮保持一致的交互风格（都是点了就直接生效，不追加确认对话框），不是漏做。

## v1.3.11：把 502/503/504/连接被断这类基础设施瞬时故障也纳入自动重试 + 每张卡片自己显示重试次数 + 每张卡片可以单独停止重试

v1.3.10 取消生图超时上限之后，用户很快反馈了两个后续真实场景，这版是对这两个反馈的回应，跟 v1.3.10 是同一条主线的延续。

### 用户反馈原文（按时间顺序）

1. `HTTP 504: <html><head><title>504 Gateway Time-out</title></head><body>...nginx/1.23.4...</body></html> 有时会出现这种情况` —— 供应商自己的反向代理（nginx）在生图请求排队较久时会主动返回 504，这不是我们这边的超时（v1.3.10 已经取消），是对方基础设施自己的网关超时。
2. 追问确认后得知用户想要的是：把"这是重试第几次"显示在**每张结果卡片自己身上**（而不是容易被其它并发卡片覆盖掉的全局状态栏），针对**自动重试**（不是手动点重试按钮那种）。
3. `要加入每个卡片停止重试的功能` —— 除了显示第几次重试，还要能针对某一张卡片单独喊停，不用等它耗尽重试次数、也不用把整批生成都停掉。
4. `HttpException: Connection closed before full header was received, uri = https://grsai.dakka.com.cn/v1/api/generate` —— 原生端 `dart:io HttpClient` 在连接被意外挂断时抛出的错误，跟 504 是同一类"基础设施临时抽风"，只是这次连响应头都没能吐出来，报错格式也完全不同（不是 `HTTP xxx` 这种规整的状态码错误，是 Dart 的 `HttpException` 字符串）。

### 修法

1. **`isTransientApiError()` 的可重试范围从"只有 400"扩到"400/502/503/504 + Connection closed"**：502 Bad Gateway、503 Service Unavailable、504 Gateway Time-out 是反向代理/网关层面的临时性错误，跟"请求本身有问题"（400 在这些供应商的生态里也经常被当成瞬时故障的报法，是既有观察）性质不同，重试通常就有机会成功。`HttpException: Connection closed ...`（原生 `dart:io HttpClient` 连接被中途挂断时抛的，不是一个规整的 HTTP 状态码错误）归到同一类，用 `/connection closed/i` 匹配。**500 依然故意排除在外**——通常意味着后端代码本身出错，重试大概率也不会成功，跟"基础设施临时抽风"不是一回事，`testRetryClearReloadAndI18n` 里专门留了一条用 500 做反例的断言防止以后被误扩大。`onRetry` 回调给用户看的状态文案也从写死的"返回 HTTP 400"改成动态提取实际状态码（正则 `HTTP\s*(\d{3})` 匹配不到时兜底显示"临时错误"，覆盖 Connection closed 这类没有状态码的情况）。5 个语言的 `retryHint` 提示文案（"失败重试次数"设置项旁边的说明）同步从"只有 HTTP 400 会自动重试"改成"只有部分临时性错误（HTTP 400/502/503/504）会自动重试"。
2. **每张结果卡片自己显示"第 N/M 次自动重试"**：新增 `updateCardRetryAttempt(card, {retryIndex, maxRetries, statusLabel})`，通过 `callImageAPI()` 新增的 `options.onRetryAttempt` 回调（跟原有的全局 `showStatus()` 调用并存，不是取代）从 `retryTransient()` 的 `onRetry` 一路传下来。`addResultPlaceholder()`（首次生成的占位卡片）和 `renderRetryLoading()`（手动点"重试"按钮时）的 loading 态 HTML 里都加了一个 `.retry-attempt-label`（默认 `hidden`，第一次重试发生时才显示文字并摘掉 `hidden`）。`generateSingle()`/`generateComic()`/`generateCaptions()`/`retryResultCard()` 四处 `callImageAPI()` 调用都传了这个回调，指向各自负责的那张卡片——四处都改是因为每种生成模式各自的任务闭包里都单独调用 `callImageAPI()`，不是一个共享的调用点。
3. **每张卡片可以单独停止重试**：loading 态 HTML 里同时加了一个 `.stop-card-retry` 按钮（复用已有的 `.ui-icon-x` 图标，不用新画），默认 `hidden`，第一次自动重试发生时跟着 `.retry-attempt-label` 一起显示出来（还没开始重试之前没有"停止重试"这个动作可言，所以首次尝试阶段不显示）。四个生成/重试入口各自给自己的卡片建一个独立的 `AbortController`（存在 `card._cardRetryAbortController` 上，`wireCardStopRetryButton(card)` 负责在按钮点击时调用它的 `.abort()`——因为每次重建卡片 innerHTML 都会连带丢弃旧的事件监听器，所以每次调用 `addResultPlaceholder()`/`renderRetryLoading()` 都要重新调一次这个绑定函数），跟批量生成整体的 `run.signal`（如果有）合并成一个统一的 signal 传给 `callImageAPI()`。新增 `combineSignals(signalA, signalB)` 手写实现"两个 signal 任一 abort 就整体 abort"（没有用更新浏览器才有的 `AbortSignal.any()`，避免给这个要兼容较旧 WebView2/PWA 场景的项目引入兼容性风险）。三处批量生成任务的 catch 分支都要能区分"是我自己这张卡片的停止按钮触发的 abort"（`cardAbort.signal.aborted === true`，此时要把这张卡片标记成失败、文案是"已手动停止重试"，正常计入 failed 计数）还是"整批生成被外层'停止生成'按钮或新一轮生成取代"（保留原来的静默返回，不动 DOM，这属于既有的、这次没有改动的行为）——`retryResultCard()` 因为本来就没有批量层面的 `run.signal`，逻辑更简单，直接判断是不是自己的 `cardAbort` 就行。

### 没有做但要知道的事

- **`.retry-attempt-label`/`.stop-card-retry` 只在"自动重试"（撞上 400/502/503/504/连接被断，`retryTransient()` 内部触发的重试）时出现，手动点"全部失败重试"或单张卡的"重试"按钮本身不会触发这两个元素显示**——除非那次手动重试自己又在内部撞上了需要自动重试的临时错误。这是用户明确要求的范围（"自动重试"，见上面澄清问题的回答），没有做成"任何重试场景都显示"。
- **`retryAllFailedResults()`（v1.3.10 加的批量重试进度条）没有额外改动**，但因为它内部就是循环调用 `retryResultCard()`，而 `retryResultCard()` 现在自己会建 `cardAbort` 并接进 `.stop-card-retry` 按钮，所以"重试全部失败"进行中，用户依然可以在某一张卡片上单独点停止——这是顺带获得的能力，不是专门为批量场景写的代码。
- **依然没有给 `nativeDownload.request()` 加原生层面的取消支持**（v1.3.10 就提到的同一个空白点）：点击"停止重试"目前只是让 JS 侧提前放弃等待这个请求的结果（`AbortController.abort()` 让 `fetch`/native bridge 的 promise 提前 reject），原生端如果是走 `nativeFetch`，那次已经发出去的 HTTP 请求本身在原生代码里并不会被真的取消掉，只是 JS 不再等它、也不会用它的结果——网络层面的连接/请求还会在后台跑到自然结束为止。这在浏览器 `fetch()` 场景下是真取消（`AbortController` 是 Fetch API 原生支持的机制），但在原生 WebView2/Android 桥接场景下只是"JS 端假装它已经结束了"。如果以后需要真正的原生级取消（比如为了省流量/省服务端配额），需要单独给 `nativeDownload.request()` 加"根据 id 主动砍断某个在途请求"的支持，见 v1.3.10 一节里同样提到的这个待办。
- **`isTransientApiError()` 的 `/connection closed/i` 匹配比较宽**，理论上会连带匹配到一些用户自定义错误消息里恰好包含"connection closed"字样但语义不同的场景（可能性很低，但不是零）。如果以后发现有请求因为这个正则被错误地重试了，需要把匹配条件收紧成更精确匹配 Dart `HttpException` 的措辞。
- 上面两个 502/503/504 相关的调整都无法在 `qa/regression-runner.js` 的普通浏览器环境里对着真实的 `dart:io HttpClient` 验证——`testRetryClearReloadAndI18n`/`testCardRetryAttemptDisplayAndStop` 里都是直接构造带有对应错误消息文本的 `Error` 对象来验证 `isTransientApiError()`/`retryTransient()`/卡片 UI 的行为，没有验证"真实网络环境下这些错误消息的格式跟测试里模拟的是否完全一致"。如果以后用户反馈类似场景没有被正确重试，第一步应该看 console 里打印的真实错误消息文本，跟这里假设的格式（`HTTP 504: ...`、`HttpException: Connection closed...`）比对一下是否有出入。

用户反馈两个连在一起的问题："现在显示的反而不是400 总是原生调用超时 取消调用时间设定 还有全部失败重试依然经常点不动 用不了"。排查后发现这两个症状同源，值得完整记录。**这版经历了一次中途修正**：最初判断是"5 分钟延长到 15 分钟"，用 `AskUserQuestion` 问推送确认时用户在"推送"/"先不推送"之外自己填了"不限时长"——明确否决了"延长但保留兜底"这个折中方案，要求真正做到没有时间上限。下面直接记录最终形态，不要照着"15 分钟"这个中间版本抄。

### 根因排查

先去读 `lib/main.dart` 的 `_nativeFetch()`（Android/Windows 共用同一份实现）：用的是 `dart:io` 的 `HttpClient`，只设置了 `connectionTimeout = 30 秒`——这只覆盖 TCP 建连阶段，请求发出之后到收到完整响应这整段过程，原生侧完全没有自己的超时。也就是说，`app.js` 里 `nativeDownload.request()` 的 JS 侧 `setTimeout` 是这条链路上**唯一**的超时保护，不是什么"双重保险"里多余的那一层。

`smartFetch()`（生图请求最终都会走到这里）在 v1.3.2 就已经把这个 JS 侧超时从默认 120 秒延长到 5 分钟，但用户这次反馈说明 5 分钟仍然不够——一部分模型/供应商的生成接口是同步阻塞到图片真正生成完成才返回（不是"提交任务拿 ID + 轮询"这种异步模式），排队繁忙时这一个 HTTP 调用本身正常运行超过 5 分钟是完全可能的，届时会被 JS 侧超时提前打断，表现为用户看到"原生功能调用超时（nativeFetch），请重试"，而不是真实的成功结果或者真实的 API 错误——这也解释了用户说的"现在显示的反而不是 400"：以前常见的失败模式是 API 返回 HTTP 400（这条路径有专门的"只重试 400"自动重试机制，见 `isTransientApiError()`/`retryTransient()`），现在情况变成请求本身在原生层被我们自己提前砍断，从来没等到服务器的真实响应。

"全部失败重试依然经常点不动 用不了"跟上面是同一个根因的另一个表现：`retryAllFailedResults()` 对每张失败卡片重新调用 `retryResultCard()` → `callImageAPI()` → 最终还是 `smartFetch()`，如果某几张卡片的重试又撞上原生超时，每一张都要先干等满整个超时时长才会失败结算，而这段时间里"全部失败重试"按钮除了显示一个从点击起就没再变过的"重试中 (N)"文字之外，没有任何进度反馈——button 被禁用很长时间、完全看不出还在正常工作还是已经卡死，体感自然是"点不动、用不了"（`retryAllFailedResults()` 本身在结构上不会真正死锁：`concurrentLimitSettled()` 内部每个任务都用 `.then/.catch` 包过，保证 `Promise.all` 一定会等到所有任务真正 settle 才返回——但取消超时之后，如果某张卡片的原生调用真的永久卡死，这个"总会 settle"的保证也就不再成立了，见下面"没有做但要知道的事"）。

### 修法

1. **`nativeDownload.request()` 支持 `timeoutMs === null` 表示"不设超时"**：原来的实现是 `setTimeout(fn, timeoutMs)` 无条件注册一个计时器，现在改成只有 `timeoutMs !== null` 时才注册。**这里有一个容易踩的坑，写进代码注释了**：不能用 `setTimeout(fn, Infinity)` 来表示"不超时"——`setTimeout` 的 delay 参数内部会被转成 32 位有符号整数，超过 `2^31-1` 毫秒（约 24.8 天）或者传 `Infinity`/`NaN` 会溢出，绝大多数引擎（包括 V8）不会真的"永不触发"，而是把它当成 0 或极小值处理，效果是"几乎立刻超时"，跟意图完全相反。"不设超时"必须是"压根不创建这个计时器"，不能靠传一个超大数字糊弄过去。
2. **`smartFetch()` 里两处 `nativeDownload.nativeFetchPayload(payload, ...)` 调用改成传 `null`**（不是某个具体数字）——生图请求现在真的没有 JS 侧强加的时间上限，能等多久算多久，符合用户"取消调用时间设定"的字面要求。
3. **`GRSAI_MAX_POLL_COUNT`/`GRSAI_POLL_INTERVAL_MS` 这套轮询次数上限整个删掉**：GrsAI"提交任务拿 ID + 轮询 `/v1/api/result`"这条异步路径原来有独立的轮询次数上限（本质上是同一类"生成时间上限"），改成 `while (true)` 无限轮询，只在拿到终态（succeeded/failed/violation）或者用户主动点"停止生成"（通过 `signal` 让 `sleep()`/`smartFetch()` 抛出）时才退出。这个循环本身很轻量（每 2 秒一次的状态查询，不是长期占用一个大请求），无限轮询的风险远小于原生 fetch 本身不设超时。
4. **`retryAllFailedResults()` 加上进度条反馈**：复用批量生成本来就有的 `#progressWrap`/`updateProgress(done, total, icon)`（`generateComic()`/`generateCaptions()` 早就在用这套 UI，只有"全部失败重试"这条路径没接），点击后立刻显示进度条并从 `0/N` 开始，每张卡片重试结算后（无论成功失败）递增 `done` 并刷新进度条，全部完成后维持"✅ N/N"3 秒再自动隐藏（跟批量生成结束后的隐藏节奏一致）。**取消超时之后这一条比之前更重要**：以前好歹每张卡片最多等 15 分钟就会失败结算，现在如果某张卡片的原生调用真的挂住，它会一直停留在"重试中"——进度条能让用户至少看清"是这一张没完成，其它的都好了"，而不是完全没有信息量的"按钮还是灰的"。

### 没有做但要知道的事（这版取舍的核心就在这里，务必读完）

- **没有给 `nativeDownload.request()` 加真正的取消（AbortSignal）支持**：`callImageAPI()`/`smartFetch()` 的调用链能接受 `signal`，但一旦请求已经交给原生层（`FlutterDownload.postMessage`），"停止生成"目前完全够不着它——只能等原生层自己 resolve/reject。**取消超时之后，这个空白点的后果比以前严重得多**：以前最多等 15 分钟就会有个（即使不准确的）结果；现在如果原生调用真的永久卡死（连接半开但既不来数据也不断开——理论上少见，但不能排除；WebView2/dart:io 这条链路上出现过好几个这类边缘 bug），会真的没有任何办法恢复那一个请求，唯一手段是重启应用。**这是用户在知道"5 分钟不够→15 分钟折中"这个方案后，仍然明确选择"不限时长"换来的结果**，不是没考虑到就莽撞做的。如果以后用户反馈"某次生成好像卡死了，怎么点都没反应"，第一步应该确认是不是这种真正的原生调用永久挂起（而不是恰好是一个很慢但仍在正常进行的请求），如果确认是，需要重新考虑给 `nativeDownload.request()` 加 id 级别的取消支持（Android/Windows 两条桥接路径都要改，`_nativeFetch()` 需要能"根据 id 主动砍断某个在途的 HttpClientRequest"）。
- **没有把原生超时错误纳入 `isTransientApiError()`/`retryTransient()` 的自动重试范围**：故意不做——这套机制认的是 HTTP 400/502/503/504（见"v1.3.11"一节），取消超时之后这条更加不该做：一次调用本身可能就等了很久才失败，再自动重试 N 次只会让单张图片失败前的等待时间成倍増加。
- **这个改动本身几乎无法在 `qa/regression-runner.js` 的 headless Edge 环境里做端到端验证**（"真实生成到底要不要超时"这件事没法在测试里等出来），但**取消超时的机制本身（`request()` 里 `timeoutMs === null` 分支）已经有专门的回归测试**：新增的 `testNativeDownloadTimeoutOptOut` 直接调用 `nativeDownload.nativeFetchPayload(..., null)`，用一个故意永不回调的 mock `FlutterDownload`，断言等待一段时间后 promise 依然处于 pending（没有被强行 reject），随后手动触发 `AiGenAndroidBridge.resolve` 确认它还能正常完成；同时验证传真实数字（比如 60ms）的调用依然会正常超时——证明"不设超时"只对生图这一条调用生效，没有连带弄坏其它调用（`chooseDir`/`saveFile` 等）原有的超时保护。这条测试用 `git stash` 双向验证过会在没有这个改动时真的失败（具体是变成一个未处理的 promise rejection，被 `cdp.assertNoRuntimeIssues()` 抓到）。

## v1.3.9：隐藏嵌字模式的全局分辨率选择器 + 修正一键填写的模板文字（v1.3.8 矫枉过正）

用户在体验完 v1.3.8 之后一次反馈了两个点：

1. **"嵌字模式，最终生成出的图肯定是按照要嵌字的图片来的，就不用加什么分辨率了"**——嵌字模式每一行的输出尺寸从 v1.3.5 起就已经是 `generateCaptions()` 内部自动取该行参考图自己的 `width x height`（取不到才兜底用全局尺寸），从来没有真正用过"全局分辨率"这个选择器的值，但 UI 上这个字段在嵌字模式下依然显示着，容易让用户误以为它有作用、去调它却什么都不会发生。**修法**：给这个 `<fieldset>` 加上 `id="globalSizeField"`，`dom` 里新增对应引用，`switchMode()` 里新增一行 `dom.globalSizeField.classList.toggle("hidden", isCaption)`，和已有的 `dom.referenceField`（嵌字模式同样隐藏全局参考图字段）用完全相同的模式——只在嵌字模式隐藏，单图/漫画模式不受影响。

2. **"一键填入应该是 给图片加入1的气泡字幕 给图片加入2的气泡字幕 类似这样"**——这是对 v1.3.8 的直接纠正。v1.3.8 把默认模板从"在图片右上角加一个白色对话气泡，文字是{n}"简化成裸的 `"{n}"`，理由是"样式交给全局提示词，这里只需要编号"，但用户实机用完发现太简略了：光一个数字，AI 根本不知道要干什么。用户举的例子说明真正想要的中间地带是——**保留一句完整的指令（明确告诉 AI"给这张图加气泡字幕"），但不重复限定样式/位置/颜色**（那些依然留给全局提示词描述）。**修法**（`getCaptionAutoFillText()`）：默认"编号气泡"模板从 `"{n}"` 改成 `"给图片加入{n}的气泡字幕"`，`{n}` 替换机制、确认覆盖流程、自定义模板输入流程均不受影响。

这两个改动都很小，但都属于"用户体验过上一版实际效果后给出的具体修正"，`qa/regression-runner.js` 里同步更新/新增了断言：`testCaptionAutoFill` 的默认模板断言从 `["1","2"]` 改成 `["给图片加入1的气泡字幕","给图片加入2的气泡字幕"]`；`testCaptionMode` 里新增了两条断言，直接读 `#globalSizeField` 的 `hidden` class，确认切到嵌字模式时它被隐藏、切回单图模式时它恢复可见（用 `git stash` 分别验证过两个新断言在改动前会真的失败、改动后才通过）。

## v1.3.8：一键填写的默认模板改成"只给编号，样式交给全局提示词"（⚠️ 这版的具体文字后来被证实太简略，v1.3.9 已修正，见上一节）

用户看完 v1.3.6 的"一键填写"功能后反馈："一键填入应该是 给图片加入N（数字1.2.3.N）的气泡字幕"。追问确认：概念上（每张图按行号加编号气泡）跟原来的理解一致，但**具体提示词内容需要调整**——用户会在"全局提示词"字段里自己描述气泡的位置/颜色/样式（并说明"气泡文字对应下面提供的编号"），所以"一键填写"生成的每行内容不应该再重复限定"白色对话气泡"/"右上角"这些样式细节，只需要提供这一行专属的、用来跟全局提示词呼应的编号本身。

**修改**（`app.js` 的 `getCaptionAutoFillText()`）：默认的"编号气泡"模板从 `"在图片右上角加一个白色对话气泡，文字是{n}"` 简化成裸的 `"{n}"`——每行的气泡文字就是这一行的编号，样式/位置完全交给用户自己写的全局提示词决定，不再由这个模板越俎代庖。自定义模板弹窗的默认示例文本也同步改成 `"{n}"`。

**这不是撤回 v1.3.6 的功能，只是调整默认模板的具体文字**——`{n}` 占位符替换机制、确认覆盖流程、自定义模板输入流程都没变，唯一变化是"编号气泡"这个内置模板具体渲染出来的文字。`qa/regression-runner.js` 里 `testCaptionAutoFill` 断言默认模板结果的地方同步改成 `["1", "2"]`。

## v1.3.7：v1.3.6 的行高修复根本没生效——真根因是 i18n 选择器写错了目标元素，而且是个潜伏了很久的老 bug

用户用了 v1.3.6 之后带截图反馈"左边问题还是没修复啊，嵌字列表大的离谱"。这一版排查出来的东西比表面看起来严重得多，值得完整记录。

### 排查过程

先怀疑是不是没升级到新版本，用户确认了版本号确实是 v1.3.6。然后怀疑是不是视口尺寸差异（用户是 2560×1369 的真实大屏，之前测试只用了 1280×900），headless Edge 里精确复现用户的分辨率+"图片还没上传，只有占位图标"这个空状态，行高依然正常显示 71px——**排除了尺寸差异这个假设**。

用户明确说"刚切换进去就这样"（还没上传任何图片）——这是关键线索，说明问题出在**零行**的状态，不在某一行的具体渲染上。测了 `#captionSection` 每个子元素的 `getBoundingClientRect()`，定位到真凶：`#captionUploadZone`（"点击或拖拽批量上传图片"那个提示区）本身高度是 **1303px**（正常应该是 118px），而且深入测发现：真正被撑高的其实是 `.upload-icon` 内部那个 `<span class="ui-icon ui-icon-image">`——它的 `textContent` 被写入了整句提示文字（约 35 个汉字），而这个 span 本身只有 `width:1.08em`（约 18px）的固定宽度、没有 `white-space:nowrap`，于是文字被迫逐字换行，35 个字堆出 1225px 高。

### 真根因：`span:last-child` 选择器语义理解错了

`applyCleanLanguage()` 里设置这个提示文案用的是：
```js
setText("#captionUploadZone span:last-child", ...)
```
`setText()` 内部是 `document.querySelector(selector)`（单数，只返回第一个匹配）。CSS 的 `:last-child` 伪类判断"是否是**它自己父元素**的最后一个子元素"，不是"选择器作用域内最后一个 span"。`#captionUploadZone` 的 DOM 结构是：
```html
<span class="upload-icon"><span class="ui-icon ui-icon-image"></span></span>  <!-- 第1个子元素 -->
<span>点击或拖拽批量上传图片...</span>                                           <!-- 第2个/最后一个子元素 -->
```
内层的 `<span class="ui-icon ui-icon-image">` 是 `.upload-icon` **自己**的唯一子元素，所以它**也满足** `:last-child`——而且它在文档顺序里排在真正的提示文字 span 前面（因为它嵌套在第一个子元素内部，深度优先遍历会先访问到它）。`querySelector` 返回的是第一个匹配，于是错误地选中了图标内部的 span，把整句提示文字写了进去。

**这不是 v1.3.5/v1.3.6 新引入的 bug，是复制了一个更早就存在的 bug**：全局参考图上传区（`#uploadZone`，从 v1.2.x 就有）用的是几乎一模一样的写法：
```js
setText(".image-upload .upload-zone span:last-child", ...)
```
结构也是同样的"图标 span 嵌套在外层 span 里，后面跟一个文字 span"，同样的选择器歧义**从这行代码写下的那一刻起就一直存在**，只是从来没人明确报告过（推测是因为单图模式的参考图字段不是页面上最显眼/用户盯着看的区域，或者恰好没人在非中文语言下仔细看过这个提示文案）。v1.3.5 加嵌字模式时照抄了这个模式，直接把潜伏的老 bug 也复制了一份。

**更严重的是：这个 bug 顺带让 v1.2.4 那次"修复"从来没有真正生效过**。v1.2.4 的既有结论是"确认 exe 端拖放上传参考图从未真正工作过，改成只在原生 Windows exe 里把提示文案从'点击或拖拽'改成'点击上传'"——但因为 `setText()` 一直在写错的元素（图标 span），真正的提示文字 span **从来没有被 `applyCleanLanguage()` 更新过**，从 v1.2.4 到 v1.3.6，打包后的 Windows exe 上这个提示文案其实一直显示的是 HTML 里硬编码的默认文字"点击或拖拽上传参考图（可多选）"——继续误导用户以为拖拽能用，而这正是 v1.2.4 想要修复但实际没修复成功的问题。**回归测试也被同一个 bug 骗过去了**：`testDragDropHintReflectsPlatform` 读取提示文字用的也是同一个有歧义的选择器，"写错元素"和"读错元素"两个 bug 刚好互相抵消，测试全程绿灯，却完全没有验证过真实可见的提示文字。

### 修复

选择器从 `span:last-child`（后代选择器）改成 `> span:last-child`（子代选择器），限定只匹配 `.upload-zone` **直接子元素**里的最后一个 span，不会再深入到 `.upload-icon` 内部去匹配那个图标 span。两处都改了：全局参考图上传区（`app.js` 里那行"潜伏很久的老 bug"）+ 嵌字模式的批量上传区。**同时修复了回归测试自己读取提示文字用的选择器**（`testDragDropHintReflectsPlatform` 内部两处），现在测试是真的在读正确的元素了。

新增 `testUploadZoneHintTargetsCorrectSpan` 专门验证这一类问题：断言两个上传区的高度都低于 200px（正常应该是 100 出头）、图标 span 自己的 `textContent` 必须是空字符串、真正的提示 span 必须包含看得懂的提示文字。**用 `git stash` 隔离验证过**：只 stash 掉 `app.js`，`testDragDropHintReflectsPlatform`（这次顺带也被我修好的老测试）会在还原的旧代码下失败（在原生 Windows exe 场景下，读到的文字里包含"拖"字，因为提示文字 span 从来没被更新过，仍是 HTML 默认值）——这也是一次很直接的证据，证明 v1.2.4 那次修复确实从来没有真正生效过。恢复 app.js 后全部 23 项检查通过。

### 教训（写进下面"关键事实"，这里再强调一次）

**CSS `:last-child`（以及 `:first-child`/`:nth-child` 等结构性伪类）永远是相对"它自己的父元素"判断的，不是相对某个选择器的"搜索范围"**。只要目标元素的兄弟节点里有嵌套结构（比如一个图标包一层 `<span>` 外壳），`elementA space elementB:last-child` 这种后代选择器就有很高概率意外命中嵌套在别处、恰好也是"自己父元素最后一个孩子"的无关元素。以后任何"选中某个容器里最后一个/第一个某类型子元素"的选择器，优先用 `>` 子代选择器限定层级，而不是依赖后代选择器 + 结构伪类的组合。

## v1.3.6：嵌字模式两个跟进反馈——行高压缩 + 一键填写

用户用过 v1.3.5 的嵌字模式后立刻反馈两点："嵌字参考图占得空间太大了"、"想要加入漫画分镜中一键填写功能"。两个都是对已上线功能的直接体验反馈，不是新的架构决策，所以没有走 Plan Mode，直接排查实现。

### 行高问题：真根因不是图片本身，是图片列的四元素纵向堆叠

**没有直接相信"参考图占得空间太大"这个字面描述**，而是先写了个 CDP 脚本量出每个元素的真实 computed size/`getBoundingClientRect()`，避免凭截图肉眼判断出错（这个项目吃过好几次"凭直觉判断 CSS 问题"的亏）。量出来发现：
1. 第一轮怀疑是 `.panel-text` textarea 继承了全局 `textarea{min-height:92px}`（本来是给主提示词大框用的）而不是漫画模式 `.panel-row textarea{min-height:52px!important}` 那个更紧凑的规则——因为嵌字行用的是 `<tr class="caption-row">`，不是 `<tr class="panel-row">`，选择器完全不命中。加了 `.caption-row textarea` 补上这条规则后，行高从 111px 降到 98px，只降了 13px，明显还有别的瓶颈。
2. 继续测量发现真正的瓶颈在"图片"列：v1.3.5 直接照抄了漫画模式那一套"按钮+缩略图+文件名+清除按钮"四个元素，在只有 56px 宽的列里横向放不下，全部纵向堆叠，四个元素堆起来将近 84px 高，比 52px 的文字框还高，是它在撑开整行到 98px。**这是漫画模式"参考图可选"的设计假设搬到"参考图必然存在"的嵌字模式后失效的一个具体例子**（上一节已经记录过一次同类教训——切换模式时自动建空行那个）。

**修法**：把"图片"列从四元素堆叠简化成单个可点击缩略图（`.caption-img-thumb`，44×44px，点击直接触发替换图片，文件名放到 `title` 属性做 hover 提示而不是常驻可见文字，去掉单独的"清除"按钮——反正删掉整行本来就有删除按钮）。行高最终降到 71px，接近漫画模式单行的高度。**这个简化只对嵌字模式生效**（`#captionTable .col-img` 宽度单独放宽到 64px，不影响漫画表格共用的 `.col-img{width:56px}` 基础规则）。

### 一键填写：完整复用漫画模式的机制，模板改成贴合嵌字场景的两个选项

漫画模式的"一键填写"（`AUTO_FILL_TEMPLATE_LABELS`/`getAutoFillPrompt`/`renderAutoFillTemplate`）本来就是通用的 `{n}`/`{ref}`/`{caption}` 占位符替换机制，`renderAutoFillTemplate()` 本身跟"分镜"毫无耦合，直接原样复用。新增 `CAPTION_AUTO_FILL_TEMPLATE_LABELS`（只有"编号气泡"+"自定义模板"两个选项，比漫画的 4 个选项精简——嵌字模式每行结构比分镜简单得多，不需要漫画那套"参考图数量对不上要不要扩展行数"的逻辑，因为嵌字模式的行数完全由批量上传决定）和 `getCaptionAutoFillText()`，UI 上镜像漫画的 `.tool-group-fill` 工具条（沿用同一批 CSS 类，只是新增了 `#captionAutoFillTemplate`/`#autoFillCaptionRows` 这套独立的 DOM 元素和 `customSelects` 注册）。

**顺带发现并补上两个 v1.3.5 遗留的 i18n 空档**：`setText()`/`setAttr()` 内部用的是 `querySelector`（单数，只改第一个匹配元素），不是 `querySelectorAll`。漫画的"一键填写"标签、"填入"按钮文案、`.col-img`/`.col-prompt` 表头翻译，用的都是不带 `#panelTable`/`#comicPanelSection` 前缀的裸类选择器（如 `.tool-group-fill .tool-label`、`.panel-table th.col-img`）——这类选择器永远只命中 DOM 里第一个匹配（漫画区块在嵌字区块前面），导致嵌字模式自己的同名元素从 v1.3.5 上线起就没有被 `applyCleanLanguage()` 翻译过，非中文语言下会一直显示硬编码的中文。这次顺手补上了 `#captionSection`/`#captionTable` 前缀限定的对应调用。**教训**：以后凡是新模式复用了跟已有模式相同的 CSS 类名，如果既有的 i18n 翻译调用是裸类选择器（没有用 ID/父级限定），要额外检查是否只命中了第一个模式，新模式那份需要单独补一行。

### 验证方式

- 新写了一个独立的 CDP "量尺寸"调试脚本（不是正式回归测试，纯本地排查用），直接量 `getComputedStyle`/`getBoundingClientRect()`，比对着截图肉眼数像素靠谱得多。
- `qa/regression-runner.js` 新增 `testCaptionAutoFill`：验证默认"编号气泡"模板正确代入行号、已有内容时点填入会弹确认覆盖对话框（用真实的 `.ask-dialog-overlay` 走一遍，不是猴子补丁绕过）、拒绝覆盖不改动内容、确认覆盖+自定义模板能正确代入。`testCaptionMode` 里引用旧版"文件名"元素（`.panel-img-name`）的地方也一并改成读新版缩略图按钮的 `title` 属性。
- `git stash` 隔离验证过：只 stash 掉 `app.js`/`index.html`/`style.css`，`testCaptionMode` 会在找不到 `.caption-img-thumb` 时崩溃报错，证明新测试真的绑定在新实现上；恢复后全部 22 项检查通过。
- 同样**没有做真机验证**，只有 headless Edge 截图+回归测试。

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

- 应用版本：`APP_VERSION = "1.3.16"`；`pubspec.yaml` 为 `1.3.16+40`
- 前端缓存/query：`index.html` 中 `20260706-1-3-16`；Service Worker cache：`ai-image-generator-1-3-16-20260706`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,3,16,40`/`"1.3.16"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致校验过）
- v1.2.3~v1.2.7、v1.2.9、v1.2.10、v1.3.0~v1.3.15 均已创建 GitHub Release；v1.2.8 只有 commit+CI 通过，没有 Release；**v1.3.16 截至本次交接是否已推送/发布取决于用户对推送的确认，见下方"下一步建议"**
- **设置里"软件更新"区块新增"安装目录"一行，只在原生 Windows exe 里可见（见"v1.3.16"一节）**——用户可以手动选择应用内更新要覆盖到哪个目录（默认跟随当前运行的 exe 位置，`_effectiveWindowsInstallDir()`），也可以"恢复自动"清掉手动选择。`document.body` 新增 `windows-native` class 专门控制这类"只对原生 Windows exe 有意义"的设置项显隐，不要跟安卓/Windows 共用的 `native-download`/`no-native-download` 搞混。
- **Windows 端应用内更新现在会显式传 `/DIR=<有效安装目录>` 给 Setup.exe（见"v1.3.15"/"v1.3.16"两节）**——`_downloadWindowsUpdate()` 调用 `_effectiveWindowsInstallDir()`（手动覆盖优先，没有则退回 `File(Platform.resolvedExecutable).parent.path`），不再依赖 Inno Setup 自己"沿用上次安装目录"的注册表探测（那条内置机制在某些情况下会静默失效，退回 `DefaultDirName={localappdata}`，导致用户装在别的盘时更新反而在 C 盘另起一份）。v1.3.15 的默认值逻辑没有自动化回归测试覆盖也没做过真机端到端验证；v1.3.16 新增的手动选择 UI 有 `qa/regression-runner.js` 的 `testWindowsInstallDirControl` 覆盖显隐/回填/点击流程，但同样没有真机端到端验证，见"已知未验证/延后事项"。
- **每张卡片的"取消"按钮从卡片一进入 loading 状态就可见，不是只有自动重试时才出现（见"v1.3.14"一节）**——用户明确要求"单张图片任何时候都能取消"，跟顶部批量"取消生成"按钮是两个独立、都要保留的入口。
- **`nativeDownload.request()`/`nativeFetchPayload()` 现在接受第四个参数 `signal`（见"v1.3.13"一节）**——`smartFetch()` 两处调用都会传自己的 `signal` 进去，这是让"停止重试"/"取消生成"点下去之后 JS 侧能立刻停止等待原生调用的关键；不要把这个参数删掉或者不传，删掉会让这两个按钮在原生调用进行中的时候重新变回"点了没反应"。
- **`openFileInputOnce()` 的防抖窗口是 400ms/500ms，不是 900ms/1200ms（见"v1.3.13"一节）**——旧值会把用户等了将近半秒之后的正常重试点击也吞掉，表现为"点击上传有时没反应"，不要因为"看起来更安全"就调大。
- **漫画模式的 `addPanelRow(prefilledRef)` 支持创建行时直接带上参考图（见"v1.3.13"一节，对应 `applyPanelRowImage(row, ref)` 辅助函数）**，跟嵌字模式 `addCaptionRow(prefilledRef)` 是同一个模式；`restoreHistoryProjectEditor()` 恢复项目时依赖这个能力把保存的参考图接回对应行，不要把这个参数去掉或者绕过 `applyPanelRowImage`/`applyCaptionRowImage` 直接操作 DOM。
- **`generateComic()`/`generateCaptions()` 保存项目时，`panels[]` 每一项都带 `references`（见"v1.3.13"一节）**——漫画模式存的是 `panel.references`（这一行自己的参考图），不是 `getPanelRequestReferences(panel)` 合并全局参考图池之后的那份，不要改错字段来源。
- **生成按钮在生成过程中会变成一个可点击的"取消生成"按钮，不再是禁用状态（见"v1.3.12"一节）**——`beginGeneration()` 里 `dom.generateBtn.disabled` 保持 `false`，加 `is-cancel` class + 换文字；点击处理器会先检查这个 class 再决定是取消还是开始新一轮生成。
- **生图相关的原生调用没有超时上限（见"v1.3.10"一节）**——`smartFetch()` 里两处 `nativeFetchPayload` 调用都传 `timeoutMs === null`；`GRSAI_MAX_POLL_COUNT` 这个轮询次数上限也整个删掉了，改成 `while(true)` 只在终态或用户主动停止时退出。这是用户在"5 分钟不够→延长到 15 分钟"这个折中方案之后，明确要求"不限时长"换来的最终形态，不要因为担心极端情况就自作主张往回加一个"看似安全"的数字上限——真要恢复某种上限，需要先跟用户确认。
- **`retryAllFailedResults()` 现在会显示 `#progressWrap` 进度条（见"v1.3.10"一节）**——不要删掉这段，删掉之后长时间的批量重试会重新变成"按钮禁用几分钟、毫无反馈"，用户已经反馈过这种体验等同于"点不动、用不了"。
- **`isTransientApiError()` 认的是 HTTP 400/502/503/504 + `HttpException: Connection closed...`（见"v1.3.11"一节），不是只有 400**——500 依然故意排除在外。
- **每张结果卡片在自动重试时会自己显示"第 N/M 次自动重试"（见"v1.3.11"一节）**——`.retry-attempt-label`，通过 `callImageAPI()` 的 `options.onRetryAttempt` 回调 + 每张卡片自己的 `card._cardRetryAbortController` 实现，**只有这个文字标签**才是"只在真正触发自动重试时才出现"；旁边的 `.stop-card-retry`（"取消"）按钮从 v1.3.14 起改成卡片一进入 loading 就可见，两者的可见性条件不再一样，别搞混。
- **嵌字模式"一键填写"的默认"编号气泡"模板是指令句 `"给图片加入{n}的气泡字幕"`（见"v1.3.9"一节，v1.3.8 曾短暂简化成裸 `{n}` 但被证实太简略）**，气泡样式/位置由用户自己在全局提示词里描述，不要再往这个内置模板里加回样式限定文字，但也不要再简化成裸编号。
- **嵌字模式下全局分辨率选择器（`#globalSizeField`）被隐藏（见"v1.3.9"一节）**——该模式每行输出尺寸恒定跟随该行参考图自身尺寸，全局分辨率选择器在这个模式下从来不生效，显示出来纯属误导。单图/漫画模式不受影响，仍然正常显示。
- **`applyCleanLanguage()` 里所有形如 `setText("... span:last-child", ...)` 的后代选择器已改成 `> span:last-child` 子代选择器（见"v1.3.7"一节）**——CSS 结构性伪类（`:last-child` 等）是相对自己父元素判断的，跟嵌套的图标 span 组合时极易选错元素，这是一个从 v1.2.x 就潜伏的老 bug，v1.3.7 才连带修复。
- `webview_windows` 依赖现在指向 `theblitzapp/flutter-webview-windows` fork 的 commit（见上面"v1.3.3"一节），不再是 `jnschulze` 官方仓库的 commit，也不再是 pub.dev 的 0.4.0
- 模型字段（`#model`）现在自己就是下拉触发器（见"v1.3.4"一节），原生 `<datalist id="modelList">` 和独立的 `#modelChoicesCustomSelect` 都已删除；`#modelChoices`（隐藏 `<select>`）仍然是数据状态源，没有变
- **新增第三个生成模式"嵌字模式"（`currentMode === "caption"`，见上面"v1.3.5"一节）**：批量上传图片、每张图自动生成一行、每行单独发一次生成请求（只带自己的图，不打包），气泡文字靠 AI 模型画上去。架构上大量复用漫画分镜模式的现有函数/机制，具体差异见"v1.3.5"一节的"刻意简化"部分。

## 已知未验证/延后事项

- v1.3.0 依赖切换后的 CI 构建已验证四端成功，但**没有真机 Windows exe 端到端验证**依赖切换本身是否解决了 IME 之外的其他潜在问题（比如是否真的不再需要 JS workaround，但目前没有移除 workaround 的计划，所以这不是阻塞项）。
- v1.2.10 的滚轮修复（overlay 扩展 + mousemove 追踪）已用"故意构造 target 和坐标都错、但真实 mousemove 位置对"的场景验证过，包括用 git stash 确认回归测试真的会失败/通过，但**仍然没有真机 Windows exe 用真实鼠标滚轮做端到端验证**。
- IME 候选框位置问题（上游 `#304`）**确认无解**，如果用户继续反馈，只需要确认"最终输入的文字是否正确进入了输入框"（如果连这个都不对，是完全不同性质的问题，需要重新排查）。
- v1.3.1 的 `chooseDir` 超时修复没有真机验证"用户真的在选择文件夹时超过 2 分钟"的场景，只是逻辑合理性上的修复。
- 漫画 folder-save 功能（v1.2.3）没有真机 Windows/Android 端到端验证。
- **v1.3.2 把 `nativeFetchPayload` 超时延长到 5 分钟，后来被 v1.3.10 证实不够用，最终干脆改成不设超时**（见"v1.3.10"一节，中途有一版"改成 15 分钟"的方案被用户明确否决，不要照抄）——用户实际使用后反馈频繁看到"原生功能调用超时"，说明确实有请求正常运行超过了 5 分钟。v1.3.10 取消超时之后，"原生功能调用超时"这条错误理论上不应该再出现；如果用户之后还是反馈同样的错误消息，说明代码里可能还有遗漏的地方在用旧的超时数值，需要重新 grep 一遍确认；如果反馈的是"某次生成好像永久卡住了"，那是取消超时的已知副作用被踩中了（见该节"没有做但要知道的事"），需要考虑给 `nativeDownload.request()` 加真正的 AbortSignal 取消支持，而不是重新加回一个超时数字。
- **v1.3.3 的 fork 依赖切换（`-32000` 偏移修复）没有真机验证"移动窗口后原位置桌面区域是否恢复可点击"这个用户实际报告的具体场景**——本机既没有 Visual Studio 工具链能本地编译验证，也没有条件手动复现"移动窗口/拖动到其它位置"。CI 的 Windows job 只能验证编译通过，不能验证运行时行为。**这是当前最高优先级的待验证项**，接手后第一件事应该是等 CI 出安装包，实机装上后手动移动窗口位置，确认原来窗口所在的桌面区域能不能正常点击图标/桌面元素了。如果验证后问题仍然存在，说明这次的诊断/修复也不对症，需要重新排查（比如可能不是 `SetSurfaceSize` 这一处硬编码坐标，插件里可能还有其它地方也用了类似的坐标逻辑）。
- **v1.3.3 依赖来源是 fork 而非官方仓库**，长期看有一定维护风险（fork 作者可能不再维护/删库），如果官方 PR #328 后续被合并发布，应该考虑切回官方来源，但要先验证官方发布的版本确实包含这个修复再切。
- v1.3.4 的参考图溢出修复、模型 combobox 改造都已经过 headless Edge 行为验证（回归测试 + 截图）和 `git stash` 隔离验证新测试真的会失败/通过，但**都没有真机 Windows exe 端到端验证**——尤其是模型 combobox，桌面/Android/PWA 三端的实际点击体验、以及原生 Windows exe 里点击输入框弹出列表的手感（会不会又踩到 webview_windows 的什么离屏渲染坑）都还没有真机确认过。
- **v1.3.5 的嵌字模式没有做过任何真机 Windows exe/Android 端到端验证**，只有 headless Edge 截图 + 回归测试。批量上传的拖拽交互在打包后的 exe 里理论上应该没问题（完全复用了 `isDragDropUnsupported()` 判断和同一套 CSS/HTML 结构），但没有实机确认过；实际生成效果（AI 是否真的能理解"在图片右上角加气泡文字"这类指令、气泡位置/样式是否符合预期）完全没有用真实 API 测试过，因为回归测试全程 mock 了 `window.fetch`。这是目前优先级最高的待验证项。
- v1.3.6 的行高压缩+一键填写同样只验证到 headless Edge 截图+回归测试这一层，没有真机确认过打包后 Windows exe 里 44px 缩略图按钮的点击手感、一键填写弹窗（确认覆盖/自定义模板）在离屏渲染下是否正常。
- **v1.3.7 的选择器修复已经用真实反馈的场景（用户截图+真实分辨率）在 headless Edge 里复现并验证修复有效**，比之前几版的"只是逻辑合理性上的修复"更扎实一些；但仍然没有在打包后的真实 Windows exe 里最终确认过（该做的浏览器端验证都做了，只是没有实机这一步）。
- **v1.3.10 取消生图超时这件事，"是否真的解决了用户遇到的问题"本质上无法在这台机器上真机验证**（需要真的等一个原本会撞上旧超时的慢生图请求跑完，本机没有条件触发这种慢请求；而"取消超时的机制本身有没有正确生效"已经有 `testNativeDownloadTimeoutOptOut` 自动化覆盖了，这两者是分开的）——**这是当前优先级最高的待验证项**：接手后如果用户能提供一个会导致长时间生成的具体场景（哪个模型、哪个供应商），应该主动找用户实测确认"原生功能调用超时"这条错误是否真的不再出现、以及"全部失败重试"点击后进度条是否符合预期。同时要留意用户是否反馈过"某次生成好像永久卡住了"——如果出现，说明取消超时的副作用（见"v1.3.10"一节"没有做但要知道的事"）被真的踩中了，需要考虑补上 AbortSignal 取消支持，而不是简单地把超时加回去。

- **v1.3.15/v1.3.16 的 Windows 更新安装路径功能都没有做过真机端到端验证**——本机没有条件复现"用户在自定义路径装好旧版本 → 触发应用内静默更新（或先在设置里手动选一个安装目录）→ 确认新版本原地覆盖、C 盘没有多出一份"这个完整链路。v1.3.15 的默认值逻辑只验证了 `flutter analyze` 干净、代码逻辑本身合理；v1.3.16 新增的手动选择 UI 多了 `testWindowsInstallDirControl` 用 mock 的原生桥接覆盖了显隐/回填/点击流程，但同样没有验证过"选中的目录最终真的被传进 Setup.exe 的 `/DIR=` 参数、安装器也真的听话装到那里"这个完整链路。**这是当前优先级最高的待验证项**：接手后如果用户能确认已经更新到这一版，应该主动问一句"这次更新之后，安装路径还是不是你自己选的那个（比如 F:\AI\picture\...），C 盘有没有又多出一份"，以及"设置里的'安装目录'那一行选择/恢复自动是否好用"，这是唯一能确认这两处修复真的解决问题的方式。

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
- **`nativeDownload` 的 `request()` 超时对于"用户节奏主导"或"后端本身就慢"的操作（选文件夹、下载大文件、生图请求/GrsAI 轮询）需要给足够长的超时**（选文件夹/下载 15 分钟；生图请求从 v1.3.10 起干脆不设上限，传 `timeoutMs === null`，见"v1.3.10"一节），不要用默认的 120 秒；错误消息也不应该硬编码平台名，这个函数在 Windows/Android 上是同一份代码。
- **Windows 端渲染原生 `Webview` 组件前，要防御"退化尺寸"（宽或高接近 0，典型场景是窗口最小化）**：webview_windows 是离屏渲染架构，给它一次退化尺寸的布局约束会损坏渲染表面、留下卡住的透明覆盖层挡住桌面（上游 `#262`/`#207`）。`_WindowsWebShellState` 已经用 `WidgetsBindingObserver.didChangeMetrics()` + `isDegenerateWindowSize()` 防住了这个场景，退化时换成 `SizedBox.shrink()` 而不是继续渲染 `Webview`。以后任何触碰这个 State 类的改动都要保留这套检测，不要因为"看起来没在用"就删掉。
- `lib/main.dart` 里 Android 和 Windows 走两条完全独立的 native bridge 分发路径，改 native bridge 参数/action 时两条都要检查、都要改。
- 这个代码库的 CSS 有反复出现的"重复声明"模式：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的。大改动后建议跑一次全文件选择器重复扫描。
- **给一个"目前只有一种调用方式"的共享函数（`saveGenerationProject`/`replacePlaceholder`/`getCurrentResultImages` 这类）新增第二种调用方（新模式）时，不要只看参数签名是否通用——要实际读函数体，确认没有偷偷硬编码写死第一种调用方的具体值**。v1.3.5 加嵌字模式时就在 `saveGenerationProject()` 里挖出这个真 bug：函数体内部硬编码了 `type:"comic-project", mode:"comic"`，直接无视传进去的 `project.type`/`project.mode`，只是因为之前唯一的调用方（`generateComic()`）传的值恰好和硬编码值一样，这个 bug 才从来没被触发过。同一类问题在 `replacePlaceholder()`/`getCurrentResultImages()`/`restoreHistoryItem()` 里也各挖出一处，全部是形如 `xxx.mode === "comic"` 的字面量判断，加新模式时都要搜一遍 `"comic"` 字符串逐个确认要不要加上新模式。
- **给漫画模式这类"多行批量生成"模式当参考实现新模式时，别把它的每个交互细节都当成必须照抄的规范**——v1.3.5 一开始照抄了漫画模式"切换模式时自动建一个空行"的逻辑，实测发现对于"批量上传驱动"的新模式（嵌字模式）体验很别扭（会先出现一个孤零零的空行）。跑一遍真实截图/交互过一遍，才发现这个细节不该照抄。复用别人的架构是对的，但要验证每个细节在新场景下是否真的合理，而不是不假思索全盘照搬。
- **`setText()`/`setAttr()`（`applyCleanLanguage()` 里最常用的两个 i18n 辅助函数）内部用的是 `querySelector`（单数），只改 DOM 里第一个匹配的元素，不是 `querySelectorAll`**。v1.3.5 加嵌字模式时复用了漫画模式的 CSS 类名（`.tool-group-fill .tool-label`、`.panel-table th.col-img` 等裸类选择器，没有 `#panelTable`/`#comicPanelSection` 这类父级限定），结果这些调用永远只命中漫画区块自己的元素（因为它在 DOM 里排在嵌字区块前面），嵌字模式的同名元素从上线起就没被翻译过，非中文语言下一直显示硬编码中文，直到 v1.3.6 排查一键填写功能时才顺带发现补上。**教训**：新模式如果复用了跟已有模式相同的 CSS 类名，先查一下现有的 i18n 调用是不是裸类选择器（没有 ID/父级限定）——如果是，新模式那份需要单独加一条带 ID 限定的调用，不能指望旧调用会"顺便"也翻译到新元素。
- **排查"UI 占用空间太大"这类视觉反馈时，先用 CDP 量 `getComputedStyle`/`getBoundingClientRect()` 的真实数值，不要只靠看截图猜哪个元素"看起来大"**。v1.3.6 排查嵌字行高问题时，第一轮只测了 textarea 高度，结果发现即使改对了 textarea，行高只降了一点点——继续测量才发现真正的瓶颈是"图片"列里四个元素（按钮/缩略图/文件名/清除按钮）在窄列里纵向堆叠，堆叠总高度才是真正撑开行高的原因，图片本身的像素尺寸其实一直没变过。这个方法论跟 v1.2.0 那次用 `elementFromPoint` 排查"按钮点不到"是同一类思路的延伸：用户的字面描述（"参考图占的空间"）不一定精确对应到具体是哪个 CSS 属性，先测量再下结论。**v1.3.7 是这个方法论更极端的一次验证**：用户反馈"v1.3.6 的修复根本没生效"，没有直接假设是自己上一版漏改了什么，而是重新测量+对照用户的真实分辨率+真实交互步骤（"刚切换进去就这样"这句话是关键，把排查范围从"某一行怎么渲染"收窄到"零行状态下哪个元素在撑高"），才挖到跟行高完全无关的另一个真根因。
- **CSS 结构性伪类（`:last-child`/`:first-child`/`:nth-child` 等）永远是相对"元素自己的父元素"判断的，不是相对某个选择器的整体"搜索范围"（v1.3.7）**。`container span:last-child` 这种后代选择器，只要 `container` 内部有嵌套结构（比如一个图标 `<span>` 套壳），非常容易在文档顺序更靠前的嵌套子元素里意外命中一个"恰好是它自己父元素最后一个孩子"的无关元素——这个代码库里 `.upload-icon` 包一层 `.ui-icon` 图标 span 就是典型例子，`upload-zone span:last-child` 选择器命中的是图标内部那个 span，不是后面真正的提示文字 span。这个 bug 从 `setText(".image-upload .upload-zone span:last-child", ...)` 这行代码第一次被写下（v1.2.x 某版）就一直潜伏着，`querySelector()` 一直在往错误的图标 span 里写整句提示文字，而且**连累了 v1.2.4"修复原生 exe 拖放提示文案"那次改动从来没有真正生效过**（真正的提示 span 从来没被 `applyCleanLanguage()` 更新过，一直显示 HTML 里硬编码的默认文字），回归测试 `testDragDropHintReflectsPlatform` 读取提示文字用的也是同一个有歧义的选择器，"写错元素"和"读错元素"两个 bug 刚好互相抵消，测试全程绿灯却完全没验证到真实可见的文字。v1.3.5 加嵌字模式时又照抄了一份同样的写法，最终在嵌字模式里因为文字更长、图标 span 更窄（`.caption-img-thumb` 场景），把这个本来"隐性"的 bug 撑成了肉眼可见的"整个上传区高达 1300px"。**修法**：把 `span:last-child` 改成 `> span:last-child`（子代选择器），限定只匹配容器的**直接子元素**，不会深入嵌套结构。以后任何"选中某容器里最后一个/第一个某类型子元素"的选择器，优先用 `>` 限定层级，不要依赖"后代选择器 + 结构伪类"的组合，尤其是当容器内有嵌套 DOM 结构时。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`。
- 不要把任何 `<select>` 改回原生渲染，7 个（含模型列表）已经全部是自绘 `.custom-select` 组件。
- 不要删掉滚轮+覆盖层管理这套机制（`initManualWheelScrollFix`/`installGlobalWheelScrollBridge`/`updateBodyScrollLock`/`resolveWheelEventStartElement`/mousemove 追踪），也不要把触发条件从 `isNativeWindowsWebview()` 改成无条件启用。
- 不要把 `webview_windows` 依赖改回 pub.dev 的 `^0.4.0`，也不要在没有先验证补丁确实存在的情况下改回 `jnschulze` 官方仓库（官方仓库截至 v1.3.3 还没合并 `-32000` 坐标偏移那个修复，见"v1.3.3"一节）。
- 不要把 `#sequentialToggle` 挪回 `#nImagesField` 里面；不要把 `#modelChoices` 改回常驻展开的按钮网格；不要删掉 `.custom-select-option` 的 `flex-shrink: 0`。
- 不要给 `.compact-reference-field .thumb-grid` 重新加 `max-height`/`overflow:auto`（v1.3.4 刚删掉，原因见上面新增的"嵌套滚动"教训）。
- 不要把模型字段（`#model`）改回"文本框 + 独立可见下拉框"两个控件的样子，也不要重新加回原生 `<datalist id="modelList">`——现在 `#model` 输入框本身就是下拉触发器（`initModelCombobox`），这是用户明确要求的交互方式（v1.3.4）。
- 不要把 `chooseDir` 的超时改回默认的 120 秒；不要给 `smartFetch()` 里两处 `nativeFetchPayload(payload, null)` 调用重新塞回一个具体的数字（不管是 5 分钟、15 分钟还是别的）——v1.3.10 的最终形态是彻底不设超时，`null` 是"不设超时"的信号，不是"待填的占位符"。同理不要把 GrsAI 那个 `while(true)` 轮询循环改回有次数上限的 `for` 循环。也不要在 `nativeDownload.request()` 里把 `if (timeoutMs !== null)` 这个判断删掉，或者试图用 `setTimeout(fn, Infinity)`/一个超大数字代替"跳过计时器"——`Infinity` 在 `setTimeout` 里会因为 32 位整数溢出被当成 0 处理，效果是几乎立刻超时，见该节代码注释。
- 不要删掉 `_WindowsWebShellState` 的 `WidgetsBindingObserver`/`didChangeMetrics()`/`isDegenerateWindowSize()` 退化尺寸检测，也不要让 `_buildBody()` 在退化尺寸时继续渲染真正的 `Webview`。
- 不要改 Windows 安装器的 AppId GUID；`[Run]` 不要加 `skipifsilent`；`[UninstallRun]` 的 taskkill 不要删；不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。
- 不要把嵌字模式（`generateCaptions()`）改成合并全局参考图池（`referenceImages`）到每行请求里——每行只发自己那一张图是这个功能存在的全部意义（避免 HTTP 413），不要为了"跟漫画模式保持一致"就加上合并逻辑。
- 不要给嵌字模式重新加回"切换模式时自动建一个空行"的逻辑（`switchMode()` 的 `isCaption` 分支里故意没有像漫画模式那样调 `addCaptionRow()`）——嵌字模式完全靠批量上传驱动，加回这个空行会导致批量上传的图片前面多出一个孤零零的空行，见"v1.3.5"一节。
- 不要在 `saveGenerationProject()`/`replacePlaceholder()`/`isHistoryProject()`/`restoreHistoryProjectEditor()`/`getCurrentResultImages()` 这些共享历史记录函数里把 `mode === "caption"` 的分支删掉、改回只认 `"comic"`。
- 不要把嵌字行的"图片"列改回漫画那种"按钮+缩略图+文件名+清除按钮"四元素堆叠布局——`.caption-img-thumb` 单个可点击缩略图是刻意简化的结果（见"v1.3.6"一节），改回去会重新撑大行高。
- 不要删掉 `applyCleanLanguage()` 里带 `#captionSection`/`#captionTable` 前缀限定的那几行 `setText()`/`setAttr()` 调用（一键填写标签、填入按钮、表头翻译）——它们看起来像是跟漫画模式那几行"重复"，实际上是必需的，因为 `setText()` 只改第一个匹配元素，删掉嵌字这份会导致非中文语言下嵌字模式的这些文案又变回硬编码中文。
- 不要把 `.image-upload .upload-zone > span:last-child`/`#captionUploadZone > span:last-child` 这两处选择器里的 `>` 子代组合符删掉、改回裸的后代选择器 `span:last-child`——删掉会重新导致提示文字被写进图标 span 里，整个上传区高度炸到 1000px+（见"v1.3.7"一节）。以后新增任何"容器内有嵌套图标结构 + 找最后一个/第一个子元素"的选择器，都要用 `>` 限定层级，不要用裸的结构伪类。
- 不要把嵌字模式"一键填写"默认的"编号气泡"模板改成带样式限定的文字（比如"白色对话气泡"/"右上角"这类），也不要改回 v1.3.8 那个裸 `{n}`（试过，用户反馈太简略、AI 看不懂该干什么）——正确形态是一句不含样式的指令句 `"给图片加入{n}的气泡字幕"`：既要让 AI 明确知道"要加气泡字幕"，又不重复限定位置/颜色/样式，这些交给用户自己在全局提示词里描述（见"v1.3.9"一节）。
- 不要从 `retryAllFailedResults()` 里删掉 `dom.progressWrap`/`updateProgress()` 调用改回纯按钮文字反馈——生图请求不设超时之后，批量重试可能要等很久（甚至理论上无限久），没有进度条会重新变成用户反馈过的"点不动、用不了"体验（见"v1.3.10"一节）。
- 不要把原生超时错误（`"原生功能调用超时（xxx），请重试"`）加进 `isTransientApiError()`/`retryTransient()` 的自动重试范围——故意不做，那套机制认的是 HTTP 400/502/503/504（见"v1.3.11"一节），不是"任何失败都重试"；何况生图请求现在已经不设超时，这条错误理论上不会再从这条路径出现了（见"v1.3.10"一节"没有做但要知道的事"）。
- 不要把 `isTransientApiError()` 的正则改回只匹配 `HTTP\s*400\b`，也不要扩大到匹配 HTTP 500——500 是刻意排除在外的（通常是后端代码本身出错，重试大概率不会成功），可重试的是 400/502/503/504 加上 `HttpException: Connection closed...`（原生 `dart:io HttpClient` 连接被中途挂断时抛的，不是规整的 HTTP 状态码错误，见"v1.3.11"一节）。
- 不要删掉 `addResultPlaceholder()`/`renderRetryLoading()` 里的 `.retry-attempt-label`/`.stop-card-retry` 元素，也不要删掉 `callImageAPI()` 的 `options.onRetryAttempt` 回调或四处生成/重试入口给每张卡片建的 `card._cardRetryAbortController`（见"v1.3.11"一节）——这是用户明确要求的"每张卡片自己显示第几次重试 + 能单独停止这张卡片的重试"。
- 不要用 `AbortSignal.any()` 替换 `combineSignals()` 这个手写的信号合并函数——项目要兼容较旧的 WebView2/PWA 场景，`AbortSignal.any()` 是较新的浏览器 API，没有必要为了少写几行代码引入兼容性风险（见"v1.3.11"一节）。
- 不要把 `beginGeneration()` 里的按钮状态改回 `dom.generateBtn.disabled = true`——生成过程中按钮必须保持可点击并显示"取消生成"，这是用户明确要求的功能，禁用按钮等于把"取消生成"这个能力删掉（见"v1.3.12"一节）。
- 不要把 `generateSingle()`/`generateComic()`/`generateCaptions()` 三处 catch 分支里"只要是 AbortError 就标记卡片失败"的逻辑改回"只有 `isGenerationCurrent(run)` 才标记"——改回去会导致点"取消生成"之后，正在进行中的卡片永远停在转圈状态，不会显示"已取消生成"（见"v1.3.12"一节）。
- 不要把 `nativeDownload.request()`/`nativeFetchPayload()` 的 `signal` 参数删掉，也不要在 `smartFetch()` 调用 `nativeFetchPayload` 时漏传这个参数——这是"停止重试"/"取消生成"在原生调用进行中时唯一能让 JS 侧立刻停止等待的机制，删掉会导致这两个按钮在真机上重新变回"点了没反应"（真实用户报告过这个问题，见"v1.3.13"一节）。
- 不要把 `openFileInputOnce()` 的锁定窗口从 400ms/500ms 调大回 900ms/1200ms 或更长——旧值会把用户等了将近半秒之后的正常重试点击也吞掉（见"v1.3.13"一节，真实用户报告过"点击上传有时没反应"）。
- 不要给 `addResultPlaceholder()`/`renderRetryLoading()` 里的 `.stop-card-retry` 按钮重新加回初始 `hidden` class，也不要让它的可见性重新依赖 `updateCardRetryAttempt()`——用户明确要求"单张图片任何时候（包括首次生成、还没失败过）都能取消"，这个按钮必须从卡片一进入 loading 状态就可见（见"v1.3.14"一节）。只有旁边的 `.retry-attempt-label` 才应该保持"只在真正触发自动重试时才出现"。
- 不要把 `.stop-card-retry` 的按钮文案（i18n key `stopCardRetry`）改回"停止重试"这类只适用于重试场景的措辞——这个按钮现在同时覆盖"取消首次生成"和"停止自动重试"两种场景，5 个语言都要用通用的"取消"/"Cancel"（见"v1.3.14"一节）。
- 不要把漫画模式 `addPanelRow()`/嵌字模式 `addCaptionRow()` 的 `prefilledRef` 参数去掉，也不要绕过 `applyPanelRowImage()`/`applyCaptionRowImage()` 直接操作行内 DOM 来设置参考图——`restoreHistoryProjectEditor()` 依赖这套机制把恢复项目时保存的参考图接回对应行（见"v1.3.13"一节）。
- 不要把 `generateComic()`/`generateCaptions()` 保存项目时 `panels[]` 里的 `references` 字段删掉，也不要把漫画模式那处改成存 `getPanelRequestReferences(panel)`（合并了全局参考图池的那份）而不是 `panel.references`（这一行自己的参考图）——存错字段来源会导致恢复项目时把全局参考图误接到某一个分镜行上（见"v1.3.13"一节）。

- 不要把 `_downloadWindowsUpdate()` 里的 `/DIR=$installDir` 参数删掉、也不要改回"什么都不传，指望 Inno Setup 自己探测上次安装目录"——那条内置探测机制依赖注册表记录，会在某些情况下静默失效并退回 `DefaultDirName`（C 盘），这正是 v1.3.15 要修的问题；`installDir` 必须继续来自 `_effectiveWindowsInstallDir()`（见"v1.3.15"/"v1.3.16"两节），不要写死成某个固定路径。
- 不要把 `_effectiveWindowsInstallDir()` 改回直接返回 `File(Platform.resolvedExecutable).parent.path`，跳过 `_windowsInstallDirOverride()` 的检查——用户明确要求能手动选择更新覆盖到别的位置（比如同时装了好几份，想专门更新没在跑的那份），删掉覆盖检查会让 v1.3.16 新增的"安装目录"设置行变成摆设（见"v1.3.16"一节）。
- 不要把 `#installDirRow`/`#installDirHint` 的显隐判断从 `isNativeWindowsWebview()` 改成复用 `native-download`/`no-native-download`——安装目录这个概念只对原生 Windows exe 有意义，安卓和浏览器/PWA 都不该看到这一行，这是专门新增 `windows-native` body class 的原因（见"v1.3.16"一节）。

## 下一步建议

- **最优先**：找用户确认 v1.3.15/v1.3.16 的更新安装路径功能是否真的好用——(1) 不手动干预时，更新是不是原地覆盖在用户自己选的路径（比如 F:\AI\picture\AI Image Generator），C 盘 `%LOCALAPPDATA%\AI Image Generator` 有没有又多出一份；(2) 设置里"软件更新"区块新增的"安装目录"这一行，选择目录/恢复自动是否符合预期，手动选完之后触发的更新是否真的装到了选的那个目录。这两处都没有做过真机端到端验证，是当前最需要用户实测反馈的一项。
- 找用户确认 v1.3.14 是否准确理解了"取消生成"的诉求——(1) 单张图片在首次生成过程中（还没失败过）点卡片自己的"取消"按钮是否能立刻取消；(2) 顶部批量"取消生成"红色按钮是否还保留、还正常工作；(3) 按钮文案改成"取消"之后，含义是否清楚（会不会被误以为跟顶部批量按钮是同一个东西）。
- 找用户确认 v1.3.13 的三处修复是否解决了实际报告的问题——(1) 嵌字模式批量上传区现在是否还会"点了没反应"；(2) 卡片上的"取消"按钮点下去之后是否会立刻有反应（不再需要等原生调用自己结束）；(3) 恢复漫画/嵌字项目之后，每一行是否正确带回了自己的参考图缩略图（包括失败的那些行）。
- 找用户确认 v1.3.12 的"取消生成"按钮是否符合预期——点击后是否立刻停止、正在生成中的卡片是否正确显示"已取消生成"（而不是停在转圈状态）、取消之后再次点击是否能正常开始新一轮生成。
- 找用户确认 v1.3.11 的三处修复是否解决了实际报告的问题——(1) 之前遇到的 504/连接被断这类错误现在是否会自动重试而不是直接判失败；(2) 自动重试发生时卡片自己是否显示了"第 N/M 次自动重试"；(3) 点卡片上的"取消"按钮（v1.3.11 时叫"停止重试"，v1.3.14 改了文案，按钮和机制是同一个）是否真的能单独喊停这一张、不影响其它卡片。如果用户反馈还有其它格式的"临时性错误"没被识别成可重试（比如某种别的错误消息格式），需要看 console 里真实的错误文本，把对应的匹配规则加进 `isTransientApiError()`（见"v1.3.11"一节末尾"没有做但要知道的事"）。
- 找用户确认 v1.3.10 的取消超时修复是否真的解决了"总是原生调用超时"——**v1.3.13 已经给 `nativeDownload.request()` 加上了 AbortSignal 支持**（之前这里写的"需要考虑加"已经做完了），如果用户反馈"某次生成好像永久卡住、点停止也没用"，说明还有别的地方需要补，不要假设这条已经万无一失。
- 同样重要：找用户用真实 API Key 实机测试嵌字模式完整流程（v1.3.5~v1.3.9）——在"全局提示词"里描述气泡的位置/颜色/样式并说明"文字对应下面的编号"，批量上传图片后点"一键填写"代入"给图片加入N的气泡字幕"这句指令，点生成，看 AI 是否真的能正确理解"全局提示词描述样式 + 每行指令句提供编号"这套组合指令、生成效果是否可用。这是本次会话里唯一完全没有用真实 API 验证过的功能（回归测试全程 mock 了网络请求，只验证了"发了几次请求、每次带几张图、历史记录存没存对"，没有验证"AI 生成的图好不好看"）。如果效果不理想，需要跟用户一起打磨全局提示词的写法示例，或者考虑是否需要在嵌字区块加一个"全局提示词示例/模板"的提示。
- 找用户确认 v1.3.7 的选择器修复是否真的解决了"嵌字列表大的离谱"这个问题，以及全局参考图上传区在非中文语言/打包后 Windows exe 里的提示文案是否正确显示"点击上传"（而不是从 v1.2.4 起就没真正生效过的"点击或拖拽"）。
- 找用户确认 v1.3.3 的 fork 依赖切换（`-32000` 坐标偏移）是否真的解决了"移动窗口后原位置桌面区域点不了"的问题——这是该修复完全没有真机验证过的部分（本机无 VS 工具链、也没有条件手动复现）。如果用户反馈问题依旧，说明诊断/修复不对症，需要重新去查 `windows/webview.cc` 里是否还有其它地方也用了类似的硬编码屏幕坐标逻辑。
- 找用户确认 v1.3.4 的两个修复（参考图溢出、模型 combobox）真机体验是否符合预期，尤其是模型输入框点击弹出列表这个新交互在打包后的 Windows exe 里手感如何。
- 找用户确认 IME 候选框位置问题（无解，已如实告知）是否影响实际打字体验（文字最终是否正确进入输入框）。
- 找用户确认 v1.3.1 的 chooseDir 超时修复在真机上表现是否符合预期（v1.3.2 的 nativeFetch 超时延长已经被 v1.3.10 取代，见上面"最优先"一条，不用再单独确认 v1.3.2 那版的数值）。
- **有两件事用户明确要求"先说清楚需求再动手"，v1.3.5 没有包含，需要接手后继续跟进澄清**：
  1. 更新提醒不够醒目——已经查明启动时的全屏确认弹窗逻辑本身没问题（`checkForUpdatesOnLaunch`，只要 GitHub 有更新的 Release 就会弹），用户之前没看到纯粹是因为当时确实没有比 v1.3.1 更新的 Release，v1.3.3 发布后这个问题可能已经自然消失，需要用户确认重新启动后是否看到了弹窗。
  2. 用户对更新提醒还提过"想要更持久的提示"这个方向（不只是启动一次性弹窗），具体想要什么形式（常驻顶部横幅？设置里的红点？）还没问清楚。
- 用户此前有一条尚未处理的陈述："还有图片其实已经缓存在本地，默认保存在setup安装的outputs里面，用户也可自行在软件内保存图片和压缩包到其它路径"——意图不明确（是要确认现状、报 bug、还是要求新功能？），至今没有回头处理。接手后如果用户没有主动重提，不要臆测着直接改代码，应该先追问清楚具体诉求。
- 如果条件允许，找一台真实 Android 设备和一台干净 Windows 机器（最好有多显示器/能实际移动窗口测试）做一次全功能端到端验证。
