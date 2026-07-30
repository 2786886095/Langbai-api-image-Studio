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

import 'secure_storage_queue.dart';

const String _geminiStartUrl = 'https://gemini.google.com/app';
const int _maxNativeTransportBytes = 96 * 1024 * 1024;
const MethodChannel _geminiSessionChannel =
    MethodChannel('com.aigen.ai_image_generator/gemini_sessions');
const String _geminiSessionStoragePrefix = 'gemini_web_session_v1:';
const String geminiEmbeddedSelectorPackVersion = '2026.07.30.6';

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
    this.nativeBridgeCapability = '',
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
      nativeBridgeCapability: List<int>.generate(
        32,
        (_) => Random.secure().nextInt(256),
      ).map((value) => value.toRadixString(16).padLeft(2, '0')).join(),
    );
  }

  final String baseUrl;
  final String apiKey;
  final String profileId;
  final String nativeBridgeCapability;

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

String geminiEmbeddedProfileIdForAccount(Map<Object?, Object?> account) {
  for (final key in const <String>[
    'browser_profile_id',
    'account_uuid',
    'local_account_id',
  ]) {
    final value = account[key]?.toString().trim().toLowerCase() ?? '';
    if (_uuidPattern.hasMatch(value)) return value;
  }
  return '';
}

String geminiEmbeddedProfileIdFromSnapshot(
  Map<Object?, Object?> snapshot,
  String localAccountId,
) {
  final accounts = snapshot['accounts'];
  if (accounts is! List) return '';
  final requested = localAccountId.trim();
  for (final value in accounts.whereType<Map>()) {
    if (value['local_account_id']?.toString() == requested) {
      return geminiEmbeddedProfileIdForAccount(value);
    }
  }
  return '';
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
    await SecureStorageQueue.run(
      () => _storage.write(
        key: _key(profileId),
        value: jsonEncode(snapshot),
      ),
    );
  }

  Future<void> restore(String profileId) async {
    if (!_uuidPattern.hasMatch(profileId) || Platform.isWindows) return;
    final raw = await SecureStorageQueue.run(
      () => _storage.read(key: _key(profileId)),
    );
    final snapshot = raw == null || raw.isEmpty ? null : jsonDecode(raw);
    await _geminiSessionChannel.invokeMethod<void>(
      'restore',
      <String, Object?>{'snapshot': snapshot},
    );
  }

  Future<void> remove(String profileId) async {
    if (!_uuidPattern.hasMatch(profileId)) return;
    await SecureStorageQueue.run(
      () => _storage.delete(key: _key(profileId)),
    );
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
    required bool directProtocolAvailable,
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
        'direct_protocol_available': directProtocolAvailable,
        'fullsize_download_available': true,
        'effective_concurrency': 1,
        'platform': 'embedded:$platform',
        'selector_pack_version': geminiEmbeddedSelectorPackVersion,
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
  final directProtocolSource = await rootBundle.loadString(
    'gemini-web-direct-protocol.js',
  );
  final workerSource = await rootBundle.loadString(
    'gemini-embedded-worker.js',
  );
  final safeConfig = jsonEncode(config.toSafeJavaScriptConfig(platform));
  final nativeBridgeCapability = jsonEncode(config.nativeBridgeCapability);
  return '''
(() => {
  const config = Object.freeze($safeConfig);
  const __LANGBAI_GEMINI_NATIVE_CAPABILITY = $nativeBridgeCapability;
  Object.defineProperty(globalThis, "__LANGBAI_GEMINI_EMBEDDED_CONFIG", {
    configurable: true,
    value: config,
  });
  const androidNativePost =
    globalThis.LangbaiGeminiHost?.postMessage?.bind(
      globalThis.LangbaiGeminiHost,
    );
  const windowsNativePost =
    globalThis.chrome?.webview?.postMessage?.bind(globalThis.chrome.webview);
  const appleNativePost =
    globalThis.webkit?.messageHandlers?.langbaiGemini?.postMessage?.bind(
      globalThis.webkit.messageHandlers.langbaiGemini,
    );
  const sendNative = message => {
    const authorizedMessage = {
      ...message,
      capability: __LANGBAI_GEMINI_NATIVE_CAPABILITY,
    };
    const value = JSON.stringify(authorizedMessage);
    if (androidNativePost) {
      androidNativePost(value);
      return;
    }
    if (windowsNativePost) {
      windowsNativePost(authorizedMessage);
      return;
    }
    if (appleNativePost) {
      appleNativePost(authorizedMessage);
      return;
    }
    throw new Error("gemini_native_message_channel_unavailable");
  };
  const __LANGBAI_GEMINI_NATIVE_SEND = sendNative;
  let pageProbeTimer = 0;
  let lastPageProbeSignature = "";
  let lastPageProbeSentAt = 0;
  const reportPageState = () => {
    const host = location.hostname.toLowerCase();
    const onGemini = host === "gemini.google.com" ||
      host.endsWith(".gemini.google.com");
    const composer = onGemini && document.querySelector(
      'div[contenteditable="true"][role="textbox"],textarea[aria-label],textarea'
    );
    const signedOutMarker = onGemini && document.querySelector([
      '[data-test-id="signed-out-disclaimer"]',
      '[data-test-id="mavatar-sign-in-icon-button"]',
      '.signed-out-buttons'
    ].join(','));
    const authenticatedMarker = onGemini && document.querySelector([
      'a[href*="SignOutOptions"]',
      'a[href*="/Logout"]',
      'a[href*="accounts.google.com"][aria-label*="@"]',
      '[role="button"][aria-label*="@"]'
    ].join(','));
    const loginReady = !!composer && !!authenticatedMarker && !signedOutMarker;
    const interactive = onGemini
      ? [...document.querySelectorAll('button,[role="button"],[aria-label],[title]')]
      : [];
    const textOf = element => [
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
    const tempChatControl = onGemini && document.querySelector(
      '[data-test-id="temp-chat-button"]'
    );
    const tempChatSurface = onGemini && [
      ...document.querySelectorAll(
        'h1,h2,h3,[role="heading"],[role="status"],[aria-label],[title],[placeholder],[data-test-id]'
      )
    ].some(element =>
      /temporary chat|临时对话|临时聊天|臨時對話|臨時聊天|一時的なチャット|一時チャット|임시 채팅/i.test(textOf(element))
    );
    const directProtocolAvailable =
      !!globalThis.LANGBAI_GEMINI_DIRECT_PROTOCOL?.generate;
    const temporaryChatAvailable = !!tempChatControl ||
      tempChatSurface ||
      interactive.some(element =>
        /temporary chat|临时对话|临时聊天|臨時對話|臨時聊天|一時的なチャット|一時チャット|임시 채팅/i.test(textOf(element))
      );
    const state = {
      source: "langbai-gemini-executor",
      type: "page_state",
      status: loginReady ? "page_ready" :
        (host === "accounts.google.com" || host.endsWith(".accounts.google.com"))
          ? "login_required"
          : (signedOutMarker ? "login_required" : "loading"),
      url: location.href,
      browser_profile_id: config.profileId,
      account_uuid: config.accountUuid,
      login_ready: loginReady,
      temporary_chat_available: temporaryChatAvailable,
      direct_protocol_available: directProtocolAvailable,
      fullsize_download_available: true,
    };
    const signature = JSON.stringify([
      state.status,
      state.url,
      state.login_ready,
      state.temporary_chat_available,
    ]);
    const now = Date.now();
    if (signature === lastPageProbeSignature &&
        now - lastPageProbeSentAt < 10000) {
      return;
    }
    lastPageProbeSignature = signature;
    lastPageProbeSentAt = now;
    sendNative(state);
  };
  const schedulePageState = () => {
    clearTimeout(pageProbeTimer);
    pageProbeTimer = setTimeout(reportPageState, 350);
  };
  if (!globalThis.__LANGBAI_GEMINI_PAGE_PROBE_STARTED) {
    globalThis.__LANGBAI_GEMINI_PAGE_PROBE_STARTED = true;
    addEventListener("DOMContentLoaded", schedulePageState);
    addEventListener("pageshow", schedulePageState);
    setTimeout(schedulePageState, 300);
    setTimeout(schedulePageState, 1500);
    new MutationObserver(schedulePageState).observe(
      document.documentElement,
      { childList: true, subtree: true }
    );
  } else {
    schedulePageState();
  }
  if (
    location.hostname === "gemini.google.com" ||
    location.hostname.endsWith(".gemini.google.com")
  ) {
$selectorSource
$directProtocolSource
$workerSource
  }
})();
''';
}

String windowsGeminiWebViewDataPath({String? localAppData}) {
  final base = localAppData ?? Platform.environment['LOCALAPPDATA'];
  if (base == null || base.trim().isEmpty) {
    throw const FileSystemException('LOCALAPPDATA is unavailable.');
  }
  return <String>[
    base,
    'flutter_webview_windows',
    'ai_image_generator',
  ].join(Platform.pathSeparator);
}

String windowsGeminiWebViewProfileName(String profileId) {
  if (!_uuidPattern.hasMatch(profileId)) {
    throw const FormatException('Invalid Gemini profile id.');
  }
  return 'gemini-${profileId.toLowerCase()}';
}

String _legacyWindowsGeminiProfilePath(
  String profileId, {
  String? localAppData,
}) {
  final base = localAppData ?? Platform.environment['LOCALAPPDATA'];
  if (base == null || base.trim().isEmpty) {
    throw const FileSystemException('LOCALAPPDATA is unavailable.');
  }
  return <String>[
    base,
    'AI Image Generator',
    'gemini_embedded_webview',
    profileId.toLowerCase(),
  ].join(Platform.pathSeparator);
}

Future<void> migrateWindowsGeminiProfilesBeforeWebViewStart(
  Iterable<String> profileIds, {
  String? sharedDefaultMigrationProfileId,
  String? localAppData,
}) async {
  final sharedRoot = Directory(
    windowsGeminiWebViewDataPath(localAppData: localAppData),
  );
  final profilesRoot = Directory(<String>[
    sharedRoot.path,
    'EBWebView',
  ].join(Platform.pathSeparator));
  for (final value in profileIds) {
    final profileId = value.trim().toLowerCase();
    if (!_uuidPattern.hasMatch(profileId)) continue;
    final legacyDefault = Directory(<String>[
      _legacyWindowsGeminiProfilePath(
        profileId,
        localAppData: localAppData,
      ),
      'EBWebView',
      'Default',
    ].join(Platform.pathSeparator));
    if (!await legacyDefault.exists()) continue;
    final destination = Directory(<String>[
      profilesRoot.path,
      'WV2Profile_${windowsGeminiWebViewProfileName(profileId)}',
    ].join(Platform.pathSeparator));
    if (await destination.exists()) continue;
    await profilesRoot.create(recursive: true);
    final temporary = Directory(
      '${destination.path}.migrating-${DateTime.now().microsecondsSinceEpoch}',
    );
    try {
      await _copyWebViewProfileDirectory(legacyDefault, temporary);
      await temporary.rename(destination.path);
    } catch (_) {
      if (await temporary.exists()) {
        await temporary.delete(recursive: true);
      }
      rethrow;
    }
  }

  final active = (sharedDefaultMigrationProfileId ?? '').trim().toLowerCase();
  if (!_uuidPattern.hasMatch(active)) return;
  await _migrateSharedDefaultGoogleSession(
    source: Directory(<String>[
      profilesRoot.path,
      'Default',
    ].join(Platform.pathSeparator)),
    destination: Directory(<String>[
      profilesRoot.path,
      'WV2Profile_${windowsGeminiWebViewProfileName(active)}',
    ].join(Platform.pathSeparator)),
  );
}

const List<String> _googleAuthenticationCookieMarkers = <String>[
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Host-1PLSID',
  '__Host-3PLSID',
];

Future<bool> _profileHasGoogleAuthenticationCookies(
  Directory profile,
) async {
  final network = Directory(
    <String>[profile.path, 'Network'].join(Platform.pathSeparator),
  );
  for (final name in const <String>[
    'Cookies',
    'Cookies-wal',
    'Cookies-journal',
  ]) {
    final file =
        File(<String>[network.path, name].join(Platform.pathSeparator));
    if (!await file.exists()) continue;
    final length = await file.length();
    if (length <= 0 || length > 64 * 1024 * 1024) continue;
    final content = latin1.decode(
      await file.readAsBytes(),
      allowInvalid: true,
    );
    if (_googleAuthenticationCookieMarkers.any(content.contains)) return true;
  }
  return false;
}

Future<void> _migrateSharedDefaultGoogleSession({
  required Directory source,
  required Directory destination,
}) async {
  if (!await source.exists() ||
      !await _profileHasGoogleAuthenticationCookies(source)) {
    return;
  }
  if (await destination.exists() &&
      await _profileHasGoogleAuthenticationCookies(destination)) {
    return;
  }

  final sourceNetwork = Directory(
    <String>[source.path, 'Network'].join(Platform.pathSeparator),
  );
  final sourceCookies = File(
    <String>[sourceNetwork.path, 'Cookies'].join(Platform.pathSeparator),
  );
  // A live or uncheckpointed SQLite cookie database is not a safe migration
  // source. Startup calls this before creating any WebView, so a cleanly
  // closed legacy profile has only the main Cookies database.
  for (final sidecar in const <String>[
    'Cookies-wal',
    'Cookies-shm',
    'Cookies-journal',
  ]) {
    final file = File(
      <String>[sourceNetwork.path, sidecar].join(Platform.pathSeparator),
    );
    if (await file.exists() && await file.length() > 0) return;
  }
  if (!await sourceCookies.exists()) return;

  // Google login depends on more than the Cookies SQLite file. Session
  // storage, account metadata, trust tokens and other profile-scoped state
  // participate in restoring an authenticated Gemini tab. Copying only the
  // cookie DB creates a misleading profile that contains SID cookies but
  // still opens signed out. Replace the anonymous destination atomically with
  // a complete, cleanly closed profile snapshot instead.
  final backupSuffix = DateTime.now().microsecondsSinceEpoch;
  final temporary = Directory(
    '${destination.path}.migrating-$backupSuffix',
  );
  final backup = Directory(
    '${destination.path}.pre-langbai-migration-$backupSuffix',
  );
  var destinationMoved = false;
  try {
    await _copyWebViewProfileDirectory(source, temporary);
    if (!await _profileHasGoogleAuthenticationCookies(temporary)) {
      await temporary.delete(recursive: true);
      return;
    }
    if (await destination.exists()) {
      await destination.rename(backup.path);
      destinationMoved = true;
    }
    await temporary.rename(destination.path);
    await File(<String>[
      destination.path,
      '.langbai-shared-profile-migration-v2',
    ].join(Platform.pathSeparator))
        .writeAsString(
      'source=Default\nmigrated_at=${DateTime.now().toUtc().toIso8601String()}\n',
      flush: true,
    );
  } catch (_) {
    if (await temporary.exists()) {
      await temporary.delete(recursive: true);
    }
    if (!await destination.exists() &&
        destinationMoved &&
        await backup.exists()) {
      await backup.rename(destination.path);
    }
    rethrow;
  }
}

Future<void> _copyWebViewProfileDirectory(
  Directory source,
  Directory destination,
) async {
  await destination.create(recursive: true);
  await for (final entity in source.list(followLinks: false)) {
    final name =
        entity.uri.pathSegments.where((segment) => segment.isNotEmpty).last;
    if (name == 'LOCK' ||
        name == 'SingletonLock' ||
        name == 'SingletonCookie' ||
        name == 'SingletonSocket' ||
        name == 'Cache' ||
        name == 'Code Cache' ||
        name == 'GPUCache' ||
        name == 'DawnCache' ||
        name == 'GrShaderCache') {
      continue;
    }
    final targetPath =
        <String>[destination.path, name].join(Platform.pathSeparator);
    if (entity is Directory) {
      await _copyWebViewProfileDirectory(entity, Directory(targetPath));
    } else if (entity is File) {
      await entity.copy(targetPath);
    }
  }
}

Future<String> resolveWindowsGeminiWebViewProfileName(
  String profileId, {
  String? localAppData,
}) async =>
    windowsGeminiWebViewProfileName(profileId);

Future<void> deleteGeminiEmbeddedProfileData(String profileId) async {
  if (!_uuidPattern.hasMatch(profileId)) return;
  if (Platform.isWindows) {
    // v1.6.7 and earlier attempted to isolate accounts with separate UDFs.
    // The patched WebView2 runtime now uses one environment and a real named
    // profile. Only remove the unused legacy directory here; deleting an
    // active WebView2 profile directory behind the runtime would corrupt it.
    final directory = Directory(_legacyWindowsGeminiProfilePath(profileId));
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
      message['generation_ready'] == true;
}

bool _isPageReadyMessage(Map<String, dynamic> message) {
  return message['source'] == 'langbai-gemini-executor' &&
      message['type'] == 'page_state' &&
      message['status'] == 'page_ready' &&
      message['login_ready'] == true;
}

Future<Map<String, Object?>> _registerPageReadyMessage({
  required _GeminiNativeTransport transport,
  required Map<String, dynamic> message,
  required String platform,
}) async {
  if (message['login_ready'] != true) {
    throw StateError(
      'Gemini page-ready registration requires a verified login marker.',
    );
  }
  final temporaryChatAvailable = message['temporary_chat_available'] == true;
  final directProtocolAvailable = message['direct_protocol_available'] == true;
  final fullsizeDownloadAvailable =
      message['fullsize_download_available'] == true;
  final snapshot = await transport.registerLoggedInProfile(
    platform: platform,
    temporaryChatAvailable: temporaryChatAvailable,
    directProtocolAvailable: directProtocolAvailable,
    maskedEmail: message['masked_email']?.toString() ?? '',
  );
  return geminiEmbeddedReadinessEvent(
    accountId: snapshot['local_account_id']?.toString() ?? '',
    accountUuid:
        snapshot['account_uuid']?.toString() ?? transport.config.profileId,
    maskedEmail: message['masked_email']?.toString() ?? '',
    loginReady: true,
    temporaryChatAvailable: temporaryChatAvailable,
    directProtocolAvailable: directProtocolAvailable,
    fullsizeDownloadAvailable: fullsizeDownloadAvailable,
    selectorPackCompatible: snapshot['selector_pack_compatible'] == true,
  );
}

Map<String, Object?> geminiEmbeddedReadinessEvent({
  required String accountId,
  required String accountUuid,
  required String maskedEmail,
  required bool loginReady,
  required bool temporaryChatAvailable,
  bool directProtocolAvailable = false,
  required bool fullsizeDownloadAvailable,
  required bool selectorPackCompatible,
}) {
  final generationReady = loginReady &&
      (temporaryChatAvailable || directProtocolAvailable) &&
      fullsizeDownloadAvailable &&
      selectorPackCompatible;
  return <String, Object?>{
    'source': 'langbai-gemini-executor',
    'type': 'login_state',
    'status': generationReady ? 'ready' : 'logged_in',
    'login_ready': loginReady,
    'generation_ready': generationReady,
    'account_id': accountId,
    'account_uuid': accountUuid,
    'masked_email': maskedEmail,
    'temporary_chat_available': temporaryChatAvailable,
    'direct_protocol_available': directProtocolAvailable,
    'fullsize_download_available': fullsizeDownloadAvailable,
    'selector_pack_compatible': selectorPackCompatible,
  };
}

String geminiEmbeddedStatusText(Map<String, dynamic> message) {
  final type = message['type']?.toString() ?? '';
  final status = message['status']?.toString() ?? '';
  final code = message['code']?.toString() ?? '';
  if (type == 'transport_error') {
    return '本机网关连接失败${code.isEmpty ? '' : '（$code）'}';
  }
  if (message['generation_ready'] == true) {
    return '已就绪，可以生成图片';
  }
  if (message['login_ready'] == true) {
    if (message['selector_pack_compatible'] == false) {
      return '已登录，但页面版本尚未兼容';
    }
    if (message['temporary_chat_available'] != true &&
        message['direct_protocol_available'] != true) {
      return '已登录，但临时对话入口尚未识别或不可用';
    }
    if (message['fullsize_download_available'] != true) {
      return '已登录，但完整尺寸图片下载能力尚不可用';
    }
    return '已登录，正在确认生图能力';
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
  bool _initializationPending = false;
  bool _pageReadyRegistrationInFlight = false;
  String _lastPageCapabilitySignature = '';
  int _handledRevision = -1;
  int _controllerGeneration = 0;

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
      unawaited(_ensureInitialized());
    }
    if (mounted) setState(() {});
  }

  Future<void> _ensureInitialized() async {
    final requestedRevision = widget.requestController.requestRevision;
    final requestedProfile = widget.requestController.profileId;
    if (requestedProfile.isEmpty) return;
    if (_initializing) {
      _initializationPending = true;
      return;
    }
    if (_controller != null && _activeProfileId == requestedProfile) {
      _handledRevision = requestedRevision;
      return;
    }
    _initializing = true;
    _initializationPending = false;
    final generation = ++_controllerGeneration;
    try {
      final config = await widget.loadConfig(requestedProfile);
      if (_controller != null && _activeProfileId != config.profileId) {
        if (_activeProfileId.isNotEmpty) {
          await _sessionVault.capture(_activeProfileId);
        }
        _controller = null;
        _transport = null;
        _lastPageCapabilitySignature = '';
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
          unawaited(
            _handleMessage(
              message.message,
              generation,
              config.profileId,
              config.nativeBridgeCapability,
            ),
          );
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
            if (!_isCurrentController(generation, config.profileId)) return;
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
      if (widget.requestController.profileId == config.profileId &&
          widget.requestController.requestRevision == requestedRevision) {
        _handledRevision = requestedRevision;
      } else {
        _initializationPending = true;
      }
      if (mounted) setState(() {});
    } catch (error) {
      if (widget.requestController.profileId == requestedProfile) {
        await _emit(<String, Object?>{
          'source': 'langbai-gemini-host',
          'type': 'startup_error',
          'status': 'failed',
          'message': error.toString(),
        });
      }
    } finally {
      _initializing = false;
      if (_initializationPending ||
          (_handledRevision != widget.requestController.requestRevision &&
              widget.requestController.profileId.isNotEmpty)) {
        _initializationPending = false;
        unawaited(Future<void>.microtask(_ensureInitialized));
      }
    }
  }

  bool _isCurrentController(int generation, String profileId) =>
      generation == _controllerGeneration &&
      profileId == _activeProfileId &&
      profileId == widget.requestController.profileId;

  Future<void> _handleMessage(
    Object? raw,
    int generation,
    String profileId,
    String nativeBridgeCapability,
  ) async {
    if (!_isCurrentController(generation, profileId)) return;
    final message = _decodeNativeMessage(raw);
    if (message == null) return;
    if (message['source'] != 'langbai-gemini-executor') return;
    if (message['capability']?.toString() != nativeBridgeCapability) return;
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
    if (transport == null || _pageReadyRegistrationInFlight) {
      return;
    }
    final capabilitySignature = jsonEncode(<Object?>[
      message['temporary_chat_available'] == true,
      message['fullsize_download_available'] == true,
      message['masked_email']?.toString() ?? '',
    ]);
    if (capabilitySignature == _lastPageCapabilitySignature) return;
    _pageReadyRegistrationInFlight = true;
    try {
      final event = await _registerPageReadyMessage(
        transport: transport,
        message: message,
        platform: _platform,
      );
      _lastPageCapabilitySignature = capabilitySignature;
      await _emit(event);
      if (_activeProfileId.isNotEmpty) {
        await _sessionVault.capture(_activeProfileId);
      }
      if (event['generation_ready'] == true) {
        widget.requestController.collapse();
      }
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
    if (mounted) {
      setState(() => _status = geminiEmbeddedStatusText(event));
    }
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
  bool _initializationPending = false;
  bool _pageReadyRegistrationInFlight = false;
  String _lastPageCapabilitySignature = '';
  int _handledRevision = -1;
  int _controllerGeneration = 0;
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
      unawaited(_ensureInitialized());
    }
    unawaited(_syncVisibility());
    if (mounted) setState(() {});
  }

  Future<void> _ensureInitialized() async {
    final requestedRevision = widget.requestController.requestRevision;
    final requestedProfile = widget.requestController.profileId;
    if (requestedProfile.isEmpty) return;
    if (_initializing) {
      _initializationPending = true;
      return;
    }
    if (_controller != null && _activeProfileId == requestedProfile) {
      _handledRevision = requestedRevision;
      return;
    }
    _initializing = true;
    _initializationPending = false;
    final generation = ++_controllerGeneration;
    windows_webview.WinWebViewController? controller;
    try {
      final config = await widget.loadConfig(requestedProfile);
      if (_controller != null && _activeProfileId != config.profileId) {
        final stale = _controller;
        _controller = null;
        _transport = null;
        _lastPageCapabilitySignature = '';
        if (stale != null) await stale.dispose();
      }
      final injectedWorker = await _loadInjectedWorker(config, 'windows');
      final windowsProfileName =
          await resolveWindowsGeminiWebViewProfileName(config.profileId);
      controller = windows_webview.WinWebViewController(
        params: windows_webview.WindowsWebViewControllerCreationParams(
          userDataFolder: windowsGeminiWebViewDataPath(),
          profileName: windowsProfileName,
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
        unawaited(_handleMessage(
          message,
          generation,
          config.profileId,
          config.nativeBridgeCapability,
        ));
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
            if (!_isCurrentController(generation, config.profileId)) return;
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
      if (widget.requestController.profileId == config.profileId &&
          widget.requestController.requestRevision == requestedRevision) {
        _handledRevision = requestedRevision;
      } else {
        _initializationPending = true;
      }
      await _syncVisibility();
      if (mounted) setState(() {});
    } catch (error) {
      if (controller != null && controller != _controller) {
        await controller.dispose();
      }
      if (widget.requestController.profileId == requestedProfile) {
        await _emit(<String, Object?>{
          'source': 'langbai-gemini-host',
          'type': 'startup_error',
          'status': 'failed',
          'message': error.toString(),
        });
      }
    } finally {
      _initializing = false;
      if (_initializationPending ||
          (_handledRevision != widget.requestController.requestRevision &&
              widget.requestController.profileId.isNotEmpty)) {
        _initializationPending = false;
        unawaited(Future<void>.microtask(_ensureInitialized));
      }
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

  bool _isCurrentController(int generation, String profileId) =>
      generation == _controllerGeneration &&
      profileId == _activeProfileId &&
      profileId == widget.requestController.profileId;

  Future<void> _handleMessage(
    Object? raw,
    int generation,
    String profileId,
    String nativeBridgeCapability,
  ) async {
    if (!_isCurrentController(generation, profileId)) return;
    final message = _decodeNativeMessage(raw);
    if (message == null || message['source'] != 'langbai-gemini-executor') {
      return;
    }
    if (message['capability']?.toString() != nativeBridgeCapability) return;
    if (message['type'] == 'trusted-click-request') {
      await _handleTrustedClickRequest(message);
      return;
    }
    if (message['type'] == 'trusted-text-request') {
      await _handleTrustedTextRequest(message);
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
    if (transport == null || _pageReadyRegistrationInFlight) {
      return;
    }
    final capabilitySignature = jsonEncode(<Object?>[
      message['temporary_chat_available'] == true,
      message['fullsize_download_available'] == true,
      message['masked_email']?.toString() ?? '',
    ]);
    if (capabilitySignature == _lastPageCapabilitySignature) return;
    _pageReadyRegistrationInFlight = true;
    try {
      final event = await _registerPageReadyMessage(
        transport: transport,
        message: message,
        platform: 'windows',
      );
      _lastPageCapabilitySignature = capabilitySignature;
      await _emit(event);
      if (event['generation_ready'] == true) {
        widget.requestController.collapse();
      }
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

  Future<void> _handleTrustedTextRequest(
    Map<String, dynamic> message,
  ) async {
    final requestId = message['requestId']?.toString() ?? '';
    final controller = _controller;
    if (requestId.isEmpty || controller == null) return;
    Map<String, Object?> response;
    try {
      final text = message['text']?.toString() ?? '';
      if (text.isEmpty || text.length > 1024 * 1024) {
        throw const FormatException(
          'Trusted text input is empty or exceeds the 1 MiB limit.',
        );
      }
      await controller.dispatchTrustedTextInput(text);
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
              : 'gemini_trusted_text_failed',
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
        List<int>? browserBytes;
        try {
          final frameTree = jsonDecode(
            await controller.callDevToolsProtocolMethod(
              'Page.getFrameTree',
              '{}',
            ),
          );
          String? frameId;
          if (frameTree is Map) {
            final frameTreeNode = frameTree['frameTree'];
            if (frameTreeNode is Map) {
              final frameNode = frameTreeNode['frame'];
              if (frameNode is Map) {
                frameId = frameNode['id']?.toString();
              }
            }
          }
          if (frameId != null && frameId.isNotEmpty) {
            final loaded = jsonDecode(
              await controller.callDevToolsProtocolMethod(
                'Network.loadNetworkResource',
                jsonEncode(<String, Object?>{
                  'frameId': frameId,
                  'url': uri.toString(),
                  'options': <String, Object?>{
                    'disableCache': true,
                    'includeCredentials': true,
                  },
                }),
              ),
            );
            final resource = loaded is Map ? loaded['resource'] : null;
            final stream = resource is Map
                ? resource['stream']?.toString() ?? ''
                : '';
            final success = resource is Map && resource['success'] == true;
            if (success && stream.isNotEmpty) {
              final collected = <int>[];
              try {
                while (true) {
                  final chunk = jsonDecode(
                    await controller.callDevToolsProtocolMethod(
                      'IO.read',
                      jsonEncode(<String, Object?>{
                        'handle': stream,
                        'size': 1024 * 1024,
                      }),
                    ),
                  );
                  if (chunk is! Map) break;
                  final data = chunk['data']?.toString() ?? '';
                  if (data.isNotEmpty) {
                    collected.addAll(chunk['base64Encoded'] == true
                        ? base64Decode(data)
                        : utf8.encode(data));
                  }
                  if (collected.length > _maxNativeTransportBytes) {
                    throw const FormatException(
                      'Gemini image exceeds the 96 MiB native limit.',
                    );
                  }
                  if (chunk['eof'] == true) break;
                }
              } finally {
                try {
                  await controller.callDevToolsProtocolMethod(
                    'IO.close',
                    jsonEncode(<String, Object?>{'handle': stream}),
                  );
                } catch (_) {}
              }
              if (collected.isNotEmpty) browserBytes = collected;
            }
          }
        } catch (_) {
          browserBytes = null;
        }
        if (browserBytes != null && browserBytes.isNotEmpty) {
          response = <String, Object?>{
            'source': 'langbai-gemini-native',
            'type': 'native-response',
            'requestId': requestId,
            'response': <String, Object?>{
              'bodyBase64': base64Encode(browserBytes),
              'contentType': 'application/octet-stream',
            },
          };
          await controller.runJavaScript(
            'window.postMessage(${jsonEncode(response)}, "*");',
          );
          return;
        }
        final cookiePayload = jsonDecode(await controller.getCookiesForUrls(
          <String>[
            'https://gemini.google.com/',
            uri.toString(),
          ],
        ));
        final cookiePairs = <String>[];
        if (cookiePayload is Map && cookiePayload['cookies'] is List) {
          final names = <String>{};
          for (final item in cookiePayload['cookies'] as List) {
            if (item is! Map) continue;
            final name = item['name']?.toString() ?? '';
            final value = item['value']?.toString() ?? '';
            if (name.isEmpty || value.isEmpty || !names.add(name)) continue;
            cookiePairs.add('$name=$value');
          }
        }
        final request =
            await client.getUrl(uri).timeout(const Duration(seconds: 30));
        request.headers.set(HttpHeaders.acceptHeader, 'image/*');
        request.headers.set(HttpHeaders.refererHeader, 'https://gemini.google.com/');
        request.headers.set(HttpHeaders.userAgentHeader,
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36');
        if (cookiePairs.isNotEmpty) {
          request.headers.set(HttpHeaders.cookieHeader, cookiePairs.join('; '));
        }
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
    if (mounted) {
      setState(() => _status = geminiEmbeddedStatusText(event));
    }
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
