# Claude Handoff: AI 图片生成器 v1.0.7

更新时间：2026-07-02
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.7`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.0.6 及更早的发布过程已经过期，不要按旧步骤操作。

当前核心状态：

- 应用版本：`APP_VERSION = "1.0.7"`
- Flutter 版本：`pubspec.yaml` 为 `1.0.7+8`
- 前端缓存/query：`index.html` 中 `style.css?v=20260702-1-0-7`、`app.js?v=20260702-1-0-7`
- Service Worker cache：`ai-image-generator-1-0-7-20260702`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- 本轮已 commit（`efe0dff`）、已 push、CI 四端构建通过、已创建 GitHub Release v1.0.7

## v1.0.7 本轮完成内容

### 1. 安卓更新改为跳转 GitHub 发布页（本轮新增，用户明确要求）

用户原话："如果更新，需要做到可以在软件里更新，手机端不要做，手机端做成调整到github项目"。

- `app.js` 的 `downloadLatestUpdate(install)`（约 1746 行起）在 `isNewer` 判断通过后新增分支：
  `if (getRuntimePlatform() === "android") { ... }`，直接 `openExternalUrl(info.release?.html_url || 兜底URL)` 跳转到 GitHub 发布页，**不**调用 `nativeDownload.downloadUpdate`，然后 `return` 提前退出。
- Windows / macOS 不受影响，继续走原生下载 + 覆盖安装（`nativeDownload.downloadUpdate`）。
- 新增 i18n key `updateOpenGithubMobile`（5 语言：zh-CN/zh-Hant/en/ja/ko），在 `CLEAN_LOCALES` 中紧跟 `updateOpenRelease` 之后。
- `window.AiGenUpdate` 导出新增 `getRuntimePlatform`，方便测试/调试。
- **回归测试覆盖**：`qa/regression-runner.js` 新增 `testAndroidUpdateRedirect(cdp)`，通过 CDP `Emulation.setUserAgentOverride` 模拟 Android UA，mock `window.FlutterDownload`（含 `nativeFetch` action 的正确响应，注意 `smartFetch` 在原生桥可用时优先走 `nativeFetch` 而非 `window.fetch`，mock 时两者都要考虑），断言：
  - 不会触发 `downloadUpdate` 原生 action（即不会尝试应用内安装）
  - 会触发 `openExternal` 原生 action 且 URL 指向 GitHub 发布页
  - `downloadLatestUpdate(true)` 返回 `{ opened: true, url: <release html_url> }`

### 2. 清理死代码

- `app.js` 中曾有两处同名 `function dataUrlToBlob(dataUrl)` 声明（约旧 3223 行与旧 4739 行）。JS 函数声明提升会让**后一个**覆盖前一个，前一个（用 `atob` 手写解码的旧版本）从未真正执行过。已删除前一个死声明，只保留后一个（用 `base64ToBytes`/`encodeUtf8` 的版本）。
- `style.css` 中已废弃的 `.side-rail`/`.rail-item`/`.rail-bottom` 规则（旧侧边栏导航，早已在 UI 重构时删除对应 HTML）已清理，确认 app.js/index.html/style.css 中再无引用。

### 3. 版本号一致性修复

- `windows/runner/Runner.rc` 的兜底版本宏（`FLUTTER_VERSION_*` 未定义时使用）此前停留在 `1,0,6,7`/`"1.0.6"`，与 `pubspec.yaml` 的 `1.0.7+8` 不一致。已同步为 `1,0,7,8`/`"1.0.7"`。注意：正常 CI/本地构建中 Flutter 工具链会自动定义 `FLUTTER_VERSION_*` 覆盖这个兜底值（已用 `Get-Item .exe | VersionInfo` 验证实际产物是 `1.0.7+8`），但兜底值本身也应保持同步，避免脱离 flutter 工具链手动 MSBuild 时版本号出错。

### 4. 深度扫描结果（用户要求"深度检测是否还有残留代码或者bug"）

已系统性排查以下几类，**除上述 dataUrlToBlob 外未发现其他功能性 bug**：

- 重复的顶层 `function` 声明：无（脚本扫描全文件）
- 重复的顶层 `const`/`let` 声明：无
- `dom.X` 引用与 `dom = {...}` 映射、`index.html` 的 `id=` 交叉核对：无缺失引用；`dom.inputPanel` 是已知误报（用 `.input-panel` class 选择器定义，扫描脚本的正则只认 `#id` 形式）
- 新增的 `#modelChoices` 自定义模型选择器：HTML/JS/CSS 三层接线核对一致（`.model-choices` 容器样式、`.model-choice` 按钮样式、点击回填 `dom.model.value` 并派发 `change` 事件均正常）
- `apiEndpointField`/`apiProviderField`/`modelField` 等新增字段外层 wrapper id：未被直接引用，但通过 `setText("#xxxField > span", key)` 模式做 i18n（非 `dom.X`/`getElementById` 直接引用形式），实际有效，非死代码
- `imageUpload`/`panelTable`/`referenceField`/`sizePresets` 这几个容器 id 本身确实未被 JS 直接引用，但其内部功能元素（`refImage`、`input[name="size"]` 等）都有独立、正确的接线，容器 id 是良性冗余，不是功能缺失
- TODO/FIXME/XXX/HACK/`debugger` 残留：无
- provider 适配器注册（`registerAdapter`）：仅 GrsAI 适配器显式设置 `provider: "grsai"`，JeniyaTop 和 OpenAI 兼容（catch-all，`detect() { return true; }`）注册顺序正确（catch-all 最后注册），无重复/冲突

### 5. 本轮一并提交的 audit2 遗留改动（Codex 此前完成，已验证为真实变更，本轮一起发布）

- GrsAI 官方协议适配：`/v1/api/generate` + `/v1/api/result?id=...`，仅 `GrsAI 生图 API` provider 启用，`官方 API`/`自定义 API` 始终走 OpenAI 兼容通用路由（`findAdapter(endpoint, provider)` 按 provider 严格路由，不再按 URL 域名嗅探误判）
- 桌面网络代理设置（HTTP 7890 / SOCKS5 10808 / 直连 / 自定义），生图/模型检测/更新检测/更新下载/远程图片加载统一走代理
- Windows 目录选择改为真实系统选择器（`file_selector` 包），此前会静默使用默认路径不弹窗
- Android 原生选择器异常处理加固（`MainActivity.kt` 捕获 `startActivityForResult`/`takePersistableUriPermission` 异常，避免 JS 侧挂起到 2 分钟超时）
- `test/proxy_config_test.dart` 桌面代理解析纯函数单元测试（6 个用例）

## 验证记录（本轮全部亲自执行，非转述）

- `node --check app.js` / `node --check qa\regression-runner.js`：通过
- `node qa\regression-runner.js`：**连续 3 次**全绿（含新增的 Android 更新跳转测试）
- `flutter analyze`：`No issues found!`
- `flutter test`：7 个测试全部通过（含 `proxy_config_test.dart` 6 个 + `widget_test.dart` 1 个）
- GitHub Actions `Build all platforms`（run `28593292932`）：4 个 job 全部成功，约 4m23s
- 下载 CI 产物并解包验证（非仅看构建日志）：
  - Android APK 内 `app.js`：`APP_VERSION = "1.0.7"`，`dataUrlToBlob` 声明数 = 1（确认死代码已清除）
  - Windows/macOS/iOS 三端 `flutter_assets/app.js` 同样确认 `APP_VERSION = "1.0.7"`
  - Android APK 签名 SHA1：`C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`（用 `keytool -printcert -jarfile` 验证，与历史发布一致 → 覆盖安装可正常生效，未意外回退到 debug 签名）
  - Windows exe 文件版本资源（`Get-Item .exe | VersionInfo`）：`FileVersion/ProductVersion = 1.0.7+8`
- GitHub Release v1.0.7 已创建，附 4 个平台包 + `SHA256SUMS.txt`

## 已知未验证/延后事项（明确标注，不虚报为已完成）

- Android 更新跳转 GitHub 发布页的逻辑只在 CDP 模拟 Android UA + mock 原生桥的条件下验证过，**没有在真实 Android 设备上手动点击验证**（本机无 adb/真机）。逻辑本身很直接（提前 return，不碰下载安装分支），风险较低，但如果用户反馈"点了更新还是想在应用内装"，先确认这是不是本次刻意改的产品决策被理解成了 bug。
- 此前 CODEX_HANDOFF.md 中记录的"模型列表选择无法使用"“路径选择点了无反应”问题，Codex 在 `57f4caf` 已从代码层面修复（异常处理加固 + 真实选择器），但同样从未在真机上做端到端确认。
- 完整的"检查更新 → 下载 → 安装 → 应用重启后是新版本"端到端流程，本会话全程未在真实设备上做过。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**，重新生成会导致老用户覆盖安装失败）。密码见 `C:\aigen-signing\CREDENTIALS-DO-NOT-LOSE.txt`（用户需自行异地备份）。GitHub Secrets 已配置：`ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`。签名 SHA1 指纹固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`，每次发布都应核对。
- 中转站（GrsAI 等）生成的图片 **约 2 小时后会被删除**，所以 app.js 在生成成功时就把图片字节缓存为本地 Blob/objectURL，导出 ZIP 等操作一律用本地缓存，不能等到用户点击导出时再去重新 fetch 远程 URL。
- Windows/中文路径会导致 Flutter/Dart AOT 编译和 Gradle/Java 属性解析崩溃，本机构建必须复制到纯 ASCII 路径（例如 `F:\AI\agent\aigen_build_xxx`）再跑 `flutter build`。
- WebView 环境（Android WebView、Windows WebView2）下原生 `confirm()`/`alert()`/`prompt()` 不可用（静默 no-op 或直接挂起 JS 线程），全部替换为自定义 `askConfirm()`/`askPrompt()` 异步弹窗。
- JS 顶层出现同名 `function` 声明时后者会静默覆盖前者、不报错，本次又抓到一例（`dataUrlToBlob`）。这是本代码库的第二次同类问题（第一次是 CSS 级联覆盖 `.panel-num`），改动大段代码后建议跑一次全文件重复声明扫描。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"，这是用户本轮明确要求的产品决策，不是 bug。
- 不要把 GrsAI 协议改回按 URL 域名嗅探来判断是否使用官方协议——用户明确要求严格按照"选择的 provider"来路由，即使自定义 API 的地址恰好也在 grsai 域名下，选了"自定义 API"就必须走通用 OpenAI 兼容协议。
- 不要恢复 `dataUrlToBlob` 的旧实现（`atob` 手写解码版本），它已被证实是从未执行过的死代码。
- 不要重新生成 Android 签名密钥库。
- 不要把桌面端图片下载/导出改回"点击时才 fetch 远程 URL"，中转站 2 小时会删图，必须用生成时缓存的本地字节。

## 下一步建议

- 如果条件允许，找一台真实 Android 设备做一次完整的"检查更新 → 跳转 GitHub → 手动下载安装"端到端确认，闭环用户这次的核心诉求。
- 持续关注是否有新的重复声明模式（可复用本轮写的 Node 扫描脚本思路：正则提取所有顶层 `function`/`const`/`let` 声明名，统计重复）。
