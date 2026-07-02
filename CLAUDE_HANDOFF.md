# Claude Handoff: AI 图片生成器 v1.0.9

更新时间：2026-07-02
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.9`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.0.8 及更早的发布过程已经过期，不要按旧步骤操作。

当前核心状态：

- 应用版本：`APP_VERSION = "1.0.9"`
- Flutter 版本：`pubspec.yaml` 为 `1.0.9+10`
- 前端缓存/query：`index.html` 中 `style.css?v=20260702-1-0-9`、`app.js?v=20260702-1-0-9`
- Service Worker cache：`ai-image-generator-1-0-9-20260702`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,0,9,10`/`"1.0.9"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- **Windows 分发方式从这个版本起变了**：不再是 ZIP，改成 Inno Setup 编译的 `AI-Image-Generator-Setup.exe`
- 本轮已 commit（`47804bd`）、已 push、CI 四端构建通过（含新增的 Inno Setup 编译步骤）、已创建 GitHub Release v1.0.9

## v1.0.9 本轮完成内容（用户明确要求）

用户原话："干脆就直接搞个exe的安装包"——在体验完 v1.0.8 的手搓 WinForms 自更新方案后，用户直接要求换成真正的 Windows 安装包。这是对的方向，一次性解决了 v1.0.7/v1.0.8 两轮里反复打补丁的三个问题（安装界面、占空间、放明显地方），而且比手写脚本更可靠。

### 架构变化

- 新增 `windows/installer/setup.iss`（Inno Setup 脚本）：
  - `AppId={{83D775F4-F8FD-418B-B3AF-5C4397ABF5E0}`（固定 GUID，**不要改**——Inno Setup 靠它识别"这是同一个软件的升级"还是"全新安装"，改了会导致老用户装成两份）
  - `DefaultDirName={localappdata}\AI Image Generator` + `PrivilegesRequired=lowest`：per-user 安装，不需要管理员权限、不会弹 UAC，这点跟现有自更新哲学（不提权）保持一致
  - `CloseApplications=yes`（默认值，显式写出来）：用 Windows Restart Manager 检测哪些进程占用了要被覆盖的文件，自动关闭它们
  - `[Run]` 里 `Flags: nowait postinstall`（注意**没有** `skipifsilent`）：交互式安装时是个可勾选的"安装后启动"复选框，静默安装时会无条件执行——这个细节很重要，如果加了 `skipifsilent`，自动更新走 `/SILENT` 时就不会重新拉起 App 了
  - 安装器本身是英文界面（Welcome/Next/Install/Finish 等标准 Inno Setup 文案），只有 App 名称/发布者/快捷方式文字是中文——没有引入 `ChineseSimplified.isl` 语言包，图省事，如果以后要做中文安装向导再加
- `lib/main.dart`：`_downloadWindowsUpdate` 大幅简化，删掉了 v1.0.8 那套手写 PowerShell 脚本生成逻辑（`_writeWindowsUpdateScript`，连带 `_psQuote` 一起删了，约 130 行）。现在的逻辑就是：下载 `Setup.exe` → `Process.start(file.path, ['/SILENT', '/NORESTART', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], detached)` → 700ms 后当前进程 `exit(0)`。关闭旧进程、覆盖安装、装完重启，全部交给安装器自己处理。
- `.github/workflows/build-all-platforms.yml` 的 `windows` job：`flutter build windows --release` 之后新增 `choco install innosetup -y` + `ISCC.exe windows\installer\setup.iss /DMyAppVersion=<从pubspec.yaml提取的版本号>` 两步，产物从 `AI-Image-Generator-windows.zip` 换成 `AI-Image-Generator-Setup.exe`。job 名字也从 "Windows ZIP" 改成了 "Windows Installer"。
- `app.js` 的 `selectUpdateAsset()`：windows 平台的资产匹配规则从 `/windows.*\.zip$/i` 改成 `/windows.*\.exe$/i, /setup.*\.exe$/i, /\.exe$/i`（实际文件名 `AI-Image-Generator-Setup.exe` 不含 "windows" 字样，靠 "setup" 关键字匹配）。

### 验证方式（这次验证得比之前更彻底，因为是全新机制）

1. **本机装了 Inno Setup**（`choco install innosetup -y`，装到 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`）单独调 `ISCC.exe` 编译 `.iss`，抓到并修好一个真实语法坑：`AppId={GUID}` 直接写会报 "Unknown constant"，因为 Inno Setup 编译器会把 `{xxx}` 当成"运行时常量"（像 `{app}`、`{localappdata}` 那样）来查找，必须写成 `AppId={{GUID}`（双花括号转义成字面单花括号）。
2. **本机真实跑了三个场景**（用临时拿真实 release 包放到 `build\windows\x64\runner\Release\` 模拟 CI 构建产物之后编译）：全新静默安装（验证安装目录/开始菜单快捷方式/桌面快捷方式/注册表卸载项都对）、应用运行中再次运行安装器模拟升级（验证 `/CLOSEAPPLICATIONS` 真的会自动关闭正在跑的旧实例、覆盖安装、`/RESTARTAPPLICATIONS` 真的会自动拉起新实例）、卸载（`unins000.exe /VERYSILENT`，验证目录/快捷方式/注册表项都干净移除）。
3. **CI 跑完之后又拿 CI 实际产出的 `Setup.exe`（不是本地临时编译版本）重新跑了一遍上面三个场景**，确认 GitHub Actions 上通过 Chocolatey 装的 Inno Setup 编译出来的东西行为一致。
4. 期间观察到一个**良性的假象**：测试升级场景时一度看到两个 `ai_image_generator.exe` 进程同时存在（一个是刚被 CloseApplications 关闭又重启的新实例，另一个 PID 看起来像没被关掉的"旧"实例）。用 `Get-CimInstance Win32_Process` 多查了一次，几秒后就只剩一个稳定进程了——这是应用启动过程中的短暂状态（Flutter/WebView2 冷启动经常有个自我重新执行的阶段），不是 CloseApplications 失效。**如果以后再看到"进程数对不上"的现象，先隔几秒重新查一次进程列表再下结论，不要在瞬时快照上直接判定失败**。

## 验证记录（本轮全部亲自执行）

- `node --check app.js` / `node --check qa\regression-runner.js`：通过
- `node qa\regression-runner.js`：连续 3 次全绿（干净环境下跑的；第一轮曾因为同时在跑 Inno Setup 编译抢 CPU/IO 资源导致 Edge 启动超时误报失败，属于本机资源竞争的环境噪音，不是代码问题，单独重跑验证过了）
- `flutter analyze`：`No issues found!`
- `flutter test`：7 个测试全部通过
- 本地 + CI 产出的安装器分别完整验证了"全新安装 / 运行中升级 / 卸载"三个场景（见上）
- GitHub Actions `Build all platforms`（run `28599005358`）：4 个 job 全部成功，约 4m48s
- 下载 CI 产物解包验证：四端 `app.js` 均为 `APP_VERSION = "1.0.9"`；Android APK 签名 SHA1 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`；Windows 安装器 `ProductVersion` 确认为 `1.0.9`
- GitHub Release v1.0.9 已创建，附 4 个平台包 + `SHA256SUMS.txt`

## 已知未验证/延后事项

- 没有找第二台"干净"的 Windows 机器测试过——所有本地验证都在这台开发机上做的，虽然装/卸/升级流程本身应该跟机器无关（Inno Setup 的机制很成熟），但如果用户反馈"装不上"，优先怀疑杀毒软件/SmartScreen 拦截未签名安装器（这个 `Setup.exe` 目前没有代码签名证书，Windows SmartScreen 首次运行很可能会弹"未知发布者"警告——这是预期行为，不是 bug，除非以后买了代码签名证书）。
- 安卓端跳转 GitHub 发布页（v1.0.7）的行为依然没有真机验证（本机无 adb/真机）。
- v1.0.8 版本的用户如果是 ZIP 解压版，需要手动一次性迁移到新安装包（已在 v1.0.9 release notes 里提示），没有做自动检测"你是不是还在用旧的 ZIP 版本"的逻辑——如果用户反馈老版本自动更新没反应，先确认对方是不是还在用 ZIP 解压版本（那个版本的自更新走的是已删除的 PowerShell 脚本逻辑，早就不存在了，会直接失败）。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**）。签名 SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`，每次发布都应核对。
- **Windows 安装器的 AppId GUID 是 `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0`，跟 Android 签名一样，这个 GUID 也不能随便改**——Inno Setup 靠 `AppId` 判断"这次运行是不是在升级已安装的同一个软件"，改了 GUID 会导致老用户升级时被当成全新软件、装出两份。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 在生成成功时就把图片字节缓存为本地 Blob/objectURL。
- Windows/中文路径会导致 Flutter/Dart AOT 编译和 Gradle/Java 属性解析崩溃，本机构建必须复制到纯 ASCII 路径。
- Windows PowerShell 5.1 脚本文件只要内容含中文就必须显式写 UTF-8 BOM——这条经验现在**已经不再适用于更新脚本**（v1.0.9 起不再手写 PowerShell 脚本了），但如果以后其他地方又要生成给 PowerShell 5.1 执行的中文脚本，这个坑依然存在，参考 v1.0.8 handoff 的记录。
- Inno Setup 的 `{xxx}` 语法在 `[Setup]` 各字段里会被当成"常量引用"解析（哪怕是 `AppId` 这种看起来不像路径的字段），要嵌入字面花括号必须写 `{{`。
- WebView 环境（Android WebView、Windows WebView2）下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部替换为自定义异步弹窗。
- 本机没有安装 Visual Studio，无法本地完整编译 Windows exe，真实 Windows exe 编译验证只能依赖 CI；但 Inno Setup 编译本身不需要 VS，可以在本机独立测试（只要有一份 `build\windows\x64\runner\Release\` 目录数据，不管是本机 build 的还是从 CI 下载解压的都行）。
- 这台机器的 Git Bash 环境没有 `strings` 命令，也存在 MSYS2 路径转换坑（给 Windows 原生 exe 传 `/D...`、`/X` 这类以 `/` 开头的参数会被 Git Bash 误当成 Unix 路径转换，必须改用 PowerShell 调用）。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"——v1.0.7 就是应用户要求改成跳转 GitHub 发布页的。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断——必须严格按用户选择的 provider 路由。
- 不要重新生成 Android 签名密钥库。
- **不要改 Windows 安装器的 AppId GUID（`83D775F4-F8FD-418B-B3AF-5C4397ABF5E0`）**。
- 不要把 Windows 更新流程改回下载 ZIP 自己解压——现在是下载 Setup.exe 静默运行，用户明确要求"直接搞个exe的安装包"。
- 不要在 `[Run]` 的 postinstall 条目上加 `skipifsilent`——会导致静默自动更新时应用不会自动重启。
- 不要把桌面端图片下载/导出改回"点击时才 fetch 远程 URL"。

## 下一步建议

- 如果条件允许，找一台真实 Android 设备和一台"干净"的 Windows 机器（不是这台开发机）各做一次完整的端到端安装/更新验证。
- 如果用户反馈 Windows 安装器被杀毒软件/SmartScreen 拦截，可以考虑购买代码签名证书（这是目前唯一已知的、需要花钱才能解决的遗留问题）。
