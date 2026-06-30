# Claude 交接文档：AI 图片生成器

更新时间：2026-06-30  
项目路径：`F:\AI\agent\图像生成`  
当前重点：用户最近明确反馈“导出功能一点用都没有”，本轮已完成导出链路修复、验证和 APK 重打包。

## 用户诉求背景

用户在连续几轮中重点指出：

- UI 不协调，需要简洁、舒服、高级感，同时深色/浅色分配要注意。
- 参考图导入曾经弹两次、参考图区域过大、按钮点不了、API 配置下滑异常。
- 漫画历史记录应按“项目”保存，而不是一张张散图；项目包含所有图片、全局提示词、分镜提示词，提示词默认折叠。
- 单张图片记录只应展示分镜提示词，不应把全局提示词和分镜提示词合并展示。
- 图片多时结果区不能堆叠，应支持滚动、自适应、最多横排 3 张。
- 失败要显示原因，支持一键全部重试，并能调整失败后的重试次数。
- 最近最新反馈：导出功能无效。

请注意：用户情绪已经比较不耐烦，回复时要直接说明做了什么、验证了什么，不要只给方案。

## 本轮已修复内容

### 1. 侧边栏导出入口

文件：`app.js`

关键位置：

- `getExportableHistoryCount()`：约第 1176 行
- `handleExportAction()`：约第 1183 行

现在侧边栏“导出”不再只是触发隐藏的 `downloadZip.click()`，而是完整判断：

- 当前结果区有图片：直接打包当前结果 ZIP。
- 当前结果为空，但历史里有可导出的项目：自动打开历史项目弹窗，并提示用户可在项目卡片点击“导出项目”。
- 当前结果和历史都没有可导出图片：显示“没有可导出的图片”。

新增文案键：

- `exportOpenedHistory`

已加入简中、繁中、英文、日文、韩文 locale。

### 2. 历史项目导出兼容旧记录

文件：`app.js`

关键位置：

- `getHistoryImages(item)`：约第 3002 行
- `getHistoryThumbnail(item)`：紧随其后

修复点：

- 历史图片现在兼容 `imageUrl` 和旧字段 `url`。
- 避免历史项目实际有图，但导出逻辑误判为空。

### 3. 浏览器 / WebView 下载触发修复

文件：`app.js`

关键位置：

- `triggerDownload(blob, filename)`：约第 3886 行

修复点：

- 原来 `URL.revokeObjectURL(url)` 在 `a.click()` 后立刻执行，部分浏览器或 WebView 可能还没接管下载就被释放，表现为“点了没反应”。
- 现在延迟 60 秒释放：

```js
setTimeout(() => URL.revokeObjectURL(url), 60000);
```

同时给临时 `<a>` 设置了：

- `download`
- `rel = "noopener"`
- `display: none`

### 4. 缓存版本更新

文件：

- `index.html`
- `sw.js`

当前版本：

- `style.css?v=20260630-export-fix`
- `app.js?v=20260630-export-fix`
- `CACHE_NAME = "ai-image-generator-export-fix-20260630"`

这是为了避免 PWA / WebView / 浏览器继续加载旧脚本。

### 5. 回归测试加强

文件：`qa/regression-runner.js`

新增覆盖：

- 真实解析 ZIP 中央目录，不再只用字符串搜索假判断。
- 当前结果区 ZIP 导出。
- 侧边栏导出当前结果。
- 当前结果为空时，侧边栏导出自动打开历史项目。
- 历史项目卡片的“导出项目”按钮能生成有效 ZIP。
- `triggerDownload()` 不会立即 revoke object URL。

关键测试断言位置：

- 约第 581 行到第 586 行。

## 已执行验证

在 `F:\AI\agent\图像生成` 执行并通过：

```powershell
node --check app.js
node --check sw.js
node --check qa/regression-runner.js
flutter analyze
node .\qa\regression-runner.js
```

回归输出：

```text
[qa] All regression checks passed.
```

## APK 状态

已重打 release APK：

```text
F:\AI\agent\图像生成\android\output\AI-Image-Generator-flutter.apk
```

构建结果：

- 大小：`43391785` bytes
- SHA256：`6A111A286A0A32F2F5D16537514B79606F30C7CAB1E1957FAD2F70E67FDE6C2B`
- 时间：`2026/6/30 16:04:56`

构建时 Gradle 仍会打印 Kotlin metadata 警告，但退出码为 0，APK 正常生成。这是之前就存在的环境/依赖警告，不是本轮导出修复引入。

## Android 资源同步注意

修改 Web 资源后，必须同步到：

```text
android\app\src\main\assets
```

本轮已经同步：

- `index.html`
- `app.js`
- `style.css`
- `manifest.webmanifest`
- `sw.js`
- `assets/icons/*`

APK 包内已检查到：

- `handleExportAction`
- 延迟 revoke 下载逻辑
- `20260630-export-fix`
- `ai-image-generator-export-fix-20260630`

## 推荐后续处理

如果用户继续反馈，建议按这个顺序排查：

1. 如果说“安卓导出还是不行”，优先看原生目录权限和 `MainActivity.kt` 的 `saveFile()`。
2. 如果说“导出后找不到文件”，检查是否已经选择 ZIP 目录；安卓端走 SAF 目录授权，不是浏览器默认下载目录。
3. 如果说“历史项目导出没有图片”，检查历史里的图片 URL 是否跨域失效，或是否只有远程 URL 且 native fetch 失败。
4. 如果继续说 UI 不满意，应从结果区、历史弹窗、API 配置三处做新一轮产品级审查，不要只微调颜色。

## 工作习惯提醒

- PowerShell 里中文源码有时会显示乱码，文件本身是 UTF-8；需要精确读中文时用 Python 或支持 UTF-8 的读取方式。
- 不要用 `git reset --hard` 或回滚用户已有改动。
- 项目在 `F:\AI\agent` 这个上层 git 下看起来像未跟踪目录，`git status` 噪音很大。
- 手动编辑用 `apply_patch`。
- 前端改动后要跑 `node .\qa\regression-runner.js`，这个测试会启动浏览器并覆盖核心流程。
- APK 构建更稳的方式是复制到 ASCII 临时目录再构建，避免中文路径偶发问题；构建后再复制 APK 回项目输出目录。

