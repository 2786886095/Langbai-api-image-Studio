# 🎨 AI 图片生成器 — 架构分析文档

> **分析日期**: 2025-06-04
> **源项目路径**: `F:\AI\图像生成`（app.js / index.html / style.css）
> **目的**: 完全理解项目架构，便于后续优化修改

---

## 一、项目概览

| 维度 | 描述 |
|------|------|
| **类型** | 纯前端 SPA（无构建工具，无框架依赖） |
| **文件** | 3 个文件：`index.html`(222行) + `app.js`(~1459行) + `style.css`(460行) |
| **总大小** | ~82KB |
| **运行方式** | 浏览器直接打开（需 HTTP 服务，因为 `file://` 下 CORS/fetch 受限） |
| **外部依赖** | 仅 JSZip（CDN 动态加载，用于 ZIP 打包下载） |
| **设计风格** | 暗色主题，CSS 变量体系，响应式断点 960px / 480px |

---

## 二、文件职责划分

### 2.1 `index.html` — 视图层（View）

**DOM 结构树：**

```
.app
├── header                         # 标题 + 副标题
├── main-layout（CSS Grid 双栏）
│   ├── aside.input-panel（左栏 — sticky 定位）
│   │   ├── details#configSection          # ⚙️ API 配置折叠区
│   │   │   ├── select#savedApis           # 已保存 API 下拉
│   │   │   ├── input#apiEndpoint          # API 地址
│   │   │   ├── input#apiKey               # API Key (password)
│   │   │   ├── input#model + datalist     # 模型选择
│   │   │   └── button#saveConfig          # 保存配置
│   │   ├── div#modeTabs                   # 模式切换按钮组
│   │   │   ├── button[data-mode="single"] # 📷 单图模式
│   │   │   └── button[data-mode="comic"]  # 🎬 漫画分镜
│   │   ├── label#globalPromptField        # 全局提示词
│   │   │   ├── textarea#prompt            # 提示词输入框
│   │   │   ├── button#importTxt           # 导入 TXT
│   │   │   └── div#txtFileBadges          # TXT 文件徽章
│   │   ├── label                          # 全局参考图片
│   │   │   ├── div#uploadZone             # 拖拽上传区
│   │   │   ├── div#thumbGrid             # 缩略图网格
│   │   │   └── input#useOrigSize (checkbox) # 输出原图尺寸
│   │   ├── fieldset                       # 全局分辨率
│   │   │   ├── label.size-option × 3      # 预设尺寸 (1024² / 横版 / 竖版)
│   │   │   └── label.size-option.size-custom # 自定义宽×高
│   │   ├── label#nImagesField (单图专属)   # 生成数量 + 依次开关
│   │   ├── div#comicPanelSection (漫画专属) # 分镜表格区域
│   │   │   ├── button#addPanel / #clearPanels
│   │   │   └── table#panelTable > tbody#panelTbody
│   │   ├── div#progressWrap              # 进度条（批量用）
│   │   ├── button#generateBtn            # ✨ 主生成按钮
│   │   └── div#status                    # 状态提示
│   └── main.result-panel（右栏）
│       ├── div#resultToolbar             # ZIP 下载 + 清空结果
│       ├── div#emptyState                # 空状态引导
│       ├── div#resultGrid                # CSS Grid 图片卡片容器
│       └── div#loadingOverlay            # 加载遮罩 + spinner
└── template#panelRowTemplate             # 分镜行模板（隐藏）
```

**关键 DOM 与 JS 绑定关系：** 全部通过 `id` 属性连接。JS 在 `dom` 对象（app.js 第 12-63 行）中集中管理所有 DOM 引用。

---

### 2.2 `app.js` — 控制层（Controller + Model）

**模块划分表：**

| 区间（行号） | 模块 | 说明 |
|:---:|------|------|
| 1–5 | 文件头注释 | 描述双模式、兼容 url/b64_json |
| 7–9 | 工具函数 | `$()` / `$$()` — querySelector 简写 |
| 11–63 | DOM 引用映射 | `dom` 对象，一次性获取所有 DOM 节点 |
| 65–70 | 全局状态变量 | `currentMode`, `panelCounter`, `abortController`, `importedTxtFiles[]`, `referenceImages[]` |
| 72–156 | 配置管理 | localStorage 读写、多 API 保存/切换/删除/渲染下拉 |
| 158–186 | 模型价格表 | `KNOWN_PRICES`（40+ 条目，跨平台统一格式） |
| 188–414 | 模型检测 | 平台识别 → GrsAI 内置 / 标准 `/v1/models` 探测 → edits 端点兼容测试 |
| 416–457 | 模式切换 | `switchMode()` — UI 显隐 + 文案切换 + 分镜初始化 |
| 459–526 | TXT 文本导入 | 多文件 FileReader → `importedTxtFiles[]` → badge UI → `getEffectivePrompt()` |
| 528–607 | 参考图片上传 | 拖拽 + 点击 → base64 编码 → `referenceImages[]` → 缩略图网格 |
| 609–629 | 分辨率解析 | 自定义宽高联动 radio → `getSelectedSize()` |
| 631–689 | 分镜表格 CRUD | template 克隆 → 增删行 → `renumberPanels()` → `collectPanels()` |
| 708–728 | 状态提示 & 加载控制 | `showStatus()`, `showLoading()`, `hideLoading()` |
| 734–765 | 平台检测 | `detectPlatform()` → "grsai" / "openai"；GrsAI 尺寸→比例映射 |
| 767–906 | **API 调用核心** | `callImageAPI()` 路由 → `grsaiGenerate()` / `openaiGenerate()` |
| 906–931 | 并发控制 | `concurrentLimit()` / `concurrentLimitSettled()` 有限并发 |
| 933–1011 | 网络工具 | `dataUrlToBlob()`, `normalizeApiUrl()` 智能拼接, `apiFetch()` 通用封装 |
| 1013–1083 | 单图生成 | `generateSingle()` — 校验 → 占位 → 并发 → 结果替换 |
| 1085–1166 | 漫画批量生成 | `generateComic()` — 全局提示词拼接 → 分镜校验 → 进度条 → 3s 后隐藏 |
| 1168–1308 | 结果渲染 | 占位卡片 → `replacePlaceholder()` / `markPlaceholderFailed()` → `renderResults()` |
| 1310–1425 | 下载 & ZIP | 单图下载、URL 复制、JSZip CDN 动态加载打包 |
| 1428–1442 | 灯箱 | `openLightbox()` — ESC 关闭 / 点击背景关闭 |
| 1444–1458 | 入口绑定 | 生成按钮 → `generateSingle()` / `generateComic()`；Ctrl+Enter 快捷键 |

---

### 2.3 `style.css` — 样式层（Presentation）

**设计系统：**

| 层级 | 实现 |
|------|------|
| **CSS 变量** | `:root` 定义 14 个变量：背景色系 (3)、文字色系 (2)、主色 `#6366f1` + 辉光、成功/错误色、圆角 (2)、过渡 |
| **色板** | 暗色：`#0f1117` (bg) → `#1a1d27` (surface) → `#242836` (surface2)，紫色主调 |
| **字体栈** | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei"` |
| **响应式** | `@media (max-width: 960px)` → 单栏；`@media (max-width: 480px)` → 紧凑间距 + 结果单列 |

**组件样式清单：**

| 组件 | CSS 类 | 关键属性 |
|------|--------|------|
| 表单 | `.field`, `input/textarea/select` | focus 紫色辉光 `box-shadow: 0 0 0 3px var(--primary-glow)` |
| 按钮 | `.btn`, `.btn-primary`, `.btn-danger`, `.btn-xs`, `.btn-sm` | 渐变主按钮 + hover 位移 |
| 分辨率预设 | `.size-presets`, `.size-option` | CSS Grid 3 列，`:has(input:checked)` 高亮 |
| 分镜表格 | `.panel-table` | `table-layout: fixed`，固定列宽 |
| 结果网格 | `.result-grid` | `grid-template-columns: repeat(auto-fill, minmax(250px, 1fr))` |
| 加载动画 | `.spinner` | CSS `@keyframes spin` |
| 灯箱 | `.lightbox` | `fixed` 全屏，`max-width: 90vw; max-height: 90vh` |
| 工具类 | `.hidden` | `display: none !important` |

---

## 三、核心数据流

### 3.1 用户操作 → API 调用完整链路

```
用户操作
  │
  ├─ 配置 API → localStorage (STORAGE_KEY / STORAGE_APIS)
  │
  ├─ 导入 TXT → importedTxtFiles[] → renderTxtBadges() → getEffectivePrompt()
  │
  ├─ 上传参考图 → referenceImages[] → renderThumbGrid() → callImageAPI()
  │
  └─ 点击「生成」
       │
       ├─ 单图模式 (generateSingle)
       │   ├─ validateCommon() → getEffectivePrompt() + getSelectedSize()
       │   ├─ concurrentLimit / sequential (依次)
       │   │   └─ callImageAPI(prompt, size, 1)
       │   │        ├─ detectPlatform()
       │   │        ├─ grsaiGenerate() 或 openaiGenerate()
       │   │        └─ 返回 { data: [{url|b64_json}] }
       │   └─ replacePlaceholder() / markPlaceholderFailed()
       │
       └─ 漫画模式 (generateComic)
           ├─ collectPanels() → 拼接 globalPrompt + panel.prompt
           ├─ 批量占位卡片 → concurrentLimit / sequential
           │   └─ callImageAPI(fullPrompt, size)
           ├─ updateProgress(done, total)
           └─ 3 秒后隐藏进度条
```

### 3.2 API 调用策略（核心复杂度所在）

```
callImageAPI(prompt, size, n)
  │
  ├─ detectPlatform(endpoint) → "grsai" | "openai"
  │
  ├─ GrsAI 分支
  │   ├─ nano-banana 模型 → POST /v1/api/generate
  │   │   ├─ body: { model, prompt, aspectRatio, replyType:"json", imageSize }
  │   │   ├─ 有参考图: body.images = [base64 dataUrls]
  │   │   ├─ 若 status=running → 轮询 GET /v1/api/result?id=xxx (最多 60×2s)
  │   │   └─ status=succeeded → data.results[0].url
  │   └─ gpt-image 模型 → POST /v1/draw/completions
  │       ├─ 获取 taskId → 轮询 POST /v1/draw/result (最多 30×4s)
  │       └─ status=succeeded → data.results[0].url
  │
  └─ OpenAI 通用分支
      ├─ 无参考图 → POST /v1/images/generations (JSON body)
      └─ 有参考图 → POST /v1/images/edits
          ├─ 先尝试 FormData (multipart)
          ├─ 若 MULTIPART_FAIL → 退化为 JSON body (image: base64[])
          └─ response_format: "b64_json"
```

---

## 四、关键数据模型

### 4.1 localStorage 持久化

```javascript
// 当前使用（单一配置）
// Key: "ai_image_gen_config"
{
  endpoint: string,
  apiKey: string,
  model: string
}

// 多配置保存
// Key: "ai_image_gen_apis"
[
  { name: string, endpoint: string, apiKey: string, model: string },
  ...
]
```

### 4.2 运行时状态（全局变量）

| 变量 | 类型 | 说明 |
|------|------|------|
| `currentMode` | `"single" \| "comic"` | 当前模式 |
| `panelCounter` | `number` | 分镜自增 ID |
| `abortController` | `AbortController \| null` | 用于取消批量生成 |
| `importedTxtFiles` | `[{name, content}]` | 已导入的 TXT 文本参考 |
| `referenceImages` | `[{file, dataUrl, width, height}]` | 已上传的参考图片 |
| `generatedImageUrls` | `string[]` | 生成结果中的图片 URL（供 ZIP 打包使用） |

### 4.3 分镜数据

```javascript
// collectPanels() 返回
[
  {
    id: string,        // "1", "2", ...
    prompt: string,    // 分镜专属提示词
    size: "WxH" | "", // 分镜专属尺寸（空则用全局）
    imgFile: File | null  // 分镜专属参考图
  },
  ...
]
```

### 4.4 模型价格字典

`KNOWN_PRICES`（第 159–186 行）包含约 40+ 个模型的价格标签，分为三类：

| 类别 | 数量 | 示例 |
|------|:---:|------|
| GrsAI nano-banana 系列 | 10 | `nano-banana-fast`, `nano-banana-pro-vip`, `nano-banana-pro-4k-vip` |
| 通用图片模型 | 12 | `gpt-image-2`, `dall-e-3`, `flux-1.1-pro`, `midjourney-v7` |
| 对话模型（参考） | 14+ | `gpt-4o`, `claude-3-5-sonnet`, `gemini-2.5-pro`, `deepseek-chat` |

---

## 五、架构模式总结

### 已采用的模式

| 模式 | 实现方式 |
|------|------|
| **命令式 DOM 操作** | 直接读写 DOM，无虚拟 DOM，无响应式系统 |
| **集中 DOM 引用** | `dom` Object 聚合，`$()`/`$$()` 辅助 |
| **全局状态变量** | 模块级 let 变量作为单数据源 |
| **Template 克隆** | `<template>` + `.cloneNode(true)` 动态创建分镜行 |
| **自制并发控制器** | `concurrentLimit()` / `concurrentLimitSettled()`，20 并发上限 |
| **localStorage 持久化** | JSON 序列化/反序列化 |
| **动态 CDN 加载** | JSZip 通过 `<script>` 动态注入 |
| **CSS 变量设计系统** | 14 个自定义属性替代 Less/Sass |

### 未采用的模式（设计取舍）

| 未采用 | 原因 / 影响 |
|------|------|
| ES Module | 所有代码在单一全局作用域，函数挂载 `window` |
| TypeScript | 无类型检查，需人工追踪参数格式 |
| React / Vue | 保持零依赖、零构建 |
| 构建工具 (Vite/Webpack) | 3 个文件直接部署 |
| 状态管理库 (Redux/Pinia) | 变量即状态，规模尚可 |
| CSS 预处理器 | 纯手写 CSS + CSS 变量 |
| 前端路由 | 模式切换走 CSS `hidden` 显隐 |

---

## 六、潜在问题与改进方向

### 6.1 架构层面

| 优先级 | 问题 | 影响 | 改进建议 |
|:---:|------|------|------|
| 🔴 | 单文件 1459 行 JS | 维护困难，查找/修改效率低 | 拆分为 ES Module: `config.js`, `api.js`, `panels.js`, `results.js`, `utils.js` |
| 🔴 | 全局作用域污染 | 变量冲突、命名污染 | IIFE 包裹或 `<script type="module">` |
| 🟡 | 无 JS 模块化 | 无法 tree-shaking | 引入 Vite 打包 |
| 🟡 | 硬编码价格表 | 价格过期后不准确 | 外置为 JSON 配置，或从 API 元数据动态获取 |
| 🟡 | 无错误边界 | 未捕获异常中断流程 | 在 async 入口统一 try/catch |
| 🟢 | 无骨架屏 | 生成中反馈单一 | 添加加载骨架屏 |

### 6.2 功能缺口

| 优先级 | 缺口 | 建议方案 |
|:---:|------|------|
| 🟡 | 无历史记录 | localStorage 存储缩略图 + 提示词 + 时间戳 |
| 🟡 | 无提示词模板 | 预设分类模板（写实/动漫/油画等）供快速选择 |
| 🟡 | 分镜无拖拽排序 | 添加行拖拽（可用原生 Drag API） |
| 🟡 | 分镜无批量导入 | 支持 CSV/JSON 格式批量导入 |
| 🟡 | 参考图仅用第一张（OpenAI 路径） | 支持多图编辑或拼合模式 |
| 🟢 | 无高级参数 | 添加 seed、temperature、steps 等高级选项 |
| 🟢 | 无主题切换 | CSS 变量已就绪，添加亮色主题变量覆盖 |

### 6.3 健壮性

| 问题 | 详情 | 改进 |
|------|------|------|
| `apiFetch` 5 分钟硬超时 | GrsAI 大图可能超时 | 按模型类型设置动态超时 |
| GrsAI 轮询无总超时 | nano-banana: 最多 2 分钟，gpt-image: 最多 2 分钟，但无全局硬限制 | 添加总轮询超时 |
| 并发限制硬编码 20 | 不同 API 有不同限流 | 支持按平台配置并发数 |
| ZIP 打包无进度 | 大量图片无反馈 | 显示打包进度 |
| `dataUrlToBlob` 同步 atob | 大 base64 阻塞主线程 | 使用异步解码或 Web Worker |

### 6.4 安全

| 问题 | 风险等级 | 说明 |
|------|:---:|------|
| API Key 明文 localStorage | 🟡 中 | 可被 XSS / 浏览器扩展窃取；对本地工具可接受 |
| 无 CSP 头 | 🟡 中 | JSZip CDN 动态加载存在供应链风险；可改用本地打包或 SRI |
| `innerHTML` 部分直接使用 | 🟢 低 | 已使用 `escapeHtml()` 防御（第 1242–1246 行），需确保所有动态 HTML 都经过此函数 |

---

## 七、函数索引

以下列出所有具名函数及其行号，方便快速定位：

| 函数 | 行号 | 说明 |
|------|:---:|------|
| `loadConfig()` | 75 | 从 localStorage 加载当前配置 |
| `saveConfig(config)` | 79 | 保存配置到 localStorage |
| `applyConfig(cfg)` | 80 | 将配置写回表单字段 |
| `loadAllApis()` | 88 | 从 localStorage 加载所有已保存 API |
| `saveAllApis(list)` | 92 | 保存所有 API 列表 |
| `renderSavedApis()` | 94 | 渲染已保存 API 下拉列表 |
| `priceLabel(modelId)` | 188 | 获取模型价格标签 |
| `loadGrsaiModels()` | 192 | 加载 GrsAI 内置模型列表 |
| `loadFallbackModels()` | 223 | 加载通用备选模型列表 |
| `checkEditsSupport(baseUrl, apiKey)` | 237 | 探测 images/edits 端点是否可用 |
| `switchMode(mode)` | 428 | 切换单图/漫画模式 |
| `removeTxtFile(index)` | 492 | 移除指定 TXT 文件 |
| `renderTxtBadges()` | 497 | 渲染 TXT 文件徽章 |
| `getEffectivePrompt()` | 517 | 获取有效提示词（TXT + 文本框拼接） |
| `addReferenceImages(files)` | 547 | 添加参考图片 |
| `removeReferenceImage(index)` | 572 | 移除指定参考图片 |
| `renderThumbGrid()` | 577 | 渲染参考图缩略图网格 |
| `getSelectedSize()` | 623 | 获取当前选中的分辨率 |
| `addPanelRow()` | 637 | 添加一行分镜 |
| `renumberPanels()` | 674 | 重新编号所有分镜行 |
| `collectPanels()` | 695 | 收集所有分镜数据 |
| `showStatus(msg, type)` | 712 | 显示状态提示（success/error/info） |
| `clearStatus()` | 716 | 清除状态提示 |
| `showLoading(text)` | 720 | 显示加载遮罩 |
| `hideLoading()` | 726 | 隐藏加载遮罩 |
| `detectPlatform(endpoint)` | 734 | 检测 API 平台类型 |
| `grsaiSizeToRatio(size)` | 745 | GrsAI 尺寸 → 宽高比 |
| `callImageAPI(prompt, size, n)` | 772 | 统一图片生成 API 入口 |
| `grsaiGenerate(endpoint, apiKey, model, prompt, size)` | 790 | GrsAI 平台生成 |
| `detectImageSize(size)` | 866 | 根据像素宽度推算 GrsAI 分辨率等级 |
| `openaiGenerate(endpoint, apiKey, model, prompt, size, n, hasRef)` | 874 | OpenAI 平台生成 |
| `sleep(ms)` | 903 | Promise 延时 |
| `concurrentLimitSettled(tasks, limit)` | 906 | 并发限制（允许部分失败） |
| `concurrentLimit(tasks, limit)` | 921 | 并发限制（一个失败全停） |
| `dataUrlToBlob(dataUrl)` | 934 | data URL → Blob |
| `normalizeApiUrl(inputUrl, path)` | 950 | 智能拼接完整 API 地址 |
| `apiFetch(url, apiKey, body)` | 961 | 通用 fetch 封装（5 分钟超时） |
| `fileToBase64(file)` | 1004 | File → Base64（返回纯字符串，不含前缀） |
| `validateCommon()` | 1017 | 公共字段校验 |
| `generateSingle()` | 1029 | 单图模式生成 |
| `generateComic()` | 1089 | 漫画分镜批量生成 |
| `updateProgress(done, total, icon)` | 1168 | 更新进度条 |
| `addResultPlaceholder(panelId, prompt)` | 1176 | 添加结果占位卡片 |
| `replacePlaceholder(card, panelId, data, prompt)` | 1192 | 用实际结果替换占位卡片 |
| `markPlaceholderFailed(card, panelId, errMsg)` | 1233 | 标记占位卡片为失败 |
| `escapeHtml(str)` | 1242 | HTML 转义 |
| `renderResults(data)` | 1252 | 统一渲染结果（单图模式） |
| `downloadImage(imageUrl, index)` | 1314 | 下载单张图片 |
| `triggerDownload(blob, filename)` | 1331 | 触发浏览器下载 |
| `copyImageUrl(dataUrl, originalUrl)` | 1340 | 复制图片链接 |
| `downloadAllAsZip()` | 1366 | ZIP 打包下载全部结果 |
| `openLightbox(imageUrl)` | 1432 | 打开灯箱预览 |

---

## 八、附录：同一仓库的关联子目录

以下子目录存在于工作区 `F:\AI\agent`，与主项目位于同一 Git 仓库中：

| 目录 | 内容 |
|------|------|
| `.agents/` | Claude Code 辅助技能（小说/变身/审核） |
| `.claude/` | Claude Code 配置与技能 |
| `.codegraph/` | 代码图索引数据库 |
| `.reasonix/` | Reasonix 会话记忆与技能 |
| `anima-tagging/` | Anima 标签打标脚本（服装/角色/风格） |
| `bianshen/` | 角色变身附属技能 |
| `character-transformation-prompts/` | 角色变身提示词输出 |
| `claude code/` | Claude Code 小说生成输出 |
| `gemini技能/` | Gemini 提示词规则与参考 |
| `memory/` | 项目记忆 (FACT.md + JOURNAL) |
| `novel-TSF/` | TSF 小说创作（同人作品） |
| `前端设计/` | 50+ 品牌 UI 设计参考 (design-md) |
| `角色变身/` | 角色变身 Anima3 编译器与分镜 |
| `软件/` | NovelFlowStudio, EasyAI-Vue, anime-site 等配套工具 |
