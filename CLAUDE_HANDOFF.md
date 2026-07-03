# Claude Handoff: AI 图片生成器 v1.2.0

更新时间：2026-07-03
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.2.0`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.0.11 及更早的发布过程已经过期，不要按旧步骤操作。

**版本号说明**：v1.0.11 → v1.2.0 是用户明确指定的跳跃（原话"修复好后上传1.2.0版本"），不是常规的 +0.0.1 递增，也不代表中间有跳过的版本存在。以后如果用户没有明确指定版本号，继续按 +0.0.1 递增；如果用户明确报了一个版本号，直接照用户说的来，不要擅自改成"更合理"的递增值。

当前核心状态：

- 应用版本：`APP_VERSION = "1.2.0"`
- Flutter 版本：`pubspec.yaml` 为 `1.2.0+13`
- 前端缓存/query：`index.html` 中 `20260703-1-2-0`
- Service Worker cache：`ai-image-generator-1-2-0-20260703`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,2,0,13`/`"1.2.0"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- 本轮已 commit（`ca76c46`）、已 push、CI 四端构建通过、已创建 GitHub Release v1.2.0

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

## 已知未验证/延后事项

- 这次的修复没有在真实 Windows WebView2 环境（而非 headless Edge）里最终确认，理论上两者渲染引擎一致（都是 Chromium），风险很低，但如果用户反馈"还是看不到保存按钮"，先确认 WebView2 缓存是否清理干净（`index.html` 的 cache-bust query 已经改了，正常情况下会强制拉新）。
- 安卓端跳转 GitHub 发布页、Windows 安装器全流程，均延续之前版本的"未做真机/干净机器验证"状态。

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
