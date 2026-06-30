# Windows 版运行说明

运行入口：`ai_image_generator.exe`

注意事项：

- 不要只复制 exe。Windows 版需要同目录下的 `data/`、`flutter_windows.dll`、`webview_windows_plugin.dll`、`WebView2Loader.dll`。
- 目标机器需要安装 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已内置；如果启动页提示缺失，请安装：
  https://developer.microsoft.com/microsoft-edge/webview2/
- 图片和 ZIP 默认保存到：
  `%USERPROFILE%\Downloads\AI Image Generator\images`
  `%USERPROFILE%\Downloads\AI Image Generator\zips`

