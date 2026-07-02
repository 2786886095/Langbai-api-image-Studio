# Claude Handoff: AI 图片生成器 v1.0.6 audit2

更新时间：2026-07-02  
项目路径：`F:\AI\agent\图像生成`  
GitHub：`https://github.com/2786886095/Langbai-api-image-Studio`  
当前 Release：`https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v1.0.6`

## 先读这个

这份文档是给 Claude 接手用的当前状态说明。旧的 v1.0.2 / v1.0.3 / v1.0.4 发布过程已经过期，不要按旧步骤操作。

当前核心状态：

- 应用版本：`APP_VERSION = "1.0.6"`
- Flutter 版本：`pubspec.yaml` 为 `1.0.6+7`
- 前端缓存/query：`20260702-1-0-6-audit2`
- Service Worker cache：`ai-image-generator-1-0-6-20260702-audit2`
- Android assets 已与根目录 Web 文件同步
- 本轮没有 commit / push

## 用户最新明确要求

用户要求：

- 深度扫描软件功能是否还有硬 bug。
- 按 GrsAI 官方调用文档做适配：`https://qmy27nhsd9.apifox.cn/452409160e0`
- 只有用户选择 `GrsAI 生图 API` 时才使用 GrsAI 官方模式。
- 选择 `官方 API` / `自定义 API` 时，以通用 OpenAI 兼容模式为主。

这个要求已经落地，并有回归测试覆盖。

## 本轮完成内容

### GrsAI 官方适配

文件：`app.js`

已按官方文档适配：

- GrsAI 默认地址：`https://grsai.dakka.com.cn/v1/api/generate`
- 官方网站提示：`https://grsai.com/zh`
- 生成接口：`POST /v1/api/generate`
- 轮询接口：`GET /v1/api/result?id=...`
- 鉴权：`Authorization: Bearer sk-...`
- `replyType: "json"`
- `nano-banana` 系列使用官方 `aspectRatio` + `imageSize`
- `gpt-image-2` 系列使用像素尺寸作为 `aspectRatio`
- 参考图对 GrsAI 只传纯 base64 或 URL，不传 `data:image/...` 前缀
- 轮询增加上限：`GRSAI_MAX_POLL_COUNT = 180`
- 轮询 HTTP 400 会保留官方错误原因，例如额度、违规、参数错误

官方模型清单已固化：

- `gpt-image-2`
- `gpt-image-2-vip`
- `nano-banana`
- `nano-banana-fast`
- `nano-banana-2`
- `nano-banana-2-cl`
- `nano-banana-2-2k-cl`
- `nano-banana-2-4k-cl`
- `nano-banana-pro`
- `nano-banana-pro-vt`
- `nano-banana-pro-cl`
- `nano-banana-pro-vip`
- `nano-banana-pro-4k-vip`

### Provider 路由规则

重要：不要改回“只按地址判断平台”。

现在规则是：

- API 类型选择 `GrsAI 生图 API`：走 GrsAI 官方 `/v1/api/generate` + `/v1/api/result`。
- API 类型选择 `官方 API`：走 OpenAI 兼容通用路线。
- API 类型选择 `自定义 API`：走 OpenAI 兼容通用路线，即使地址里包含 `grsai.dakka.com.cn` 也不能自动切 GrsAI。

关键实现：

- `findAdapter(endpoint, provider)`
- GrsAI adapter 标记：`provider: "grsai"`
- `callImageAPI()`、`detectModelsForAdapter()`、`currentApiConfig()`、`updateApiQuickState()` 均传入 provider。
- `apiEndpoint` change 事件不再把自定义 GrsAI 域名自动改成 GrsAI 类型。

回归中已经断言：

- 选 GrsAI 时请求 `https://grsai.dakka.com.cn/v1/api/generate`
- 选自定义且地址为 GrsAI 域名时，请求 `/v1/images/generations`

### 已修复的硬问题

本轮及上一轮累计已修复：

- 图片链接预览失败但下载正常时，“重新加载图片”现在复用下载字节链路，转成本地 `blob:` 预览。
- 清空未完成生成时，生成按钮会恢复，不会一直显示还在生成。
- 只有 HTTP 400 自动重试；成功返回图片立即停止；非 400 不重试。
- 重试状态显示“第 N/M 轮自动重试”。
- 头部导出入口显示并可用，移除旧侧栏残留逻辑。
- 漫画历史按项目保存，图片级提示词只保留分镜提示词。
- 桌面代理设置已接入 native fetch payload。
- 浏览器 CORS 转发地址和桌面网络代理已区分。

## 关键文件

- `index.html`
  - CSS/JS query 为 `20260702-1-0-6-audit2`
  - API 类型下拉：官方 API / GrsAI 生图 API / 自定义 API
  - 设置弹窗含桌面代理区

- `app.js`
  - 主业务逻辑
  - GrsAI 官方适配
  - provider-aware adapter routing
  - 400-only retry
  - blob 重新加载图片
  - 桌面代理 payload

- `qa/regression-runner.js`
  - 浏览器端完整硬功能回归
  - 新增 GrsAI 官方 generate/result 流程覆盖
  - 捕获 runtime exception / console.error

- `lib/main.dart`
  - Flutter WebView shell
  - native fetch / 下载 / 更新包处理

- `lib/proxy_config.dart`
  - 桌面代理解析

- `android/app/src/main/assets/`
  - 已同步根目录 `index.html`、`app.js`、`style.css`、`sw.js`、`manifest.webmanifest`

- `CODEX_HANDOFF.md`
  - Codex 侧更长的历史交接，可作为补充阅读

## 已通过验证

最近一次验证命令均通过：

```powershell
node --check app.js
node --check qa\regression-runner.js
node qa\regression-runner.js
flutter test
flutter analyze
```

浏览器回归输出包含：

```text
[qa] API config save, restore, delete, and mobile scroll
[qa] Reference image sorting, single file picker click, and auto-fill template
[qa] Comic generation history as project, restore, and ZIP export
[qa] 400-only retry, clear while generating, reload failed image, and i18n layout
[qa] Desktop proxy settings and native payload propagation
[qa] GrsAI official generate/result adapter behavior
[qa] Settings update controls and platform package selection
[qa] All regression checks passed.
```

同步校验：

- 根目录 Web 文件与 `android/app/src/main/assets/` 对应文件 SHA256 一致。
- `git diff --check` 只有 Windows 换行提示，无空白错误。

## 当前工作区状态

截至本交接文档生成时，工作区有未提交改动。不要误以为已经发布到 GitHub。

主要改动文件：

- `CLAUDE_HANDOFF.md`
- `CODEX_HANDOFF.md`
- `README.md`
- `app.js`
- `index.html`
- `qa/regression-runner.js`
- `sw.js`
- `style.css`
- `android/app/src/main/assets/app.js`
- `android/app/src/main/assets/index.html`
- `android/app/src/main/assets/style.css`
- `android/app/src/main/assets/sw.js`
- `windows/runner/Runner.rc`

注意：还有一些 Flutter 生成文件可能因本机工具运行出现换行提示，不要无脑重置。先看 `git diff` 再决定。

## 发布状态与未完成

已知发布状态：

- GitHub Release `v1.0.6` 已存在。
- Android v1.0.6 release/debug APK 之前已构建过，并放在 `android/output/`。
- Android 正式签名 SHA1 应保持：
  `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`

本轮新增 audit2 后尚未完成：

- 未重新打包 APK。
- 未重新构建 Windows/macOS/iOS 包。
- 未 commit。
- 未 push。
- 未更新 GitHub Release 附件。

如果继续发布：

1. 先跑完整验证。
2. 在 ASCII 路径构建 Android，避免中文路径导致 Flutter AOT/Shader 问题。
3. 确认 APK 签名 SHA1 不变。
4. 重新生成 SHA256。
5. 再决定是否替换 Release 附件或发布 `v1.0.6-audit2` / `v1.0.7`。

## 建议 Claude 下一步

如果用户要求“继续完善/发布”：

1. 先运行：

```powershell
git status --short
node --check app.js
node --check qa\regression-runner.js
node qa\regression-runner.js
flutter test
flutter analyze
```

2. 检查是否需要真实 GrsAI Key 做一次手动 smoke：

- API 类型选 `GrsAI 生图 API`
- 地址为 `https://grsai.dakka.com.cn/v1/api/generate`
- 模型选 `nano-banana` 或 `gpt-image-2`
- 无参考图、单张出图
- 有参考图、单张出图
- 异步 running 轮询能返回图片

3. 如果用户仍反馈按钮无反应：

- 先确认用户安装的是包含 audit2 的包，不是旧 APK/旧桌面包。
- 让用户清缓存或重装。
- 在软件设置里检查版本和资源 query。
- 对安卓设备重点排查 native bridge：`MainActivity.kt` 的下载、路径选择、native fetch 路径。

4. 如果要发 GitHub：

- 不要直接覆盖旧 Release 附件，除非用户明确允许。
- 推荐发 `v1.0.7`，因为 audit2 已改变运行逻辑。

## 禁忌

- 不要恢复旧侧栏 UI。
- 不要把 GrsAI 路由改回“只看 URL 自动判断”。
- 不要让自定义 API 被 GrsAI 域名强制切换 provider。
- 不要把桌面代理和浏览器 `api-proxy.js` 混成一个设置。
- 不要重新生成 Android 签名密钥。
- 不要跳过 `node qa\regression-runner.js`，用户之前大量反馈都是按钮/滚动/弹层类硬问题。
