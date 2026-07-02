# Claude Handoff: AI 图片生成器 v1.0.11

更新时间：2026-07-02
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.11`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.0.10 及更早的发布过程已经过期，不要按旧步骤操作。

当前核心状态：

- 应用版本：`APP_VERSION = "1.0.11"`
- Flutter 版本：`pubspec.yaml` 为 `1.0.11+12`
- 前端缓存/query：`index.html` 中 `20260702-1-0-11`
- Service Worker cache：`ai-image-generator-1-0-11-20260702`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,0,11,12`/`"1.0.11"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- Windows 分发方式：Inno Setup 编译的 `AI-Image-Generator-Setup.exe`（v1.0.9 起，v1.0.10/v1.0.11 又修了两个小问题，见下）
- 本轮已 commit（`297ea69`）、已 push、CI 四端构建通过、已创建 GitHub Release v1.0.11

## v1.0.9 → v1.0.11：Windows 安装体验从零到打磨完整的过程

用户体验完 v1.0.8 的手搓 WinForms 自更新方案后，直接说"干脆就直接搞个exe的安装包"——这是三个版本连续迭代的起点。

### v1.0.9：换成 Inno Setup

- 新增 `windows/installer/setup.iss`，CI 里 `flutter build windows --release` 之后用 `choco install innosetup -y` + `ISCC.exe windows\installer\setup.iss /DMyAppVersion=<版本号>` 编译出 `AI-Image-Generator-Setup.exe`，替代原来的 `AI-Image-Generator-windows.zip`。
- `lib/main.dart` 删掉了 v1.0.8 那套约 130 行手写 PowerShell 脚本生成逻辑（`_writeWindowsUpdateScript`/`_psQuote`），`_downloadWindowsUpdate` 简化成"下载 Setup.exe → `Process.start(exe, ['/SILENT','/NORESTART','/CLOSEAPPLICATIONS','/RESTARTAPPLICATIONS'], detached)`"，关闭旧进程/覆盖安装/重启全部交给安装器自己处理（`CloseApplications=yes` 用 Windows Restart Manager 检测占用文件的进程并自动关闭）。
- `app.js` 的 `selectUpdateAsset()` windows 匹配规则从 `.zip` 改成 `.exe`/`setup` 关键字。

### v1.0.10：加回"选择安装路径"

- 用户反馈"为啥没有选择安装的路径"——v1.0.9 初版为了向导流程精简加了 `DisableDirPage=yes`，把选目录的页面跳过了。去掉这个和配套的 `DisableReadyPage=yes`，恢复标准 Inno Setup 六步向导（欢迎 → 附加任务 → 选择安装位置 → 准备安装 → 安装 → 完成）。默认值还是 `{localappdata}\AI Image Generator`（免管理员权限），只是现在用户可以点"浏览"改路径。**静默安装（`/SILENT`/`/VERYSILENT`）完全不受影响，不会弹任何向导页**，这两种模式是独立的。

### v1.0.11：修复卸载残留

- 自己测出来的问题，不是用户报的：装完程序会按 `[Run]` 设计自动启动一次，如果这时候不手动关掉直接点卸载，文件被占用导致 exe/dll 删不干净。加了 `[UninstallRun]`，卸载删文件前先 `taskkill /F /IM ai_image_generator.exe` 兜底。

## 关键坑与经验（本轮新增的，长期有效）

- **`AppId` 是 Inno Setup 判断"这是升级还是全新安装"的唯一依据**：`{{83D775F4-F8FD-418B-B3AF-5C4397ABF5E0}`（前面双花括号是转义成字面单花括号的写法，`AppId={GUID}` 直接写会被编译器当成"运行时常量引用"报 "Unknown constant"）。**这个 GUID 永远不要改**，改了老用户升级时会被当成装了个新软件，装出两份。
- **`[Run]` 里 `postinstall` 条目不要加 `skipifsilent`**：想要"静默自动更新也自动重启应用"就不能加这个 flag，否则只有交互式安装才会启动应用。
- **`CloseApplications=yes` 只覆盖安装/升级场景，不管卸载**——这是本轮才发现的：如果程序在卸载时还在跑（比如刚装完自动启动的那个实例），文件会被占用。需要单独在 `[UninstallRun]` 里用 `taskkill` 兜底，两个阶段是独立的机制。
- **本机没有 Visual Studio，但 Inno Setup 编译本身不需要 VS**——`choco install innosetup -y` 装到 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`，只要有一份 `build\windows\x64\runner\Release\` 目录内容（不管是本机 build 的还是从 CI 下载 Setup.exe 解压/静默安装出来的）就能独立在本机测试编译+安装+升级+卸载全流程，不用等 CI。这次连续三版都是这么快速验证的。
- **验证"进程有没有被正确关闭"不要信单次快照**：曾经在测升级流程时一度看到两个同名进程，隔几秒用 `Get-CimInstance Win32_Process` 重新查发现只是启动瞬时状态。
- **给原生 Windows exe（`ISCC.exe`、`Setup.exe`、`unins000.exe`）传 `/D...`、`/DIR=...`、`/SILENT` 这类以 `/` 开头的参数，必须用 PowerShell 工具调用，不能用 Bash 工具**——Git Bash 的 MSYS2 路径转换层会把这类参数误当 Unix 路径处理，导致 "You may not specify more than one script filename" 之类的怪异报错。
- Git Bash 环境没有 `strings` 命令，验证二进制文件内容用 `grep -a`。

## 验证记录（本轮全部亲自执行，含三个版本的完整验证链）

- 每个版本发布前都跑了：`node --check` 全部脚本、`flutter analyze`（无问题）、`flutter test`（7 测试全过）、`node qa\regression-runner.js` 连续 3 次全绿
- 每个版本都用 CI 实际产出的 `Setup.exe`（不是本地临时编译版本）在本机重新完整测试过对应的新增/修复行为：
  - v1.0.9：全新安装、运行中升级（自动关闭+覆盖+自动重启）、卸载
  - v1.0.10：默认路径静默安装、`/DIR=` 自定义路径安装
  - v1.0.11：装完不手动关程序直接卸载，验证不再残留文件
- 每次都下载 CI 产物解包验证四端 `APP_VERSION`、Android 签名 SHA1 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`

## 已知未验证/延后事项

- 所有 Windows 安装器测试都在这台开发机上做的，没有找第二台"干净"机器验证过。Inno Setup 机制本身很成熟，理论上跟机器无关，但如果用户反馈"装不上"，优先怀疑杀毒软件/SmartScreen 拦截未签名安装器（`Setup.exe` 目前没有代码签名证书，首次运行大概率会弹"未知发布者"警告，这是预期行为不是 bug）。
- 安卓端跳转 GitHub 发布页（v1.0.7）依然没有真机验证（本机无 adb/真机）。
- v1.0.8 及更早版本的用户（ZIP 解压版）需要手动迁移一次到新安装包，没有自动检测逻辑。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**），SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
- **Windows 安装器的 AppId GUID `83D775F4-F8FD-418B-B3AF-5C4397ABF5E0` 同样不能改**，性质跟 Android 签名密钥一样重要。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 生成成功时就把字节缓存本地。
- Windows/中文路径会导致 Flutter/Dart AOT 编译崩溃，本机构建必须用纯 ASCII 路径。
- WebView 环境下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部是自定义异步弹窗。
- GrsAI provider 路由必须按用户选择的 provider 严格路由，不能按 URL 域名嗅探（v1.0.6 audit2 起）。
- 安卓端更新检测跳转 GitHub 发布页而非应用内安装（v1.0.7 起，用户明确要求）。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要改 Windows 安装器的 AppId GUID。
- 不要在 `[Run]` 的 postinstall 条目上加 `skipifsilent`。
- 不要把 Windows 更新流程改回下载 ZIP 自己解压——现在是下载 Setup.exe 静默运行。
- 不要重新加回 `DisableDirPage=yes`——用户明确要求能自己选安装路径。
- 不要删掉 `[UninstallRun]` 里的 taskkill 兜底——会重新出现卸载残留问题。
- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断。
- 不要重新生成 Android 签名密钥库。
- 不要把桌面端图片下载/导出改回"点击时才 fetch 远程 URL"。

## 下一步建议

- 如果条件允许，找一台真实 Android 设备和一台"干净"的 Windows 机器（不是这台开发机）各做一次完整的端到端安装/更新验证。
- 如果用户反馈 Windows 安装器被杀毒软件/SmartScreen 拦截，考虑购买代码签名证书。
- Windows 安装体验这条线目前看起来已经比较完整了（选路径、自动升级、干净卸载都验证过），除非用户有新反馈，不需要主动再动。
