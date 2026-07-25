# OpenCodex 本机生图专用适配规范

> 适用设备：当前 Windows 电脑
> OpenCodex 版本：`2.7.36`
> 图像模型：本文件专述 `gpt-image-2`
> 文档日期：2026-07-25
> 适配范围：只包含文生图与参考图编辑，不包含文本模型、Responses API 或模型路由

Nano Banana 2（`gemini-3.1-flash-image`）使用同一 OpenCodex 地址，但采用独立的
`aspect_ratio` / `image_size` 契约和本地蒙版合成方案，详见
`NANO_BANANA2_AND_INPAINT_IMPLEMENTATION_PLAN.md`。两套模型参数不得混发。

## 1. 接入目标

软件应把 OpenCodex 作为一个独立的“本地 Codex 生图”供应商处理，不要套用普通 OpenAI API 的 multipart 编辑协议。

OpenCodex 在本机接收 JSON 请求，使用已经登录的 ChatGPT/Codex 授权连接上游图像服务，再把上游 JSON 响应原样返回。软件不需要 OpenAI API Key。

需要注意：

- 这是本机回环地址，只允许当前电脑访问，不是公网 API。
- `opencodex-local-only` 只是为了兼容软件“密钥不能为空”的校验，不是 OpenAI API Key，也不会作为上游密钥使用。
- 请求走当前 ChatGPT/Codex 登录授权，但 OpenAI 没有公开承诺这类私有后端调用在产品界面中具体计入哪一种额度，软件不得显示“保证扣 Codex 额度”。
- OpenCodex 只负责转发，内容审核、账号限制、限流和可用模型最终仍由上游决定。

## 2. 本机连接参数

| 配置项 | 固定值 | 说明 |
|---|---|---|
| 供应商标识 | `opencodex-local-image` | 建议的软件内部 ID |
| 显示名称 | `OpenCodex 本地 GPT` | 建议的界面名称 |
| 协议 | HTTP + JSON | 不使用 WebSocket，不使用 SSE |
| 主机 | `127.0.0.1` | 仅本机回环 |
| 端口 | `10100` | 当前 OpenCodex 端口 |
| Base URL | `http://127.0.0.1:10100/v1` | 建议内部保存 Base URL |
| 文生图地址 | `http://127.0.0.1:10100/v1/images/generations` | `POST` |
| 参考图编辑地址 | `http://127.0.0.1:10100/v1/images/edits` | `POST` |
| 健康检查 | `http://127.0.0.1:10100/healthz` | `GET`，不消耗生图额度 |
| 模型 | `gpt-image-2` | 当前只展示此模型 |
| 本地占位密钥 | `opencodex-local-only` | 非敏感占位字符串 |
| `Content-Type` | `application/json` | 两个图片端点都必须是 JSON |
| 客户端超时 | 建议 `620000 ms` | 应略大于代理的 600 秒超时 |
| OpenCodex 图片超时 | `600000 ms` | 当前本机配置，10 分钟 |
| 推荐并发 | `5` | 总任务可更多，但同时最多发 5 个请求 |
| 推荐单请求图片数 | `n = 1` | 多图批量通过客户端并发调度 |

建议请求头：

```http
Content-Type: application/json
Accept: application/json
Authorization: Bearer opencodex-local-only
```

当前服务只监听 `127.0.0.1`，因此不要求代理准入密钥。上述 `Authorization` 仅用于兼容现有软件的非空密钥结构。不要把它写成可导出、可共享的真实凭据。

## 3. 能力总表

| 能力 | 本机适配状态 | 软件实现要求 |
|---|---:|---|
| 文本生成图片 | 已实测成功 | 调用 `/v1/images/generations` |
| 单张参考图编辑 | 已实测成功 | 调用 `/v1/images/edits`，使用 JSON Data URL |
| 多张参考图 | 支持 | `images` 数组中放多个对象 |
| Base64 图片响应 | 已实测成功 | 读取 `data[].b64_json` |
| `quality: high` | 请求可发送，但当前私有上游未按值执行 | UI 必须标为“质量偏好”，不能承诺实际档位 |
| 自定义尺寸 | 请求可发送，但当前私有上游未按值执行 | UI 必须标为“尺寸偏好”，并以响应/图片实际尺寸为准 |
| 透明背景 | 不支持 | `gpt-image-2` 当前不支持 `transparent` |
| 参考图忠实度切换 | 不支持切换 | `gpt-image-2` 自动按 high fidelity 处理 |
| multipart 编辑上传 | 不支持 | 不得发送 `multipart/form-data` |
| 图片 URL 结果 | 不应依赖 | 以 Base64 响应为主 |
| 流式生图 | 不支持 | 等待完整 JSON 响应 |
| 遮罩编辑 `mask` | 当前专用契约不支持 | 不在 UI 中开放 |
| 自动重试非幂等生图 | 不建议 | 防止重复扣量或生成重复图片 |

## 4. 请求参数表

### 4.1 当前专用契约支持的参数

| 字段 | 类型 | 生成 | 编辑 | 可选值/格式 | 推荐值 | 说明 |
|---|---|---:|---:|---|---|---|
| `model` | string | 必填 | 必填 | `gpt-image-2` | `gpt-image-2` | 不要自动替换为文本模型 |
| `prompt` | string | 必填 | 必填 | 非空文本 | 用户提示词 | 支持中文 |
| `size` | string | 可选 | 可选 | `auto` 或 `宽x高` | `auto` / 常用预设 | 当前私有上游可能忽略，例如请求 `1024x1024` 实际返回 `1402x1122` |
| `quality` | string | 可选 | 可选 | `auto`、`low`、`medium`、`high` | `auto` | 当前私有上游可能改写档位，不能把请求值当成实际值 |
| `background` | string | 可选 | 可选 | `auto`、`opaque` | `auto` | 不要给 `gpt-image-2` 发送 `transparent` |
| `n` | integer | 可选 | 可选 | 正整数 | `1` | 软件应使用多个 `n=1` 请求做批量任务 |
| `images` | array | 不使用 | 必填 | `[{ "image_url": "data:..." }]` | 1 个或多个 | 字段名是复数 `images` |

### 4.2 `quality` 的实测结论

| UI 名称 | 请求值 | 用途 | 取舍 |
|---|---|---|---|
| 自动 | `auto` | 默认通用模式 | 由模型决定 |
| 草稿 | `low` | 构图预览、快速试错 | 最快，细节较少 |
| 标准 | `medium` | 一般成图 | 质量和速度折中 |
| 高质量 | `high` | 最终成图、细节要求高 | 更慢，通常使用更多图像输出量 |

公开 API 支持上表四档，但 2026-07-25 对 ChatGPT/Codex 私有额度路径完成的 33 组 GPT 尺寸/比例测试中，`auto`、`low`、`medium`、`high` 最终全部按 `medium` 输出。因此软件在 OpenCodex GPT 模式固定发送 `quality: "medium"`，并禁用其他三个无效档位。这个结论不适用于独立的 OpenAI 官方 API Key 路径。

它是图像渲染质量请求，不是 Codex 文本模型的 reasoning effort；软件中不要把它命名为“推理等级”。

### 4.3 尺寸约束

公开 OpenAI Image API 中，`gpt-image-2` 支持 `auto` 和符合以下全部条件的自定义尺寸：

| 约束 | 要求 |
|---|---|
| 最大边长 | 不超过 `3840 px` |
| 边长步进 | 宽、高都必须是 `16` 的倍数 |
| 长短边比例 | 不超过 `3:1` |
| 总像素下限 | 不少于 `655360` |
| 总像素上限 | 不超过 `8294400` |

建议预设：

| 名称 | `size` |
|---|---|
| 正方形 | `1024x1024` |
| 竖图 | `1024x1536` |
| 横图 | `1536x1024` |
| 2K 正方形 | `2048x2048` |
| 2K 横图 | `2048x1152` |
| 4K 横图 | `3840x2160` |
| 4K 竖图 | `2160x3840` |

超过 `2560x1440` 总像素级别的输出在官方说明中仍被视为实验性能力。高分辨率与 `quality: high` 叠加时，延迟和用量都会明显增加。

当前 ChatGPT/Codex 私有图片后端不按上述公开 API 尺寸上限直接输出。2026-07-25 的 19 组常用/边界尺寸和 14 组提示词比例全部成功，60 张原图双解码尺寸误差为 0，实测结果为：

- 总像素稳定在约 157 万，最大观测值 `1,573,770`；
- 最大观测长边 `2172`，对应 `2172x724` / `724x2172`；
- 有效画幅约不超过 `3:1`，`1:4` 与 `1:8` 会被收窄；
- 单独发送 `size` 不能可靠决定方向，提示词必须同时明确横向/纵向和目标比例。

因此软件仍允许发送符合公开契约的尺寸请求，但会把尺寸推导出的方向和最简比例附加到发给 OpenCodex GPT 的提示词中。结果卡必须以 Base64 解码后的真实宽高为准，不能把输入尺寸当成实际输出尺寸。

### 4.4 不要默认发送的参数

OpenCodex 会把 JSON 主体原样转发，但“能被代理转发”不等于“当前 ChatGPT/Codex 私有图片后端承诺支持”。以下参数属于公开 OpenAI Image API 能力，却不在当前 Codex 图片客户端的稳定 JSON 契约中：

| 字段 | 公开 Image API | 当前本机适配策略 |
|---|---:|---|
| `output_format` | `png`、`jpeg`、`webp` | 暂不发送；按返回 Base64 实际格式保存 |
| `output_compression` | `0`–`100`，仅 JPEG/WebP | 暂不发送 |
| `moderation` | `auto`、`low` | 暂不发送；不能绕过上游审核 |
| `input_fidelity` | 其他模型可能支持 | `gpt-image-2` 必须省略，参考图自动 high fidelity |
| `mask` | 公开 Image API 支持 | 当前本地 JSON 契约未定义，不发送 |
| `response_format` | 某些旧接口存在 | 不发送；固定解析 `b64_json` |
| `stream` | 其他 API 可能存在 | 不发送 |

如果以后要开放 `output_format`、`output_compression` 或 `moderation`，必须先针对当前 OpenCodex 版本和当前 ChatGPT 登录后端逐项做真实请求验收，不能仅凭公开 API 文档启用。

## 5. 文生图请求

### 最小请求

```json
{
  "model": "gpt-image-2",
  "prompt": "一只橘猫坐在窗台上，午后阳光，细腻插画风"
}
```

### 推荐完整请求

```json
{
  "model": "gpt-image-2",
  "prompt": "一只橘猫坐在窗台上，午后阳光，细腻插画风",
  "size": "1024x1536",
  "quality": "high",
  "background": "auto",
  "n": 1
}
```

JavaScript 示例：

```js
const response = await fetch(
  "http://127.0.0.1:10100/v1/images/generations",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": "Bearer opencodex-local-only"
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size: "1024x1536",
      quality: "high",
      background: "auto",
      n: 1
    }),
    signal: AbortSignal.timeout(620000)
  }
);
```

## 6. 参考图编辑请求

这个端点与 OpenAI 公开 API 的常规 multipart 示例不同。本机 OpenCodex 专用适配必须发送 JSON。

参考图对象：

```json
{
  "image_url": "data:image/png;base64,iVBORw0KGgoAAA..."
}
```

完整请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "保留人物、服装和画风，把背景改成雨夜霓虹街道",
  "size": "1024x1536",
  "quality": "high",
  "background": "auto",
  "n": 1,
  "images": [
    {
      "image_url": "data:image/png;base64,iVBORw0KGgoAAA..."
    }
  ]
}
```

多参考图只需继续向 `images` 数组添加对象：

```json
{
  "images": [
    { "image_url": "data:image/png;base64,..." },
    { "image_url": "data:image/jpeg;base64,..." },
    { "image_url": "data:image/webp;base64,..." }
  ]
}
```

实现要求：

1. 客户端读取图片二进制。
2. 转为 Base64。
3. 根据真实 MIME 类型组成完整 Data URL。
4. 使用字段 `images`，每项为 `{ "image_url": "data:..." }`。
5. POST 到 `/v1/images/edits`。
6. 不要构建 `FormData`，不要发送 `image[]` multipart 字段。

当前没有从上游获得可靠的“参考图最大张数”承诺。软件不应伪造硬上限；为控制 JSON 体积、内存和延迟，本机 UI 可先建议每个任务使用 1–4 张参考图。

## 7. 成功响应

客户端至少应兼容下面的结构：

```json
{
  "created": 1778832973,
  "background": "opaque",
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAA..."
    }
  ],
  "quality": "high",
  "size": "1024x1536",
  "usage": {
    "input_tokens": 1474,
    "output_tokens": 1372,
    "total_tokens": 2846
  }
}
```

解析规则：

| 字段 | 要求 |
|---|---|
| `data` | 必须存在并且是数组 |
| `data[].b64_json` | 主要图片结果，必须支持 |
| `created` | 可记录，不要作为成功的唯一判断 |
| `quality`、`size`、`background` | 可选元数据 |
| `usage` | 可选；不要假设每次都返回 |
| `data[].url` | 可兼容，但本机适配不得依赖 |

软件应逐项解码 `data[].b64_json`，通过文件头识别 PNG/JPEG/WebP 后再选择扩展名，避免固定把所有结果保存为 `.png`。

## 8. 并发、超时和取消

| 项目 | 策略 |
|---|---|
| 最大同时请求数 | `5` |
| 单请求 `n` | 固定 `1` |
| 顺序模式 | 并发设为 `1` |
| 客户端总超时 | 建议 `620000 ms` |
| OpenCodex 上游超时 | 当前 `600000 ms` |
| 用户取消 | 客户端中止请求；代理可能返回 `499` |
| 自动重试 | 默认关闭，或只允许用户明确重试 |

图片生成属于非幂等操作。OpenCodex 本身不会对连接重置自动重发图片请求，以免重复生成。软件也不要对 `502`、`504` 或网络断开进行无提示自动重试；应该保留失败卡片，让用户选择重试。

批量调度伪代码：

```js
const MAX_CONCURRENCY = 5;

// 每个任务始终 n=1；任务总数可以大于 5。
await runWithConcurrency(tasks, MAX_CONCURRENCY, async (task) => {
  return task.references.length
    ? editImage(task)
    : generateImage(task);
});
```

## 9. 请求与响应体限制

| 限制 | 当前 OpenCodex 值 |
|---|---:|
| 解压后的 JSON 请求体上限 | `256 MiB` |
| 上游图片响应体上限 | `100 MiB` |

这只是代理的 OOM 保护上限，不是软件应追求的正常负载。Base64 会比原始二进制大约多三分之一；客户端应在编码前限制单图大小，并避免一次请求塞入大量超高分辨率参考图。

## 10. 错误处理表

| HTTP 状态 | 常见含义 | 软件处理 |
|---:|---|---|
| `400` | 参数错误、模型不支持、没有可用 OpenAI 上游 | 展示 `error.message`，不要原样重试 |
| `401` | ChatGPT/Codex 授权失效，需要重新登录 | 提示用户检查 `ocx status` 或重新授权 |
| `409` | 账号/任务亲和性失效 | 提示重新开始任务后再试 |
| `413` | 请求体过大 | 压缩/减少参考图，不要自动重试 |
| `429` | 账号冷却、限流或额度限制 | 展示限流信息，延后手动重试 |
| `499` | 用户或客户端取消 | 标记为已取消，不显示成服务故障 |
| `502` | 上游连接失败或响应超过代理限制 | 保留任务，允许用户手动重试 |
| `504` | 上游超过 600 秒 | 标记超时，允许用户手动重试 |
| `5xx` | 上游临时故障 | 不要无限重试 |

错误响应通常为：

```json
{
  "error": {
    "type": "upstream_error",
    "message": "image generations upstream timed out"
  }
}
```

兼容解析时同时检查：

```js
const message =
  body?.error?.message ??
  body?.message ??
  `HTTP ${response.status}`;
```

对于 `error.code === "moderation_blocked"`，应提示修改提示词或输入图，不要自动重复提交相同内容。

## 11. 启动检查

软件选择 OpenCodex 供应商后，可以先请求：

```http
GET http://127.0.0.1:10100/healthz
```

只有健康检查成功后才启用“生成”按钮。失败时建议显示：

> OpenCodex 本地服务未启动。请先启动 OpenCodex，或执行 `ocx ensure`。

健康检查不等于 ChatGPT OAuth 一定有效；`401`、`429` 等上游状态仍需在实际生图请求中处理。

## 12. 推荐的软件配置对象

```json
{
  "id": "opencodex-local-image",
  "name": "OpenCodex 本地 GPT",
  "baseUrl": "http://127.0.0.1:10100/v1",
  "apiKey": "opencodex-local-only",
  "model": "gpt-image-2",
  "transport": "json",
  "generationPath": "/images/generations",
  "editPath": "/images/edits",
  "healthUrl": "http://127.0.0.1:10100/healthz",
  "supportsReferences": true,
  "referenceEncoding": "data-url-json-array",
  "supportsMultipartEdits": false,
  "supportsStreaming": false,
  "qualityOptions": ["auto", "low", "medium", "high"],
  "backgroundOptions": ["auto", "opaque"],
  "defaultQuality": "auto",
  "defaultBackground": "auto",
  "defaultN": 1,
  "maxConcurrency": 5,
  "timeoutMs": 620000
}
```

## 13. 验收清单

- [ ] `/healthz` 可以识别 OpenCodex 已启动。
- [ ] 文生图使用 JSON 调用 `/v1/images/generations`。
- [ ] 参考图使用 JSON 调用 `/v1/images/edits`。
- [ ] 编辑请求发送 `images[].image_url` Data URL，不使用 multipart。
- [ ] `quality` 提供 `auto/low/medium/high`，默认 `auto`。
- [ ] `quality: high` 与 `size` 可以同时发送，但 UI 标为请求偏好。
- [ ] UI 显示响应返回的实际 `quality` 与图片实际宽高，不把请求值当成结果值。
- [ ] `gpt-image-2` 不发送 `input_fidelity` 和 `background: transparent`。
- [ ] 单请求固定 `n=1`，最多同时 5 个请求。
- [ ] 客户端超时大于 OpenCodex 的 600 秒。
- [ ] 正确解码一个或多个 `data[].b64_json`。
- [ ] `usage` 缺失时不会报错。
- [ ] `400/401/409/413/429/499/502/504` 有明确提示。
- [ ] 网络失败和 `5xx` 不会无限自动重试。
- [ ] 日志不记录 ChatGPT OAuth、完整 Authorization 或完整 Base64 图片。

## 14. 依据与边界

本规范依据三部分信息：

1. 当前电脑安装的 OpenCodex `2.7.36` 图片代理实现与配置。
2. 当前电脑已完成的文生图和参考图编辑真实调用，二者均返回 HTTP 200；参考图编辑内容生效，但 `quality: high` 和请求尺寸未被私有上游严格执行。
3. [OpenAI 图像生成官方说明](https://developers.openai.com/api/docs/guides/image-generation)与 [GPT Image 2 模型页](https://developers.openai.com/api/docs/models/gpt-image-2)。
4. [Codex 图片 JSON 请求类型](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/images.rs)。

公开 OpenAI Image API 与 ChatGPT/Codex 登录后端不是同一份稳定性承诺。本文把当前 Codex JSON 类型没有声明的参数列为“不要默认发送”，这是为了避免软件错误地把公开 API 的全部能力照搬到本机私有转发路径。
