# Claude Handoff: AI 图片生成器 v1.0.8

更新时间：2026-07-02
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.8`

## 先读这个

这份文档是给 Claude/Codex 接手用的当前状态说明。v1.0.7 及更早的发布过程已经过期，不要按旧步骤操作。

当前核心状态：

- 应用版本：`APP_VERSION = "1.0.8"`
- Flutter 版本：`pubspec.yaml` 为 `1.0.8+9`
- 前端缓存/query：`index.html` 中 `style.css?v=20260702-1-0-8`、`app.js?v=20260702-1-0-8`
- Service Worker cache：`ai-image-generator-1-0-8-20260702`
- Windows 版本资源：`windows/runner/Runner.rc` 兜底值 `1,0,8,9`/`"1.0.8"`
- Android assets 已与根目录 Web 文件同步（SHA256 一致）
- 本轮已 commit（`68d8269`）、已 push、CI 四端构建通过（含真实 Visual Studio 编译）、已创建 GitHub Release v1.0.8

## v1.0.8 本轮完成内容（用户明确要求，三条连续反馈）

用户原话：
1. "我发现软件下载后并没有弹出安装界面，更新安装可以参考 https://github.com/esengine/deepseek-reasonix 该项目的更新安装"（该仓库实际是个 Go CLI 工具，README 里没有可参考的图形更新安装实现细节，未采用其具体代码，而是自行设计了下述方案）
2. "而且如果更新，帮安装最新版放在明显点的地方"
3. "而且我不需要下载更新包的功能 反而会占空间"

### 1. Windows 自更新加可见图形进度窗口

`lib/main.dart` 的 `_writeWindowsUpdateScript()`（约 724 行起）生成的 PowerShell 脚本，从"纯后台静默运行"改为：
- 用 `Add-Type -AssemblyName System.Windows.Forms` 弹出一个置顶的 WinForms 进度窗口（Marquee 进度条 + 状态文字），每个阶段都更新中文提示："等待旧版本退出..." → "正在解压更新包..." → "正在安装到程序目录..." → "正在清理安装包..." → "正在更新桌面快捷方式..." → "更新完成，正在重新启动..."
- 用 `try/catch` 包裹主流程，失败时弹出 `MessageBox` 显示具体错误信息 + GitHub 发布页链接兜底，不会再无声无息地闪一下就消失
- `Process.start('powershell.exe', [...])` 参数新增 `-STA`（WinForms 必须单线程单元模型，否则 `New-Object System.Windows.Forms.Form` 会抛 `ThreadStateException`）

**关键坑（实测复现）**：脚本文件必须写入 UTF-8 BOM。之前 `script.writeAsString(...)` 默认写无 BOM 的 UTF-8，Windows PowerShell 5.1 在没有 BOM 时会按系统 ANSI 代码页解析脚本文件，一旦内容里有中文字符就会把某个字符串"读串行"，报 `The string is missing the terminator: "`。修复：改用 `script.writeAsBytes([0xEF, 0xBB, 0xBF, ...utf8.encode(content)])` 显式带 BOM。这个坑不是本次新引入的——只是之前的脚本内容全是英文/无中文才没暴露，一旦要加中文提示就会踩到。**以后任何要往 Windows 端写、且会被 PowerShell 解释执行的脚本文件，只要内容含中文，必须显式写 BOM。**

**另一个实测发现（已通过设计规避）**：relaunch 后立即检查 `HasExited` 来决定要不要重试启动，会有假阴性——WebView2 冷启动有时超过 1-2 秒才稳定，过早检查会误判"已退出"进而重复启动出两个实例。现在的设计是**只启动一次，不做基于进程存活检测的重试**，改用更长的固定等待（800ms 预备 + 启动后 600ms 收尾）给窗口关闭做缓冲，真正的失败兜底交给桌面快捷方式（见下）和错误 MessageBox。

### 2. 更新包 zip 自动清理

`_writeWindowsUpdateScript` 生成的脚本在 `Copy-Item` 成功后新增 `Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue`，删除 `%USERPROFILE%\Downloads\AI Image Generator\updates\` 下已下载的安装包。之前只清理了临时解压目录，从未清理过原始下载的 zip，多次更新后会一直累积占用磁盘空间。

### 3. 桌面快捷方式

脚本在复制安装文件后，用 `New-Object -ComObject WScript.Shell` 创建/覆盖桌面上的 `AI 图片生成器.lnk`，`TargetPath`/`WorkingDirectory`/`IconLocation` 都指向当前（更新后）的安装目录。每次成功自更新都会刷新这个快捷方式，所以用户始终可以在桌面找到"最新版本"的入口，不需要自己记安装路径。快捷方式创建失败会被内层 `try/catch` 吞掉，不影响更新主流程。

### 4. 移除"仅下载更新包"按钮

`index.html` 删除了 `#downloadUpdate` 按钮，只保留 `#checkUpdates` + `#installUpdate`。`app.js` 相应清理了 `dom.downloadUpdate` 映射、`setButtonText`/`updateInstallButtonState` 里对它的引用、以及它的 `click` 监听器。i18n key `downloadUpdate` 本身保留未删——它还被 `downloadLatestUpdate` 的错误消息拼接（`install ? "installUpdate" : "downloadUpdate"`）用到，删了会导致那条路径的错误文案失效，不是死代码。

### 验证方式（这次做得比较彻底，记录方法供以后复用）

因为改的是"生成一段 PowerShell 脚本字符串再让系统执行"这种没法被 `flutter analyze`/`flutter test` 覆盖的逻辑，用了三层验证：
1. **单独抽取字符串拼接逻辑**：把 `_writeWindowsUpdateScript` 里 `lines` 数组的构造逻辑复制到一个独立的 `.dart` 文件，塞入假的 pid/路径，用 `dart run xxx.dart` 直接跑，生成真实的 `.ps1` 文件——比对 Dart 转义规则是否符合预期（这一步真的抓到一个 bug：raw string `r"..."` 里手滑加了不必要的 `\$` 转义，导致生成的 PowerShell 脚本里混入了字面反斜杠）。
2. **真实 Windows 环境跑生成出来的脚本**：把一份真实 release 包解压到测试目录当"安装目录"，把同一个 zip 当"更新包"，完整跑一遍 `expand → copy → 删 zip → 建快捷方式 → 重启`，用 `Get-Process`/`Test-Path` 逐项断言副作用，而不是只看退出码。
3. **本机没有 Visual Studio，没法本地 `flutter build windows` 出真实 exe**（`flutter doctor` 里 `[✗] Visual Studio not installed`），最终真实编译验证只能靠 CI；CI 跑完后从产物里 `grep -a` 二进制文件确认新脚本的关键字符串（`System.Windows.Forms`、`-STA`、脚本文件名、GitHub 兜底链接）确实被编译进 `data/app.so`。

注意：`strings` 命令在这台机器的 Git Bash 环境里不存在（`command not found`），如果通过管道 `strings ... | grep -c ... || true` 这种写法，命令找不到会被 `|| true` 悄悄吞掉、看起来像"没匹配到"——验证二进制文件内容时改用 `grep -a` 直接搜，不要用 `strings`。中文文本标记在 `app.so` 里用 `grep -a` 搜不到（大概率是 Dart AOT 对非 Latin1 字符串用 UTF-16/TwoByteString 内部表示，不是连续 UTF-8 字节），这不代表中文没编译进去——第 2 层的真实脚本执行验证已经直接证明中文文本在生成的 `.ps1` 文件里是完整且能正确解析执行的。

## 验证记录（本轮全部亲自执行）

- `node --check app.js` / `node --check qa\regression-runner.js`：通过
- `node qa\regression-runner.js`：连续 3 次全绿
- `flutter analyze`：`No issues found!`
- `flutter test`：7 个测试全部通过
- 独立 `dart run` 验证脚本生成逻辑 + 真实 Windows 环境完整跑通更新流程 2 次（见上）
- GitHub Actions `Build all platforms`（run `28595969310`）：4 个 job 全部成功，约 4m56s
- 下载 CI 产物解包验证：四端 `app.js` 均为 `APP_VERSION = "1.0.8"`；Android APK 签名 SHA1 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`；Windows exe 文件版本资源 `1.0.8+9`；`data/app.so` 内确认新更新脚本关键标记存在
- GitHub Release v1.0.8 已创建，附 4 个平台包 + `SHA256SUMS.txt`

## 已知未验证/延后事项

- Windows 新更新流程（WinForms 弹窗 + 桌面快捷方式）只在本机（有 WebView2、无 Visual Studio）手动模拟测试过，**没有用 CI 编译出的真实签名/未签名 exe 在另一台干净的 Windows 机器上做过端到端确认**。逻辑本身已经过双重验证（独立脚本生成 + 真实执行），风险较低，但如果用户反馈"更新窗口一闪而过""桌面快捷方式没建成"，先看是不是防病毒软件拦截了刚下载/复制的可执行文件（本次调试中就观察到一次性的、原因不明的重启延迟，怀疑与此有关）。
- 安卓端跳转 GitHub 发布页（v1.0.7 引入）和本轮的深度扫描结论，都还没有真机验证（本机无 adb/真机）。
- 完整的"检查更新 → 下载 → 安装 → 应用重启后是新版本"端到端流程，全程仍未在真实终端用户设备上做过。

## 关键事实（长期有效，务必保留）

- Android 发布签名密钥库：`C:\aigen-signing\ai-image-generator-release.jks`（**不可重新生成**）。密码见 `C:\aigen-signing\CREDENTIALS-DO-NOT-LOSE.txt`。GitHub Secrets 已配置好对应四个变量。签名 SHA1 固定为 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`，每次发布都应核对。
- 中转站（GrsAI 等）生成的图片约 2 小时后会被删除，app.js 在生成成功时就把图片字节缓存为本地 Blob/objectURL，导出等操作一律用本地缓存。
- Windows/中文路径会导致 Flutter/Dart AOT 编译和 Gradle/Java 属性解析崩溃，本机构建必须复制到纯 ASCII 路径。**本轮新增一条同类坑**：任何要被 Windows PowerShell 5.1 解释执行、且内容含中文的脚本文件，写入时必须带 UTF-8 BOM，否则会按系统代码页解析导致中文把字符串截断、脚本直接解析失败。
- WebView 环境（Android WebView、Windows WebView2）下原生 `confirm()`/`alert()`/`prompt()` 不可用，全部替换为自定义异步弹窗。
- JS/PowerShell 生成脚本这类"用主语言拼接目标语言代码字符串"的场景，容易在转义规则上出错且难以用常规静态检查发现——`dart run` 独立抽取验证是本轮验证出的一个好方法，值得以后复用。
- 本机没有安装 Visual Studio，无法本地完整编译 Windows exe，`flutter build windows --release` 会在生成 ephemeral 配置后因缺少 VS 而没法继续（这不是 bug，是环境限制）。真实 Windows exe 编译验证只能依赖 CI（`windows-latest` runner 自带 VS）。
- 这台机器的 Git Bash 环境没有 `strings` 命令；验证二进制文件内容改用 `grep -a`。

## 禁忌（不要在没有明确理由的情况下回退这些改动）

- 不要把安卓的更新按钮改回"应用内下载 + 覆盖安装"——v1.0.7 就是应用户要求改成跳转 GitHub 发布页的。
- 不要把 GrsAI 协议改回按 URL 域名嗅探判断——必须严格按用户选择的 provider 路由。
- 不要恢复 `dataUrlToBlob` 的旧实现（已证实是死代码）。
- 不要重新生成 Android 签名密钥库。
- 不要把桌面端图片下载/导出改回"点击时才 fetch 远程 URL"。
- 不要把 Windows 自更新脚本的 `-STA` 参数去掉——去掉会导致 WinForms 弹窗直接抛异常崩溃。
- 不要把 Windows 更新脚本改回不带 BOM 的纯文本写入——中文提示会导致 PowerShell 5.1 解析失败。
- 不要恢复"仅下载更新包"按钮——用户明确说不需要，只留"下载并安装"一个入口。

## 下一步建议

- 如果条件允许，找一台真实 Android 设备和一台"干净"的 Windows 机器（不是这台开发机）各做一次完整的端到端更新验证，闭环所有关于更新体验的用户反馈。
- 持续关注 Windows 自更新重启后是否稳定成功；如果用户反馈偶发失败，桌面快捷方式已经是现成的手动兜底入口，可以先确认这条路径能否让用户绕过问题，再决定是否需要加自动重试。
