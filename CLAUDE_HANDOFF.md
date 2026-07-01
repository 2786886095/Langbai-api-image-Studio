# Claude 交接文档：AI 图片生成器

> ✅ **2026-07-01 深夜最新：v1.0.3 已发布，是当前 Latest release。**
> https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.3
> 打包自 commit `bc3e071`。四端产物已下载解包验证：`APP_VERSION="1.0.3"`、confirm/prompt 弹窗修复、
> 设置按钮 flex-wrap 修复、分镜表格压缩修复全部确认在内；**Android APK 签名指纹核对为
> `SHA1: C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`**（新持久密钥，非 debug）。
> v1.0.2 及更早版本用户升级到 v1.0.3 需要**手动卸载重装一次**（Release notes 里已写明原因），
> 之后版本间就会正常覆盖更新。未做过真机端到端人工点击实测（没有 adb/设备）。
>
> ⚠️⚠️ **Android 正式签名密钥已建立，任何人接手前必读第 9 节。**
> 之前所有 Android 构建（包括已发布的 v1.0.2）都是用 Flutter 自动生成的 **debug 签名**打包的——这
> 是个结构性 bug：debug keystore 每台机器/每次 CI 运行都不一样，导致"软件内更新覆盖安装"根本不可能
> 成立（安卓拒绝安装签名不匹配的"更新"，表现为"应用未安装"/"已存在冲突的包"）。已在 commit
> `03bb1ad` 修复：生成了持久签名密钥，本地构建和 GitHub Actions CI 现在用同一把签名，已双向验证
> 指纹一致（`SHA1: C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`）。
> **这把密钥的存放位置、恢复方式、GitHub Secrets 配置，见文末第 9 节——不要重新生成新的一把，
> 否则又会破坏更新链。**
>
> ✅ 2026-07-01 早些时候：v1.0.2 已重新构建并正式发布，替代了本文档下面第 6 节里引用的坏产物。
> 下面第 1–8 节描述的 CI run `28451118759` 和本地 APK/Windows ZIP **已作废**（构建于 confirm/prompt
> 无响应 bug 修复之前）。第 6 节提到的 Release 本身仍然是最新的公开发布版：
> **https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.2**
> ——但**这个 v1.0.2 是用旧的、不稳定的 debug 签名打的**，装了它的用户以后升级到任何用新密钥签名
> 的版本时，都需要手动卸载重装一次（唯一一次，之后就正常了）。
> 根因、修复内容、验证过程见文末「2026-07-01 补充：confirm/prompt 全局无响应 bug」章节。
> 唯一遗留项：**没有真实 Android 设备验证**（构建环境无 adb/模拟器），建议接手后装机实测一遍
> "清空分镜/删除配置/编辑重试/清空历史"。

更新时间：2026-07-01  
项目路径：`F:\AI\agent\图像生成`  
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`  
当前分支：`main`  
最新提交：`a34e484 feat: add in-app updater and harden history restore`（此后 Claude 又在工作区新增未提交修复，见文末）

## 1. 当前状态

这轮 Codex 已经完成并推送：

- 修复/加强“按钮没反应”类硬问题的验证链路：新增更新按钮冒烟测试，完整回归通过。
- 软件内更新功能已落地：
  - 设置弹窗新增“软件更新”区域。
  - 可检查 GitHub Releases 最新版本。
  - Windows 可下载 ZIP，生成独立 PowerShell 更新脚本，退出当前程序后覆盖安装目录并重启。
  - Android 可下载 APK，并通过系统安装器安装。
  - Web/PWA 环境无法覆盖本地程序时，会打开更新包下载链接。
- 历史记录逻辑已按用户要求调整：
  - 漫画分镜历史只显示“项目”，不再显示一张张漫画图片。
  - 单图模式才显示图片提示词。
  - 提示词默认折叠为 3 行，点击可展开/收起。
  - 还原历史时只还原提示词、模型、尺寸、重试等参数，不还原参考图。
  - 旧历史里残留的漫画单图记录会被过滤，不再展示。
- Android Web assets 已同步到 `android/app/src/main/assets/`。
- 本地 Android release APK 和 Windows ZIP 已重新生成。
- GitHub Actions 最新 run 已四端成功。

尚未完成：

- `v1.0.2` GitHub Release 还没有创建。GitHub 当前 Latest 仍是 `v1.0.0`。
- 下一步最重要的是用最新 CI artifacts 创建 `v1.0.2` Release，否则软件内更新检测仍会看到旧版本。

## 2. 最新 CI 状态

GitHub Actions run：

```text
run id: 28451118759
url: https://github.com/2786886095/Langbai-api-image-Studio/actions/runs/28451118759
headSha: a34e484fc660673acc4e2ba179a58d3e82e4fd00
conclusion: success
createdAt: 2026-06-30T14:15:37Z
updatedAt: 2026-06-30T14:19:49Z
```

四端 job 全部 success：

- Android APK
- Windows ZIP
- macOS app
- iOS app unsigned

已下载 CI artifacts 到：

```text
C:\Users\Public\aigen_artifacts_28451118759
```

CI artifacts：

```text
C:\Users\Public\aigen_artifacts_28451118759\android-apk\app-release.apk
size=43433560
sha256=2A6D8B6F67B66FA6AD441EBADA4D3FC52CB3F5B98B8F38DBF2F383945759CD02

C:\Users\Public\aigen_artifacts_28451118759\windows-release\AI-Image-Generator-windows.zip
size=12502389
sha256=B99A67CC6BE772AB7AF778D2891802D0F41DCE394C34DBC08886D76320D93A81

C:\Users\Public\aigen_artifacts_28451118759\macos-release\AI-Image-Generator-macos.zip
size=22423204
sha256=7E5F858E6B79F79C7F26E570886EBEED439BDABA59EAB305540EF23DC77E8184

C:\Users\Public\aigen_artifacts_28451118759\ios-release-unsigned\AI-Image-Generator-ios-unsigned.zip
size=25712681
sha256=90BADF6DCAA994FB3064950A54AE9E94F91E438A463B1E8191B509220C1F694F
```

## 3. 本地产物

本地已生成并复制回项目输出目录：

```text
F:\AI\agent\图像生成\android\output\AI-Image-Generator-flutter.apk
size=43433670
sha256=7D66DFB8D725BBA626ED012B697581CA8285A7DC83D9E980B9B4795FBEFE7D9A
mtime=2026-06-30 22:13:58

F:\AI\agent\图像生成\windows\output\AI-Image-Generator-windows.zip
size=12259307
sha256=A38809BD34BB7E4B319AE936BAB33F3DBBD985A799C80EFD1E685A534CE18C12
mtime=2026-06-30 22:14:17
```

推荐发布 GitHub Release 时优先使用 CI artifacts，而不是本地产物，因为 CI 同时覆盖四端。

## 4. 已验证命令

在 `F:\AI\agent\图像生成` 下已通过：

```powershell
node --check app.js
node --check qa\regression-runner.js
node qa\regression-runner.js
flutter analyze
flutter test
```

回归输出：

```text
[qa] API config save, restore, delete, and mobile scroll
[qa] Reference image sorting, single file picker click, and auto-fill template
[qa] Comic generation history as project, restore, and ZIP export
[qa] 400-only retry, clear while generating, reload failed image, and i18n layout
[qa] Settings update controls and platform package selection
[qa] All regression checks passed.
```

本地构建验证：

- Android debug：在 `C:\Users\Public\aigen_update_build` 成功。
- Android release：在 `C:\Users\Public\aigen_update_build` 成功。
- Windows Release：用 VS2026 CMake/MSBuild 路线成功。
- Windows 启动冒烟：`ai_image_generator.exe` 启动 6 秒未秒退。

注意：在 `F:\AI\agent\图像生成` 中文路径下直接 `flutter build apk` 会触发 Flutter shader/impellerc 写文件失败，这是已知路径问题，不代表代码坏了。

## 5. 重要改动文件

前端：

- `index.html`
  - 设置弹窗新增“软件更新”区域。
  - 资源 query 升到 `1.0.2`。
- `app.js`
  - 新增 `APP_VERSION = "1.0.2"`。
  - 新增 GitHub Release 检测、平台包选择、下载/安装更新逻辑。
  - 历史过滤：漫画只展示项目。
  - 提示词 3 行折叠/展开。
  - 历史还原清空参考图，只还原参数。
  - native bridge 新增 `downloadUpdate`。
- `style.css`
  - 更新区样式。
  - 历史提示词 3 行折叠样式。
- `sw.js`
  - `CACHE_NAME = "ai-image-generator-1-0-2-20260630"`。

Flutter / 原生：

- `lib/main.dart`
  - Mobile WebView bridge 新增 `downloadUpdate` 调用。
  - Windows 新增 `_downloadWindowsUpdate()`。
  - Windows 安装更新会生成 `apply-ai-image-generator-update.ps1`，等待当前进程退出后覆盖目录并重启。
- `android/app/src/main/kotlin/com/aigen/ai_image_generator/MainActivity.kt`
  - 新增 Android `downloadUpdate`。
  - 下载 APK 到 cache，并通过 FileProvider 拉起系统安装器。
- `android/app/src/main/AndroidManifest.xml`
  - 新增 `REQUEST_INSTALL_PACKAGES` 权限。
  - 新增 FileProvider。
- `android/app/src/main/res/xml/file_paths.xml`
  - 新增 FileProvider path 配置。
- `android/app/build.gradle`
  - 新增 `androidx.core:core-ktx:1.13.1`。
- `pubspec.yaml`
  - 版本升到 `1.0.2+3`。

测试：

- `qa/regression-runner.js`
  - 新增 “Settings update controls and platform package selection” 测试。
  - mock GitHub Release，验证设置按钮、检查更新按钮、状态文本和 Windows 包选择。

文档：

- `README.md`
  - 补充软件内更新说明。

## 6. 下一步：创建 v1.0.2 Release

当前 GitHub Release 状态：

```text
Latest: v1.0.0
v1.0.2: 未创建
```

建议 Claude 继续执行以下步骤。先准备 release 文件名，保证软件内更新选择逻辑能明确匹配平台：

```powershell
$src = "C:\Users\Public\aigen_artifacts_28451118759"
$out = "C:\Users\Public\aigen_release_v1.0.2"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Copy-Item "$src\android-apk\app-release.apk" "$out\AI-Image-Generator-android.apk" -Force
Copy-Item "$src\windows-release\AI-Image-Generator-windows.zip" "$out\AI-Image-Generator-windows.zip" -Force
Copy-Item "$src\macos-release\AI-Image-Generator-macos.zip" "$out\AI-Image-Generator-macos.zip" -Force
Copy-Item "$src\ios-release-unsigned\AI-Image-Generator-ios-unsigned.zip" "$out\AI-Image-Generator-ios-unsigned.zip" -Force

Get-FileHash "$out\*" -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash)  $([System.IO.Path]::GetFileName($_.Path))" } |
  Set-Content "$out\SHA256SUMS.txt" -Encoding UTF8
```

创建 Release：

```powershell
gh release create v1.0.2 `
  "C:\Users\Public\aigen_release_v1.0.2\AI-Image-Generator-android.apk" `
  "C:\Users\Public\aigen_release_v1.0.2\AI-Image-Generator-windows.zip" `
  "C:\Users\Public\aigen_release_v1.0.2\AI-Image-Generator-macos.zip" `
  "C:\Users\Public\aigen_release_v1.0.2\AI-Image-Generator-ios-unsigned.zip" `
  "C:\Users\Public\aigen_release_v1.0.2\SHA256SUMS.txt" `
  --repo 2786886095/Langbai-api-image-Studio `
  --target a34e484fc660673acc4e2ba179a58d3e82e4fd00 `
  --title "AI 图片生成器 1.0.2" `
  --notes "1.0.2 修复按钮/滚动/语言交互问题，新增软件内更新，漫画历史仅按项目展示，提示词默认三行折叠，历史还原不再恢复参考图。"
```

创建后验证：

```powershell
gh release view v1.0.2 --repo 2786886095/Langbai-api-image-Studio --web
gh release list --repo 2786886095/Langbai-api-image-Studio --limit 5
```

然后打开软件设置里的“检查更新”，应能看到 `v1.0.2`。如果当前软件本身已是 `1.0.2`，会显示已是最新版；旧版 `1.0.0`/`1.0.1` 应显示可更新。

## 7. 继续排查“按钮没反应”的重点

如果用户继续说“按钮点不了”，优先按这个顺序排查：

1. 确认用户运行的是最新包，不是旧 `v1.0.0`。GitHub Release 未更新时，用户下载到的仍然是旧包。
2. 检查 WebView 是否加载了旧 assets。`index.html` 应包含：
   - `style.css?v=20260630-1-0-2`
   - `app.js?v=20260630-1-0-2`
3. 检查 `sw.js` 缓存名是否为：
   - `ai-image-generator-1-0-2-20260630`
4. 跑：
   ```powershell
   node qa\regression-runner.js
   ```
   重点看最后一项 `Settings update controls and platform package selection`。
5. Windows 壳如果疑似点击事件不进 JS，先启动 Release exe 做 WebView 冒烟，再看是否有 JS 初始化错误。
6. Android 壳如果下载/更新没反应，检查：
   - `REQUEST_INSTALL_PACKAGES` 权限是否在 manifest。
   - FileProvider authority 是否是 `${applicationId}.fileprovider`。
   - `file_paths.xml` 是否进 APK。

## 8. 已知环境坑

- 中文路径构建坑：`F:\AI\agent\图像生成` 下 Flutter build 可能失败。复制到 ASCII 路径构建：
  ```text
  C:\Users\Public\aigen_update_build
  ```
- Windows Flutter 3.24 会误选 VS2019 generator。本机可用 VS2026 CMake 路线：
  ```powershell
  & 'F:\c++\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' -S windows -B build\windows\x64 -G "Visual Studio 18 2026" -A x64 -DFLUTTER_TARGET_PLATFORM=windows-x64
  & 'F:\c++\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' --build build\windows\x64 --config Release --target INSTALL
  ```
- Android release 构建会打印 Kotlin metadata warning，但目前退出码 0、APK 可生成。
- GitHub Actions warning：
  - Node.js 20 deprecation
  - macOS runner label migration
  目前都是 warning，不影响构建成功。

## 9. 给用户回复时注意

用户已经多次反馈“不像真的改了”“按钮没反应”“GitHub 没 Release”。回复要直接给结果和链接，不要空泛解释。

如果 Claude 接着做 Release，完成后应明确告诉用户：

- `v1.0.2` Release 链接。
- 已上传哪些平台包。
- 软件内更新功能从这个版本开始可用。
- 旧版需要先手动安装一次 `v1.0.2`，之后才能在软件内检测/下载后续更新。

---

## 2026-07-01 补充：confirm/prompt 全局无响应 bug（已定位并修复，未打包/未发布）

### 用户反馈

"codex给软件bug越修越修，很多功能都没有完善，按键点了都没反应"。

### 根因（已用真实构建产物验证，非猜测）

`app.js` 里有 **11 处**调用原生阻塞对话框 `confirm()`/`prompt()`，横跨 **8 个功能**：保存 API 配置命名、删除已存配置、自定义尺寸命名、缩减分镜数量确认、**清空所有分镜**、参考图扩展分镜确认、覆盖填写模板确认+自定义模板输入、**编辑重试提示词**、**清空全部生图记录**。

这 8 个功能全部依赖三个原生壳（Android WebView / Windows WebView2）能正确接管 JS 对话框回调——而三个壳全都没有：

- **Android（`webview_flutter`）**：默认不接管 `onJsConfirm`/`onJsPrompt`，Android WebView 官方文档明确写"不覆盖时，对话框永远被抑制，直接返回 false/null"。表现是**点击后完全静默，界面上任何东西都不会发生**。
- **Windows（`webview_windows`/WebView2）**：`lib/main.dart` 里的 `_WindowsWebShellState` 没有处理任何 JS 对话框事件。实测（见下）表现是**点击后卡住 15 秒以上**，JS 执行线程被阻塞在原生同步调用上，此时页面对任何后续点击都没有反应。

### 实测验证过程（不是看代码猜的）

1. 用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334` 启动**真实打包出来的** `windows/output/AI-Image-Generator-windows.zip`（解压到干净目录，核对过里面的 `index.html` 版本号是最新的，不是残留旧构建），用 CDP 直接连进程内的 WebView2。
2. 点击"清空分镜"（`clearPanels`），CDP 调用**卡住超过 15 秒**（Promise.race 本地超时），复现了用户说的"点了没反应"。
3. 定位到 `confirm("确定清空所有分镜？")` 调用，全文搜出全部 11 处同类调用。
4. 用自建的页面内异步弹窗（见下）替换全部 11 处，重新验证同一场景：**弹窗 154ms 内出现，点确定 309ms 内完成清空**，点击取消能正确保留内容不清空，验证后页面仍完全响应。

### 修复方案

`app.js` 新增 `openAskDialog()`/`askConfirm()`/`askPrompt()`（紧跟 `closeModal()` 之后），用页面自身的 `.modal` DOM 结构实现确认/输入弹窗，不依赖任何 WebView 原生对话框支持，因此 Web/PWA/Android/Windows/iOS/macOS 全端行为一致。`style.css` 追加 `.ask-dialog-*` 样式（文件最末尾，`z-index:1200`，确保盖在其他弹窗之上，因为"清空全部记录"是从设置弹窗里触发的）。全部 11 处 `confirm(`/`prompt(` 调用点已替换，涉及函数已改为 `async`（`saveConfig`/`deleteSavedApi`/`saveSizePreset`/`setPanelCount`/`clearPanels`/`autoFillPanels`/`editRetryContext`/`clearHistory` 监听器/函数链）。

`qa/regression-runner.js` 里原本用 `window.prompt = () => "qa-api"` / `window.confirm = () => true` 打猴子补丁"假装"用户回答了原生对话框——这正是这个 bug 能在"回归全绿"的情况下溜过去的原因：测试从来没有真正走过对话框这条链路。已修正 `testApiConfig` 里 `saveConfig`/`deleteSavedApi` 两处，改为真实寻找 `.ask-dialog-overlay` 并点击 `.ask-dialog-ok`/`.ask-dialog-cancel`。

### 已验证

- `node --check app.js` / `node --check qa/regression-runner.js` 通过。
- `node qa/regression-runner.js` 全量回归通过（含更新过的 API config 测试，真实走对话框、不再猴子补丁）。
- 上述"真实打包 Windows exe + WebView2 CDP"场景复测通过（154ms 出弹窗，309ms 完成清空，取消路径正确）。
- 已同步 `app.js`/`style.css` 到 `android/app/src/main/assets/`（SHA256 校验一致）。

### 后续处理（已全部完成）

1. `git commit 779eacb`（app.js/style.css/qa/regression-runner.js/CLAUDE_HANDOFF.md/android assets）+ `git push origin main`。
2. 本地重打 Android APK：复制到 `C:\Users\Public\aigen_v102_build`（ASCII 路径）构建，`grep -c "ask-dialog-overlay"` 提取出的 `assets/flutter_assets/app.js` = 1，确认修复已打入。已复制回 `android/output/AI-Image-Generator-flutter.apk`（SHA256 `66EFE837E54D24F6DABBDE5F27BA75B7494D48E37B803DCCD08418305B812894`）。
3. 本地重打 Windows：复制到 `C:\Users\Public\aigen_v102_win_build`，走既定的 `flutter build windows` + VS2026 手动 CMake（`cmake -S windows -B build\windows\x64 -G "Visual Studio 18 2026" ...`）路线，退出码 0。打包为 `windows/output/AI-Image-Generator-windows.zip`（SHA256 `7A7ACE1C813197BF544DCED9FB17403FA5700ABFE9BB8FFB39A5E12314E9B1C3`），同样验证含 `ask-dialog-overlay`。
4. Push 后 CI run `28489094928` 四端全部 success（Android/Windows/macOS/iOS）。**下载 CI 产物逐一解包验证**（不是想当然认为绿了就行），macOS 的 `app.js` 在 `AI Image Generator.app/Contents/Frameworks/App.framework/Versions/A/Resources/flutter_assets/app.js`、iOS 在 `Runner.app/Frameworks/App.framework/flutter_assets/app.js`，两者 `ask-dialog-overlay` 均为 1。
5. 用 CI 产物（不是本地产物——CI 更权威，四端来自同一次真实构建）创建了正式 Release：
   **https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.2**
   （target = `main` 分支，即 commit `779eacb`）。5 个资产：`AI-Image-Generator-android.apk` / `-windows.zip` / `-macos.zip` / `-ios-unsigned.zip` / `SHA256SUMS.txt`。
6. `flutter analyze` → `No issues found!`；清理了所有 `C:\Users\Public\aigen_v102_*` 临时构建目录。

### 仍未做（唯一遗留项）

**没有真实 Android 设备验证**（这台机器没有 adb/模拟器）。Android 的原生失败模式是"静默无反应"（不是卡住），修复后应该表现为正常的页面内弹窗，但没有装机实测过。如果用户反馈 v1.0.2 在安卓上仍有问题，优先怀疑：APK 是否真的更新到了 v1.0.2（而不是覆盖安装失败还在跑旧版本）、WebView 版本是否过旧不支持某些 CSS（`.ask-dialog-overlay` 用了基础 flex/fixed 定位，理论上兼容性没问题）。

---

## 2026-07-01 补充：Android 正式签名密钥（commit `03bb1ad`）—— 极其重要，不要重新生成

### 用户反馈

"我的要求是在软件内更新安装包可以直接覆盖现有软件包更新"，随后补充"安卓手机更新可能会显示已经存在软件"。

### 根因

`android/app/build.gradle` 里 release 构建一直写着 `signingConfig = signingConfigs.debug`（模板自带的 `// TODO: Add your own signing config`，从来没人填过）。Flutter 的 debug keystore 是**每台构建机器/每次 CI runner 各自随机生成**的，不随仓库走。后果：

- 我在这台 Windows 机器上的历次本地构建、和 GitHub Actions 云端构建（生成 v1.0.2 那次），彼此签名很可能就不一样。
- Android 系统要求新旧 APK 签名完全一致才允许"覆盖安装升级"，不一致会直接拒绝，表现为"应用未安装"或感觉上"已经存在冲突的包"——这正是用户反馈的现象。
- 这不是一次性问题：只要没有固定签名，**以后每次 GitHub Actions 重新构建都会用新的随机 debug key**，导致所有未来版本之间永远无法互相覆盖更新。

### 修复：生成持久签名密钥，本地+CI 统一使用

1. **密钥文件位置**（不在 git 仓库里，也不在任何多用户共享目录）：
   ```
   C:\aigen-signing\ai-image-generator-release.jks
   C:\aigen-signing\CREDENTIALS-DO-NOT-LOSE.txt   ← 含 storePassword（keyPassword 与其相同，PKCS12 格式不支持二者不同）
   ```
   这个目录用 `icacls` 显式锁定了权限，只有当前 Windows 用户账号 + SYSTEM + Administrators 可读。**必须由用户手动把这整个文件夹备份到密码管理器或加密云存储**——这台机器一旦重装/丢失，密钥就永久丢失，届时所有已装用户都无法再收到可覆盖安装的更新，只能重新手动安装。
   - 路径最初生成在 `C:\Users\浪白\android-signing\`（含中文用户名），因为 Gradle/JVM 在这台机器上对含中文的路径解析有编码问题（跟本项目其他地方"中文路径导致构建崩溃"是同一类坑），后来搬到了纯 ASCII 的 `C:\aigen-signing\`。**以后任何跟这把密钥相关的操作都不要再用含"浪白"的路径。**
2. **`android/key.properties`**（本地专用，被 `android/.gitignore` 排除，不进仓库）：
   ```properties
   storePassword=...
   keyPassword=...
   keyAlias=aigen_release
   storeFile=C:\\aigen-signing\\ai-image-generator-release.jks
   ```
   写这个文件时**踩过一个坑**：PowerShell `Set-Content -Encoding UTF8`（Windows PowerShell 5.1）会在文件开头加 UTF-8 BOM，Java 的 `Properties.load()` 不会自动跳过 BOM，导致第一个键名（`storePassword`）被污染、读出来是 `null`——`gradlew signingReport` 当时能识别出 storeFile/alias 但死活不显示 SHA 指纹，就是这个原因。用 `[System.Text.UTF8Encoding]::new($false)`（不写 BOM）重写后才正常。**以后如果 `key.properties`/类似 properties 文件在 Windows 上莫名其妙读不到值，先查 BOM。**
3. **`android/app/build.gradle`**：新增读取 `key.properties` 的逻辑，`release` 签名优先用它，文件不存在时回退 debug 签名（保证没有这把密钥的人本地 `flutter build apk --release` 不会报错，只是签名不稳定）。
4. **GitHub Secrets**（已通过 `gh secret set NAME < file`，从文件读取、密码从未出现在任何命令行参数或对话输出里）：
   ```
   ANDROID_KEYSTORE_BASE64    ← keystore 文件的 base64
   ANDROID_KEYSTORE_PASSWORD
   ANDROID_KEY_PASSWORD
   ANDROID_KEY_ALIAS          ← "aigen_release"
   ```
   `gh secret list --repo 2786886095/Langbai-api-image-Studio` 可以看到这 4 个名字（看不到值）。
5. **`.github/workflows/build-all-platforms.yml`** 的 `android` job 新增了一步 "Restore release signing keystore"：构建前从上述 4 个 secrets 还原出 `android/app/release-keystore.jks` + `android/key.properties`（相对路径 `storeFile=release-keystore.jks`，因为 `file()` 在 `android/app/build.gradle` 里是相对 `android/app/` 解析的，跟本地用绝对路径是两种写法，都对）。secret 未配置时会打印提示并回退 debug 签名，不会让构建失败。

### 已验证（双向指纹比对，不是只看"构建成功"）

- 本地：`gradlew signingReport` 显示 release 变体 `SHA1: C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`（debug 变体是完全不同的 `6D:53:1A:79:...`）。
- 本地：在锁权限的 ASCII 目录 `C:\aigen-release-build` 里跑了一次真实的 `flutter build apk --release`（验证完已删除该目录，只是当时被工具拦下没删成功，`C:\aigen-release-build` 可能还留着，可手动清理），`keytool -printcert -jarfile <apk>` 读出的证书指纹跟 signingReport 完全一致。
- CI：推送后触发 run `28491578220`，Android job success；下载该 artifact 用 `keytool -printcert -jarfile` 验证，指纹**同样是** `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`——跟本地构建完全一致，证明本地和云端现在用的是同一把签名。

### 尚未做

1. **还没有创建新 Release**。v1.0.2（已发布）用的是旧签名，这次修复本身不改变已发布产物。下次发布新版本时（无论叫 v1.0.3 还是别的号），会自动用新签名——这将是第一个用户能"覆盖更新"的起点，但**用户现有的 v1.0.2 装机需要手动卸载重装一次**才能吃到它，之后的版本间就会正常了，这点在 Release notes 里应该写清楚。
2. **没有真机验证覆盖安装本身**（这台机器没有 adb/设备）。指纹比对证明了签名一致性在密码学上是对的，但完整的"用户点下载并安装 → 系统弹出更新确认 → 装完自动打开新版本"这条 UI 交互链路，仍然建议装机实测一次。
3. **Windows 端的"下载并安装覆盖"逻辑**也做了一次代码审查（`lib/main.dart` 的 `_writeWindowsUpdateScript`）：等旧进程退出→解压→`Copy-Item -Recurse -Force` 覆盖安装目录→重启，逻辑合理；且确认了 CI 产出的 zip 是"文件直接在根目录"的扁平结构（`Compress-Archive -Path .../Release/*`），跟脚本的 `Expand-Archive` + `Copy-Item (Join-Path $extract '*')` 预期结构一致，**没有发现结构性问题**，但同样没有做过一次真实"从旧版本升级到新版本、覆盖安装并重启"的端到端实测。
