import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart' as mobile_webview;
import 'package:webview_flutter_android/webview_flutter_android.dart'
    as android_webview;
import 'package:webview_windows/webview_windows.dart' as windows_webview;

const _appTitle = 'AI 图片生成器';
const _appBackground = Color(0xFF101310);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AiImageGeneratorApp());
}

class AiImageGeneratorApp extends StatelessWidget {
  const AiImageGeneratorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: _appTitle,
      home:
          Platform.isWindows ? const WindowsWebShell() : const MobileWebShell(),
    );
  }
}

bool _skipForwardHeader(String name, {required bool multipart}) {
  final lower = name.toLowerCase();
  return lower == HttpHeaders.hostHeader ||
      lower == HttpHeaders.contentLengthHeader ||
      (multipart && lower == HttpHeaders.contentTypeHeader);
}

void _setForwardHeaders(
  HttpClientRequest request,
  Map<String, String> headers, {
  required bool multipart,
}) {
  headers.forEach((name, value) {
    if (!_skipForwardHeader(name, multipart: multipart)) {
      request.headers.set(name, value);
    }
  });
}

String _escapeMultipartHeader(String value) {
  return value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\r', '')
      .replaceAll('\n', '');
}

void _addUtf8(HttpClientRequest request, String value) {
  request.add(utf8.encode(value));
}

void _addMultipartBody(
  HttpClientRequest request,
  List<dynamic> fields,
  String boundary,
) {
  for (final rawField in fields) {
    if (rawField is! Map) continue;
    final name = rawField['name']?.toString() ?? '';
    if (name.isEmpty) continue;
    final type = rawField['type']?.toString() ?? 'text';
    _addUtf8(request, '--$boundary\r\n');
    if (type == 'blob') {
      final filename = rawField['filename']?.toString() ?? 'upload.bin';
      final mimeType =
          rawField['mimeType']?.toString() ?? 'application/octet-stream';
      _addUtf8(
        request,
        'Content-Disposition: form-data; name="${_escapeMultipartHeader(name)}"; filename="${_escapeMultipartHeader(filename)}"\r\n',
      );
      _addUtf8(request, 'Content-Type: $mimeType\r\n\r\n');
      request.add(base64Decode(rawField['base64']?.toString() ?? ''));
      _addUtf8(request, '\r\n');
    } else {
      _addUtf8(
        request,
        'Content-Disposition: form-data; name="${_escapeMultipartHeader(name)}"\r\n\r\n',
      );
      _addUtf8(request, '${rawField['value']?.toString() ?? ''}\r\n');
    }
  }
  _addUtf8(request, '--$boundary--\r\n');
}

Future<Map<String, Object?>> _nativeFetch(
  Map<String, dynamic> payload,
) async {
  final url = payload['url']?.toString() ?? '';
  final method = payload['method']?.toString().toUpperCase() ?? 'GET';
  final responseType = payload['responseType']?.toString() ?? '';
  final isMultipart = payload['bodyType']?.toString() == 'formData';
  final headers = (payload['headers'] as Map?)
          ?.map((key, value) => MapEntry(key.toString(), value.toString())) ??
      <String, String>{};
  final body = payload['body']?.toString();

  final client = HttpClient()..connectionTimeout = const Duration(seconds: 30);
  try {
    final request = await client.openUrl(method, Uri.parse(url));
    _setForwardHeaders(request, headers, multipart: isMultipart);
    if (isMultipart) {
      final boundary =
          '----AiGenBoundary${DateTime.now().microsecondsSinceEpoch}';
      request.headers.set(
        HttpHeaders.contentTypeHeader,
        'multipart/form-data; boundary=$boundary',
      );
      _addMultipartBody(
        request,
        (payload['fields'] as List?) ?? <dynamic>[],
        boundary,
      );
    } else if (body != null && body.isNotEmpty) {
      request.add(utf8.encode(body));
    }

    final response = await request.close();
    final responseBytes = await response.fold<List<int>>(
      <int>[],
      (previous, element) => previous..addAll(element),
    );
    final responseHeaders = <String, String>{};
    response.headers.forEach((name, values) {
      responseHeaders[name] = values.join(',');
    });
    final result = <String, Object?>{
      'status': response.statusCode,
      'headers': responseHeaders,
    };
    if (responseType == 'base64') {
      result['base64'] = base64Encode(responseBytes);
    } else {
      result['body'] = utf8.decode(responseBytes, allowMalformed: true);
    }
    return result;
  } finally {
    client.close(force: true);
  }
}

Future<File> _downloadUrlToFile(String url, File target) async {
  if (!_isExternalHttpUrl(url)) {
    throw PlatformException(
      code: 'invalid_url',
      message: 'Only http/https URLs can be downloaded.',
    );
  }

  final client = HttpClient()..connectionTimeout = const Duration(seconds: 30);
  try {
    final request = await client.getUrl(Uri.parse(url));
    final response = await request.close();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PlatformException(
        code: 'download_failed',
        message: 'HTTP ${response.statusCode}',
      );
    }
    await target.parent.create(recursive: true);
    final sink = target.openWrite();
    try {
      await response.pipe(sink);
    } finally {
      await sink.close();
    }
    return target;
  } finally {
    client.close(force: true);
  }
}

String _psQuote(String value) => "'${value.replaceAll("'", "''")}'";

bool _isExternalHttpUrl(String url) {
  final uri = Uri.tryParse(url.trim());
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
}

Future<bool> _openWindowsExternalUrl(String url) async {
  if (!_isExternalHttpUrl(url)) return false;
  await Process.start('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  return true;
}

class MobileWebShell extends StatefulWidget {
  const MobileWebShell({super.key});

  @override
  State<MobileWebShell> createState() => _MobileWebShellState();
}

class _MobileWebShellState extends State<MobileWebShell>
    with WidgetsBindingObserver {
  static const MethodChannel _downloads =
      MethodChannel('com.aigen.ai_image_generator/downloads');

  late final mobile_webview.WebViewController _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _controller = mobile_webview.WebViewController()
      ..setJavaScriptMode(mobile_webview.JavaScriptMode.unrestricted)
      ..setBackgroundColor(_appBackground)
      ..setNavigationDelegate(
        mobile_webview.NavigationDelegate(
          onPageFinished: (_) => _syncDownloadDirs(),
        ),
      )
      ..addJavaScriptChannel(
        'FlutterDownload',
        onMessageReceived: _handleDownloadMessage,
      )
      ..loadFlutterAsset('index.html');

    final platform = _controller.platform;
    if (platform is android_webview.AndroidWebViewController) {
      android_webview.AndroidWebViewController.enableDebugging(false);
      platform.setMediaPlaybackRequiresUserGesture(false);
      platform.setOnShowFileSelector(_handleAndroidFileSelector);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _syncDownloadDirs();
      _controller.runJavaScript(
        'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onAppResumed && window.AiGenAndroidBridge.onAppResumed();',
      );
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _controller.runJavaScript(
        'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onAppPaused && window.AiGenAndroidBridge.onAppPaused();',
      );
    }
  }

  Future<List<String>> _handleAndroidFileSelector(
    android_webview.FileSelectorParams params,
  ) async {
    final result = await _downloads.invokeMethod<List<dynamic>>('chooseFiles', {
      'acceptTypes': params.acceptTypes,
      'allowMultiple':
          params.mode == android_webview.FileSelectorMode.openMultiple,
    });
    return (result ?? <dynamic>[]).map((item) => item.toString()).toList();
  }

  Future<void> _handleDownloadMessage(
    mobile_webview.JavaScriptMessage message,
  ) async {
    final Map<String, dynamic> payload;
    try {
      payload = jsonDecode(message.message) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final id = payload['id']?.toString() ?? '';
    final action = payload['action']?.toString() ?? '';
    try {
      Object? result;
      switch (action) {
        case 'chooseDir':
          result = await _downloads.invokeMethod<String>('chooseDirectory', {
            'kind': payload['kind'] ?? 'images',
          });
          await _syncDownloadDirs();
          break;
        case 'getDirs':
          result = await _downloads.invokeMethod<Map<dynamic, dynamic>>(
            'getSavedDirectories',
          );
          break;
        case 'saveFile':
          result = await _downloads.invokeMethod<String>('saveFile', {
            'kind': payload['kind'] ?? 'images',
            'fileName': payload['fileName'] ?? 'download.bin',
            'mimeType': payload['mimeType'] ?? 'application/octet-stream',
            'base64': payload['base64'] ?? '',
          });
          break;
        case 'downloadUpdate':
          result = await _downloads.invokeMethod<Map<dynamic, dynamic>>(
            'downloadUpdate',
            {
              'url': payload['url'] ?? '',
              'fileName': payload['fileName'] ?? 'update.apk',
              'install': payload['install'] == true,
            },
          );
          break;
        case 'nativeFetch':
          result = await _nativeFetch(payload);
          break;
        case 'openExternal':
          final url = payload['url']?.toString() ?? '';
          if (!_isExternalHttpUrl(url)) {
            throw PlatformException(
              code: 'invalid_url',
              message: 'Only http/https URLs can be opened externally.',
            );
          }
          result = await _downloads.invokeMethod<bool>('openExternalUrl', {
            'url': url,
          });
          break;
        default:
          throw PlatformException(
            code: 'unknown_action',
            message: 'Unknown action: $action',
          );
      }
      await _resolveJs(id, result);
    } catch (error) {
      await _rejectJs(id, error.toString());
    }
  }

  Future<void> _syncDownloadDirs() async {
    try {
      final dirs = await _downloads.invokeMethod<Map<dynamic, dynamic>>(
        'getSavedDirectories',
      );
      final json = jsonEncode(dirs ?? <String, String>{});
      await _controller.runJavaScript(
        'window.AiGenAndroidBridge && window.AiGenAndroidBridge.setDirs($json);',
      );
    } catch (_) {
      // Optional outside Android.
    }
  }

  Future<void> _resolveJs(String id, Object? result) {
    return _controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.resolve(${jsonEncode(id)}, ${jsonEncode(result)});',
    );
  }

  Future<void> _rejectJs(String id, String message) {
    return _controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.reject(${jsonEncode(id)}, ${jsonEncode(message)});',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _appBackground,
      body: SafeArea(
          child: mobile_webview.WebViewWidget(controller: _controller)),
    );
  }
}

class WindowsWebShell extends StatefulWidget {
  const WindowsWebShell({super.key});

  @override
  State<WindowsWebShell> createState() => _WindowsWebShellState();
}

class _WindowsWebShellState extends State<WindowsWebShell> {
  final _controller = windows_webview.WebviewController();
  final _subscriptions = <StreamSubscription<dynamic>>[];

  bool _isReady = false;
  String? _errorTitle;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    unawaited(_initializeWebView());
  }

  Future<void> _initializeWebView() async {
    try {
      final version =
          await windows_webview.WebviewController.getWebViewVersion();
      if (version == null || version.isEmpty) {
        throw PlatformException(
          code: 'missing_webview2',
          message: '未检测到 Microsoft Edge WebView2 Runtime，请安装后重新打开应用。',
        );
      }

      await _controller.initialize();
      _subscriptions.add(_controller.webMessage.listen(
        _handleWindowsBridgeMessage,
        onError: (Object error) => debugPrint('WebView message error: $error'),
      ));
      _subscriptions.add(_controller.loadingState.listen((state) {
        if (state == windows_webview.LoadingState.navigationCompleted) {
          unawaited(_syncWindowsDownloadDirs());
        }
      }));

      await _controller.setBackgroundColor(_appBackground);
      await _controller.setPopupWindowPolicy(
          windows_webview.WebviewPopupWindowPolicy.sameWindow);
      await _controller
          .addScriptToExecuteOnDocumentCreated(_windowsBridgeScript);

      final indexFile = _windowsAssetFile('index.html');
      if (!indexFile.existsSync()) {
        throw PlatformException(
          code: 'missing_asset',
          message: '找不到内置页面资源：${indexFile.path}',
        );
      }

      await _controller.loadUrl(Uri.file(indexFile.path).toString());
      if (!mounted) return;
      setState(() => _isReady = true);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _errorTitle = 'Windows WebView 启动失败';
        _errorMessage = error.toString();
      });
    }
  }

  File _windowsAssetFile(String name) {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    return File(
      [
        exeDir,
        'data',
        'flutter_assets',
        name,
      ].join(Platform.pathSeparator),
    );
  }

  Future<void> _handleWindowsBridgeMessage(dynamic rawMessage) async {
    final payload = _decodeBridgePayload(rawMessage);
    if (payload == null) return;

    final id = payload['id']?.toString() ?? '';
    final action = payload['action']?.toString() ?? '';
    try {
      Object? result;
      switch (action) {
        case 'chooseDir':
          result = await _ensureWindowsDownloadDir(
            payload['kind']?.toString() ?? 'images',
          );
          await _syncWindowsDownloadDirs();
          break;
        case 'getDirs':
          result = _windowsDownloadDirs();
          break;
        case 'saveFile':
          result = await _saveWindowsFile(
            payload['kind']?.toString() ?? 'images',
            payload['fileName']?.toString() ?? 'download.bin',
            payload['base64']?.toString() ?? '',
          );
          break;
        case 'downloadUpdate':
          result = await _downloadWindowsUpdate(
            payload['url']?.toString() ?? '',
            payload['fileName']?.toString() ?? 'update.zip',
            payload['install'] == true,
          );
          break;
        case 'nativeFetch':
          result = await _nativeFetch(payload);
          break;
        case 'openExternal':
          result = await _openWindowsExternalUrl(
            payload['url']?.toString() ?? '',
          );
          break;
        default:
          throw PlatformException(
            code: 'unknown_action',
            message: 'Unknown action: $action',
          );
      }
      await _resolveWindowsJs(id, result);
    } catch (error) {
      await _rejectWindowsJs(id, error.toString());
    }
  }

  Map<String, dynamic>? _decodeBridgePayload(dynamic rawMessage) {
    try {
      if (rawMessage is Map) {
        return rawMessage.map(
          (key, value) => MapEntry(key.toString(), value),
        );
      }
      if (rawMessage is String && rawMessage.trim().isNotEmpty) {
        final decoded = jsonDecode(rawMessage);
        if (decoded is Map) {
          return decoded.map(
            (key, value) => MapEntry(key.toString(), value),
          );
        }
      }
    } catch (error) {
      debugPrint('Cannot decode Windows bridge payload: $error');
    }
    return null;
  }

  Map<String, String> _windowsDownloadDirs() {
    return {
      'images': _windowsDownloadDir('images'),
      'zips': _windowsDownloadDir('zips'),
    };
  }

  String _windowsDownloadDir(String kind) {
    final profile = Platform.environment['USERPROFILE'];
    final root = (profile == null || profile.isEmpty)
        ? Directory.current.path
        : [
            profile,
            'Downloads',
          ].join(Platform.pathSeparator);
    return [
      root,
      'AI Image Generator',
      kind == 'zips'
          ? 'zips'
          : kind == 'updates'
              ? 'updates'
              : 'images',
    ].join(Platform.pathSeparator);
  }

  Future<String> _ensureWindowsDownloadDir(String kind) async {
    final dir = Directory(_windowsDownloadDir(kind));
    await dir.create(recursive: true);
    return dir.path;
  }

  Future<String> _saveWindowsFile(
    String kind,
    String fileName,
    String encoded,
  ) async {
    final dir = await _ensureWindowsDownloadDir(kind);
    final safeName = _sanitizeWindowsFileName(fileName);
    final file = File([dir, safeName].join(Platform.pathSeparator));
    await file.writeAsBytes(base64Decode(encoded), flush: true);
    return file.path;
  }

  Future<Map<String, Object?>> _downloadWindowsUpdate(
    String url,
    String fileName,
    bool install,
  ) async {
    final dir = Directory(_windowsDownloadDir('updates'));
    final safeName = _sanitizeWindowsFileName(fileName);
    final file = File([dir.path, safeName].join(Platform.pathSeparator));
    await _downloadUrlToFile(url, file);

    var installerStarted = false;
    String? scriptPath;
    if (install && safeName.toLowerCase().endsWith('.zip')) {
      final script = await _writeWindowsUpdateScript(file);
      scriptPath = script.path;
      await Process.start(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script.path,
        ],
        mode: ProcessStartMode.detached,
      );
      installerStarted = true;
      unawaited(Future<void>.delayed(
        const Duration(milliseconds: 700),
        () => exit(0),
      ));
    }

    return {
      'path': file.path,
      'installerStarted': installerStarted,
      'scriptPath': scriptPath,
    };
  }

  Future<File> _writeWindowsUpdateScript(File zipFile) async {
    final updatesDir = zipFile.parent.path;
    final script = File(
      [updatesDir, 'apply-ai-image-generator-update.ps1']
          .join(Platform.pathSeparator),
    );
    final exePath = Platform.resolvedExecutable;
    final installDir = File(exePath).parent.path;
    final lines = <String>[
      r"$ErrorActionPreference = 'Stop'",
      '\$pidToWait = $pid',
      '\$zip = ${_psQuote(zipFile.path)}',
      '\$target = ${_psQuote(installDir)}',
      '\$exe = ${_psQuote(exePath)}',
      r'Wait-Process -Id $pidToWait -ErrorAction SilentlyContinue',
      r'Start-Sleep -Milliseconds 500',
      r"$extract = Join-Path $env:TEMP ('aigen-update-' + [guid]::NewGuid().ToString())",
      r'New-Item -ItemType Directory -Path $extract -Force | Out-Null',
      r'Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force',
      r"Copy-Item -Path (Join-Path $extract '*') -Destination $target -Recurse -Force",
      r'Remove-Item -LiteralPath $extract -Recurse -Force',
      r'Start-Process -FilePath $exe',
    ];
    await script.writeAsString(lines.join('\r\n'), flush: true);
    return script;
  }

  String _sanitizeWindowsFileName(String name) {
    final fallback = 'download-${DateTime.now().millisecondsSinceEpoch}.bin';
    final source = name.trim().isEmpty ? fallback : name.trim();
    final sanitized = source.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    return sanitized.length > 180 ? sanitized.substring(0, 180) : sanitized;
  }

  Future<void> _syncWindowsDownloadDirs() {
    return _controller.executeScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.setDirs(${jsonEncode(_windowsDownloadDirs())});',
    );
  }

  Future<void> _resolveWindowsJs(String id, Object? result) {
    return _controller.executeScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.resolve(${jsonEncode(id)}, ${jsonEncode(result)});',
    );
  }

  Future<void> _rejectWindowsJs(String id, String message) {
    return _controller.executeScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.reject(${jsonEncode(id)}, ${jsonEncode(message)});',
    );
  }

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(_controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _appBackground,
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_errorMessage != null) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Card(
            color: const Color(0xFF1B1724),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _errorTitle ?? '启动失败',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _errorMessage!,
                    style: const TextStyle(color: Color(0xFFD8D0E8)),
                  ),
                  const SizedBox(height: 16),
                  const SelectableText(
                    'WebView2 Runtime: https://developer.microsoft.com/microsoft-edge/webview2/',
                    style: TextStyle(color: Color(0xFF9FB7FF)),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    if (!_isReady || !_controller.value.isInitialized) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF8B7CF6)),
      );
    }

    return windows_webview.Webview(_controller);
  }
}

const _windowsBridgeScript = r'''
(() => {
  if (window.FlutterDownload) return;
  window.FlutterDownload = {
    postMessage(message) {
      if (!window.chrome || !window.chrome.webview) return;
      try {
        const payload = typeof message === "string" ? JSON.parse(message) : message;
        window.chrome.webview.postMessage(payload);
      } catch (error) {
        window.chrome.webview.postMessage({
          id: "",
          action: "bridgeError",
          message: String(error)
        });
      }
    }
  };
})();
''';
