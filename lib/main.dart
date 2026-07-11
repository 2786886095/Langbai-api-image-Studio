import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/services.dart';
import 'package:file_selector/file_selector.dart' as file_selector;
import 'package:socks5_proxy/socks_client.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart' as mobile_webview;
import 'package:webview_flutter_android/webview_flutter_android.dart'
    as android_webview;
import 'package:webview_windows/webview_windows.dart' as windows_webview;

import 'proxy_config.dart';

const _appTitle = 'AI 图片生成器';
const _appBackground = Color(0xFF121417);
const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
);

String _validateSecretKey(Object? value) {
  final key = value?.toString().trim() ?? '';
  if (!RegExp(r'^api_key:[A-Za-z0-9_-]{1,160}$').hasMatch(key)) {
    throw PlatformException(
      code: 'invalid_secret_key',
      message: 'Invalid secure-storage key.',
    );
  }
  return key;
}

Future<Object?> _handleSecretAction(
  String action,
  Map<String, dynamic> payload,
) async {
  final key = _validateSecretKey(payload['key']);
  switch (action) {
    case 'saveSecret':
      await _secureStorage.write(
        key: key,
        value: payload['value']?.toString() ?? '',
      );
      return true;
    case 'loadSecret':
      return _secureStorage.read(key: key);
    case 'deleteSecret':
      await _secureStorage.delete(key: key);
      return true;
    default:
      throw PlatformException(
        code: 'unknown_secret_action',
        message: 'Unknown secure-storage action: $action',
      );
  }
}

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

bool _isDesktopPlatform() =>
    Platform.isWindows || Platform.isMacOS || Platform.isLinux;

final Map<String, HttpClient> _activeNetworkClients = <String, HttpClient>{};
final Set<String> _cancelledNetworkRequests = <String>{};

void _cancelNetworkRequest(String requestId) {
  if (requestId.isEmpty) return;
  final active = _activeNetworkClients.remove(requestId);
  if (active != null) {
    active.close(force: true);
    return;
  }
  // Cancellation can arrive while proxy DNS is still resolving. Keep a short-lived
  // marker for that race, then discard it so repeated timeouts cannot grow this set.
  _cancelledNetworkRequests.add(requestId);
  Timer(const Duration(minutes: 1), () {
    _cancelledNetworkRequests.remove(requestId);
  });
}

Future<InternetAddress> _resolveProxyAddress(String host) async {
  final literal = InternetAddress.tryParse(host);
  if (literal != null) return literal;
  final addresses = await InternetAddress.lookup(host).timeout(
    const Duration(seconds: 30),
  );
  if (addresses.isEmpty) {
    throw const SocketException('Proxy host did not resolve.');
  }
  return addresses.first;
}

Future<HttpClient> _createNetworkClient(
  Map<String, dynamic> payload, {
  String requestId = '',
}) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 30);
  final proxy = resolveDesktopProxyFindProxy(
    desktopPlatform: _isDesktopPlatform(),
    mode: payload['proxyMode']?.toString(),
    proxyUrl: payload['proxyUrl']?.toString(),
  );
  if (!proxy.valid) {
    client.close(force: true);
    throw PlatformException(
      code: 'invalid_proxy',
      message: proxy.error ?? 'Invalid proxy configuration.',
    );
  }
  try {
    if (proxy.kind == DesktopProxyKind.socks5) {
      final address = await _resolveProxyAddress(proxy.host!);
      SocksTCPClient.assignToHttpClient(
        client,
        <ProxySettings>[ProxySettings(address, proxy.port!)],
      );
      client.findProxy = (_) => 'DIRECT';
    } else {
      client.findProxy = (_) => proxy.findProxy;
    }
    if (requestId.isNotEmpty) {
      if (_cancelledNetworkRequests.remove(requestId)) {
        throw const HttpException('Request cancelled.');
      }
      _activeNetworkClients[requestId] = client;
    }
    return client;
  } catch (_) {
    client.close(force: true);
    rethrow;
  }
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
  final requestId = payload['id']?.toString() ?? '';

  final uri = Uri.tryParse(url);
  if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
    throw PlatformException(
      code: 'invalid_url',
      message: 'Only http/https URLs can be requested.',
    );
  }
  if (!const <String>{'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'}
      .contains(method)) {
    throw PlatformException(
      code: 'invalid_method',
      message: 'Unsupported HTTP method: $method',
    );
  }

  final client = await _createNetworkClient(payload, requestId: requestId);
  try {
    final request = await client.openUrl(method, uri);
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
    const maxResponseBytes = 128 * 1024 * 1024;
    final responseBuilder = BytesBuilder(copy: false);
    var responseLength = 0;
    await for (final chunk in response) {
      responseLength += chunk.length;
      if (responseLength > maxResponseBytes) {
        throw const HttpException('Response exceeds the 128 MB safety limit.');
      }
      responseBuilder.add(chunk);
    }
    final responseBytes = responseBuilder.takeBytes();
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
    if (requestId.isNotEmpty) {
      _activeNetworkClients.remove(requestId);
      _cancelledNetworkRequests.remove(requestId);
    }
    client.close(force: true);
  }
}

Future<File> _downloadUrlToFile(
  String url,
  File target, {
  Map<String, dynamic> proxyPayload = const <String, dynamic>{},
  String expectedSha256 = '',
}) async {
  if (!_isExternalHttpUrl(url)) {
    throw PlatformException(
      code: 'invalid_url',
      message: 'Only http/https URLs can be downloaded.',
    );
  }

  final expected = expectedSha256.trim().toLowerCase();
  if (expected.isNotEmpty && !RegExp(r'^[a-f0-9]{64}$').hasMatch(expected)) {
    throw PlatformException(
      code: 'invalid_checksum',
      message: 'Expected SHA-256 checksum is invalid.',
    );
  }

  final client = await _createNetworkClient(proxyPayload);
  final partial = File('${target.path}.part');
  try {
    final request = await client
        .getUrl(Uri.parse(url))
        .timeout(const Duration(seconds: 45));
    final response = await request.close().timeout(const Duration(minutes: 2));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PlatformException(
        code: 'download_failed',
        message: 'HTTP ${response.statusCode}',
      );
    }
    await target.parent.create(recursive: true);
    if (await partial.exists()) await partial.delete();
    final sink = partial.openWrite();
    try {
      await response.timeout(const Duration(minutes: 2)).pipe(sink);
    } finally {
      await sink.close();
    }
    if (expected.isNotEmpty) {
      final actual = (await sha256.bind(partial.openRead()).first).toString();
      if (actual != expected) {
        await partial.delete();
        throw PlatformException(
          code: 'checksum_mismatch',
          message:
              'Downloaded file SHA-256 does not match the release checksum.',
        );
      }
    }
    if (await target.exists()) await target.delete();
    await partial.rename(target.path);
    return target;
  } catch (_) {
    if (await partial.exists()) await partial.delete();
    rethrow;
  } finally {
    client.close(force: true);
  }
}

bool _isExternalHttpUrl(String url) {
  final uri = Uri.tryParse(url.trim());
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
}

bool isTrustedReleaseAssetUrl(String value) {
  final uri = Uri.tryParse(value.trim());
  if (uri == null || uri.scheme != 'https' || uri.host != 'github.com') {
    return false;
  }
  final path = uri.path.toLowerCase();
  return path.startsWith(
    '/2786886095/langbai-api-image-studio/releases/download/',
  );
}

Future<bool> _openSystemExternalUrl(String url) async {
  if (!_isExternalHttpUrl(url)) return false;
  return launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}

bool _isTrustedAppAssetUrl(String url) {
  if (url == 'about:blank') return true;
  final uri = Uri.tryParse(url);
  if (uri == null || uri.scheme != 'file') return false;
  final normalized = uri.path.replaceAll('\\', '/').toLowerCase();
  return normalized.endsWith('/flutter_assets/index.html');
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
  bool _trustedMobileDocument = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _controller = mobile_webview.WebViewController()
      ..setJavaScriptMode(mobile_webview.JavaScriptMode.unrestricted)
      ..setBackgroundColor(_appBackground)
      ..setNavigationDelegate(
        mobile_webview.NavigationDelegate(
          onPageStarted: (url) {
            _trustedMobileDocument = _isTrustedAppAssetUrl(url);
          },
          onPageFinished: (url) {
            _trustedMobileDocument = _isTrustedAppAssetUrl(url);
            if (_trustedMobileDocument) {
              final platform = Platform.isAndroid
                  ? 'android'
                  : Platform.isIOS
                      ? 'ios'
                      : Platform.isMacOS
                          ? 'macos'
                          : 'mobile';
              unawaited(_controller.runJavaScript(
                'window.__AI_GEN_NATIVE_PLATFORM=${jsonEncode(platform)};window.__AI_GEN_SECURE_STORAGE=true;window.dispatchEvent(new Event("aigen-native-ready"));',
              ));
              unawaited(_syncDownloadDirs());
            }
          },
          onNavigationRequest: (request) {
            if (_isTrustedAppAssetUrl(request.url)) {
              return mobile_webview.NavigationDecision.navigate;
            }
            if (_isExternalHttpUrl(request.url)) {
              unawaited(_openSystemExternalUrl(request.url));
            }
            return mobile_webview.NavigationDecision.prevent;
          },
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
    if (!_trustedMobileDocument) return;
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
        case 'saveSecret':
        case 'loadSecret':
        case 'deleteSecret':
          result = await _handleSecretAction(action, payload);
          break;
        case 'cancelNativeFetch':
          _cancelNetworkRequest(payload['targetId']?.toString() ?? '');
          result = true;
          break;
        case 'chooseDir':
          final kind = payload['kind']?.toString() ?? 'images';
          result = await _downloads.invokeMethod<String>('chooseDirectory', {
            'kind': kind,
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
            'folder': payload['folder'] ?? '',
          });
          break;
        case 'downloadUpdate':
          if (!Platform.isMacOS) {
            throw PlatformException(
              code: 'unsupported_update',
              message: 'Mobile updates must be opened in the system browser.',
            );
          }
          result = await _downloadMacUpdate(payload);
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
          result = Platform.isAndroid
              ? await _downloads.invokeMethod<bool>('openExternalUrl', {
                  'url': url,
                })
              : await _openSystemExternalUrl(url);
          break;
        default:
          throw PlatformException(
            code: 'unknown_action',
            message: 'Unknown action: $action',
          );
      }
      if (id.isNotEmpty) await _resolveJs(id, result);
    } catch (error) {
      if (id.isNotEmpty) await _rejectJs(id, error.toString());
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

  String _macDefaultDownloadDir(String kind) {
    final home = Platform.environment['HOME'] ?? Directory.current.path;
    return <String>[
      home,
      'Downloads',
      'AI Image Generator',
      kind == 'zips'
          ? 'zips'
          : kind == 'updates'
              ? 'updates'
              : 'images',
    ].join(Platform.pathSeparator);
  }

  String _sanitizePortableFileName(String name) {
    final fallback = 'download-${DateTime.now().millisecondsSinceEpoch}.bin';
    final source = name.trim().isEmpty ? fallback : name.trim();
    final sanitized = source.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    return sanitized.length > 180 ? sanitized.substring(0, 180) : sanitized;
  }

  Future<Map<String, Object?>> _downloadMacUpdate(
    Map<String, dynamic> payload,
  ) async {
    final url = payload['url']?.toString() ?? '';
    final expectedSha256 = payload['expectedSha256']?.toString() ?? '';
    if (!isTrustedReleaseAssetUrl(url) || expectedSha256.isEmpty) {
      throw PlatformException(
        code: 'untrusted_update',
        message: 'Update URL or SHA-256 checksum is missing or untrusted.',
      );
    }
    final dir = Directory(_macDefaultDownloadDir('updates'));
    final file = File(<String>[
      dir.path,
      _sanitizePortableFileName(
        payload['fileName']?.toString() ?? 'update.zip',
      ),
    ].join(Platform.pathSeparator));
    await _downloadUrlToFile(
      url,
      file,
      proxyPayload: payload,
      expectedSha256: expectedSha256,
    );
    if (payload['install'] == true) {
      await Process.start(
        'open',
        <String>[file.path],
        mode: ProcessStartMode.detached,
      );
    }
    return <String, Object?>{
      'path': file.path,
      'installerStarted': false,
      'opened': payload['install'] == true,
    };
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

/// True when [size] is small enough that handing it to the Windows Webview
/// widget as a layout constraint would risk triggering the upstream
/// off-screen-rendering bug (jnschulze/flutter-webview-windows#262, #207)
/// where a zero-sized Webview leaves a stuck transparent overlay behind.
/// Exposed at top level (rather than inlined in State.didChangeMetrics) so
/// it can be unit-tested without needing a real WebviewController.
bool isDegenerateWindowSize(Size size) => size.width < 2 || size.height < 2;

class _WindowsWebShellState extends State<WindowsWebShell>
    with WidgetsBindingObserver {
  final _controller = windows_webview.WebviewController();
  final _subscriptions = <StreamSubscription<dynamic>>[];

  bool _isReady = false;
  bool _isWindowSizeDegenerate = false;
  bool _trustedWindowsDocument = false;
  String? _windowsIndexUrl;
  String? _errorTitle;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initializeWebView());
  }

  // webview_windows 有个已知上游问题（jnschulze/flutter-webview-windows#262、#207）：
  // 如果承载它的 widget 在挂载状态下收到一次尺寸为 0 的布局约束，插件底层的离屏渲染合成会
  // 留下一个清理不掉的透明覆盖层——即使窗口后来恢复正常大小，这个覆盖层依然会挡住桌面上其他
  // 窗口/图标的点击（多名用户反馈过完全一样的"贴一层透明遮罩，左边图标点不了"症状）。Windows
  // 上最小化窗口时，Flutter 引擎汇报给整个组件树的窗口物理尺寸通常会变成 0，如果这时候
  // Webview 还照常挂在树里，就会踩中这个坑。这里监听窗口尺寸变化，一旦探测到尺寸退化为 0（或
  // 极小），在下一帧真正布局之前就把 Webview 换成占位符——控制器本身不销毁、不重新加载页面，
  // 只是暂时不把 Webview 摆进树里，窗口恢复正常大小后立刻换回来，页面状态都还在。
  @override
  void didChangeMetrics() {
    final views = WidgetsBinding.instance.platformDispatcher.views;
    final size = views.isNotEmpty ? views.first.physicalSize : Size.zero;
    final degenerate = isDegenerateWindowSize(size);
    if (degenerate != _isWindowSizeDegenerate && mounted) {
      setState(() => _isWindowSizeDegenerate = degenerate);
    }
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
      _subscriptions.add(_controller.url.listen((url) {
        unawaited(_handleWindowsUrlChanged(url));
      }));

      await _controller.setBackgroundColor(_appBackground);
      await _controller
          .setPopupWindowPolicy(windows_webview.WebviewPopupWindowPolicy.deny);
      await _controller
          .addScriptToExecuteOnDocumentCreated(_windowsBridgeScript);

      final indexFile = _windowsAssetFile('index.html');
      if (!indexFile.existsSync()) {
        throw PlatformException(
          code: 'missing_asset',
          message: '找不到内置页面资源：${indexFile.path}',
        );
      }

      _windowsIndexUrl = Uri.file(indexFile.path).toString();
      _trustedWindowsDocument = true;
      await _controller.loadUrl(_windowsIndexUrl!);
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

  bool _isTrustedWindowsUrl(String url) {
    final expected = _windowsIndexUrl;
    if (expected == null) return false;
    final actualUri = Uri.tryParse(url);
    final expectedUri = Uri.tryParse(expected);
    if (actualUri == null ||
        expectedUri == null ||
        actualUri.scheme != 'file') {
      return false;
    }
    return actualUri.toFilePath().toLowerCase() ==
        expectedUri.toFilePath().toLowerCase();
  }

  Future<void> _handleWindowsUrlChanged(String url) async {
    final trusted = _isTrustedWindowsUrl(url);
    _trustedWindowsDocument = trusted;
    if (trusted || _windowsIndexUrl == null || url == 'about:blank') return;

    await _controller.stop();
    if (_isExternalHttpUrl(url)) {
      await _openSystemExternalUrl(url);
    }
    await _controller.loadUrl(_windowsIndexUrl!);
  }

  Future<void> _handleWindowsBridgeMessage(dynamic rawMessage) async {
    if (!_trustedWindowsDocument) return;
    final payload = _decodeBridgePayload(rawMessage);
    if (payload == null) return;

    final id = payload['id']?.toString() ?? '';
    final action = payload['action']?.toString() ?? '';
    try {
      Object? result;
      switch (action) {
        case 'saveSecret':
        case 'loadSecret':
        case 'deleteSecret':
          result = await _handleSecretAction(action, payload);
          break;
        case 'cancelNativeFetch':
          _cancelNetworkRequest(payload['targetId']?.toString() ?? '');
          result = true;
          break;
        case 'chooseDir':
          result = await _chooseWindowsDownloadDir(
            payload['kind']?.toString() ?? 'images',
          );
          await _syncWindowsDownloadDirs();
          break;
        case 'getDirs':
          result = _windowsDownloadDirs();
          break;
        case 'getInstallDir':
          result = _windowsInstallDirInfo();
          break;
        case 'chooseInstallDir':
          result = await _chooseWindowsInstallDir();
          break;
        case 'resetInstallDir':
          result = await _resetWindowsInstallDir();
          break;
        case 'saveFile':
          result = await _saveWindowsFile(
            payload['kind']?.toString() ?? 'images',
            payload['fileName']?.toString() ?? 'download.bin',
            payload['base64']?.toString() ?? '',
            payload['folder']?.toString() ?? '',
          );
          break;
        case 'downloadUpdate':
          result = await _downloadWindowsUpdate(
            payload['url']?.toString() ?? '',
            payload['fileName']?.toString() ?? 'update.zip',
            payload['install'] == true,
            payload,
          );
          break;
        case 'nativeFetch':
          result = await _nativeFetch(payload);
          break;
        case 'openExternal':
          result = await _openSystemExternalUrl(
            payload['url']?.toString() ?? '',
          );
          break;
        default:
          throw PlatformException(
            code: 'unknown_action',
            message: 'Unknown action: $action',
          );
      }
      if (id.isNotEmpty) await _resolveWindowsJs(id, result);
    } catch (error) {
      if (id.isNotEmpty) await _rejectWindowsJs(id, error.toString());
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

  File _windowsSettingsFile() {
    final appData = Platform.environment['APPDATA'];
    final root =
        (appData == null || appData.isEmpty) ? Directory.current.path : appData;
    return File([
      root,
      'AI Image Generator',
      'settings.json',
    ].join(Platform.pathSeparator));
  }

  Map<String, String> _windowsSavedDownloadDirs() {
    try {
      final file = _windowsSettingsFile();
      if (!file.existsSync()) return <String, String>{};
      final decoded = jsonDecode(file.readAsStringSync());
      if (decoded is! Map) return <String, String>{};
      final dirs = decoded['downloadDirs'];
      if (dirs is! Map) return <String, String>{};
      return dirs
          .map((key, value) => MapEntry(key.toString(), value.toString()));
    } catch (_) {
      return <String, String>{};
    }
  }

  Future<void> _saveWindowsDownloadDir(String kind, String path) async {
    final file = _windowsSettingsFile();
    await file.parent.create(recursive: true);
    var data = <String, Object?>{};
    try {
      if (await file.exists()) {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map) {
          data = decoded.map((key, value) => MapEntry(key.toString(), value));
        }
      }
    } catch (_) {
      data = <String, Object?>{};
    }
    final dirs = (data['downloadDirs'] is Map)
        ? Map<String, String>.from(
            (data['downloadDirs'] as Map).map(
              (key, value) => MapEntry(key.toString(), value.toString()),
            ),
          )
        : <String, String>{};
    dirs[kind] = path;
    data['downloadDirs'] = dirs;
    await file.writeAsString(jsonEncode(data), flush: true);
  }

  String _windowsDefaultDownloadDir(String kind) {
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

  String _windowsDownloadDir(String kind) {
    return _windowsSavedDownloadDirs()[kind] ??
        _windowsDefaultDownloadDir(kind);
  }

  // 安装目录默认跟随"当前正在运行的这个 exe 所在目录"（见 _downloadWindowsUpdate 的
  // /DIR= 修复），但用户可能想手动指定更新覆盖到另一个位置（比如当前跑的是 C 盘这份，
  // 但想把 F 盘那份旧版本也更新掉）。这里用同一份 settings.json 存一个独立的 installDir
  // 覆盖值，跟 downloadDirs 是平级的两个字段，不要合并到一起——installDir 只有一个值，
  // 不像 downloadDirs 是按 kind 分类的字典。
  String? _windowsInstallDirOverride() {
    try {
      final file = _windowsSettingsFile();
      if (!file.existsSync()) return null;
      final decoded = jsonDecode(file.readAsStringSync());
      if (decoded is! Map) return null;
      final value = decoded['installDir'];
      if (value is! String || value.trim().isEmpty) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  Future<void> _saveWindowsInstallDir(String? path) async {
    final file = _windowsSettingsFile();
    await file.parent.create(recursive: true);
    var data = <String, Object?>{};
    try {
      if (await file.exists()) {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map) {
          data = decoded.map((key, value) => MapEntry(key.toString(), value));
        }
      }
    } catch (_) {
      data = <String, Object?>{};
    }
    if (path == null || path.trim().isEmpty) {
      data.remove('installDir');
    } else {
      data['installDir'] = path;
    }
    await file.writeAsString(jsonEncode(data), flush: true);
  }

  String _defaultWindowsInstallDir() =>
      File(Platform.resolvedExecutable).parent.path;

  String _effectiveWindowsInstallDir() =>
      _windowsInstallDirOverride() ?? _defaultWindowsInstallDir();

  Map<String, Object?> _windowsInstallDirInfo() {
    final override = _windowsInstallDirOverride();
    return {
      'installDir': override ?? _defaultWindowsInstallDir(),
      'isOverride': override != null,
    };
  }

  Future<Map<String, Object?>> _chooseWindowsInstallDir() async {
    final current = _effectiveWindowsInstallDir();
    await Directory(current).create(recursive: true);
    final selected = await file_selector.getDirectoryPath(
      initialDirectory: current,
      confirmButtonText: '选择目录',
    );
    if (selected != null && selected.trim().isNotEmpty) {
      await _saveWindowsInstallDir(selected);
    }
    return _windowsInstallDirInfo();
  }

  Future<Map<String, Object?>> _resetWindowsInstallDir() async {
    await _saveWindowsInstallDir(null);
    return _windowsInstallDirInfo();
  }

  Future<String> _chooseWindowsDownloadDir(String kind) async {
    final current = Directory(_windowsDownloadDir(kind));
    await current.create(recursive: true);
    final selected = await file_selector.getDirectoryPath(
      initialDirectory: current.path,
      confirmButtonText: '选择目录',
    );
    if (selected == null || selected.trim().isEmpty) {
      return current.path;
    }
    final dir = Directory(selected);
    await dir.create(recursive: true);
    await _saveWindowsDownloadDir(kind, dir.path);
    return dir.path;
  }

  Future<String> _ensureWindowsDownloadDir(String kind) async {
    final dir = Directory(_windowsDownloadDir(kind));
    await dir.create(recursive: true);
    return dir.path;
  }

  Future<String> _saveWindowsFile(
    String kind,
    String fileName,
    String encoded, [
    String folder = '',
  ]) async {
    final baseDir = await _ensureWindowsDownloadDir(kind);
    var dir = baseDir;
    final trimmedFolder = folder.trim();
    if (trimmedFolder.isNotEmpty) {
      final safeFolder = _sanitizeWindowsFileName(trimmedFolder);
      if (safeFolder.isNotEmpty && safeFolder != '.' && safeFolder != '..') {
        dir = [baseDir, safeFolder].join(Platform.pathSeparator);
        await Directory(dir).create(recursive: true);
      }
    }
    final safeName = _sanitizeWindowsFileName(fileName);
    final file = File([dir, safeName].join(Platform.pathSeparator));
    await file.writeAsBytes(base64Decode(encoded), flush: true);
    return file.path;
  }

  // 更新安装包是 Inno Setup 生成的 Setup.exe：下载后直接静默运行它即可，
  // 关闭旧进程/覆盖安装文件/刷新开始菜单与桌面快捷方式/重启应用都由安装器自身处理
  // （setup.iss 里 CloseApplications=yes 用 Restart Manager 检测并关闭正在运行的旧实例，
  // /RESTARTAPPLICATIONS 让它装完后自动拉起新版本）。不再需要在这里手写解压/复制/建
  // 快捷方式的 PowerShell 脚本。
  Future<Map<String, Object?>> _downloadWindowsUpdate(
    String url,
    String fileName,
    bool install,
    Map<String, dynamic> payload,
  ) async {
    final expectedSha256 = payload['expectedSha256']?.toString() ?? '';
    if (!isTrustedReleaseAssetUrl(url) || expectedSha256.isEmpty) {
      throw PlatformException(
        code: 'untrusted_update',
        message: 'Update URL or SHA-256 checksum is missing or untrusted.',
      );
    }
    final dir = Directory(_windowsDownloadDir('updates'));
    final safeName = _sanitizeWindowsFileName(fileName);
    if (!safeName.toLowerCase().endsWith('.exe')) {
      throw PlatformException(
        code: 'invalid_update_type',
        message: 'Windows updates must be installer .exe files.',
      );
    }
    final file = File([dir.path, safeName].join(Platform.pathSeparator));
    await _downloadUrlToFile(
      url,
      file,
      proxyPayload: payload,
      expectedSha256: expectedSha256,
    );

    var installerStarted = false;
    if (install && safeName.toLowerCase().endsWith('.exe')) {
      // Inno Setup 自带的"沿用上次安装目录"依赖注册表里的 AppId 记录，一旦这条记录因为
      // 提权状态变化等原因对不上，就会静默退回 setup.iss 里的 DefaultDirName（本机 AppData），
      // 用户实际装在别的盘时更新就会在 C 盘另起一份。这里直接显式传 /DIR，不依赖那条注册表
      // 探测：默认用当前正在运行的 exe 所在目录（_effectiveWindowsInstallDir() 没有手动覆盖
      // 时的兜底值），如果用户在设置里手动选过安装目录（比如想更新覆盖到另一个盘上的旧版本），
      // 就用那个覆盖值。
      final installDir = _effectiveWindowsInstallDir();
      await Process.start(
        file.path,
        [
          '/SILENT',
          '/NORESTART',
          '/CLOSEAPPLICATIONS',
          '/RESTARTAPPLICATIONS',
          '/DIR=$installDir',
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
    };
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
    WidgetsBinding.instance.removeObserver(this);
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
            color: const Color(0xFF1E2329),
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
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
                    style: const TextStyle(color: Color(0xFFD5DCE5)),
                  ),
                  const SizedBox(height: 16),
                  const SelectableText(
                    'WebView2 Runtime: https://developer.microsoft.com/microsoft-edge/webview2/',
                    style: TextStyle(color: Color(0xFFAAB5FF)),
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
        child: CircularProgressIndicator(color: Color(0xFF879CFF)),
      );
    }

    if (_isWindowSizeDegenerate) {
      return const SizedBox.shrink();
    }

    return windows_webview.Webview(_controller);
  }
}

const _windowsBridgeScript = r'''
(() => {
  const path = location.pathname.replace(/\\/g, "/").toLowerCase();
  if (location.protocol !== "file:" || !path.endsWith("/flutter_assets/index.html")) return;
  if (window.FlutterDownload) return;
  window.__AI_GEN_NATIVE_PLATFORM = "windows";
  window.__AI_GEN_SECURE_STORAGE = true;
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
  addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor || !/^https?:/i.test(anchor.href)) return;
    event.preventDefault();
    window.FlutterDownload.postMessage(JSON.stringify({
      id: `external_${Date.now()}`,
      action: "openExternal",
      url: anchor.href
    }));
  }, true);
})();
''';
