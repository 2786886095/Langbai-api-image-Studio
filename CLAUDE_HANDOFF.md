# Claude Handoff: AI 图片生成器 v1.2.1

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.1`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.2.0 及更早的发布过程已经过期，不要按旧步骤操作。

## v1.2.1：启动时自动检测更新 + 一个未解决的排查

用户要求"如果更新要在刚进软件直接弹出，选择是否更新"。已实现：`app.js` 末尾 `setTimeout(() => { void checkForUpdatesOnLaunch(); }, 1200);`，启动 1.2 秒后静默调用 `checkForUpdates({silent:true})`，如果 `isNewer` 就用 `askConfirm()` 弹窗问"发现新版本 vX.X.X / 是否立即更新？"，确定则 `downloadLatestUpdate(true)`。新增 i18n key `updateNowPrompt`（5 语言）。回归测试 `testStartupUpdatePrompt` 用 `Page.addScriptToEvaluateOnNewDocument` 在导航前注入 mock（这是关键：`window.fetch` 之类的 mock 必须在 `loadFresh()` 触发的整页导航**之前**用这个 CDP 方法注入，导航后旧页面上下文里设的变量会全部丢失，直接在 `cdp.eval` 里设 `window.xxx = ...` 然后指望它在下次 `loadFresh` 导航后还在是不行的——这个坑在写测试时踩过一次）。

**同一轮里排查但没解决的问题**：用户反馈"设置里无法滑动，而且...还有api配置的各种列表都无法打开"。排查过程：
1. 一开始怀疑是 v1.2.0 修的那个"内部滚动裁切按钮"同类 bug 在别处重现，扫了全部 `overflow`+`max-height` CSS 组合，没找到明显的第二处同类问题。
2. 用 CDP 对 `#settingsModal .modal-card` 做真实的 `Input.dispatchMouseEvent` type=mouseWheel 测试，8 种视口尺寸下滚动都正常工作。
3. 用 CDP 测试"保存配置"→模型检测列表的完整流程，第一轮测试因为脚本没有正确响应 `askPrompt()` 弹窗（点了"保存配置"按钮但没有输入名字/点确定就直接测下一步），导致弹窗一直卡在页面上、挡住了所有后续点击——一度以为找到了真 bug，后来发现是自己测试脚本的问题：正确走完"点保存→弹出命名框→输入名字→点确定"全流程后，保存和模型列表点击选择都完全正常。
4. **有价值的副产品发现**：`openAskDialog()`（`askConfirm`/`askPrompt` 的实现）弹出的 `.ask-dialog-overlay` 是 `position:fixed; z-index:1200` 的全屏遮罩，如果这个弹窗因为任何原因没有被正常关闭（不确定什么场景会导致这个），它会挡住页面上所有元素的点击和滚动，表现上会很像"整个界面卡住了"——这可能是用户遇到的真实原因，但没能找到具体触发条件。
5. 最终结论：核心功能代码本身验证是对的，问题要么是没被复现到的边缘情况，要么是 WebView2 环境特有的行为（本机只能用 headless Edge 测试，无法真机验证 WebView2 渲染差异）。已经跟用户要更多复现信息（截图或具体操作步骤）。

**如果用户后续提供了截图/复现步骤，优先检查**：
- 触发问题前用户具体点了什么——尤其是有没有点过任何会弹出 `askConfirm`/`askPrompt` 的按钮（这个代码库里一共 11 处调用，不只是"保存配置"，还包括保存尺寸名字、编辑分镜提示词、自定义模板等）
- 如果能确认是 `.ask-dialog-overlay` 卡住，检查该弹窗的 OK/Cancel 按钮点击区域在实际视口尺寸下是否被裁切/移出可视区域（不同于本次验证用的 1366×768 等常见尺寸）
- 复现时同时用 `document.querySelectorAll(".ask-dialog-overlay").length` 检查是否有多个遗留的弹窗遮罩叠在一起（比如快速连续点击触发弹窗的按钮，是否可能创建多个 overlay 实例）

**版本号说明**：v1.0.11 → v1.2.0 是用户明确指定的跳跃（原话"修复好后上传1.2.0版本"），不是常规的 +0.0.1 递增，也不代表中间有跳过的版本存在。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来，不要擅自改成"更合理"的递增值。

当前核心状态：

- 应用版本：`APP_VERSION = "1.2.1"`
- Flutter 版本：`pubspec.yaml` 为 `1.2.1+14`
- 前端缓存/query：`index.html` 中 `20260703-1-2-1`
- Service Worker cache：`ai-image-generator-1-2-1-20260703`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,2,1,14`/`"1.2.1"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- 本轮已 commit（`11f4731`）、已 push、CI 四端构建通过、已创建 GitHub Release v1.2.1

## v1.2.0：API 配置"保存配置"按钮被遮挡问题

用户提供截图反馈："左上角api根本无法正常选择，有按键明显被遮挡在下面，我需要的三个配置是官方，grasi，自定义（可保存）"。

**排查过程**（值得记录，因为这类"看截图猜 CSS bug"的问题容易走弯路）：
1. 先用 CDP 在真实浏览器里对 `#apiProvider`（API 类型下拉）做逐点 hit-test，发现下拉本身在展开配置面板后完全可以正常点击选中——**这不是下拉选不了的问题**。官方/GrsAI/自定义三个 `<option>` 一直都在（`index.html` 的 `#apiProvider`），切换后端点自动填充的逻辑也一直是对的。
2. 重新盯着用户截图看，注意到截图里配置面板到"浏览器 CORS 转发地址"输入框就断了，`saveConfig`（"保存配置"）按钮完全没出现——而按 HTML 结构它应该紧跟在 CORS 字段后面。
3. 查 CSS 发现 `.config-section[open] .config-body` 有独立的 `max-height: min(520px, calc(100vh - 260px)); overflow-y: auto;`（桌面端和 `max-width:980px` 移动端媒体查询里各有一份，逻辑一样）。GrsAI 字段集比较长，内容一旦超出这个内部滚动区域的高度，"保存配置"按钮就会被推到这个**独立于外层面板的内部滚动区域**之外，只剩一条圆角边框叠在下方"单图模式"标签上——这正是用户说的"按键明显被遮挡在下面"。
4. 在 8 种视口尺寸（1024×768 到 1920×1080，含短窗口/窄窗口）下用脚本复现，全部命中同一个问题，确认不是某个特定分辨率的边缘情况，是普遍性 bug。

**修复**：直接删掉这层内部滚动限制（`style.css` 两处，桌面端 unconditional 规则 + `max-width:980px` 媒体查询里那份），让配置面板内容自然融入外层 `.input-panel`（桌面）或整个页面（移动端，这两处本来就有自己的滚动）。不再有"滚动容器里嵌套另一个滚动容器"的问题。同时更新了 `qa/regression-runner.js` 里的 `testApiConfig` 测试——之前的断言是 `assertQa(mobile.body.overflowY === "auto" && ...)`，字面意思是"验证内部滚动确实存在"，这其实是在给这个 bug 兜底/加固；现在改成断言"内部滚动容器不应该存在，且保存按钮能通过外层正常滚动到达并点击"。

**这类问题的通用排查方法，记下来供以后复用**：用户报"按钮被遮挡/点不了"这类视觉 bug 时，先用 CDP 跑一个独立脚本（不是改现有回归测试）：`document.elementFromPoint(cx, cy)` 在目标元素的中心点+四角做 hit-test，对比返回的元素是不是目标元素本身或其后代——这能直接、确定性地判断"看起来在那但点了没反应"是不是被别的元素挡住了，比纯靠看截图猜测靠谱得多。这次这个 bug 最后证明不是"元素被别的元素挡住"（我最初的假设），而是"元素被自己的滚动容器裁掉了、根本没渲染到那个位置"——两种表现在截图上很像，但排查思路不完全一样，遇到类似反馈时两种可能性都要考虑。

## Windows 安装体验（v1.0.9-v1.0.11，仍然有效，未改动）

Windows 分发方式是 Inno Setup 编译的 `AI-Image-Generator-Setup.exe`（不是 ZIP）。关键事实：

- **`AppId={{83D775F4-F8FD-418B-B3AF-5C4397ABF5E0}`（`windows/installer/setup.iss`）永远不要改**，这是 Inno Setup 判断"升级 vs 全新安装"的唯一依据，改了老用户升级会被当成装了个新软件。
- `[Run]` 里"安装后启动"的条目不要加 `skipifsilent`，否则静默自动更新时应用不会自动重启。
- `[UninstallRun]` 里的 `taskkill` 兜底不要删，删了会重新出现"装完不手动关程序直接卸载导致文件残留"的问题。
- `DisableDirPage` 不要加回去，用户明确要求能自己选安装路径。
- 本机没有 Visual Studio，但装了 Inno Setup（`choco install innosetup -y`，`ISCC.exe` 在 `C:\Program Files (x86)\Inno Setup 6\`），可以独立在本机测试安装器编译+安装+升级+卸载全流程，不需要等 CI。
- 详细背景见 git log 里 v1.0.9/v1.0.10/v1.0.11 三次提交的完整 commit message，或问用户要更早版本的 handoff 记录。

## 更早的关键产品决策（仍然有效）

- **v1.0.7**：安卓端"检查/安装更新"跳转 GitHub 发布页而非应用内下载覆盖安装，用户明确要求，不要改回去。
- **v1.0.6 audit2**：GrsAI provider 路由必须按用户选择的 provider 严格路由，不能按 URL 域名嗅探。

## 验证记录（本轮全部亲自执行）

- 用 CDP 独立脚本在 8 种视口尺寸下复现问题、验证修复，见上文排查过程
- `node --check app.js` / `node --check qa\regression-runner.js`：通过
- `node qa\regression-runner.js`：连续 3 次全绿（含更新后的 API 配置面板测试）
- `flutter analyze`：`No issues found!`
- `flutter test`：7 个测试全部通过
- GitHub Actions `Build all platforms`（run `28633164781`）：4 个 job 全部成功，约 4m7s
- 下载 CI 产物解包验证：四端 `app.js` 均为 `APP_VERSION = "1.2.0"`；确认产物内 `style.css` 已不含导致问题的旧 `max-height` 规则；Android APK 签名 SHA1 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`
- GitHub Release v1.2.0 已创建，附 4 个平台包 + `SHA256SUMS.txt`

### v1.2.1 验证记录

- `node --check app.js` / `node qa\regression-runner.js` ×3 全绿（含新增的 `testStartupUpdatePrompt`）
- `flutter analyze`：无问题；`flutter test`：7 测试全过
- GitHub Actions `Build all platforms`（run `28634568312`）：4 个 job 全部成功，约 4m59s
- 下载 CI 产物解包验证：四端 `app.js` 均为 `APP_VERSION = "1.2.1"`，确认 `checkForUpdatesOnLaunch` 已编译进产物；Android 签名 SHA1 匹配
- GitHub Release v1.2.1 已创建，附 4 个平台包 + `SHA256SUMS.txt`

## 已知未验证/延后事项

- 这次的修复没有在真实 Windows WebView2 环境（而非 headless Edge）里最终确认，理论上两者渲染引擎一致（都是 Chromium），风险很低，但如果用户反馈"还是看不到保存按钮"，先确认 WebView2 缓存是否清理干净（`index.html` 的 cache-bust query 已经改了，正常情况下会强制拉新）。
- 安卓端跳转 GitHub 发布页、Windows 安装器全流程，均延续之前版本的"未做真机/干净机器验证"状态。
- **用户报的"设置里无法滑动"和"api配置的各种列表都无法打开"至今未解决**，详见上面 v1.2.1 那一节的排查记录。等用户提供截图/复现步骤后需要继续跟进，不要假设已经修好。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 同样不能改。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗。
- **这个代码库的 CSS 有反复出现的"重复声明"模式**：同一选择器在文件不同位置多次定义、互不在媒体查询保护下，后出现的规则静默覆盖前面的（本次的内部滚动 bug、之前的 `.panel-num` 徽章溢出、`.side-rail` 死代码，都是这个模式的不同表现）。大改动后建议跑一次全文件选择器重复扫描，人工核对是响应式断点的合理重复还是意外覆盖。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要给 `.config-section[open] .config-body` 重新加 `max-height`/`overflow-y: auto`——会重新导致保存按钮被裁切遮挡。
- 不要改 Windows 安装器的 AppId GUID。
- 不要在 `[Run]` 的 postinstall 条目上加 `skipifsilent`。
- 不要删掉 `[UninstallRun]` 里的 taskkill 兜底。
- 不要重新加 `DisableDirPage=yes`。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。

## 下一步建议

- 如果条件允许，找一台真实 Android 设备和一台"干净"的 Windows 机器各做一次完整的端到端验证。
- 用户报"看起来点不了/被遮挡"这类视觉 bug 时，优先用 CDP hit-test 脚本复现，而不是只靠读代码猜测——这次靠这个方法直接定位到了根因。
