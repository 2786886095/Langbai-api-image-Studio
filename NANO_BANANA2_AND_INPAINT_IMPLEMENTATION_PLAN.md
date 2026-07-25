# Langbai Image Studio：OpenCodex 双模型与局部重绘实施计划

> 文档日期：2026-07-25
> 目标版本：v1.3.33
> 状态：已按本文方案落地并加入自动回归
> 本机 OpenCodex：`2.7.36`，`http://127.0.0.1:10100`

## 1. 已确认事实

1. OpenCodex 的本机图片接口已支持两个模型：
   - `gpt-image-2`
   - `gemini-3.1-flash-image`（Nano Banana 2）
2. 两个模型统一使用：
   - `POST /v1/images/generations`
   - `POST /v1/images/edits`
   - JSON 请求，不使用 multipart。
3. Nano Banana 2 已使用当前 Google Antigravity OAuth 完成真实测试：
   - 512、1:1 文生图成功，耗时 11.66 秒。
   - 单张参考图编辑成功，耗时 10.26 秒。
   - 16:9、4K 请求成功返回，但实际只有 `1408×768`；说明当前 Antigravity OAuth 私有路径接受 4K 参数，却没有按 4K 执行。
   - 自定义 `832×1216` 请求实际返回 `768×1376`；当前私有路径不能精准执行任意像素宽高。
   - 响应为 OpenAI 兼容的 `data[].b64_json`，并额外返回 `mime_type`。
4. Nano Banana 2 支持语义图片编辑，但当前 Antigravity 上游不接受独立 `mask` 字段。
5. 因此“局部重绘”不能宣称是上游原生蒙版重绘。首版应采用：
   - 本地绘制蒙版；
   - Nano Banana 2 生成候选补丁；
   - 客户端按蒙版合成；
   - 蒙版外像素保持原图。
6. `gpt-image-2` 当前走 ChatGPT/Codex 私有图片后端。真实测试已经证明：
   - `quality` 可以发送，但上游可能改写；
   - `size` 可以发送，但上游可能不按请求尺寸输出。
   - 请求 `832×1216`、`medium`，实际返回 `1024×1536`、`medium`。
   因而这两个值在 UI 中必须标为“请求偏好”，不能标成“保证生效”。

## 2. 产品结构

不要再新增一个重复的 OpenCodex 地址配置。保留现有“OpenCodex 本地生图”供应商，在其内部增加模型选择：

| UI 名称 | 请求模型 ID | 登录来源 | 主要用途 |
|---|---|---|---|
| GPT Image 2 | `gpt-image-2` | ChatGPT/Codex 登录 | 通用生成、参考图编辑 |
| Nano Banana 2 | `gemini-3.1-flash-image` | Google Antigravity OAuth | 多参考图、文字渲染、语义编辑、局部重绘补丁 |

固定连接参数：

| 项目 | 值 |
|---|---|
| Base URL | `http://127.0.0.1:10100/v1` |
| 健康检查 | `GET http://127.0.0.1:10100/healthz` |
| 本地占位密钥 | `opencodex-local-only` |
| 协议 | HTTP + JSON |
| 客户端总超时 | `620000 ms` |
| 单请求图片数 | `n = 1` |

占位密钥不是 OpenAI、Google 或 OpenCodex 的真实凭据，不得将其描述成可共享 API Key。Google OAuth 和 ChatGPT 登录仍由 OpenCodex 管理。

## 3. 软件模块改造

建议新增或拆分以下能力对象：

```text
OpenCodexImageProvider
├── OpenCodexHealthClient
├── OpenCodexCapabilityRegistry
├── OpenCodexRequestBuilder
│   ├── GptImage2RequestBuilder
│   └── NanoBanana2RequestBuilder
├── OpenCodexImageResponseDecoder
├── InpaintWorkspace
│   ├── MaskEditor
│   ├── InpaintCropPlanner
│   ├── PatchAlignment
│   └── MaskCompositor
└── OpenCodexJobScheduler
```

关键要求：

- 不通过模型名字中的 `gpt`、`gemini` 字符串临时判断能力；使用明确的 capability 表。
- 每次切换模型时重建参数面板，隐藏不适用字段，禁止把上一个模型的字段带入新请求。
- 历史记录保存“请求参数”和“实际输出属性”两套值。
- 原始 Base64 不写日志，只记录 MIME、宽高、字节数、耗时和错误类型。

## 4. Nano Banana 2 API 契约

### 4.1 文生图

```http
POST http://127.0.0.1:10100/v1/images/generations
Content-Type: application/json
Authorization: Bearer opencodex-local-only
```

```json
{
  "model": "gemini-3.1-flash-image",
  "prompt": "一只蓝色陶瓷杯，白色背景，商品摄影",
  "n": 1,
  "aspect_ratio": "1:1",
  "image_size": "1K"
}
```

### 4.2 参考图编辑

```http
POST http://127.0.0.1:10100/v1/images/edits
Content-Type: application/json
Authorization: Bearer opencodex-local-only
```

```json
{
  "model": "gemini-3.1-flash-image",
  "prompt": "只在杯子正面增加一个黄色五角星，其他内容保持不变",
  "n": 1,
  "aspect_ratio": "1:1",
  "image_size": "1K",
  "images": [
    {
      "image_url": "data:image/jpeg;base64,<BASE64>"
    }
  ]
}
```

### 4.3 响应

```json
{
  "created": 1784950000,
  "data": [
    {
      "b64_json": "<BASE64>",
      "mime_type": "image/jpeg"
    }
  ]
}
```

解码规则：

1. 优先读取 `mime_type`。
2. 若字段不存在，按文件签名识别 PNG、JPEG、WebP。
3. 不根据用户选择的输出格式强行命名文件。
4. 图片解码后再次读取真实宽高，并写入结果卡和历史记录。

## 5. Nano Banana 2 参数面板

### 5.1 支持参数

| UI 字段 | JSON 字段 | 可选值 | 默认值 | 说明 |
|---|---|---|---|---|
| 模型 | `model` | 固定 ID | Nano Banana 2 | 不允许发送别名 |
| 提示词 | `prompt` | 非空字符串 | 用户输入 | 生成和编辑都必填 |
| 比例 | `aspect_ratio` | 见下表 | `1:1` | 只发送官方支持值，不提供任意像素值 |
| 分辨率档位 | `image_size` | `512`、`1K`、`2K`、`4K` | `1K` | 只发送这四个官方字段值 |
| 参考图 | `images` | Data URL 数组 | 空 | 编辑至少 1 张 |
| 张数 | `n` | 固定 `1` | `1` | 批量由客户端发多个请求 |

支持比例：

```text
1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1,
4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
```

上述分辨率是 Nano Banana 2 官方能力和 OpenCodex 可接受的请求值，不代表当前 Google Antigravity OAuth 私有路径保证执行。2026-07-25 的本机实测请求 `image_size: "4K"`、`aspect_ratio: "16:9"`，实际返回 `1408×768` JPEG。因此 UI 必须将其标为“分辨率偏好”，并以解码后的真实宽高为准。

### 5.2 参考图限制

OpenCodex 适配层最多接收 14 张参考图。Google 官方对 Nano Banana 2 的细分说明是：

- 最多 10 张对象参考图；
- 其中最多 4 张可用于人物一致性；
- 总数上限为 14。

软件首版建议先开放 8 张，完成内存和移动端压力测试后再提高到 14 张。这里的 8 张是客户端稳定性建议，不是模型上限。

### 5.3 自定义宽高

软件已有自定义宽高时，可以采用两种方式：

1. 当前实现：UI 只显示“比例 + 分辨率档位”，并隐藏 Nano 模式下的像素尺寸面板。
2. 旧工程像素尺寸不直接发送给 Nano；用户必须明确选择官方比例和档位。

结果页必须同时显示请求的比例/档位和图片实际宽高，避免用户误以为请求目标一定会被私有上游严格执行。

官方尺寸表：
[Google Gemini image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)

GPT Image 2 任意合规尺寸与七个常用预设：
[OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation)

## 6. GPT Image 2 参数扩展

### 6.1 默认开放

| 参数 | 状态 | UI 处理 |
|---|---|---|
| `prompt` | 已支持 | 正常开放 |
| `images` | 已支持 | 参考图列表 |
| `n` | 已支持 | 固定 `1`，批量由客户端并发 |
| `quality` | 可发送但可能被上游改写 | 标为“质量偏好” |
| `size` | 可发送但可能被上游改写 | 标为“尺寸偏好” |
| `background` | 仅 `auto`、`opaque` | 禁止 `transparent` |

`quality` 选项：

```text
auto, low, medium, high
```

必须在结果卡同时保存：

- requestedQuality；
- responseQuality（若上游返回）；
- actualWidth / actualHeight。

### 6.2 实验功能，不应默认开放

| 参数 | 公开 OpenAI API | 当前 ChatGPT/Codex 私有路径 | 实施策略 |
|---|---|---|---|
| `moderation` | `auto`、`low` | 未逐项实测 | 放入“实验参数”，默认不发送 |
| `output_format` | PNG/JPEG/WebP | 未逐项实测 | 首版在客户端解码后转换 |
| `output_compression` | JPEG/WebP 压缩 | 未逐项实测 | 首版使用客户端导出质量 |
| `input_fidelity` | 部分模型可调 | GPT Image 2 固定高保真 | 必须省略 |
| `mask` | 公开 API 存在相关编辑能力 | 当前本地 JSON 契约未确认 | 不发送 |
| `stream` | 公开能力取决于接口 | 当前本地契约不支持 | 不开放 |

注意：`moderation: low` 不是“更高审核强度”，而是较低限制选项。软件不能提供虚构的“低/中/高审核强度”，也不能承诺绕过上游安全策略。

### 6.3 实验参数启用门槛

每个实验参数都必须完成：

1. 单独真实请求；
2. 生成和编辑分别测试；
3. 记录请求值、响应值和实际文件；
4. 400 时确认不会自动重试；
5. 在当前 OpenCodex 和当前 ChatGPT 登录后端复测；
6. 通过后才从“实验”移到默认面板。

## 7. 局部重绘方案

### 7.1 目标

用户在原图上涂抹需要改变的区域，输入修改内容，软件调用 Nano Banana 2 生成补丁，并保证蒙版外像素不被替换。

该保证来自本地合成，不来自模型。

### 7.2 编辑界面

必须包含：

- 画笔、橡皮擦；
- 画笔大小；
- 边缘柔化；
- 撤销、重做；
- 清空蒙版；
- 显示/隐藏蒙版；
- 原图/候选图对比；
- 100% 像素查看；
- 生成多个候选并选择；
- “只改蒙版区域”的明确提示。

建议将蒙版保存为与原图同尺寸的单通道 8 位图：

- `0`：完全保留原图；
- `255`：完全使用新补丁；
- 中间值：仅用于蒙版内侧羽化。

### 7.3 请求前处理

1. 计算非零蒙版的包围盒。
2. 在包围盒四周增加上下文：
   - 至少 64 像素；
   - 或包围盒长边的 15%，取较大值。
3. 将裁剪框限制在原图范围。
4. 将裁剪框扩展到 Nano Banana 2 支持的最接近比例。
5. 导出：
   - 原图裁剪块；
   - 裁剪块内的本地蒙版；
   - 裁剪坐标和目标尺寸。
6. 只把原图裁剪块作为参考图发给模型，不发送二值 `mask` 字段。

建议提示词模板：

```text
编辑这张局部图像：{用户要求}。
保持未提及的主体、透视、光线、纹理、边缘关系和背景不变。
输出与输入图相同的构图与比例，不要移动镜头，不要添加无关元素。
```

不应声称模型能看到用户画的蒙版。蒙版只在客户端合成阶段使用。

### 7.4 返回后对齐

1. 解码候选图。
2. 缩放到裁剪框目标尺寸。
3. 首版使用“保持中心 + 等比 cover + 中心裁剪”。
4. 计算裁剪边缘的差异预览。
5. 若边缘偏移明显，允许用户：
   - 平移；
   - 缩放；
   - 重新生成；
   - 调整上下文范围。
6. 后续版本可增加特征点或边缘相关性自动配准，但不能在没有可靠置信度时静默变形。

### 7.5 本地合成

合成公式：

```text
result = original × (1 - alpha) + generatedPatch × alpha
```

强制规则：

- `alpha = 0` 的像素必须逐字节保留原图；
- 羽化只能向蒙版内部计算，不能扩散到蒙版外；
- 透明原图必须保留原 alpha；
- 合成在原图色彩空间中完成；
- 保存前不得先对整图做有损 JPEG 重编码。

这样可以保证蒙版外像素不变，但不能保证蒙版内的透视和纹理一定完美衔接，因此必须保留预览和撤销。

### 7.6 特殊情况

| 情况 | 处理 |
|---|---|
| 蒙版为空 | 禁止提交 |
| 蒙版覆盖全图 | 提示改用普通参考图编辑 |
| 蒙版过小 | 自动扩大上下文，不扩大实际合成区域 |
| 蒙版触碰边缘 | 裁剪框贴边，提示可能出现接缝 |
| 多个相距很远的区域 | 拆成多个重绘任务，按顺序合成 |
| 人脸/文字 | 建议更大上下文，生成后要求用户人工检查 |
| 输出构图明显漂移 | 不自动合成，进入手动对齐界面 |

## 8. 并发、超时和重试

继续保留全局最多 5 个分镜并发，但建议增加模型/分辨率动态上限：

| 任务 | 建议并发 |
|---|---:|
| GPT Image 2 | 最多 5 |
| Nano Banana 2 512/1K | 最多 5 |
| Nano Banana 2 2K | 最多 3 |
| Nano Banana 2 4K | 最多 1 |
| 局部重绘 | 最多 2 |

这些是客户端内存和稳定性建议，不是上游公布的硬限制。

重试规则：

- HTTP 400、401、403：不自动重试；
- HTTP 429：显示限流，允许用户手动重试；
- HTTP 502、504、网络中断：不静默自动重发；
- 图片请求是非幂等操作，自动重试可能产生重复图片或重复用量；
- 每个失败任务保留原参数，提供“手动重试”按钮。

## 9. 错误映射

| 状态/错误 | 用户提示 |
|---|---|
| `/healthz` 失败 | OpenCodex 本地服务未启动 |
| 401 | 对应的 ChatGPT 或 Google OAuth 需要重新登录 |
| 403 | 上游账号策略或模型访问受限 |
| 400 + model | 当前账号或 OpenCodex 不支持该模型/参数 |
| 400 + reference | 参考图必须为 PNG、JPEG、WebP Data URL |
| 429 | 上游限流或额度暂不可用 |
| 504 | 上游在 600 秒内未完成 |
| no image | 上游只返回了文本或被安全策略终止 |
| decode failed | 响应图片损坏或格式无法识别 |

错误日志不得包含：

- Authorization；
- OAuth token；
- 完整 Data URL；
- 完整 Base64；
- 用户本地凭据文件内容。

## 10. 历史记录与工程格式

为每张图保存：

```json
{
  "provider": "opencodex-local-image",
  "model": "gemini-3.1-flash-image",
  "operation": "generation | edit | inpaint",
  "prompt": "...",
  "requested": {
    "aspectRatio": "1:1",
    "imageSize": "1K",
    "quality": null,
    "size": null
  },
  "actual": {
    "mimeType": "image/jpeg",
    "width": 1024,
    "height": 1024,
    "bytes": 443447
  },
  "inpaint": {
    "crop": null,
    "maskAssetId": null,
    "feather": null
  }
}
```

局部重绘工程还应保存：

- 原图资源 ID；
- 蒙版资源 ID；
- 裁剪坐标；
- 请求使用的裁剪图；
- 未合成的模型候选图；
- 最终合成图；
- 对齐变换参数；
- 撤销链或至少上一版快照。

## 11. 测试计划

### 11.1 API

- [ ] GPT Image 2 文生图。
- [ ] GPT Image 2 单参考图编辑。
- [ ] Nano Banana 2 文生图。
- [ ] Nano Banana 2 单参考图编辑。
- [ ] Nano Banana 2 多参考图编辑。
- [ ] Nano Banana 2 所有比例参数校验。
- [ ] 512、1K、2K、4K 分辨率。
- [ ] PNG、JPEG、WebP Data URL 输入。
- [ ] 错误远程 URL 被客户端提前拒绝。
- [ ] `n != 1` 被客户端提前拒绝。

### 11.2 局部重绘

- [ ] 蒙版外像素逐字节一致。
- [ ] 蒙版羽化不越界。
- [ ] 边缘蒙版。
- [ ] 小区域蒙版。
- [ ] 多个分离区域。
- [ ] 透明 PNG。
- [ ] 竖图、横图、超宽图。
- [ ] 返回图尺寸与请求不一致时仍能安全对齐。
- [ ] 失败后原图、蒙版和撤销历史不丢失。

### 11.3 稳定性

- [ ] 5 个 1K 任务并发。
- [ ] 3 个 2K 任务并发。
- [ ] 单个 4K 任务内存峰值。
- [ ] 10 分钟连续任务。
- [ ] OpenCodex 中途停止时正确失败。
- [ ] OAuth 失效时不泄露凭据。
- [ ] HTTP 400 不自动重发。

## 12. 分阶段发布

### 阶段 A：双模型

- 增加 Nano Banana 2 模型卡。
- 完成参数面板和请求构建。
- 完成 Base64/MIME 解码。
- 完成生成、编辑和多参考图。

### 阶段 B：局部重绘 MVP

- 蒙版画布；
- 自动裁剪和上下文扩展；
- Nano Banana 2 候选补丁；
- 手动对齐；
- 蒙版内侧羽化合成；
- 撤销和工程保存。

### 阶段 C：高级重绘

- 多候选对比；
- 自动配准置信度；
- 多个分离区域串行处理；
- 边缘差异热图；
- 蒙版与候选版本管理。

### 阶段 D：GPT Image 2 实验参数

- 逐项真实测试 moderation、输出格式和压缩；
- 只有确认当前私有后端接受并按值执行后才正式开放；
- 未确认的字段继续由客户端后处理完成。

## 13. 验收标准

1. 同一 OpenCodex 配置中可稳定选择 GPT Image 2 和 Nano Banana 2。
2. Nano Banana 2 生成、单图编辑和多图编辑均能保存正确格式。
3. 切换模型不会发送另一模型的私有参数。
4. 局部重绘时蒙版外像素逐字节不变。
5. 上游不支持 `mask` 的事实在 UI 和帮助中表述准确。
6. GPT Image 2 的质量和尺寸显示为“请求偏好”，实际结果单独显示。
7. 任何失败都不自动重复提交非幂等生图请求。
8. 日志、崩溃报告和工程文件不包含 OAuth、真实 API Key 或完整 Base64。
9. Windows 完整回归通过后，再进入 Android、iOS、macOS 构建。

## 14. 参考

- [Google Nano Banana 图像生成官方说明](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google generateContent 图像生成说明](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [OpenAI 图像生成官方说明](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2 模型页](https://developers.openai.com/api/docs/models/gpt-image-2)
- 本项目现有规范：`OPENCODEX_LOCAL_IMAGE_ADAPTER.md`
