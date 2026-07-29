# Langbai Gemini 图片伴侣

Gemini 网页生图使用系统浏览器登录，不把 Google Cookie、OAuth Token 或完整账号信息复制进 Langbai。

## Chromium 系浏览器

1. 打开扩展管理页并启用“开发者模式”。
2. 选择“加载已解压的扩展”，选择 `chromium` 目录。
3. 在 Langbai 的“Gemini 网页生图”卡片中复制 64 位本机配对密钥。
4. 打开扩展弹窗，粘贴密钥并点击“保存并检测”。
5. 点击“打开 Gemini”，在系统浏览器完成登录。
6. 回到软件点击“检测浏览器伴侣”。

配对密钥只授权本机 `127.0.0.1` 图片任务桥。扩展脚本只在 `https://gemini.google.com/*` 运行。

## 平台说明

- Windows、macOS、Linux：Chrome、Edge 等 Manifest V3 浏览器可加载本扩展。
- Android：需使用支持 Chromium 扩展的浏览器；标准 Chrome Android 当前不加载桌面扩展。
- iOS/iPadOS：Chromium 扩展包不适用；入口会显示平台诊断，Safari Web Extension 需签名构建后启用。

Gemini 网页结构变化可能触发 `selector_pack_outdated`。此时其他 API 供应商仍可继续使用。
