# Codex / Claude Handoff: AI 图片生成器 v1.6.19

更新时间：2026-07-31
项目路径：`F:\AI\agent\codex\Langbai-api-image-Studio-v145-publish`
仓库：`https://github.com/2786886095/Langbai-api-image-Studio`

## 当前状态

- 本交接对应源码版本 `1.6.19+96`；线上发布状态以 GitHub Releases 实际页面为准。

## v1.6.19 Gemini 网页原生 2K 修复

- 2K 请求改用网页“制作图片”对应的 Advanced Fast/Pro 图片工具协议。
- `c8o8Fe` 完整尺寸请求保留并发送 StreamGenerate 的签名图片令牌、描述符与会话路径。
- `resolution_intent=2k` 已从任务透传到直接协议；原图恢复检查点保存定位字段，但不保存 Cookie。
- 真实协议验证输出 `2048×2048` PNG、5,669,081 字节；复放结果与网页下载 SHA-256 一致。

## v1.6.18 Gemini 原图中转域名与持续恢复修复

- 根因：Google 原图解析第一跳实际返回 `work.fife.usercontent.google.com`，旧 JS 白名单只接受 `googleusercontent.com/ggpht.com`，因此合法地址被清空。
- `gemini-embedded-worker.js`、`gemini-web-direct-protocol.js` 与 `lib/gemini_embedded_browser.dart` 已统一允许 HTTPS `usercontent.google.com` 子域。
- 同任务原图恢复最长 60 轮、每轮间隔 10 秒；只处理现有 `direct_image_ready` 检查点，不重新提交生图。
- 真实验收任务 `gemini_1785417252522907_9e9711a5` 成功；原图 `1408×768`、1,015,725 字节、SHA-256 `F77990164501C59B976987710AA6D0D0EF37C401AF567AD08314A45059710AE2`，审计为 `transform=none`。

## v1.6.17 Gemini 原图下载错误提示修复

- 根因：`app.js` 中 `gemini_generated_image_recovery_failed` 的简体中文文案在历史编辑中已被真实问号字符覆盖，不是运行时字体问题。
- `image-task-stability.js` 新增 `result_recovery_failed` 分类；图片已生成但原图下载失败不再归入 `provider_ui_unavailable`。
- 此分类使用 `retryPolicy=never`，防止自动重提已经成功生成的任务并重复消耗额度。
- 回归必须断言错误标题为“Gemini 原图下载失败”、正文不存在 `????`，并且不出现“网页界面能力不可用”。

## v1.6.16 工作区与 Gemini 专属尺寸实装修复

- 活动结果图片与活动历史项目 ID 已从工作区草稿 schema 2 中彻底移除；任何自动重载或新启动都只可恢复未保存文字，图片必须由用户从“历史”中主动恢复。
- Gemini 供应商启用独立官方 1K / 2K 尺寸组，其他供应商保留原尺寸、自定义尺寸和用户常用尺寸；切换供应商会分别记住本次会话中的选择。
- 用户样图 `panel-1（1）.png` 虽为 `1536×1024`，本机任务 `gemini_1785399255491955_e36dd828` 的审计明确记录 `downloaded_fullsize=512x343`、`final_size=1536x1024`，旧版是在放大预览图。
- `gemini-web-direct-protocol.js` 新增 `c8o8Fe` Batchexecute 原图 RPC，生成完成后以 `cid/rid/rcid/image_id` 获取 `fullSizeUrl`。
- 真实临时会话中 `c8o8Fe` 可能返回 `BardErrorInfo 1003`；`gemini-embedded-worker.js` 会将生成预览 URL 仅作为原图定位器，经 `=d-I?alr=yes` 两级鉴权跳转取得原始 PNG。下载候选只允许该最终原图，禁止保存预览图或 `=s2048` 变体。
- `gemini-embedded-worker.js` 按网页协议执行 `=d-I?alr=yes` 两级文本跳转，再下载最终原图；Windows 增加受 Google 主机白名单约束的 `resource-download-request`，Cookie 仍只留在 WebView2/原生网络层。
- 多个下载候选改为解码后按真实像素数选优，不再按 Blob 字节大小选优。
- Gemini 新任务固定 `size_mode=native_fullsize`；工作器与前端二次复核均保留原图尺寸，不裁切、不缩小、不放大。全局分辨率只决定请求的最接近构图比例，审计中的 `final_size` 必须等于 `downloaded_fullsize`。

## v1.6.14 Windows 主 WebView 防误重载与工作区恢复

- 根因一：旧逻辑对所有 WebView2 `ProcessFailed` 类型都重建主控制器；GPU、Utility、Frame 等辅助进程本可由 WebView2 自愈，却触发整页闪白。
- 根因二：20 秒健康检查连续两次 JavaScript 探针超时就销毁控制器；当 WebView RPC 正忙时会误判，造成无条件数据丢失。
- `windowsProcessFailureRequiresRebuild()` 现在只允许 kind 0（BrowserProcessExited）和 kind 1（RenderProcessExited）重建；辅助进程故障仅记录日志。
- 健康探测仅作遥测，不再触发破坏性恢复；真实主进程退出仍由 `onProcessFailed` 恢复。
- `ai_image_gen_workspace_draft_v1` 每 5 秒及输入变化时保存元数据草稿，恢复模式、提示词、分镜/嵌字行、尺寸、重试次数和历史项目结果；不保存 API Key、Cookie、图片字节或参考图本体。
- 回归包含完整文档导航重载，验证 `__AI_GEN_APP_READY`、未保存提示词、项目 ID 与结果卡均恢复。
- Gemini `content-push.googleapis.com/upload` 当前返回的有效值可能是 `/contrib_service/ttl_1d/...` 相对文件标识，而非 `https://` URL；`normalizeUploadedFileIdentifier()` 已兼容纯文本/JSON 字符串形式，并限制为该路径或 Googleusercontent HTTPS 地址。

## v1.6.13 Gemini 真实生图与鉴权下载修复

- 根因一：Gemini 直连返回的 `lh3.googleusercontent.com/gg-dl/...` 图片地址要求登录会话；页面 `fetch()` 受 CORS 限制，普通 Dart `HttpClient` 即使附带 Cookie 仍会返回 403。
- 修复：Windows WebView2 宿主新增仅供 Dart 调用的 DevTools 协议桥；`Network.loadNetworkResource(includeCredentials=true)` 和 `IO.read` 在原登录会话内读取图片，再把图片字节交给现有缓存与尺寸处理链。Cookie 不返回给 Gemini 页面 JavaScript。
- 根因二：非终态任务重启时会回到 `waiting_for_browser/preparing_temporary_chat`，但已有 `direct_image_ready` 检查点恢复成功后需要直接进入 `locating_full_size`；旧状态机把这条安全恢复路径拒绝为 409。
- 修复：仅当任务持有经过网关净化的 `direct_image_ready` 检查点时，允许从准备态进入原图恢复态；没有检查点的任务仍不能跳过提交状态。
- 直连额度回退保持单调状态，不再从 `generating` 倒退到准备/上传/提交；自动模型对齐当前网页模式，并仅在明确未生成图片时尝试 Fast 或网页回退。
- 真实验收任务 `gemini_1785393219008967_c74bf8a5` 已成功完成；下载结果为 203,209 字节、`512×512` PNG、SHA-256 `03C890E0A401C7B638CC8E788321B6699D9A0E15D5711D410859E83ECDC819C2`。
- 分支 CI `30519317779` 已在升版前通过四端构建；正式 v1.6.13 发布仍须以 main 的最终 CI、包内版本和 Release 资产校验为准。

## v1.6.12 Gemini 直连额度误判与网页回退修复

- 现场证据：同一账号、同一内置浏览器手动生成“芙宁娜图片”成功，但 `StreamGenerate` 直连响应为“额度重置后才能生成图片”。
- 根因：Gemini 当前网页生图工具与旧直连协议并不总是共享同一条额度路由；软件把直连路由拒绝错误升级成账号全局额度耗尽。
- `gemini-web-direct-protocol.js` 现在返回 `gemini_direct_quota_unavailable` 和 `safeToFallbackToUi=true`，不再直接污染账号状态。
- `gemini-embedded-worker.js` 仅在直连明确终止且确认没有图片时回退网页流程；可能已提交或状态不明的错误仍禁止重复提交。
- 若网页流程也明确返回额度耗尽，原有账号状态记录和自动切换逻辑继续生效。

## v1.6.11 Gemini 中文额度响应识别修复

- 真实失败任务 `gemini_1785384578931547_f5942c4d` 的响应包含“额度重置后才能生成图片”，证明短提示词已进入 Gemini 图片生成链路。
- `gemini-web-direct-protocol.js` 原中文正则发生乱码，导致一次误判 `moderation_blocked`、一次落入 `gemini_no_image_returned`；现改为 Unicode 转义规则。
- 明确识别“额度限制影响图片生成”“额度重置后才能生成图片”“图片生成额度耗尽”等响应并返回 `quota_exhausted`。
- 网关收到 `quota_exhausted` 后沿用现有账号冷却与自动切换逻辑；首次请求没有图片，因此切换账号不会造成同一账号重复生成。
- 审核规则不再用宽泛的“无法生成”单独判定，避免把额度提示误归为内容审核。

## v1.6.10 Gemini 直接协议启动门禁修复

- v1.6.9 的 `geminiWebCapabilities()` 在直接协议可用时正确返回 `temporary_chat_required=false`，但 `gemini-web-image-adapter.js` 仍写死要求该字段为 `true`，导致软件启动后把可用账号误报为“缺少能力：temporary_chat_required”。
- 能力校验现要求 `direct_protocol_available=true`，或传统路径的 `temporary_chat_available/temporary_chat_required=true`；两条生成运输路径均不可用时才返回 `gemini_generation_transport`。
- `geminiEmbeddedStatusText()` 同步接受直接协议能力，避免原生状态栏继续显示临时对话入口不可用。
- 浏览器完整回归使用与真实 v1.6.9 相同的能力组合：`temporary_chat_required=false`、`temporary_chat_available=false`、`direct_protocol_available=true`。
- 本修复不删除、不迁移、不覆盖 Gemini/ChatGPT 账号、API 配置、历史、缓存或参考图设置。

## v1.6.9 Gemini 网页直接调用

- `gemini-web-direct-protocol.js` 在已登录 Gemini WebView 内直接调用 `StreamGenerate`，Cookie 不离开页面进程，单图与漫画分镜均不再依赖可见输入框。
- 请求使用临时协议标志，但不会把它伪报成“临时对话已验证”；参考图使用 Gemini 上传通道，生成图片 URL 先写入私有恢复检查点，再交给现有下载、缓存、尺寸校验和原子保存链。
- 任务增加独立 claim 心跳；过期 claim 若可能已经提交会终止为“提交状态未知”，若已有图片检查点则只继续下载和保存，均不会自动重新生成。
- `gemini-embedded-worker.js` 只有在直接协议尚未提交请求且模块/令牌不可用时才进入旧页面备用流程；提交开始后禁止跨路线重试，避免重复扣额度。
- “额度限制影响图片生成”归类为 `quota_exhausted`，由现有网关把任务转交下一可用账号；没有其它账号时显示真实额度原因。
- Windows WebView2 增加 CDP `Input.insertText` 备用桥，但直接调用为默认路线。发布前必须由 Windows CI 编译该 C++ 变更。
- 协议互操作参考：`https://github.com/HanaokaYuzu/Gemini-API`。本仓没有引入该 Python 包，也没有保存或导出 Google Cookie。

## v1.6.8 全面稳定性与真实就绪门禁

- Gemini 状态拆分为登录就绪和生图就绪；只有 `temporary_chat_available`、`fullsize_download_available` 与当前 selector 协议同时成立才允许生成并自动收起登录界面。
- `gemini-embedded-worker.js` 不再把 URL 变化当作临时对话成功证据；若落入普通会话会返回首页并恢复同一任务检查点，图片基线在临时对话确认后才采集。
- Windows WebView2 使用同一环境下的命名 Profile 隔离账号，并在启动前迁移旧版 Gemini Profile；主程序增加单实例、APP_READY 健康探测和失败重建退避。
- ChatGPT/Gemini 的系统安全存储改为全局 FIFO，ChatGPT 账号状态采用原子写入、`.tmp`/`.bak` 恢复；安装器只结束当前安装目录中的内置网关。
- Web 任务生命周期重构：供应商快照、终态错误、取消、失败全重试、GrsAI 轮询、缓存/历史、离线 SW 版本一致性均有专项测试。
- 发布门禁：Node 全量回归、Flutter analyze/test、Windows 安装覆盖与数据保留、四端 CI、包内版本/资源哈希及 APK 签名。

## v1.6.7 Gemini 临时对话入口与假就绪修复

- `gemini-selector-pack.js` 加入当前网页稳定入口 `[data-test-id="temp-chat-button"]`，并补齐简繁中文“临时聊天”、启用/退出文案及临时对话页面提示文本。
- `gemini-embedded-worker.js` 的页面跳转检查点只表示“点击后发生过导航”，不再直接判定临时对话已启用；新页面必须通过按钮激活态、标题、状态文本或输入框提示再次验证。
- `GeminiAccountMetadata.available` 重新要求当前页面确认 `temporaryChatAvailable`；网页探测同时识别稳定 data-test-id 和已激活页面，避免 v1.6.6 的瞬时控件误判与历史 true 值造成假就绪。
- Gemini 选择器、临时对话校验及历史守卫错误归类为 `provider_ui_unavailable`，不会再因为 HTTP 502 被显示成 ChatGPT 上游断开。
- 回归覆盖 `selector_pack_outdated`、`gemini_temporary_chat_unavailable`、`temporary_chat_unverified`、`temporary_chat_guard_failed`，并保持所有账号、API、历史、路径和缓存数据原位升级。

## v1.6.6 Gemini 账号就绪与批量 409 闪烁修复

- `GeminiAccountMetadata.available` 不再依赖页面瞬时的临时对话控件探测；登录、额度、冷却和完整尺寸下载能力仍为硬条件，临时对话由任务工作器逐次验证。
- 生成前强制读取 `/v1/accounts` 并要求至少一个可用账号；不可用时不创建结果卡、不提交图片任务。
- 网关将无账号、登录失效、额度冷却和页面未就绪分别返回 409/401/429/409 及独立错误码，前端不会再把账号状态误报成限流。
- 防回归覆盖普通健康检查与生成预检并发、瞬时临时对话探测为 false、拒绝后账号状态刷新，以及重复提交计数保持不变。

## v1.6.5 Gemini 无限生成收口与参数恢复

- `gemini-embedded-worker.js` 不再把控制点击等同于提交成功；发送后 15 秒内必须观察到输入框清空、新用户消息、响应启动或生成状态，否则以 `gemini_submission_not_acknowledged` 结束。
- 每次请求都追加明确的直接生图指令；纯文字回复稳定 45 秒且页面已停止生成时返回 `gemini_no_image_returned`，绝对等待超过 20 分钟返回 `gemini_no_image_timeout`。
- 图片发现从单纯 URL 集合升级为 DOM 节点和 `src/srcset/真实尺寸` 签名，兼容复用 URL 或原节点更新。
- Gemini 专属配置恢复 `modelPreference=auto/fast/pro` 与 `qualityIntent=fast/standard/detail`，完整进入配置持久化和任务请求；其它供应商字段保持隔离。
- 回归覆盖参数保存、请求透传、无图终止、提交确认、Android 内嵌资源同步。

## v1.6.4 Gemini 真实生成与精确尺寸修复

- Windows Gemini 隐藏 WebView 的临时对话、发送等控件改用 WebView2 CDP 可信鼠标事件；普通 `element.click()` 在当前 Gemini 页面可能被忽略。
- 当前 Gemini Pro 页面不一定提供独立图片工具按钮，执行器会在找不到该按钮时发送明确的生图前缀，但不会改动用户原始提示词记录。
- Google 图片地址优先在页面内下载；遇到 CORS/凭据限制时由 Windows 原生宿主下载，结果仍只上传到本机鉴权网关。
- `gemini-embedded-worker.js` 在上传任务结果前按 `requested_size` 处理 `exact_output/local_4k_upscale`，使用等比安全区裁切或 contain，不做非等比拉伸。
- `app.js` 的结果复核尺寸现在从实际提交的 Gemini task body 派生，修复“任务提交全局尺寸、预览却按旧 adapter size 处理”的错位。
- 真实验收任务 `gemini_exact_ascii_1785335303976089` 已成功：缓存 PNG 为 `1024×1536`、2,327,569 字节、SHA-256 `1cff4894374a4f57bf526cc6f45f72f723fe958a8ca7d3cf5c6929b188f66402`。
- 分支 CI `30457603230` 已验证质量门、Windows、Android、macOS、iOS 全部成功；正式发布仍应以 `main` 对应版本 CI 为准。

## v1.6.3 Gemini 任务续接与全局分辨率

- 真实任务记录确认旧版故障发生在 `preparing_temporary_chat`：Gemini 点击临时对话后整页导航，旧 JavaScript 上下文被销毁；新页面又领取其他任务，导致任务永远没有进入提示词提交阶段。
- `gemini-embedded-worker.js` 现在仅允许顶层页面执行任务，并以 `sessionStorage` 保存临时对话导航检查点。
- `GeminiWebGatewayManager` 会在页面重载后返回同账号尚未过期的原 claim，并释放旧版本遗留的重复 claim；单账号任务执行保持串行。
- 客户端和隐藏页面均取消 12 分钟硬超时，持续跟踪同一任务到成功、明确失败或用户取消，禁止因等待时间长而重新提交。
- Gemini 供应商不再显示独立尺寸模式、构图比例、裁切策略和质量意图；全局分辨率是唯一目标尺寸，内部固定 `exact_output + smart_cover + standard`。

## v1.6.2 ChatGPT 会话恢复与 Gemini 登录修复

- `ChatGptMultiAccountStore.restoreGatewaySession()` 会在 Windows/Android 内置 ChatGPT 网关启动后，从系统安全存储重新注入当前账号令牌。失败时尝试其他已保存账号，但不删除任何账号元数据或令牌。
- Windows Gemini 登录 WebView 使用组件内宿主，不再覆盖 Flutter 工具栏；用户可以随时点击返回、刷新或关闭。
- Gemini 页面探测到 `page_ready` 后，由 Dart 本机鉴权通道调用 `/v1/companion/identity` 保存隔离账号，成功后通知主 Web UI 并自动收起登录页。
- Google 重定向完成后的 `onPageFinished` 会再次注入带全局防重复标记的探测脚本，避免只依赖 document-created 注入而漏掉登录完成状态。
- 发布前必须验证：ChatGPT 保存账号后重启仍可用；Gemini 登录成功后账号进入列表且界面自动收起；已有 API、历史、路径和尺寸预设不被重置。

## v1.6.1 Gemini 软件内登录、多账号与隐藏任务

- Gemini 是独立供应商 `geminiWeb`，不复用或改写官方 OpenAI、ChatGPT 网页生图、GrsAI、自定义 API 的配置或密钥。
- Windows 使用按本机 UUID 隔离的 WebView2 user-data 目录；Android/iOS/macOS 使用系统安全存储保存每个本机 UUID 对应的 Google Cookie 快照。删除账号时同时清理对应本地会话。
- `lib/gemini_embedded_browser.dart` 负责软件内登录页、登录完成自动收起、隐藏 WebView、原生消息传输与顶层导航白名单。真实本机网关 Bearer Key 只留在 Dart 内存，注入页面只看到无效占位值。
- `gemini-embedded-worker.js` 在隐藏 Gemini 页面中执行临时对话、参考图上传、结果定位和带检查点的任务上报。旧 `gemini_companion/` 扩展源码和发布 ZIP 已删除。
- `lib/gemini_web_gateway.dart` 继续只监听 `127.0.0.1:18160–18199`；任务固定绑定账号。额度或登录失效时，在启用自动切换的前提下只把当前任务转交给尚未尝试的可用账号。
- Android 的 Gemini 会话恢复严禁调用 `CookieManager.removeAllCookies()`，否则会同时清除 ChatGPT 等其他内置网页登录。当前实现仅过期 Google/Gemini 域已观察到的 Cookie。
- 图片成功后沿用现有 IndexedDB 本地缓存策略；下载、ZIP 或保存到文件夹时才写入用户输出目录。Gemini 账号 Cookie、配对密钥不会进入历史、项目 JSON 或 ZIP。
- Google 可能因 OAuth `disallowed_useragent` 或网页结构调整阻止嵌入式登录；CI 能验证宿主、资源、消息桥和任务协议，但不能代替真实 Google 账号、区域与额度验证。遇到此类变化应显示具体错误，不得静默退化为系统浏览器扩展。

### v1.6.1 发布硬门槛

```powershell
node --check app.js
node --check gemini-embedded-worker.js
node qa/static-audit.js
node --test qa/api-proxy.test.js
node --test qa/image-task-stability.test.js
node qa/codex-image-gateway-adapter.test.js
node qa/gemini-web-adapter.test.js
node qa/regression-runner.js
flutter analyze
flutter test
```

四端 CI 还必须实际编译 Android、Windows、macOS、iOS；Windows 包必须包含 `gemini-embedded-worker.js` 并通过既有 WebView2 启动与原生命中测试。发布页使用中文，并明确真实 Gemini 登录仍受 Google 策略、区域、审核和额度约束。

## v1.5.0 Windows 内置 ChatGPT 网页生图与多账号

- Windows Release 现在必须打包 `chatgpt_gateway/langbai_chatgpt_gateway.exe` 及其 PyInstaller onedir 依赖。源码位于 `embedded_gateway/`，构建入口为 `embedded_gateway/build-windows.ps1`；`windows/installer/setup.iss` 会递归包含 Release 目录。
- 内置服务只监听 `127.0.0.1`，在 `18081–18100` 中动态选择空闲端口；主程序每次启动生成随机 API Key 和会话桥密钥，子进程监控主进程 PID 并随其退出。
- 服务只挂载健康检查、能力检查、Session bridge 和图片异步任务路由。文字接口必须保持 `404`。`embedded_gateway/smoke-packaged.ps1` 会对实际 PyInstaller EXE 验证这些边界。
- `lib/chatgpt_multi_account.dart` 从完整 Session JSON、裸 `accessToken` 或 `Bearer` 文本中识别令牌，保存脱敏账号元数据；每个令牌使用独立的 Flutter Secure Storage 槽。令牌不能进入 Local Storage、历史记录、项目 JSON 或 ZIP。
- Windows 可用独立官方网页登录窗口；登录完成后读取同源 `/api/auth/session`，导入安全存储并自动关闭。另一条路径使用系统默认浏览器打开 `https://chatgpt.com/api/auth/session`，用户手动全选复制并粘贴导入。
- 多账号支持选择、删除、自动切换。只在明确的 `401`、`429`、认证失效或额度不足代码时切换；审核、普通 `400`、`502/503/504` 不切号。异步任务提交体必须携带 `account_id`，任务创建后始终绑定同一账号。
- `makeImageApiError()` 必须保留 `gatewayTaskTerminal/status/code/requestId`。否则终态 429 会被误当成轮询网络故障，卡到 20 分钟截止时间，自动切号永远不会执行。
- 受保护图片历史 URL 允许识别内置网关动态端口，但下载前必须把任务路径重写到本次运行的可信网关 origin，再附加内存 Bearer Key；不得把密钥发送到旧端口或远程主机。
- OpenAI 官方 API、GrsAI 和自定义 API 入口完整保留；账号令牌与用户保存的 API 配置/密钥互不覆盖。
- 当前内置 ChatGPT 网页兼容层仅随 Windows 发布。Android/iOS/macOS 继续使用官方 API、GrsAI 或自定义 API。它不是 OpenAI 官方 Image API，网页协议变化后可能需要客户端更新。

### v1.5.0 发布硬门槛

```powershell
node --check app.js
node --check qa/regression-runner.js
node qa/static-audit.js
node --test qa/api-proxy.test.js
node --test qa/image-task-stability.test.js
node qa/codex-image-gateway-adapter.test.js
node qa/regression-runner.js
python -m compileall -q embedded_gateway/launcher.py embedded_gateway/vendor/chatgpt2api/api embedded_gateway/vendor/chatgpt2api/services embedded_gateway/vendor/chatgpt2api/utils
flutter analyze
flutter test
```

Windows CI 还必须构建网关 EXE、运行 `smoke-packaged.ps1`、核对 Flutter assets 版本、通过 WebView2 启动与原生命中测试，最后再用 Inno Setup 打包。发布页使用中文，明确说明 ChatGPT 网页生图的 Windows 范围和非官方兼容层边界。

## v1.4.4 OpenCodex 客户端稳定层与项目审计

- 本轮只修改 Langbai 软件端；本机 OpenCodex 2.7.40 安装目录保持原样。
- 新增独立 `image-task-stability.js`：将审核拦截、参数、认证、413、429、502、503、超时和解码错误分开；`moderation_blocked` 会保留审核类别和 request ID，不再显示成参数不支持，也不会重复原请求。
- OpenCodex GPT 默认并发从 5 调整为 2；连续两次 502/503 后降为 1，连续三次打开 45 秒客户端熔断器。参考图链路确认断开后会阻止本轮后续参考图提交，不会静默改成纯文字。
- OpenCodex 结果解码后校验实际宽高；尺寸不符会在卡片标记并在 ZIP/文件夹导出时进入 `raw-nonexact/` 隔离目录。
- 每张 OpenCodex 结果记录提示词、参考图、请求指纹和输出 SHA-256，以及 request ID、请求/实际尺寸、耗时和人工审核状态；不保存密钥或完整 Data URL 到审计清单。
- 漫画与嵌字项目在任务开始时建立断点记录，每个分镜成功或失败后立即更新；恢复中断项目时，成功图片和未完成分镜会同时恢复。原任务使用参考图但参考图未恢复时，重试会要求重新导入，避免身份漂移。
- Windows 文件保存改为同目录 `.part` 写入、长度校验、原子改名；导出附带 `project.json`、`audit.json` 和 `contact-sheet.html`。
- 审核失败的“编辑重试”只提交当前分镜修订内容，不再自动拼接可能污染镜头的全局提示词；普通重试继续保持原有全局+分镜行为。

## v1.4.3 漫画分镜批量提示词覆盖确认

- 漫画分镜已有提示词时，再次应用批量提示词必须先二次确认；取消后保留全部原内容并保持批量输入弹窗打开。
- 确认后严格按行覆盖：非空行替换对应分镜，空行清空对应分镜；批量文本未覆盖到的后续分镜保持不变。
- 显式输入全空行批次也可用于批量清空，但仍必须经过覆盖确认；仅完全没有任何输入行时才提示输入内容。
- 简体中文、繁体中文、英文、日文和韩文均明确说明覆盖与空行清空规则。
- 回归新增拒绝覆盖、确认覆盖、空行清除、全空批次清除及尾部分镜保持不变的专项检查。

## v1.4.2 gpt-image-2 局部重绘修复

- 局部重绘只对两个明确入口开放：OpenCodex `gpt-image-2` 与官方 OpenAI `gpt-image-2`；Nano Banana 2、GrsAI 和自定义接口均不会启用该入口。
- 官方 OpenAI 路径向 `/v1/images/edits` 发送同尺寸 PNG 原图与原生 PNG `mask`。软件内涂抹区域会转换为透明编辑区，并在响应后再次本地合成，保证蒙版外像素不变。
- OpenCodex 路径固定使用 `gpt-image-2` JSON 图片编辑契约，不发送上游不支持的 `mask` 字段；生成语义补丁后仅在本地蒙版内合成。
- 回归会真实点击两个入口，截获并检查 multipart/JSON 请求，同时确认 Nano Banana 2 与 GrsAI 的入口禁用、蒙版 alpha 反转正确、两条路径都能生成候选。

## v1.4.1 官方 API 冷启动崩溃修复

- 已确认根因：启动恢复官方 API 配置时，`applyConfig()` 调用 `setModelChoices()`，后者访问尚未初始化的 `KNOWN_PRICES`，导致 `app.js` 在绑定设置、漫画分镜、语言、主题等按钮前以 TDZ `ReferenceError` 中止。
- 配置恢复现统一放在模块末尾执行，保证所有模型/价格常量已初始化；恢复失败仅使用临时空配置继续启动，不调用 `saveConfig()` 或 `clearConfig()`，不会覆盖用户 API、密钥或历史。
- `bootstrap-guard.js` 已加入 Flutter assets。v1.4.0 虽在 `index.html` 引用该文件，但 `pubspec.yaml` 漏列，Windows 安装包内实际不存在。
- 回归现在会在导航前分别预置官方、GrsAI、OpenCodex、自定义和损坏配置，要求 `window.__AI_GEN_APP_READY === true`，并调用设置、漫画、语言、主题、历史和导出入口。
- Windows 隐藏自检不再只检查 DOM 存在，而是要求应用就绪并验证设置、漫画、语言和主题按钮确实改变界面状态。

## v1.4.0 Windows 原生内容宿主重构

- `v1.3.37` 的窗口式 WebView2 仍以 Flutter 渲染 HWND 为父窗口。用户实机确认页面可见，但设置、漫画分镜等内容区点击仍无法命中。
- 三路独立审计确认两个结构性缺陷：插件注册发生在 Flutter HWND 挂入主窗口之前；Runner 的 `WM_ACTIVATE` 又会无条件把焦点抢回 Flutter。
- `third_party/webview_win_floating` 现支持 `useTopLevelWindowHost`：运行时解析真正的顶层 HWND，创建独立 `WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS` 宿主，再以它作为 WebView2 父窗口。
- 宿主尺寸、Z 序、最小化/恢复、DPI、移动和焦点由 Win32 消息直接管理，不再使用 Flutter 的 `localToGlobal * DPR` 作为 Windows 全屏内容坐标。
- `bootstrap-guard.js` 在主脚本异常时保留设置和模式切换的最低限度操作，并显示启动错误；正常加载结束由 `window.__AI_GEN_APP_READY` 接管。
- CI 新增可见窗口的原生命中测试：页面完成启动后，`WindowFromPoint` 必须命中 `Chrome_RenderWidgetHostHWND`，不能再命中 Flutter 渲染窗口。GitHub 托管 Runner 不接收桌面鼠标注入，因此实际控件点击继续由浏览器回归覆盖，最终 Windows 行为必须由安装包实机确认。
- 本轮完成的是一次跨 Web、Windows/macOS/Linux Flutter 壳、Android、iOS 的功能与安全深度审计。
- Web 完整回归、代理专项、Flutter analyze/test、Android debug 实际构建均已通过。
- 本机没有 Visual Studio/macOS，因此 Windows C++、macOS Swift、iOS Swift 的最终编译必须由四端 GitHub Actions 验证。

## v1.3.37 Windows 全面无响应根因修复

- 多路独立审计确认：反复出现的“页面仍显示、所有按钮和滚轮都像卡死”不是单个按钮监听器问题，根因是旧 Windows 壳使用 CompositionController + Flutter texture，并手工转发鼠标、滚轮与焦点。WebView2 进程失效后旧壳还会保留最后一帧，且没有恢复处理。
- Windows 已迁移到 vendored `webview_win_floating` commit `bbae6b84`，使用真实 Flutter HWND 创建普通 windowed `CoreWebView2Controller`。点击、键盘、下拉、拖放和滚轮现在由 Windows/WebView2 原生处理，不再经过 Flutter MethodChannel 输入转发。
- 继续使用 `%LOCALAPPDATA%\flutter_webview_windows\ai_image_generator` 作为 user data folder，复用原来的 `EBWebView/Default`，不会创建新 profile，也不会覆盖或清空用户保存的 API、Key 元数据、历史和设置。
- vendored 插件新增 document-created bridge、`ProcessFailed` 上报、UTF-8 路径转换、空控制器销毁保护和原生拖放启用。Dart 壳收到任何 WebView2 进程失败会销毁并重建；每 20 秒做一次无界面健康检查，连续两次超时也会自动恢复。
- 最小化时显式隐藏原生 WebView，恢复时同步显示并聚焦。windowed 模式下禁用旧 texture 专用的 JS 滚轮纠偏，避免设置弹窗滚动时反向滚动主界面；参考图拖放恢复为可用能力。
- 大缓存升级不再在 versionchange 事务中批量迁移所有旧键；历史清理改用 `openKeyCursor()`，不反序列化图片 Blob；自动缓存清理延后 15 秒执行，避免启动抢占。
- 发布前硬门槛：浏览器回归、Flutter analyze/test、GitHub Actions Windows 原生 C++ 编译全部通过。不得只凭浏览器 `.click()` 测试发布 Windows 包。

## v1.3.36 Windows 原子点击与大缓存启动修复

- 已确认旧 profile 的 IndexedDB 约 `3.59 GiB`，而启动清理原先用 `openCursor()` 逐条读取包含 Blob 的记录；这会反序列化大量图片并放大 WebView 输入延迟。缓存库升级到 v3 后把 `createdAt` 放进独立轻量元数据表，过期清理只走 `openKeyCursor()`，不再读取图片 Blob。
- 旧缓存升级时仅读取键名并把迁移时间写入元数据，不删除旧图片；新图片的 Blob 与元数据在同一事务写入。启动清理延迟到浏览器空闲期，避免首屏抢占。
- Windows 插件的鼠标按下/抬起过去只发送按钮状态，C++ 使用异步 hover 留下的 `last_cursor_pos_`，因此点击漫画标签可能错误命中旧结果图片并打开预览。现在按钮消息原子携带本次 `x/y`，原生层先更新坐标、聚焦 WebView，再发送按下/抬起。
- 滚轮消息也原子携带当前位置，避免设置弹窗打开时因旧坐标而滚动背后的主面板；跨显示器 DPI 变化会用新缩放值重新提交最近一次 Surface 尺寸。
- 浏览器完整回归、静态审计、Flutter analyze、Flutter `13/13`、代理 `6/6` 已通过。Windows 原生编译与旧 profile 实机复测必须使用 GitHub Actions artifact 完成，本机没有 Visual Studio C++ 工具链。

## v1.3.35 Windows 点击与 API 配置数据修复

- Windows v1.3.34 可渲染页面但真实鼠标点击会失效或命中另一个控件。曾尝试在 2024 旧插件上直接扩充坐标参数；虽然 CI 能编译，真实安装测试会在点击后崩溃，因此该方案已废弃且没有发布。当前改为内置上游最新提交 `2ae79f8c`，使用其新的 `WebviewHost`、`RenderWebview` 和透明命中实现。
- 新 Host 显式传入 `%LOCALAPPDATA%\flutter_webview_windows\ai_image_generator`；WebView2 会在其下复用既有 `EBWebView`，不会切换 localStorage 来源或丢失现有历史/设置/API 元数据。外部链接仍交给系统默认浏览器，弹窗不在软件内打开。
- Windows 壳在最小化时不再把 Flutter 子窗口强制缩到零，WebView 也拒绝上报小于 `2x2` 的 Surface；窗口失活时不再强制抢焦点。模式标签新增方向键切换、`aria-selected` 与粘性定位。
- 启动时检测旧版 API 配置是否共享同一 ID，或不同 ID 清洗/截断后是否落到同一个安全密钥槽。活动配置保留原 ID 与密钥槽，冲突配置获得新 ID 并停止读取歧义密钥，同时提示用户重新填写，避免把另一个供应商的 Key 静默拿来使用。
- 新建未选中配置时强制生成新 ID；保存列表时再次执行唯一性保护；系统安全存储的读、写、删在 JS 和 Dart 两层全局串行。回归覆盖重复/碰撞 ID 的一次性迁移、稳定重载、默认配置、同供应商同名多账户和并发安全存储。
- v1.3.35 只有在 GitHub Actions Windows 编译成功，并用该安装包做真实鼠标跨控件点击、滚轮、最小化恢复和 API 升级验证后才能发布。浏览器 `.click()` 回归不能替代这一步。

## v1.3.34 OpenCodex GPT 私有额度实测适配

- 依据 19/19 常用/边界尺寸、14/14 提示词比例和 60 张原图双解码结果，OpenCodex GPT 私有额度路径按约 157 万像素输出，最大观测总像素 `1,573,770`、最大观测长边 `2172`、有效比例约不超过 `3:1`。
- `auto / low / medium / high` 在该私有路径最终均为 `medium`；OpenCodex GPT 现固定发送 `quality: "medium"`，其余质量按钮禁用。OpenAI 官方 API 的质量选项不受影响。
- 私有路径的 `size` 不能单独可靠控制方向。软件会从所选像素尺寸约分出比例，并在仅发送给 OpenCodex GPT 的请求提示词末尾补充横向/纵向/方形与目标比例；历史仍保存用户原始提示词。
- 尺寸输入继续按公开 GPT Image 2 请求契约校验，因为私有端点会接收后自行缩放；界面明确显示实测输出策略，并以解码后的真实尺寸为准。
- Nano Banana 2 代码保留，但不继续自动测试或消耗其额度；后续可另行接入 Google 官方 Gemini API。

## v1.3.33 OpenCodex 双模型、尺寸与局部重绘

- `OpenCodex 本地生图` 现明确支持 `gpt-image-2` 与 `gemini-3.1-flash-image`（Nano Banana 2），通过 capability 表隔离参数，不按模型名字猜能力。
- Nano 只显示并发送 Google 官方 14 种比例与 `512 / 1K / 2K / 4K` 档位；不发送 GPT 的 `size / quality / background`。并发上限按档位为 `5 / 5 / 3 / 1`。
- GPT Image 2 提供 OpenAI 七个官方常用尺寸，并新增多组满足 16 倍数约束的横屏、竖屏、4:3、5:4、16:10 等常用预设；合法自定义尺寸继续可用。
- OpenCodex GPT 的尺寸与质量明确标为请求偏好；结果卡与历史同时保存 requested、响应字段、解码实际宽高、MIME 和字节数，不能把请求值冒充实际值。
- 新增 Nano 局部重绘工作区：画笔、橡皮、撤销/重做、清空、蒙版显隐、原图对比、适应/100%、内向羽化、上下文裁剪、1～4 个候选和手动平移/缩放。
- 局部重绘不是上游原生 mask：模型只接收带上下文的语义编辑裁剪，最终由客户端按蒙版本地 RGBA 合成。回归逐像素验证蒙版外四通道不变。
- OpenCodex 固定 `n=1`，批量由客户端多请求并发；任何 OpenCodex 失败均不自动重复提交。
- 浏览器回归新增双模型请求体隔离、官方比例/档位、动态并发、`n=1` 拦截、官方尺寸预设、局部合成和结果实际属性验证。

## v1.3.32 OpenCodex 本机生图适配

- 新增独立的 `OpenCodex 本地 GPT` 供应商，固定连接 `http://127.0.0.1:10100`、占位密钥 `opencodex-local-only` 和模型 `gpt-image-2`，不混用官方 OpenAI multipart 或 GrsAI 任务协议。
- 文生图与参考图编辑均发送 JSON；参考图使用 `images[].image_url` Data URL，固定单请求 `n=1`，批量任务默认最多并发 5。
- 新增专属质量 `auto/low/medium/high`、背景 `auto/opaque` 和健康检查面板；健康检查失败时禁用生成，可通过按钮重新检测。
- OpenCodex 的 health 和图片请求强制直连，绕过电脑端 HTTP/SOCKS 代理；健康检查超时 5 秒，图片请求客户端超时 620 秒。
- 不发送 `response_format`、`output_format`、压缩、审核、`input_fidelity`、mask 或 stream；OpenCodex 请求不进入 HTTP 400 自动重试，失败保留给用户手动重试。
- Base64 图片根据文件头识别 PNG/JPEG/WebP MIME，避免返回格式与保存扩展名不一致。
- 详细契约与验收边界见 `OPENCODEX_LOCAL_IMAGE_ADAPTER.md`。

## v1.3.31 增量修复

- 已保存 API 配置按记录 ID 分别使用系统安全存储，不同配置的密钥不再互相覆盖。
- 切换 API 类型或改为不同端点时会退出当前已保存记录并清空界面密钥，避免把 GrsAI 记录误写成官方记录，反向切换同样适用。
- 保存和恢复覆盖供应商、端点、密钥、模型、浏览器 CORS 转发地址及官方专属画质参数；空值也会正确恢复，不沿用上一条配置。
- 安全存储写入按每个配置串行化，并用应用序列防止异步读取旧密钥后污染刚切换的新配置。
- 回归新增 GrsAI 与官方 API 两套完整配置反复切换，以及两条安全存储密钥独立迁移的验证。

## v1.3.30 增量功能

- 仅在 OpenAI 官方 `gpt-image-2`（含日期快照）模式显示人民币费用区；GrsAI 和自定义 API 不显示、不计算官方价格。
- 生成前按官方三种标准尺寸、质量和张数估算图片输出费用；`auto` 显示低到高范围，自定义尺寸不猜测固定价，明确提示生成后按实际 Token 计算。
- 生成后读取 OpenAI Image API 响应的 `usage`，按文本输入 `$5`、图片输入 `$8`、图片输出 `$30` / 百万 Token 计算 USD，再换算人民币；费用与 Token 随单图或漫画/嵌字项目历史保存、恢复和汇总。
- USD/CNY 通过 Frankfurter 的 ECB 每日参考汇率自动更新并缓存 6 小时；失败保留上次成功值，没有缓存时明确使用 `6.77` 备用汇率；支持手动刷新。
- 费用区新增“官方价格”，通过系统默认浏览器打开 OpenAI 最新价格页，不在软件内创建或嵌入浏览器页面。
- 回归覆盖固定估价、`auto` 范围、自定义尺寸、真实 usage 计费、历史持久化、汇率更新/失败回退、GrsAI 隔离及桌面/移动端无溢出。

## v1.3.29 增量功能

- OpenAI 官方 API 与 GrsAI/自定义协议彻底拆分：官方模式固定走 `api.openai.com/v1/images/generations|edits`，GrsAI 的模型别名、任务轮询和 504 设置不再进入官方模式。
- 官方模式新增专属参数面板：质量、背景、输出格式、JPEG/WebP 压缩、审核强度、参考图保真度；所有说明已覆盖简繁英日韩，并随当前官方 API 配置保存。
- `gpt-image-2`（含官方日期快照）按官方约束支持自定义尺寸、禁止透明背景、参考图固定高保真；旧模型使用标准三种尺寸并按能力启用保真度。
- 官方模型检测只接收 GPT Image 官方别名/日期快照，过滤 GrsAI 的 VIP/CL/VT/4K 别名；401、403、网络错误或无匹配模型时保留内置官方列表并显示真实原因。
- 官方返回的 PNG/JPEG/WebP Base64 会保留正确 MIME 和下载扩展名；JSON API 错误优先提取 message/code，不再把整段对象直接显示给用户。
- 回归新增官方生成、参考图编辑、参数持久化、供应商隔离、模型快照、错误回退、非法尺寸拦截，以及桌面窄栏/移动端无横向溢出检查。

## v1.3.28 增量修复

- “全部失败重试”现在会让同一张再次失败的卡自动回到队尾，直到生成出真实图片或达到次数上限；不再每张只处理一次。
- 工具栏的次数改为“失败后追加次数”：每张先执行 1 次，再追加 N 次；填写 10 表示最多共 11 次，不会嵌套放大为 121 次请求。
- 每张卡和排队卡都会显示当前第几次/总次数；成功立即停止，HTTP 200 但没有图片数据仍视为失败并继续下一轮。
- “取消全部重试”旁新增“补充剩余失败”，运行期间始终可点，可强制扫描并加入自动收集链路遗漏的失败卡。
- 回归新增成功前连续失败、达到上限仍失败、空图片响应、人工补充遗漏卡和各轮次显示覆盖。

## v1.3.27 增量修复

- “全部失败重试”超过供应商并发上限时，尚未发出请求的卡片会立即显示“等待重试（队列第 N 个）”，不再继续伪装成普通失败卡。
- 每个排队卡明确说明请求尚未发送，并保留原始失败原因；前序任务结束后队列位置实时前移，轮到时自动切换为“正在重试生成”。
- 取消全部重试会恢复所有尚未开始的排队卡及其原失败原因，不留下错误的排队样式或位置数据。
- 浏览器回归新增 12 张失败卡、并发上限 10 的专项覆盖，验证 10 张请求中、2 张排队、队列编号以及取消恢复。

## v1.3.26 增量功能

- 设置的“自动重试”区域新增 GrsAI 首次提交 HTTP 504 专用重试次数与间隔；默认 2 次、30 秒，范围分别为 0～10 次和 1～600 秒。
- 仅选择 GrsAI 提供商时启用该策略；通用 API 仍严格保持只有 HTTP 400 自动重试。
- 每次提交 504 后逐秒显示剩余等待时间和当前重试轮次；单卡取消、全部取消会立即中断等待。
- 后续任一提交成功会立刻停止 504 重试并进入原有同步结果或任务 ID 轮询流程。
- 达到上限后明确提示任务可能已经提交，提醒先检查 GrsAI 后台，避免继续无边界重提。
- 五语言、设置持久化及回归测试已补齐；测试覆盖前两次 504、第三次成功，以及连续 504 恰好执行配置次数后停止。

## v1.3.25 增量修复

- “全部失败重试”由点击时的静态卡片快照改为动态并发队列；本轮运行期间新出现的失败图片会自动加入当前队列。
- 按钮计数、全局提示和进度总数会随新增失败项实时增长，不再被旧的全局锁挡住。
- 同一张卡每轮最多自动处理一次；重试后仍失败时保留给下一轮，避免形成无限循环。
- 取消全部重试会同时清空待处理队列并中止所有已开始请求；任务结束后新增失败项仍可立即开启下一轮。
- 回归覆盖“2 张重试中新增第 3 张失败图、3 张均启动、取消后全部恢复、再次重试全部成功、清空释放锁”的完整流程。

## v1.3.24 增量修复

- GrsAI 已取得任务 ID 后，结果查询若暂时返回 HTTP 504，会对同一个任务执行 2～30 秒指数退避并继续查询，不会重新提交生图任务。
- GrsAI 首次提交若返回 HTTP 504，不会自动重提：官方统一接口没有提供幂等键或按请求找回任务的能力，盲目重提可能重复扣费；界面会明确说明这一点。
- HTML 网关错误会提取标题/正文摘要，不再把整段 nginx HTML 原样显示给用户。
- 原生软件的远程图片预览不再把整张 Base64 一次塞进 WebView；Dart 原生层暂存字节，JS 通过不超过 192 KiB 的分块逐步读取并组装 Blob，完成或失败后释放传输。
- 回归新增 GrsAI 轮询 504 恢复、首次提交 504 不重复 POST、原生图片分块逐字节重组和传输释放检查。

## v1.3.22 增量功能

- 移除漫画分镜数量输入、批量分镜提示词的 100 条硬上限；批量输入多少行就自动扩展到多少个分镜。
- 大批量创建每 100 行主动让出一次渲染帧，避免一次性创建大量 DOM 行时界面长期无响应。
- 嵌字模式允许导入超过 100 张图片并按顺序填入同数量提示词；仍保留图片数量一一对应、单张 25 MB 和单批 250 MB 校验。
- 全局参考图仍限制 100 张，避免一次生图请求携带无限参考图；该限制与嵌字批量图片已拆分。
- 回归覆盖 105 条漫画提示词和 105 条嵌字提示词，确认首尾顺序、数量和不截断。

## v1.3.21 增量功能

- 所有成功生成的图片都会立即写入独立 IndexedDB 临时缓存，不再依赖“保存历史”开关，避免中转站约两小时后删除图片导致下载失败。
- 设置新增缓存保留天数（默认 7 天，范围 1～365 天）、自动清理说明和立即清理按钮；应用启动、设置变更和生成新图时会清理过期缓存。
- 新历史记录使用 `cache://` 引用同一份缓存字节，不再向旧历史图片仓库重复写入一份 Blob；旧版 `idb://` 历史仍兼容。
- 临时缓存仅在应用内部存储；生成时不会写用户目录，只有“打包下载 ZIP”或“保存到文件夹”才会创建正式文件。
- 五语言和回归测试已补齐，覆盖关闭历史后的缓存、期限清理、设置持久化及历史缓存复用。

## v1.3.20 增量修复

- 修复“全部失败重试”开始后失败卡切换为加载态，失败数归零导致整条工具栏消失的问题。
- 重试进行中工具栏持续可见，按钮切换为“取消全部重试”，并立即显示本轮重试数量。
- 取消会终止本轮所有正在等待的卡片请求、恢复失败卡并释放全局锁；可随即重新发起全部重试。
- 防止单个无超时原生生图请求永久挂起后，`retryAllFailedRun` 状态永远无法复位。
- 五语言补齐开始、取消中、取消完成提示；回归覆盖挂起、取消、状态恢复和第二轮成功重试。

## v1.3.19 增量功能

- 漫画分镜与嵌字模式新增共用的“批量输入提示词”弹窗。
- 每行一条提示词，严格按分镜顺序或图片名称顺序映射；内部空行保留位置，避免后续内容错位。
- 漫画提示词多于现有分镜时自动扩展分镜；从 v1.3.22 起不再设置数量硬上限。
- 嵌字提示词多于图片时阻止应用并显示数量差异；少于图片时只更新前面的对应项，其余保持不变。
- 覆盖已有内容前使用跨端页面确认框；支持 `Ctrl/Cmd + Enter` 应用、Esc 关闭、焦点陷阱和弹层滚动隔离。
- 五种语言均已补齐按钮、说明、计数和错误提示；浏览器回归覆盖空行、扩展、溢出、局部填写和拒绝覆盖。

## v1.3.18 增量修复

- 修复“输入项目名称后，保存到文件夹仍使用固定名称”的问题。
- 漫画与嵌字模式的名称输入框现在明确提示会同时控制项目和文件夹名称。
- 有名称时文件夹格式为：`用户名称_YYYY-MM-DD_HH-mm-ss`。
- 未输入名称时分别使用：`漫画项目_YYYY-MM-DD_HH-mm-ss`、`嵌字项目_YYYY-MM-DD_HH-mm-ss`。
- 自定义名称会清理跨平台不允许的文件名字符，并限制长度，但始终保留日期时间后缀。
- 回归测试会执行三次真实原生桥保存，分别验证自定义漫画名、未命名漫画和未命名嵌字。

## 本轮修复

### 1. 电脑端网络代理

- 设置中新增桌面网络代理：
  - 默认 HTTP：`http://127.0.0.1:7890`
  - SOCKS5：`socks5://127.0.0.1:10808`
  - 直连
  - 自定义 `http/https/socks5://host:port`
- 自定义值无效时明确报错，不静默直连。
- 代理只作用于 Windows/macOS/Linux；Android/iOS 不使用电脑本机的 `127.0.0.1`。
- `_nativeFetch()`、模型检测、生图、GrsAI 轮询、更新检查、更新包下载和远程图片重载共用代理配置。
- Dart 原生网络层通过 `findProxy` 支持 HTTP，通过 `socks5_proxy` 真正支持 SOCKS5。
- “浏览器 CORS 转发地址”与“电脑端网络代理”已分开说明。

### 2. 重试、取消与请求生命周期

- 自动重试严格限定为 **HTTP 400**；网络错误、HTTP 5xx 和其他状态不会自动重试。
- 一旦返回可用图片立即停止，不会继续跑剩余重试轮次。
- 全局状态和每张结果卡都会显示当前第几轮、总重试次数。
- 每张卡从首次请求开始就可单独取消；批量取消仍可用，二者互不干扰。
- JS AbortSignal 会发送 native cancel，Dart 随即关闭对应 `HttpClient`，不再只是停止界面等待。
- 生图请求不设置任意固定超时，但始终可取消；模型检测、更新和图片重载等普通请求默认 120 秒。
- 取消标记一分钟后清理，避免长期堆积。

### 3. 图片重载、历史记录与导出

- 图片重载不再复用失败的 blob；会重新请求并校验 PNG/JPEG/WebP/GIF 等图片魔数。
- 浏览器重载改走 `smartFetch()`，可使用已配置的 `api-proxy.js` 绕过 CORS。
- 如果 IndexedDB 缓存丢失，预览、灯箱、下载和 ZIP 会回退到原始远程 URL。
- 历史图片字节放入 IndexedDB，localStorage 仅保存项目元数据，降低容量爆炸风险。
- 修复并发历史保存时旧清理任务误删新图片的竞态，清理任务串行并读取最新快照。
- 漫画和气泡嵌字按“项目”保存；单图按图片保存。
- 项目记录保留成功和失败分镜、分镜提示词及参数；提示词默认折叠。
- 恢复项目时恢复参数、分镜与提示词，但按产品要求**不恢复参考图**。
- 单图记录只显示该图片的提示词，不重复拼入全局提示词。
- 全失败项目也会保存，方便修改提示词后重试。
- 导出、ZIP、漫画保存到文件夹和历史原地替换均纳入回归。

### 4. API、GrsAI 与密钥

- API 类型保留官方 API、GrsAI 生图 API、自定义 API；自定义配置可保存并设默认。
- 只有选择 GrsAI 时才走官方 `generate/result` 适配；其他 API 继续走通用 OpenAI 兼容逻辑。
- 旧 API 配置缺少 ID 时会一次性迁移为稳定 ID；旧数字默认索引会迁移为 ID。
- 修复删除同端点的非当前配置时错误清空当前配置。
- 原生壳把 API Key 迁移到系统 secure storage，成功后从 localStorage 脱敏删除。
- secure storage 写入失败时保留旧值并提示，避免静默丢失用户密钥。

### 5. 更新与原生安全

- 更新包只信任本仓库 GitHub HTTPS Release assets。
- Windows 更新仅接受 `.exe` 且必须 SHA-256 匹配；使用明确安装目录启动安装器后退出。
- macOS 下载、校验 ZIP 后由系统打开；Android/iOS 打开系统浏览器中的 Release 页面。
- Android 删除应用内下载并安装任意 APK 的旧路径，同时删除 `REQUEST_INSTALL_PACKAGES`。
- WebView 只在本地可信应用页注入原生桥；外部链接始终交给已打开的系统浏览器新标签/窗口。
- native fetch 限制 URL、HTTP 方法和最大响应体；更新下载使用 `.part`、超时、SHA 校验及失败清理。
- `api-proxy.js` 仅监听 localhost，使用随机 token，限制 Origin/方法/请求与响应大小，默认阻止私网目标，并保持二进制字节不变。
- 浏览器取消请求时会同步中断代理上游连接。

### 6. macOS、iOS 与文件权限

- iOS/macOS 增加 MethodChannel：选择目录、持久化 security-scoped bookmark、保存文件、外部浏览器。
- macOS entitlement 增加用户选择目录、Downloads 和 Keychain 权限。
- Android 继续使用 SAF；参考图/ZIP 保存不依赖永久文件系统路径。
- 注意：Swift 代码已做结构审计和 plist 解析，但本机 Windows 无法编译，必须看 CI。

### 7. UI、滚轮、语言与 PWA

- 深色主题改为中性石墨黑，降低紫色面积与高对比刺眼感；浅色维持蓝白。
- 关键卡片统一为不超过 8px 圆角，移动端去掉过大的卡片圆角。
- 三个工作流明确为：单图生成、漫画分镜、气泡嵌字。
- 自绘下拉支持鼠标和键盘；语言、主题、设置、模型、API 与代理均有实际点击回归。
- 模态框焦点锁定、关闭后焦点返回、上传区键盘激活、进度 ARIA/live 区域已补齐。
- Windows `webview_windows` 的滚轮误派发继续由应用层兼容：打开设置等覆盖层时只滚覆盖层，不滚主页面。
- Service Worker 对带版本 query 的资源使用 `ignoreSearch` 匹配，真实断网重载已通过 CDP 回归。

## 验证结果

以下命令在 2026-07-11 全部通过：

```powershell
node --check app.js
node --check api-proxy.js
node --check qa\regression-runner.js
node --check qa\static-audit.js
node qa\static-audit.js
node --test qa\api-proxy.test.js
flutter analyze
flutter test
node qa\regression-runner.js
```

结果摘要：

- 静态审计：版本、缓存、Android assets、重试/超时、secure storage、代理/更新桥和 CI gate 一致。
- 代理专项：`6/6` 通过。
- Flutter：`No issues found`，`13/13` 测试通过。
- 浏览器完整回归：所有场景通过；涵盖语言、主题、设置滚轮、API、模型、参考图、三种生成模式、重试/取消、历史、导出、更新、PWA 离线。
- Android debug 在 ASCII 副本实际构建成功：
  - APK：`F:\AI\agent\codex\buildcheck-image-generator-1320-20260717175644\build\app\outputs\flutter-apk\app-debug.apk`
  - SHA-256：`DC7A88CB6CF7184DC8CDEE95629B23BB5351E3058CBB652A4D7A674327BBA590`
  - APK 内 `assets/app.js`、`assets/flutter_assets/app.js`、两份 `index.html` 与根目录源码哈希完全一致。

## 发布前必须完成

1. 检查 `git diff`，只提交本轮源代码和测试，不提交 QA 截图、临时 Edge profile、ASCII buildcheck 或构建目录。
2. 推送后确认 GitHub Actions 的 `quality`、Android、Windows、macOS、iOS 全部成功。
3. 下载四端 artifacts，逐个检查内嵌 `APP_VERSION = "1.6.11"`。
4. 对正式 Android APK 核对既有签名 SHA1：`C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
5. 使用 CI 的 `release-checksums` 产物核对并发布 `SHA256SUMS.txt`，再创建 `v1.6.11` Release；不要在 CI 未绿前创建 Release。
6. 至少在真实 Windows exe 上复测滚轮、语言下拉、目录选择、模型检测、代理测试和更新安装路径。

## 不要误改

- 不要把生图 POST 自动重试扩大到非 HTTP 400；GrsAI 已有任务 ID 后的结果查询 GET 遇到 504 可安全续查，这是特例。
- 不要把气泡嵌字或漫画历史拆成一张张图片。
- 不要恢复项目时自动塞回参考图。
- 不要把自绘下拉改回原生 `<select>`；旧 `webview_windows` 的离屏渲染无法可靠显示原生下拉弹层。
- 不要移除 native AbortSignal/cancelRequest 链路。
- 不要让 Android 使用桌面 `127.0.0.1` 代理。
- 不要绕过 SHA-256 校验安装更新。
- 不要改 Android 正式签名密钥或 Windows Inno Setup AppId。

## 工作区说明

- `CLAUDE_HANDOFF.md` 与本文件后半部分保留旧版本历史；当前状态以本文顶部的 v1.6.11 章节为准。
- 中文源路径会触发 Flutter shader 写入失败；Android 本地构建请继续使用纯 ASCII 副本。

## v1.4.5：专用 Codex 生图网关接入

### 供应商与配置

- 保留官方 OpenAI、GrsAI、自定义 API，以及 Windows 专用 Codex 生图网关。
- GrsAI 仍使用 `https://grsai.dakka.com.cn/v1/api/generate`，其密钥、模型和配置与官方/自定义配置独立保存。
- 原 `OpenCodex` 入口迁移为：
  - API：`http://127.0.0.1:18080/v1`
  - 健康检查：`http://127.0.0.1:18080/healthz`
  - 模型：`gpt-image-2`
- 旧 `opencodex` 或 `127.0.0.1:10100` 配置会迁移到新网关，旧占位密钥不会带入。
- 网关只在 Windows 原生软件显示；浏览器、PWA 和其他平台的自绘下拉会跳过该隐藏选项。

### 本机凭据

- Windows 壳通过 `loadCodexImageGatewayConfig` 读取 `%LOCALAPPDATA%\LangbaiCodexImageGateway\local-api-key.txt`。
- 仅接受 64 位小写十六进制密钥。
- 密钥只进入运行时内存和请求 Authorization，不写入 localStorage、API 配置、历史、导出或日志。
- 不要把该凭据合并进现有 API Key secure-storage 配置，也不要在界面显示它。

### 请求、尺寸与局部重绘

- 每个上游请求固定 `n=1`；客户端最多排队 5 个，网关内部并发由网关管理。
- 支持文生图、1–20 张参考图语义编辑、同步请求和可恢复异步任务。
- 6–20 张参考图由网关聚合为最多 5 张编号参考板。
- 异步任务 ID 会立即写入漫画/嵌字项目检查点；断线或重启后继续轮询，不重新提交。
- 服务端任务进入 `failed` 终态后立即返回具体错误，不能继续轮询到 300 秒超时。
- 网关结果 URL 必须通过原生分块下载并携带 Bearer；网关请求固定直连 `127.0.0.1`。
- UI 提供 `low/medium/high`、`native/strict_native/exact_output`、异步开关和 1–5 客户端队列数。
- HTTP 422 / `image_dimension_mismatch` 分类为参数/尺寸问题，要求调整参数。
- 局部重绘使用“网关语义编辑整图 + 软件仅在用户蒙版内本地合成”；官方 OpenAI 仍走原生 mask；GrsAI 不进入该协议。

### 新增文件

- `codex-image-gateway.js`
- `lib/codex_image_gateway_config.dart`
- `test/codex_image_gateway_config_test.dart`
- `qa/codex-image-gateway-adapter.test.js`

### 验证状态

- 全量浏览器交互回归、静态审计、网关/错误分类 Node 测试全部通过。
- `flutter analyze`：`No issues found`；`flutter test`：19 项通过。
- Android release 本地构建成功，APK 内包含 v1.4.5 的 `app.js`、`index.html`、`bootstrap-guard.js` 和 `codex-image-gateway.js`。
- 本机缺少 Visual Studio C++ 工具链，Windows 构建必须以 GitHub Actions 为准。
- 本机没有 `android/key.properties`，本地 APK 使用 debug fallback 签名；正式 Release 必须由 CI 恢复既有 keystore，并核对 SHA1 `C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。

## v1.4.6：Codex 网关预览鉴权修复（历史）

- 修复异步任务成功后预览组件继续使用受保护 URL、导致无 Bearer 的 `<img>` 请求返回 401 的问题。
- 网关文件 URL 会先由原生桥携带内存中的 Bearer Key 下载，结果只保留 `b64_json`，不再保留受保护的 `url` 或 `original_url`。
- v1.4.5 旧历史记录点击“重新加载图片”时，会自动识别网关文件 URL并补充 Bearer 鉴权。
- Bearer 只允许发送给固定可信源 `http://127.0.0.1:18080`，不会发送到其他本机端口、`localhost` 别名或远程主机。
- 网关文件读取强制 `forceDirectProxy=true`，不经过桌面代理。
- API Key 继续只存在 Windows 运行时内存，不进入 Local Storage、历史、项目导出或日志。
- GrsAI、官方 OpenAI、自定义 API 及其配置保存逻辑没有改动。
- Android 内嵌 `app.js` 与根资源同步；浏览器回归和静态审计覆盖新任务预览、旧任务重载、鉴权头、可信源和密钥泄漏检查。

## v1.4.7：Codex 网关成功结果与重试状态修复

- 成功图片写入历史记录时，即使浏览器元数据存储触发 `QuotaExceededError`，也不会把已完成任务改判为失败或触发重复付费提交。
- 历史检查点不再保存多 MB Base64 或受保护的网关文件 URL；优先保留本地缓存指针。
- Codex 网关客户端有效并发固定为最多 2，队列设置和多语言说明同步收紧。
- 成功卡片继续保留预览；旧历史图片仍通过可信网关源鉴权加载。
- 官方 OpenAI、GrsAI、自定义 API 的入口和独立配置保持不变。
- 发布版本为 `1.4.7+69`，Web/Android 缓存标识为 `20260728-1-4-7`。
- 必须运行网关专项测试、静态审计、完整浏览器回归、`flutter analyze` 和 `flutter test`，并由四端 CI 验证正式构建。

## v1.4.8：Codex 网关异步任务轮询上限修复

- 客户端异步任务轮询上限从 300 秒延长到 1200 秒（20 分钟），避免长耗时成功任务在软件端被提前报告失败。
- 单次网关请求超时仍为 300 秒；本次只延长拥有任务 ID 后的状态轮询窗口，不修改网关服务。
- 超过 20 分钟或发生网络中断时继续保留任务 ID，软件重启后仍可恢复轮询，不重新提交付费任务。
- 用户主动取消仍会终止轮询并调用任务取消接口。
- Codex 网关有效并发仍为 2；官方 OpenAI、GrsAI、自定义 API 及其独立配置均保持不变。
- 发布版本为 `1.4.8+70`，Web/Android 缓存标识为 `20260728-1-4-8`。

## v1.4.9: Built-in ChatGPT sign-in foundation and web image route

- The Windows desktop app now opens ChatGPT official sign-in in a separate window and supports sign-in, re-login, and sign-out. Each account uses an isolated WebView2 profile directory.
- Only sanitized account id, display label, and sign-in state are persisted. Tokens, cookies, and passwords are excluded from app Local Storage, history, and exports.
- The auth window enforces an approved-domain allowlist and opens unrelated external links in the system browser.
- ChatGPT Web Image uses the dedicated local gateway route. Official OpenAI, GrsAI, and Custom API profiles remain separate and are preserved.
- This release provides the account-isolation and sign-in-management foundation. The existing local image gateway remains responsible for image tasks and resume behavior.
- Release version: `1.4.9+71`; Web/Android cache marker: `20260729-1-4-9`.
