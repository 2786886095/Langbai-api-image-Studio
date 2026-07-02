# Codex Handoff: AI 图片生成器 v1.0.6

更新时间：2026-07-02  
项目路径：`F:\AI\agent\图像生成`  
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`

## 本轮结论

本轮已完成 `v1.0.6` 修复线，重点是软件端硬性功能排查、桌面网络代理、重试反馈和回归加固。

已完成：

- 新增全局“电脑端网络代理”设置：
  - 默认 `http://127.0.0.1:7890`
  - 可选 `socks5://127.0.0.1:10808`
  - 可选直连
  - 可选自定义，仅接受 `http://host:port`、`https://host:port`、`socks5://host:port`
- 保留原 `api-proxy.js`，并把 API 表单里的旧代理字段改名为“浏览器 CORS 转发地址”，避免和桌面代理混淆。
- 桌面壳 native 请求统一附带代理配置：
  - API 生图请求
  - 模型检测请求
  - GrsAI 轮询请求
  - GitHub 更新检查
  - 更新包下载
  - 远程图片重新加载/下载
- Flutter/Dart 网络层新增代理解析，桌面端设置 `HttpClient.findProxy`：
  - `direct -> DIRECT`
  - `http/https -> PROXY host:port`
  - `socks5 -> SOCKS host:port`
  - Android 默认忽略桌面代理并走 `DIRECT`
- 新增“测试代理”按钮：
  - 桌面壳通过同一条 `_nativeFetch` 链路测试 GitHub Release API
  - 浏览器端提示改用系统/浏览器代理或 `api-proxy.js`
- 修复一个真实硬 bug：
  - 历史项目还原时调用了不存在的 `renderThumbs()`，导致按钮看似无反应；已改为 `renderThumbGrid()`。
- 重试逻辑收紧：
  - 只有 HTTP 400 自动重试
  - 一旦成功返回图片数据立即停止重试
  - 非 400 直接失败，不继续重试
  - 重试中状态会显示“第 N/M 轮自动重试”
- 回归测试加固：
  - 捕获未处理 JS 异常和 `console.error`，有任何硬错误直接失败
  - 新增桌面代理 payload 冒烟测试
  - 新增语言菜单点击测试
  - 新增重试轮次、成功即停、非 400 不重试测试

## 关键改动文件

- `index.html`
  - 资源 query 升到 `20260702-1-0-6`
  - 新增 `#desktopProxyMode`、`#desktopProxyCustomUrl`、`#testDesktopProxy`、`#desktopProxyStatus`
  - 当前版本显示升到 `v1.0.6`
- `app.js`
  - `APP_VERSION = "1.0.6"`
  - `SETTINGS_KEY` 新增 `desktopProxyMode`、`desktopProxyCustomUrl`
  - 新增 `resolveDesktopProxyConfig()`、`withDesktopProxyPayload()`、`testDesktopProxy()`
  - `smartFetch()`、`nativeDownload.nativeFetchPayload()`、`nativeDownload.nativeFetchBlob()`、`downloadUpdate()` 都会带代理 payload
  - `fetchLatestReleaseInfo()` 改走 `smartFetch()`，桌面更新检测也能走代理
  - `retryTransient()` 新增 `onRetry` 回调，并只对 HTTP 400 重试
  - 修复 `clearAllReferenceImages()` 的错误函数引用
- `lib/proxy_config.dart`
  - 新增桌面代理解析纯函数
- `lib/main.dart`
  - `_nativeFetch()` 和 Windows 更新包下载统一使用 `_createNetworkClient()`
  - 桌面端应用 `HttpClient.findProxy`
- `test/proxy_config_test.dart`
  - 覆盖默认 HTTP、SOCKS5、直连、自定义、非法自定义、非桌面忽略代理
- `qa/regression-runner.js`
  - 扩展控件和代理回归
  - 捕获 runtime exception / console error
  - 覆盖重试轮次和语言菜单可点击性
- `sw.js`
  - `CACHE_NAME = "ai-image-generator-1-0-6-20260702"`
- `pubspec.yaml`
  - `version: 1.0.6+7`
- `android/app/src/main/assets/`
  - 已同步 `index.html`、`app.js`、`style.css`、`sw.js`、`manifest.webmanifest`

## 已通过验证

```powershell
node --check app.js
node --check qa\regression-runner.js
flutter test
flutter analyze
node qa\regression-runner.js
```

回归输出包含：

```text
[qa] API config save, restore, delete, and mobile scroll
[qa] Reference image sorting, single file picker click, and auto-fill template
[qa] Comic generation history as project, restore, and ZIP export
[qa] 400-only retry, clear while generating, reload failed image, and i18n layout
[qa] Desktop proxy settings and native payload propagation
[qa] Settings update controls and platform package selection
[qa] All regression checks passed.
```

## 仍需发布验证

- Android release/debug 已在 ASCII 路径 `F:\AI\agent\aigen_build_106` 构建通过。
- Android release APK 已复制到：
  `android/output/AI-Image-Generator-v1.0.6-android.apk`
- Android debug APK 已复制到：
  `android/output/AI-Image-Generator-v1.0.6-android-debug.apk`
- Android release 签名已验证，SHA1 仍为：
  `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`
- APK SHA256 已写入：
  `android/output/SHA256SUMS-v1.0.6.txt`
- Windows release build 在本机未通过，原因是缺少 Visual Studio 2019/Windows C++ 构建工具：
  `CMake Error: Visual Studio 16 2019 could not find any instance of Visual Studio.`
- GitHub Actions 四端 artifacts 下载后确认：
  - `app.js` 为 `APP_VERSION = "1.0.6"`
  - `index.html` query 为 `20260702-1-0-6`
  - Android assets 与根目录资源一致
- 创建 GitHub Release `v1.0.6` 并上传四端包和 `SHA256SUMS.txt`

## 发布说明建议

```text
v1.0.6 增加桌面端网络代理设置（HTTP 7890、SOCKS5 10808、直连、自定义），桌面软件的生图、模型检测、GitHub 更新检测、更新包下载和远程图片加载会统一走该代理；保留浏览器 CORS 转发地址作为纯 HTML 方案。修复历史项目还原按钮无反应问题。重试逻辑调整为仅 HTTP 400 自动重试，成功返回图片立即停止，非 400 直接失败，并显示第 N/M 轮重试状态。回归测试新增运行时异常捕获、语言菜单、代理 payload、重试轮次等硬性功能检查。
```

## 注意

`CLAUDE_HANDOFF.md` 保留更早的历史、签名和发布记录。Android 正式签名密钥不要重新生成，否则会破坏覆盖更新链。
