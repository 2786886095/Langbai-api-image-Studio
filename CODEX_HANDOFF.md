# Codex 交接文档：AI 图片生成器 v1.0.5 修复轮

更新时间：2026-07-02
项目路径：`F:\AI\agent\图像生成`
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`

## 当前结论

本轮接手 Claude 留下的 `v1.0.4` 后问题，已在工作区完成 `v1.0.5` 修复，尚未发布前请以本文为准。

已处理：

- 软件内更新不会再在“已是最新版”时继续下载/安装。
- 检查更新后会根据版本结果禁用/启用“下载更新包”和“下载并安装”。
- 更新区补齐当前版本、最新版本、匹配到的平台资源名、GitHub Release notes，交互更接近用户给的 Codex++ 示例。
- 模型检测结果不再只依赖 `datalist`，新增应用内可点击模型候选面板，Android/WebView 不弹系统候选框时也能选择。
- 点击模型检测、目录选择会立即显示状态反馈，避免看起来像按钮无响应。
- Android 目录/文件选择器启动失败会立刻回传错误；目录授权失败时改为尽力保存 URI，避免部分文件管理器直接中断。
- Windows “选择图片/ZIP 目录”从“只创建默认目录”改成真正弹出系统文件夹选择器，并保存到 `%APPDATA%\AI Image Generator\settings.json`。
- 版本已升到 `1.0.5+6`，Web cache/query 已升到 `20260702-1-0-5`。
- Android assets 已同步并 SHA256 比对一致。

仍需真机/实机验证：

- Android 真机上 `ACTION_OPEN_DOCUMENT_TREE` 是否能正常弹出并保存目录。
- Android 真机上系统 APK 安装器能否从 `v1.0.4` 覆盖到 `v1.0.5`。
- Windows 实机从旧版点“下载并安装”后，PowerShell 覆盖更新脚本是否完整替换并重启。

## 关键改动文件

- `app.js`
  - `APP_VERSION = "1.0.5"`。
  - 新增 `latestUpdateInfo`、版本结果状态管理、同版本下载拦截。
  - `window.AiGenUpdate.APP_VERSION` 暴露给回归测试。
  - 更新区写入匹配资源名和 Release notes。
  - 新增 `setModelChoices()` 和模型候选按钮面板。
  - 模型检测/目录选择增加即时状态反馈。
- `index.html`
  - 资源 query 改为 `20260702-1-0-5`。
  - 更新区新增 `#updateAssetLabel`、`#updateNotes`。
  - 模型输入区新增 `#modelChoices`。
- `style.css`
  - 新增模型候选按钮样式。
  - 新增更新 notes 滚动文本框样式。
- `sw.js`
  - `CACHE_NAME = "ai-image-generator-1-0-5-20260702"`。
- `lib/main.dart`
  - 新增 `file_selector`。
  - Windows `chooseDir` 改为 `getDirectoryPath()` 真文件夹选择器。
  - Windows 路径保存到 `%APPDATA%\AI Image Generator\settings.json`。
- `android/app/src/main/kotlin/com/aigen/ai_image_generator/MainActivity.kt`
  - `chooseFiles()` / `chooseDirectory()` 启动系统选择器时加异常回传。
  - 目录持久化授权失败不再中断成功选择流程。
- `qa/regression-runner.js`
  - 新增模型候选面板点击回归。
  - 新增同版本更新禁止下载/安装回归。
  - 检查更新资源名和 Release notes 渲染。

## 已通过验证

```powershell
node --check app.js
node --check qa\regression-runner.js
node qa\regression-runner.js
flutter pub get
dart format lib\main.dart
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

Android assets 同步文件：

```text
index.html
app.js
style.css
sw.js
manifest.webmanifest
```

同步后 SHA256 全部一致。

## 发布建议

下一步建议提交并发布 `v1.0.5`：

1. `git add` 本轮改动。
2. commit：`fix: harden updater and native pickers`
3. push 到 `main`，等待 GitHub Actions 四端构建成功。
4. 下载 CI artifacts，确认：
   - `app.js` 中 `APP_VERSION = "1.0.5"`。
   - `index.html` 中 `20260702-1-0-5`。
   - Android APK 签名仍为 `SHA1: C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
5. 创建 GitHub Release `v1.0.5`，上传 Android/Windows/macOS/iOS unsigned artifacts 和 `SHA256SUMS.txt`。

Release notes 建议写：

```text
1.0.5 修复软件内更新在最新版时仍会重装的问题；新增更新资源和 Release notes 展示；模型列表改为应用内可点击选择；Windows 目录选择改为真正的系统文件夹选择器；加固 Android 文件/目录选择器错误回传。
```

## 注意

`CLAUDE_HANDOFF.md` 仍保留完整历史、签名密钥、旧版本发布记录。Android 正式签名密钥不要重新生成，否则会再次破坏覆盖更新链。
