# Codex / Claude Handoff: AI 图片生成器 v1.4.2

更新时间：2026-07-25
项目路径：`F:\AI\agent\codex\Langbai-api-image-Studio`
仓库：`https://github.com/2786886095/Langbai-api-image-Studio`

## 当前状态

- 本交接对应源码版本 `1.4.2+64`；线上发布状态以 GitHub Releases 实际页面为准。

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
3. 下载四端 artifacts，逐个检查内嵌 `APP_VERSION = "1.4.2"`。
4. 对正式 Android APK 核对既有签名 SHA1：`C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
5. 生成 `SHA256SUMS.txt`，再创建 `v1.4.2` Release；不要在 CI 未绿前创建 Release。
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

- `CLAUDE_HANDOFF.md` 保留旧版本的详细历史；本文件是 v1.4.2 当前状态的权威摘要。
- 中文源路径会触发 Flutter shader 写入失败；Android 本地构建请继续使用纯 ASCII 副本。
