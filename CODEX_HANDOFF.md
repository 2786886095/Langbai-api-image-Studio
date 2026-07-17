# Codex / Claude Handoff: AI 图片生成器 v1.3.20

更新时间：2026-07-17
项目路径：`F:\AI\agent\图像生成`
仓库：`https://github.com/2786886095/Langbai-api-image-Studio`

## 当前状态

- 本交接对应源码版本 `1.3.20+44`；线上发布状态以 GitHub Releases 实际页面为准。
- 本轮完成的是一次跨 Web、Windows/macOS/Linux Flutter 壳、Android、iOS 的功能与安全深度审计。
- Web 完整回归、代理专项、Flutter analyze/test、Android debug 实际构建均已通过。
- 本机没有 Visual Studio/macOS，因此 Windows C++、macOS Swift、iOS Swift 的最终编译必须由四端 GitHub Actions 验证。

## v1.3.20 增量修复

- 修复“全部失败重试”开始后失败卡切换为加载态，失败数归零导致整条工具栏消失的问题。
- 重试进行中工具栏持续可见，按钮切换为“取消全部重试”，并立即显示本轮重试数量。
- 取消会终止本轮所有正在等待的卡片请求、恢复失败卡并释放全局锁；可随即重新发起全部重试。
- 防止单个无超时原生生图请求永久挂起后，`retryAllFailedRun` 状态永远无法复位。
- 五语言补齐开始、取消中、取消完成提示；回归覆盖挂起、取消、状态恢复和第二轮成功重试。

## v1.3.19 增量功能

- 漫画分镜与嵌字模式新增共用的“批量输入提示词”弹窗。
- 每行一条提示词，严格按分镜顺序或图片名称顺序映射；内部空行保留位置，避免后续内容错位。
- 漫画提示词多于现有分镜时自动扩展分镜，最多 100 条。
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
- Flutter：`No issues found`，`11/11` 测试通过。
- 浏览器完整回归：所有场景通过；涵盖语言、主题、设置滚轮、API、模型、参考图、三种生成模式、重试/取消、历史、导出、更新、PWA 离线。
- Android debug 在 ASCII 副本实际构建成功：
  - APK：`F:\AI\agent\codex\buildcheck-image-generator-1320-20260717175644\build\app\outputs\flutter-apk\app-debug.apk`
  - SHA-256：`DC7A88CB6CF7184DC8CDEE95629B23BB5351E3058CBB652A4D7A674327BBA590`
  - APK 内 `assets/app.js`、`assets/flutter_assets/app.js`、两份 `index.html` 与根目录源码哈希完全一致。

## 发布前必须完成

1. 检查 `git diff`，只提交本轮源代码和测试，不提交 QA 截图、临时 Edge profile、ASCII buildcheck 或构建目录。
2. 推送后确认 GitHub Actions 的 `quality`、Android、Windows、macOS、iOS 全部成功。
3. 下载四端 artifacts，逐个检查内嵌 `APP_VERSION = "1.3.20"`。
4. 对正式 Android APK 核对既有签名 SHA1：`C0:CE:3C:D4:36:95:D6:B1:28:7E:0B:8F:69:51:3F:70:89:AA:AA:91`。
5. 生成 `SHA256SUMS.txt`，再创建 `v1.3.20` Release；不要在 CI 未绿前创建 Release。
6. 至少在真实 Windows exe 上复测滚轮、语言下拉、目录选择、模型检测、代理测试和更新安装路径。

## 不要误改

- 不要把自动重试扩大到非 HTTP 400。
- 不要把气泡嵌字或漫画历史拆成一张张图片。
- 不要恢复项目时自动塞回参考图。
- 不要把自绘下拉改回原生 `<select>`；旧 `webview_windows` 的离屏渲染无法可靠显示原生下拉弹层。
- 不要移除 native AbortSignal/cancelRequest 链路。
- 不要让 Android 使用桌面 `127.0.0.1` 代理。
- 不要绕过 SHA-256 校验安装更新。
- 不要改 Android 正式签名密钥或 Windows Inno Setup AppId。

## 工作区说明

- `CLAUDE_HANDOFF.md` 保留旧版本的详细历史；本文件是 v1.3.20 当前状态的权威摘要。
- 中文源路径会触发 Flutter shader 写入失败；Android 本地构建请继续使用纯 ASCII 副本。
