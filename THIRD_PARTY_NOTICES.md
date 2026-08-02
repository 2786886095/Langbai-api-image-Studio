# 第三方来源说明

## Gemini 网页协议互操作研究

`gemini-web-direct-protocol.js` 的互操作设计参考了以下公开项目所记录的
Gemini 网页行为、端点用途与响应结构：

- 项目：HanaokaYuzu/Gemini-API
- 地址：https://github.com/HanaokaYuzu/Gemini-API
- 上游许可证：GNU Affero General Public License v3.0

Langbai Image Studio 没有打包、导入或运行该项目的 Python 源码。当前适配层在
JavaScript 中独立实现，并随本仓库提供完整源码。用户登录 Cookie 仅由系统 WebView
管理，适配层不会把 Cookie 写入应用配置、历史记录、项目文件或导出文件。

## 内置 ChatGPT 网页生图网关

Windows 安装包包含 `chatgpt2api` 的经适配运行代码：

- 项目：chatgpt2api
- 上游许可证：MIT License
- 完整许可证：`THIRD_PARTY_LICENSES/chatgpt2api-MIT.txt`

该许可证文件和本说明会随 Windows 安装包一并分发。

## Gemini Watermark Remover

软件内置了 `GargantuaX/gemini-watermark-remover` 的浏览器图片处理核心，用于在
本机处理 Gemini 生成图片，以及处理用户主动导入的单张或多张图片：

- 项目：GargantuaX/gemini-watermark-remover
- 地址：https://github.com/GargantuaX/gemini-watermark-remover
- 集成版本：1.0.33
- 上游许可证：MIT License
- 完整许可证：`THIRD_PARTY_LICENSES/gemini-watermark-remover-MIT.txt`

集成文件 `gemini-watermark-remover.bundle.js` 随应用源码和静态资源一同提供，运行时
不需要启动独立服务，也不调用外部去水印 API。
