import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:webview_flutter/webview_flutter.dart' as mobile_webview;
import 'package:webview_win_floating/webview_win_floating.dart'
    as windows_webview;

const String _geminiStartUrl = 'https://gemini.google.com/app';
const int _maxNativeTransportBytes = 96 * 1024 * 1024;
const MethodChannel _geminiSessionChannel =
    MethodChannel('com.aigen.ai_image_generator/gemini_sessions');
const String _geminiSessionStoragePrefix = 'gemini_web_session_v1:';
const String _geminiEmbeddedSelectorPackVersion = '2026.07.29.1';

typedef GeminiEmbeddedConfigLoader = Future<GeminiEmbeddedBrowserConfig>
    Function(String profileId);
typedef GeminiEmbeddedEventCallback = FutureOr<void> Function(
    Map<String, Object?> event);
typedef GeminiEmbeddedVisibilityCallback = void Function(bool visible);

@immutable
class GeminiEmbeddedBrowserConfig {
  const GeminiEmbeddedBrowserConfig({
    required this.baseUrl,
    required this.apiKey,
    required this.profileId,
  });

  factory GeminiEmbeddedBrowserConfig.fromGateway({
    required Map<String, Object?> gateway,
    required String profileId,
  }) {
    final baseUrl = gateway['baseUrl']?.toString().trim() ?? '';
    final apiKey = gateway['apiKey']?.toString().trim() ?? '';
    final parsed = Uri.tryParse(baseUrl);
    if (parsed == null ||
        parsed.scheme != 'http' ||
        !_isLoopbackHost(parsed.host) ||
        parsed.port < 1 ||
        parsed.port > 65535) {
      throw const FormatException(
        'Gemini gateway must use an http://127.0.0.1:<port> URL.',
      );
    }
    if (apiKey.isEmpty) {
      throw const FormatException('Gemini gateway pairing key is empty.');
    }
    if (!_uuidPattern.hasMatch(profileId)) {
      throw const FormatException('Gemini embedded profile ID is invalid.');
    }
    return GeminiEmbeddedBrowserConfig(
      baseUrl: baseUrl.replaceAll(RegExp(r'/+$'), ''),
      apiKey: apiKey,
      profileId: profileId.toLowerCase(),
    );
  }

  final String baseUrl;
  final String apiKey;
  final String profileId;

  Uri get gatewayUri => Uri.parse(baseUrl);

  Map<String, Object?> toSafeJavaScriptConfig(String platform) {
    return <String, Object?>{
      'baseUrl': baseUrl,
      'bridgePort': gatewayUri.port,
      // The page only receives a placeholder. Dart replaces Authorization
      // before forwarding to the loopback gateway, so the real pairing key
      // never enters the Gemini JavaScript world.
      'pairingKey':
          '0000000000000000000000000000000000000000000000000000000000000000',
      'enabled': true,
      'embedded': true,
      'nativeTransport': 'postMessage',
      'nativeRequestTimeoutMs': 60000,
      'profileId': profileId,
      'accountUuid': profileId,
      'platform': platform,
    };
  }
}

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);

String createGeminiEmbeddedProfileId() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final value =
      bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${value.substring(0, 8)}-'
      '${value.substring(8, 12)}-'
      '${value.substring(12, 16)}-'
      '${value.substring(16, 20)}-'
      '${value.substring(20)}';
}

class GeminiMobileSessionVault {
  GeminiMobileSessionVault({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  }) : _storage = storage;

  final FlutterSecureStorage _storage;

  String _key(String profileId) =>
      '$_geminiSessionStoragePrefix${profileId.toLowerCase()}';

  Future<void> capture(String profileId) async {
    if (!_uuidPattern.hasMatch(profileId) || Platform.isWindows) return;
    final snapshot =
        await _geminiSessionChannel.invokeMethod<Object?>('capture');
    if (snapshot == null) return;
    await _storage.write(key: _key(profileId), value: jsonEncode(snapshot));
  }

  Future<void> restore(String profileId) async {
    if (!_uuidPattern.hasMatch(profileId) || Platform.isWindows) return;
    final raw = await _storage.read(key: _key(profileId));
    final snapshot = raw == null || raw.isEmpty ? null : jsonDecode(raw);
    await _geminiSessionChannel.invokeMethod<void>(
      'restore',
      <String, Object?>{'snapshot': snapshot},
    );
  }

  Future<void> remove(String profileId) async {
    if (!_uuidPattern.hasMatch(profileId)) return;
    await _storage.delete(key: _key(profileId));
  }
}

class GeminiEmbeddedBrowserRequestController extends ChangeNotifier {
  bool get visible => _visible;
  int get requestRevision => _requestRevision;
  String get profileId => _profileId;

  bool _visible = false;
  int _requestRevision = 0;
  String _profileId = '';

  void show(String profileId) {
    if (!_uuidPattern.hasMatch(profileId)) {
      throw const FormatException('Gemini embedded profile ID is invalid.');
    }
    _profileId = profileId.toLowerCase();
    _visible = true;
    _requestRevision++;
    notifyListeners();
  }

  void activate(String profileId) {
    if (!_uuidPattern.hasMatch(profileId)) return;
    final normalized = profileId.toLowerCase();
    if (_profileId == normalized && !_visible) return;
    _profileId = normalized;
    _visible = false;
    _requestRevision++;
    notifyListeners();
  }

  void collapse() {
    if (!_visible) return;
    _visible = false;
    notifyListeners();
  }
}

bool isAllowedGeminiTopLevelNavigation(String value) {
  if (value == 'about:blank') return true;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.scheme != 'https') return false;
  final host = uri.host.toLowerCase();
  return _allowedNavigationHosts.any(
    (allowed) => host == allowed || host.endsWith('.$allowed'),
  );
}

const Set<String> _allowedNavigationHosts = <String>{
  'gemini.google.com',
  'accounts.google.com',
  'myaccount.google.com',
  'accounts.youtube.com',
  'g.co',
};

const Set<String> _allowedGeminiImageHosts = <String>{
  'googleusercontent.com',
  'ggpht.com',
  'gstatic.com',
  'googleapis.com',
  'google.com',
};

bool _isAllowedGeminiImageUrl(Uri uri) {
  if (uri.scheme != 'https') return false;
  final host = uri.host.toLowerCase();
  return _allowedGeminiImageHosts.any(
    (allowed) => host == allowed || host.endsWith('.$allowed'),
  );
}

class _GeminiNativeTransport {
  _GeminiNativeTransport(this.config);

  final GeminiEmbeddedBrowserConfig config;

  Future<Map<String, Object?>> send(Map<String, dynamic> payload) async {
    final rawUrl = payload['url']?.toString() ?? '';
    final uri = Uri.tryParse(rawUrl);
    if (uri == null || !_isAllowedGatewayRequest(uri)) {
      throw PlatformException(
        code: 'gemini_native_transport_forbidden',
        message: 'Native Gemini transport only permits the configured gateway.',
      );
    }

    final method = (payload['method']?.toString() ?? 'GET').toUpperCase();
    if (!const <String>{'GET', 'POST', 'PUT', 'PATCH', 'DELETE'}
        .contains(method)) {
      throw PlatformException(
        code: 'gemini_native_transport_method',
        message: 'Unsupported native transport method: $method',
      );
    }

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15)
      ..idleTimeout = const Duration(seconds: 30)
      ..findProxy = (_) => 'DIRECT';
    try {
      final request = await client
          .openUrl(method, uri)
          .timeout(const Duration(seconds: 20));
      final headers = payload['headers'];
      if (headers is Map) {
        for (final entry in headers.entries) {
          final name = entry.key.toString().trim();
          if (name.isEmpty ||
              _blockedForwardHeaders.contains(name.toLowerCase())) {
            continue;
          }
          request.headers.set(name, entry.value.toString());
        }
      }
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${config.apiKey}',
      );

      final encodedBody = payload['bodyBase64']?.toString() ?? '';
      final body = payload['body'];
      if (encodedBody.isNotEmpty || body != null) {
        final bytes = encodedBody.isNotEmpty
            ? base64Decode(encodedBody)
            : utf8.encode(body is String ? body : jsonEncode(body));
        if (bytes.length > _maxNativeTransportBytes) {
          throw PlatformException(
            code: 'gemini_native_transport_body_too_large',
            message: 'Gemini native transport request exceeds 96 MiB.',
          );
        }
        final contentType = payload['contentType']?.toString().trim() ?? '';
        if (contentType.isNotEmpty) {
          request.headers.set(HttpHeaders.contentTypeHeader, contentType);
        }
        request.add(bytes);
      }

      final response =
          await request.close().timeout(const Duration(seconds: 70));
      final bytes = <int>[];
      await for (final chunk in response.timeout(const Duration(seconds: 70))) {
        bytes.addAll(chunk);
        if (bytes.length > _maxNativeTransportBytes) {
          throw PlatformException(
            code: 'gemini_native_transport_response_too_large',
            message: 'Gemini native transport response exceeds 96 MiB.',
          );
        }
      }

      final responseHeaders = <String, String>{};
      response.headers.forEach((name, values) {
        responseHeaders[name] = values.join(', ');
      });
      final contentType =
          response.headers.contentType?.mimeType.toLowerCase() ?? '';
      final textual = contentType.startsWith('text/') ||
          contentType.contains('json') ||
          contentType.contains('javascript') ||
          contentType.contains('xml') ||
          contentType.isEmpty;
      return <String, Object?>{
        'status': response.statusCode,
        'statusText': response.reasonPhrase,
        'headers': responseHeaders,
        if (textual) 'body': utf8.decode(bytes, allowMalformed: true),
        if (!textual) 'bodyBase64': base64Encode(bytes),
      };
    } finally {
      client.close(force: true);
    }
  }

  Future<Map<String, Object?>> registerLoggedInProfile({
    required String platform,
    required bool temporaryChatAvailable,
    String maskedEmail = '',
  }) async {
    final response = await send(<String, dynamic>{
      'url': '${config.baseUrl}/companion/identity',
      'method': 'POST',
      'headers': <String, String>{'Content-Type': 'application/json'},
      'body': <String, Object?>{
        'browser_profile_id': config.profileId,
        'account_uuid': config.profileId,
        'display_name': 'Gemini 网页账号',
        'masked_email': maskedEmail,
        'status': 'ready',
        'temporary_chat_available': temporaryChatAvailable,
        'fullsize_download_available': true,
        'effective_concurrency': 1,
        'platform': 'embedded:$platform',
        'selector_pack_version': _geminiEmbeddedSelectorPackVersion,
      },
    });
    final status = int.tryParse(response['status']?.toString() ?? '') ?? 0;
    final body = response['body']?.toString() ?? '';
    if (status < 200 || status >= 300) {
      throw HttpException(
        'Gemini account registration failed (HTTP $status): $body',
      );
    }
    final decoded = body.isEmpty ? <String, dynamic>{} : jsonDecode(body);
    if (decoded is! Map) {
      throw const FormatException(
        'Gemini account registration returned invalid JSON.',
      );
    }
    return decoded.map(
      (key, value) => MapEntry(key.toString(), value),
    );
  }

  bool _isAllowedGatewayRequest(Uri uri) {
    final expected = config.gatewayUri;
    if (uri.scheme != 'http' ||
        !_isLoopbackHost(uri.host) ||
        uri.port != expected.port) {
      return false;
    }
    final path = uri.path;
    return path == '/healthz' || path == '/v1' || path.startsWith('/v1/');
  }
}

const Set<String> _blockedForwardHeaders = <String>{
  'authorization',
  'connection',
  'content-length',
  'host',
  'origin',
  'proxy-authorization',
  'transfer-encoding',
};

bool _isLoopbackHost(String host) {
  final normalized = host.toLowerCase();
  return normalized == '127.0.0.1' ||
      normalized == 'localhost' ||
      normalized == '::1' ||
      normalized == '[::1]';
}

Future<String> _loadInjectedWorker(
  GeminiEmbeddedBrowserConfig config,
  String platform,
) async {
  final selectorSource = await rootBundle.loadString(
    'gemini-selector-pack.js',
  );
  final workerSource = await rootBundle.loadString(
    'gemini-embedded-worker.js',
  );
  final safeConfig = jsonEncode(config.toSafeJavaScriptConfig(platform));
  return '''
(() => {
  const config = Object.freeze($safeConfig);
  Object.defineProperty(globalThis, "__LANGBAI_GEMINI_EMBEDDED_CONFIG", {
    configurable: true,
    value: config,
  });
  const sendNative = message => {
    const value = JSON.stringify(message);
    if (globalThis.LangbaiGeminiHost?.postMessage) {
      globalThis.LangbaiGeminiHost.postMessage(value);
      return;
    }
    if (globalThis.chrome?.webview?.postMessage) {
      globalThis.chrome.webview.postMessage(message);
      return;
    }
    if (globalThis.webkit?.messageHandlers?.langbaiGemini?.postMessage) {
      globalThis.webkit.messageHandlers.langbaiGemini.postMessage(message);
      return;
    }
    throw new Error("gemini_native_message_channel_unavailable");
  };
  globalThis.__LANGBAI_GEMINI_NATIVE_REPORT = message => sendNative(message);
  addEventListener("message", event => {
    const message = event?.data;
    if (
      message?.source === "langbai-gemini-executor" &&
      (
        message?.type === "native-request" ||
        message?.type === "trusted-click-request" ||
        message?.type === "image-download-request"
      )
    ) {
      try { sendNative(message); }
      catch (error) {
        postMessage({
          source: "langbai-gemini-native",
          type: "native-response",
          requestId: message.requestId,
          error: {
            code: "gemini_native_channel_unavailable",
            message: String(error?.message || error),
          },
        }, "*");
      }
    }
  });
  const reportPageState = () => {
    const host = location.hostname.toLowerCase();
    const onGemini = host === "gemini.google.com" ||
      host.endsWith(".gemini.google.com");
    const composer = onGemini && document.querySelector(
      'div[contenteditable="true"][role="textbox"],textarea[aria-label],textarea'
    );
    const interactive = onGemini
      ? [...document.querySelectorAll('button,[role="button"],[aria-label],[title]')]
      : [];
    const textOf = element => [
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
    const temporaryChatAvailable = interactive.some(element =>
      /temporary chat|临时对话|臨時對話|一時的なチャット|임시 채팅/i.test(textOf(element))
    );
    sendNative({
      source: "langbai-gemini-executor",
      type: "page_state",
      status: composer ? "page_ready" :
        (host === "accounts.google.com" || host.endsWith(".accounts.google.com"))
          ? "login_required"
          : "loading",
      url: location.href,
      browser_profile_id: config.profileId,
      account_uuid: config.accountUuid,
      temporary_chat_available: temporaryChatAvailable,
      fullsize_download_available: true,
    });
  };
  if (!globalThis.__LANGBAI_GEMINI_PAGE_PROBE_STARTED) {
    globalThis.__LANGBAI_GEMINI_PAGE_PROBE_STARTED = true;
    addEventListener("DOMContentLoaded", reportPageState);
    addEventListener("pageshow", reportPageState);
    setTimeout(reportPageState, 300);
    setTimeout(reportPageState, 1500);
    new MutationObserver(reportPageState).observe(
      document.documentElement,
      { childList: true, subtree: true }
    );
  } else {
    reportPageState();
  }
  if (
    location.hostname === "gemini.google.com" ||
    location.hostname.endsWith(".gemini.google.com")
  ) {
$selectorSource
$workerSource
  }
})();
''';
}

String _windowsGeminiProfilePath(String profileId) {
  final localAppData = Platform.environment['LOCALAPPDATA'];
  if (localAppData == null || localAppData.trim().isEmpty) {
    throw const FileSystemException('LOCALAPPDATA is unavailable.');
  }
  return <String>[
    localAppData,
    'AI Image Generator',
    'gemini_embedded_webview',
    profileId.toLowerCase(),
  ].join(Platform.pathSeparator);
}

Future<void> deleteGeminiEmbeddedProfileData(String profileId) async {
  if (!_uuidPattern.hasMatch(profileId)) return;
  if (Platform.isWindows) {
    final directory = Directory(_windowsGeminiProfilePath(profileId));
    if (await directory.exists()) {
      await directory.delete(recursive: true);
    }
    return;
  }
  await GeminiMobileSessionVault().remove(profileId);
}

Map<String, dynamic>? _decodeNativeMessage(Object? raw) {
  try {
    if (raw is Map) {
      return raw.map((key, value) => MapEntry(key.toString(), value));
    }
    if (raw is String && raw.trim().isNotEmpty) {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        return decoded.map((key, value) => MapEntry(key.toString(), value));
      }
    }
  } catch (error) {
    debugPrint('Gemini embedded message decode failed: $error');
  }
  return null;
}

bool _isReadyMessage(Map<String, dynamic> message) {
  return message['source'] == 'langbai-gemini-executor' &&
      message['type'] == 'login_state' &&
      (message['login_ready'] == true || message['status'] == 'ready');
}

bool _isPageReadyMessage(Map<String, dynamic> message) {
  return message['source'] == 'langbai-gemini-executor' &&
      message['type'] == 'page_state' &&
      message['status'] == 'page_ready';
}

Future<Map<String, Object?>> _registerPageReadyMessage({
  required _GeminiNativeTransport transport,
  required Map<String, dynamic> message,
  required String platform,
}) async {
  final snapshot = await transport.registerLoggedInProfile(
    platform: platform,
    temporaryChatAvailable: message['temporary_chat_available'] == true,
    maskedEmail: message['masked_email']?.toString() ?? '',
  );
  return <String, Object?>{
    'source': 'langbai-gemini-executor',
    'type': 'login_state',
    'status': 'ready',
    'login_ready': true,
    'account_id': snapshot['local_account_id']?.toString() ?? '',
    'account_uuid':
        snapshot['account_uuid']?.toString() ?? transport.config.profileId,
    'masked_email': message['masked_email']?.toString() ?? '',
    'temporary_chat_available': message['temporary_chat_available'] == true,
  };
}

String _statusText(Map<String, dynamic> message) {
  final type = message['type']?.toString() ?? '';
  final status = message['status']?.toString() ?? '';
  final code = message['code']?.toString() ?? '';
  if (type == 'transport_error') {
    return '本机网关连接失败${code.isEmpty ? '' : '（$code）'}';
  }
  if (status == 'ready' || message['login_ready'] == true) {
    return '登录已就绪，后台连接保持中';
  }
  if (status == 'page_ready') return '页面已就绪，正在连接本机网关';
  if (status == 'login_required') return '请在此页面完成 Gemini 登录';
  if (status == 'failed') {
    return message['message']?.toString() ?? 'Gemini 页面运行失败';
  }
  return '正在加载 Gemini 登录页';
}

class _GeminiBrowserToolbar extends StatelessWidget {
  const _GeminiBrowserToolbar({
    required this.status,
    required this.onBack,
    required this.onReload,
    required this.onClose,
  });

  final String status;
  final VoidCallback onBack;
  final VoidCallback onReload;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF191D24),
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: 52,
          child: Row(
            children: [
              IconButton(
                tooltip: '返回；无上一页时关闭',
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back, color: Colors.white),
              ),
              const SizedBox(width: 4),
              const Text(
                'Gemini 登录',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  status,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFFBCC5D2)),
                ),
              ),
              IconButton(
                tooltip: '重新加载',
                onPressed: onReload,
                icon: const Icon(Icons.refresh, color: Colors.white),
              ),
              IconButton(
                tooltip: '收起',
                onPressed: onClose,
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GeminiMobileEmbeddedBrowser extends StatefulWidget {
  const GeminiMobileEmbeddedBrowser({
    super.key,
    required this.requestController,
    required this.loadConfig,
    required this.onEvent,
  });

  final GeminiEmbeddedBrowserRequestController requestController;
  final GeminiEmbeddedConfigLoader loadConfig;
  final GeminiEmbeddedEventCallback onEvent;

  @override
  State<GeminiMobileEmbeddedBrowser> createState() =>
      _GeminiMobileEmbeddedBrowserState();
}

class _GeminiMobileEmbeddedBrowserState
    extends State<GeminiMobileEmbeddedBrowser> {
  mobile_webview.WebViewController? _controller;
  _GeminiNativeTransport? _transport;
  String _activeProfileId = '';
  final GeminiMobileSessionVault _sessionVault = GeminiMobileSessionVault();
  String _status = '正在加载 Gemini 登录页';
  String _platform = 'mobile';
  bool _initializing = false;
  bool _pageReadyRegistrationInFlight = false;
  bool _pageReadyRegistered = false;
  int _handledRevision = -1;

  @override
  void initState() {
    super.initState();
    widget.requestController.addListener(_onRequestChanged);
    _onRequestChanged();
  }

  @override
  void didUpdateWidget(covariant GeminiMobileEmbeddedBrowser oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.requestController != widget.requestController) {
      oldWidget.requestController.removeListener(_onRequestChanged);
      widget.requestController.addListener(_onRequestChanged);
      _onRequestChanged();
    }
  }

  @override
  void dispose() {
    widget.requestController.removeListener(_onRequestChanged);
    super.dispose();
  }

  void _onRequestChanged() {
    if (_handledRevision != widget.requestController.requestRevision &&
        widget.requestController.profileId.isNotEmpty) {
      _handledRevision = widget.requestController.requestRevision;
      unawaited(_ensureInitialized());
    }
    if (mounted) setState(() {});
  }

  Future<void> _ensureInitialized() async {
    final requestedProfile = widget.requestController.profileId;
    if (_initializing ||
        (_controller != null && _activeProfileId == requestedProfile)) {
      return;
    }
    _initializing = true;
    try {
      final config =
          await widget.loadConfig(widget.requestController.profileId);
      if (_controller != null && _activeProfileId != config.profileId) {
        if (_activeProfileId.isNotEmpty) {
          await _sessionVault.capture(_activeProfileId);
        }
        _controller = null;
        _transport = null;
        _pageReadyRegistered = false;
      }
      await _sessionVault.restore(config.profileId);
      final platform = Platform.isAndroid
          ? 'android'
          : Platform.isIOS
              ? 'ios'
              : Platform.isMacOS
                  ? 'macos'
                  : 'mobile';
      _platform = platform;
      final injectedWorker = await _loadInjectedWorker(config, platform);
      late final mobile_webview.WebViewController controller;
      controller = mobile_webview.WebViewController();
      await controller.setJavaScriptMode(
        mobile_webview.JavaScriptMode.unrestricted,
      );
      await controller.setBackgroundColor(const Color(0xFFFFFFFF));
      await controller.addJavaScriptChannel(
        'LangbaiGeminiHost',
        onMessageReceived: (message) {
          unawaited(_handleMessage(message.message));
        },
      );
      await controller.setNavigationDelegate(
        mobile_webview.NavigationDelegate(
          onNavigationRequest: (request) {
            if (isAllowedGeminiTopLevelNavigation(request.url)) {
              return mobile_webview.NavigationDecision.navigate;
            }
            unawaited(_emit(<String, Object?>{
              'source': 'langbai-gemini-host',
              'type': 'navigation_blocked',
              'url': request.url,
            }));
            return mobile_webview.NavigationDecision.prevent;
          },
          onPageFinished: (_) {
            unawaited(controller.runJavaScript(injectedWorker).catchError(
              (Object error) {
                return _emit(<String, Object?>{
                  'source': 'langbai-gemini-host',
                  'type': 'injection_error',
                  'status': 'failed',
                  'message': error.toString(),
                });
              },
            ));
          },
          onWebResourceError: (error) {
            unawaited(_emit(<String, Object?>{
              'source': 'langbai-gemini-host',
              'type': 'navigation_error',
              'status': 'failed',
              'message': error.description,
            }));
          },
        ),
      );
      _transport = _GeminiNativeTransport(config);
      _controller = controller;
      _activeProfileId = config.profileId;
      await controller.loadRequest(Uri.parse(_geminiStartUrl));
      if (mounted) setState(() {});
    } catch (error) {
      await _emit(<String, Object?>{
        'source': 'langbai-gemini-host',
        'type': 'startup_error',
        'status': 'failed',
        'message': error.toString(),
      });
    } finally {
      _initializing = false;
    }
  }

  Future<void> _handleMessage(Object? raw) async {
    final message = _decodeNativeMessage(raw);
    if (message == null) return;
    if (message['source'] != 'langbai-gemini-executor') return;
    if (message['type'] == 'native-request') {
      await _handleNativeRequest(message);
      return;
    }
    if (_isPageReadyMessage(message)) {
      await _completePageReady(message);
      return;
    }
    await _emit(message.cast<String, Object?>());
    if (_isReadyMessage(message)) {
      if (_activeProfileId.isNotEmpty) {
        await _sessionVault.capture(_activeProfileId);
      }
      widget.requestController.collapse();
    }
  }

  Future<void> _completePageReady(Map<String, dynamic> message) async {
    final transport = _transport;
    if (transport == null ||
        _pageReadyRegistered ||
        _pageReadyRegistrationInFlight) {
      return;
    }
    _pageReadyRegistrationInFlight = true;
    try {
      final event = await _registerPageReadyMessage(
        transport: transport,
        message: message,
        platform: _platform,
      );
      _pageReadyRegistered = true;
      await _emit(event);
      if (_activeProfileId.isNotEmpty) {
        await _sessionVault.capture(_activeProfileId);
      }
      widget.requestController.collapse();
    } catch (error) {
      await _emit(<String, Object?>{
        'source': 'langbai-gemini-host',
        'type': 'account_registration_error',
        'status': 'failed',
        'message': error.toString(),
      });
    } finally {
      _pageReadyRegistrationInFlight = false;
    }
  }

  Future<void> _handleNativeRequest(Map<String, dynamic> message) async {
    final requestId = message['requestId']?.toString() ?? '';
    if (requestId.isEmpty || _controller == null || _transport == null) return;
    Map<String, Object?> response;
    try {
      final payload = message['payload'];
      if (payload is! Map) {
        throw const FormatException('Native request payload is invalid.');
      }
      final result = await _transport!.send(
        payload.map((key, value) => MapEntry(key.toString(), value)),
      );
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'response': result,
      };
    } catch (error) {
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'error': <String, Object?>{
          'code': error is PlatformException
              ? error.code
              : 'gemini_native_transport_failed',
          'message': error.toString(),
        },
      };
    }
    await _controller!.runJavaScript(
      'window.postMessage(${jsonEncode(response)}, "*");',
    );
  }

  Future<void> _emit(Map<String, Object?> event) async {
    if (mounted) setState(() => _status = _statusText(event));
    await widget.onEvent(event);
  }

  Future<void> _goBackOrClose() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
    } else {
      widget.requestController.collapse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = widget.requestController.visible;
    final controller = _controller;
    return Offstage(
      offstage: !visible,
      child: IgnorePointer(
        ignoring: !visible,
        child: ColoredBox(
          color: Colors.white,
          child: Column(
            children: [
              _GeminiBrowserToolbar(
                status: _status,
                onBack: () => unawaited(_goBackOrClose()),
                onReload: () {
                  if (controller != null) unawaited(controller.reload());
                },
                onClose: widget.requestController.collapse,
              ),
              Expanded(
                child: controller == null
                    ? const Center(child: CircularProgressIndicator())
                    : mobile_webview.WebViewWidget(controller: controller),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GeminiWindowsEmbeddedBrowser extends StatefulWidget {
  const GeminiWindowsEmbeddedBrowser({
    super.key,
    required this.requestController,
    required this.loadConfig,
    required this.onEvent,
    required this.onVisibilityChanged,
    required this.windowSuppressed,
  });

  final GeminiEmbeddedBrowserRequestController requestController;
  final GeminiEmbeddedConfigLoader loadConfig;
  final GeminiEmbeddedEventCallback onEvent;
  final GeminiEmbeddedVisibilityCallback onVisibilityChanged;
  final bool windowSuppressed;

  @override
  State<GeminiWindowsEmbeddedBrowser> createState() =>
      _GeminiWindowsEmbeddedBrowserState();
}

class _GeminiWindowsEmbeddedBrowserState
    extends State<GeminiWindowsEmbeddedBrowser> {
  windows_webview.WinWebViewController? _controller;
  _GeminiNativeTransport? _transport;
  String _activeProfileId = '';
  String _status = '正在加载 Gemini 登录页';
  bool _initializing = false;
  bool _pageReadyRegistrationInFlight = false;
  bool _pageReadyRegistered = false;
  int _handledRevision = -1;
  String _lastStatusSignature = '';

  @override
  void initState() {
    super.initState();
    widget.requestController.addListener(_onRequestChanged);
    _onRequestChanged();
  }

  @override
  void didUpdateWidget(covariant GeminiWindowsEmbeddedBrowser oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.requestController != widget.requestController) {
      oldWidget.requestController.removeListener(_onRequestChanged);
      widget.requestController.addListener(_onRequestChanged);
    }
    if (oldWidget.windowSuppressed != widget.windowSuppressed ||
        oldWidget.requestController.visible !=
            widget.requestController.visible) {
      unawaited(_syncVisibility());
    }
  }

  @override
  void dispose() {
    widget.requestController.removeListener(_onRequestChanged);
    final controller = _controller;
    if (controller != null) unawaited(controller.dispose());
    super.dispose();
  }

  void _onRequestChanged() {
    widget.onVisibilityChanged(widget.requestController.visible);
    if (_handledRevision != widget.requestController.requestRevision &&
        widget.requestController.profileId.isNotEmpty) {
      _handledRevision = widget.requestController.requestRevision;
      unawaited(_ensureInitialized());
    }
    unawaited(_syncVisibility());
    if (mounted) setState(() {});
  }

  Future<void> _ensureInitialized() async {
    final requestedProfile = widget.requestController.profileId;
    if (_initializing ||
        (_controller != null && _activeProfileId == requestedProfile)) {
      return;
    }
    _initializing = true;
    windows_webview.WinWebViewController? controller;
    try {
      final config =
          await widget.loadConfig(widget.requestController.profileId);
      if (_controller != null && _activeProfileId != config.profileId) {
        final stale = _controller;
        _controller = null;
        _transport = null;
        _pageReadyRegistered = false;
        if (stale != null) await stale.dispose();
      }
      final injectedWorker = await _loadInjectedWorker(config, 'windows');
      controller = windows_webview.WinWebViewController(
        params: windows_webview.WindowsWebViewControllerCreationParams(
          userDataFolder: _windowsGeminiProfilePath(config.profileId),
          suspendDuringDeactive: false,
          // The app's main WebView uses the full-window native host. The
          // Gemini login surface must instead respect its Flutter widget
          // bounds so the native page cannot cover the close toolbar.
          useTopLevelWindowHost: false,
        ),
      );
      await controller.setJavaScriptMode(
        mobile_webview.JavaScriptMode.unrestricted,
      );
      await controller.setBackgroundColor(const Color(0xFFFFFFFF));
      controller.onWebMessageReceived = (message) {
        unawaited(_handleMessage(message));
      };
      await controller.addScriptToExecuteOnDocumentCreated(injectedWorker);
      await controller.setNavigationDelegate(
        windows_webview.WinNavigationDelegate(
          onNavigationRequest: (request) async {
            if (isAllowedGeminiTopLevelNavigation(request.url)) {
              return mobile_webview.NavigationDecision.navigate;
            }
            await _emit(<String, Object?>{
              'source': 'langbai-gemini-host',
              'type': 'navigation_blocked',
              'url': request.url,
            });
            return mobile_webview.NavigationDecision.prevent;
          },
          onPageFinished: (_) {
            // WebView2 normally installs the document-created script. Running
            // the guarded worker once more after redirects makes login
            // detection resilient when Google replaces the document during
            // the OAuth flow.
            unawaited(controller!.runJavaScript(injectedWorker).catchError(
              (Object error) {
                return _emit(<String, Object?>{
                  'source': 'langbai-gemini-host',
                  'type': 'injection_error',
                  'status': 'failed',
                  'message': error.toString(),
                });
              },
            ));
          },
          onWebResourceError: (error) {
            unawaited(_emit(<String, Object?>{
              'source': 'langbai-gemini-host',
              'type': 'navigation_error',
              'status': 'failed',
              'message': error.description,
            }));
          },
        ),
      );
      _transport = _GeminiNativeTransport(config);
      _controller = controller;
      _activeProfileId = config.profileId;
      await controller.loadRequest(Uri.parse(_geminiStartUrl));
      await _syncVisibility();
      if (mounted) setState(() {});
    } catch (error) {
      if (controller != null && controller != _controller) {
        await controller.dispose();
      }
      await _emit(<String, Object?>{
        'source': 'langbai-gemini-host',
        'type': 'startup_error',
        'status': 'failed',
        'message': error.toString(),
      });
    } finally {
      _initializing = false;
    }
  }

  Future<void> _syncVisibility() async {
    final controller = _controller;
    if (controller == null) return;
    final loginVisible =
        widget.requestController.visible && !widget.windowSuppressed;
    try {
      // The executor must retain a real, non-zero WebView2 viewport while the
      // login surface is collapsed. Gemini ignores critical controls when the
      // controller is hidden or reduced to 0x0. build() moves the live native
      // view off-screen instead of deactivating it.
      await controller.setVisibility(true);
      if (loginVisible) await controller.requestFocus();
    } catch (error) {
      debugPrint('Cannot update Gemini WebView visibility: $error');
    }
  }

  Future<void> _handleMessage(Object? raw) async {
    final message = _decodeNativeMessage(raw);
    if (message == null || message['source'] != 'langbai-gemini-executor') {
      return;
    }
    if (message['type'] == 'trusted-click-request') {
      await _handleTrustedClickRequest(message);
      return;
    }
    if (message['type'] == 'image-download-request') {
      await _handleImageDownloadRequest(message);
      return;
    }
    if (message['type'] == 'native-request') {
      await _handleNativeRequest(message);
      return;
    }
    if (_isPageReadyMessage(message)) {
      await _completePageReady(message);
      return;
    }
    final signature = jsonEncode(<Object?>[
      message['type'],
      message['status'],
      message['code'],
      message['account_id'],
    ]);
    if (signature == _lastStatusSignature) return;
    _lastStatusSignature = signature;
    await _emit(message.cast<String, Object?>());
    if (_isReadyMessage(message)) widget.requestController.collapse();
  }

  Future<void> _completePageReady(Map<String, dynamic> message) async {
    final transport = _transport;
    if (transport == null ||
        _pageReadyRegistered ||
        _pageReadyRegistrationInFlight) {
      return;
    }
    _pageReadyRegistrationInFlight = true;
    try {
      final event = await _registerPageReadyMessage(
        transport: transport,
        message: message,
        platform: 'windows',
      );
      _pageReadyRegistered = true;
      await _emit(event);
      widget.requestController.collapse();
    } catch (error) {
      await _emit(<String, Object?>{
        'source': 'langbai-gemini-host',
        'type': 'account_registration_error',
        'status': 'failed',
        'message': error.toString(),
      });
    } finally {
      _pageReadyRegistrationInFlight = false;
    }
  }

  Future<void> _handleNativeRequest(Map<String, dynamic> message) async {
    final requestId = message['requestId']?.toString() ?? '';
    if (requestId.isEmpty || _controller == null || _transport == null) return;
    Map<String, Object?> response;
    try {
      final payload = message['payload'];
      if (payload is! Map) {
        throw const FormatException('Native request payload is invalid.');
      }
      final result = await _transport!.send(
        payload.map((key, value) => MapEntry(key.toString(), value)),
      );
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'response': result,
      };
    } catch (error) {
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'error': <String, Object?>{
          'code': error is PlatformException
              ? error.code
              : 'gemini_native_transport_failed',
          'message': error.toString(),
        },
      };
    }
    await _controller!.runJavaScript(
      'window.postMessage(${jsonEncode(response)}, "*");',
    );
  }

  Future<void> _handleTrustedClickRequest(
    Map<String, dynamic> message,
  ) async {
    final requestId = message['requestId']?.toString() ?? '';
    final controller = _controller;
    if (requestId.isEmpty || controller == null) return;
    Map<String, Object?> response;
    try {
      final x = double.tryParse(message['x']?.toString() ?? '');
      final y = double.tryParse(message['y']?.toString() ?? '');
      if (x == null ||
          y == null ||
          !x.isFinite ||
          !y.isFinite ||
          x < 0 ||
          y < 0) {
        throw const FormatException(
          'Trusted-click CSS coordinates are invalid.',
        );
      }
      await controller.dispatchTrustedMouseClick(x, y);
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'response': <String, Object?>{'ok': true},
      };
    } catch (error) {
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'error': <String, Object?>{
          'code': error is PlatformException
              ? error.code
              : 'gemini_trusted_click_failed',
          'message': error.toString(),
        },
      };
    }
    await controller.runJavaScript(
      'window.postMessage(${jsonEncode(response)}, "*");',
    );
  }

  Future<void> _handleImageDownloadRequest(
    Map<String, dynamic> message,
  ) async {
    final requestId = message['requestId']?.toString() ?? '';
    final controller = _controller;
    if (requestId.isEmpty || controller == null) return;
    Map<String, Object?> response;
    final rawUrl = message['url']?.toString() ?? '';
    final uri = Uri.tryParse(rawUrl);
    if (uri == null || !_isAllowedGeminiImageUrl(uri)) {
      response = <String, Object?>{
        'source': 'langbai-gemini-native',
        'type': 'native-response',
        'requestId': requestId,
        'error': <String, Object?>{
          'code': 'gemini_image_download_forbidden',
          'message': 'Only HTTPS Google image hosts are permitted.',
        },
      };
    } else {
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 20)
        ..idleTimeout = const Duration(seconds: 60)
        ..findProxy = (_) => 'DIRECT';
      try {
        final request =
            await client.getUrl(uri).timeout(const Duration(seconds: 30));
        request.headers.set(HttpHeaders.acceptHeader, 'image/*');
        final downloaded =
            await request.close().timeout(const Duration(seconds: 70));
        if (downloaded.statusCode < 200 || downloaded.statusCode >= 300) {
          throw HttpException(
            'Gemini image download returned HTTP ${downloaded.statusCode}.',
            uri: uri,
          );
        }
        final bytes = <int>[];
        await for (final chunk
            in downloaded.timeout(const Duration(seconds: 70))) {
          bytes.addAll(chunk);
          if (bytes.length > _maxNativeTransportBytes) {
            throw const FormatException(
              'Gemini image exceeds the 96 MiB native limit.',
            );
          }
        }
        final contentType =
            downloaded.headers.contentType?.mimeType.toLowerCase() ?? '';
        if (bytes.isEmpty ||
            (contentType.isNotEmpty && !contentType.startsWith('image/'))) {
          throw const FormatException(
            'Gemini image URL did not return image bytes.',
          );
        }
        response = <String, Object?>{
          'source': 'langbai-gemini-native',
          'type': 'native-response',
          'requestId': requestId,
          'response': <String, Object?>{
            'bodyBase64': base64Encode(bytes),
            'contentType':
                contentType.isEmpty ? 'application/octet-stream' : contentType,
          },
        };
      } catch (error) {
        response = <String, Object?>{
          'source': 'langbai-gemini-native',
          'type': 'native-response',
          'requestId': requestId,
          'error': <String, Object?>{
            'code': 'gemini_image_download_failed',
            'message': error.toString(),
          },
        };
      } finally {
        client.close(force: true);
      }
    }
    await controller.runJavaScript(
      'window.postMessage(${jsonEncode(response)}, "*");',
    );
  }

  Future<void> _emit(Map<String, Object?> event) async {
    if (mounted) setState(() => _status = _statusText(event));
    await widget.onEvent(event);
  }

  Future<void> _goBackOrClose() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
    } else {
      widget.requestController.collapse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible =
        widget.requestController.visible && !widget.windowSuppressed;
    final controller = _controller;
    if (controller == null) {
      return visible
          ? const ColoredBox(
              color: Colors.white,
              child: Center(child: CircularProgressIndicator()),
            )
          : const SizedBox.shrink();
    }
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned(
          left: visible ? 0 : -1400,
          top: visible ? 52 : 0,
          right: visible ? 0 : null,
          bottom: visible ? 0 : null,
          width: visible ? null : 1280,
          height: visible ? null : 720,
          child: IgnorePointer(
            ignoring: !visible,
            child: windows_webview.WinWebViewWidget(controller: controller),
          ),
        ),
        if (visible)
          Positioned(
            left: 0,
            top: 0,
            right: 0,
            child: _GeminiBrowserToolbar(
              status: _status,
              onBack: () => unawaited(_goBackOrClose()),
              onReload: () {
                unawaited(controller.reload());
              },
              onClose: widget.requestController.collapse,
            ),
          ),
      ],
    );
  }
}
