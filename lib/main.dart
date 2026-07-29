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
import 'package:webview_win_floating/webview_win_floating.dart'
    as windows_webview;

import 'proxy_config.dart';
import 'codex_image_gateway_config.dart';
import 'chatgpt_account_store.dart';
import 'chatgpt_multi_account.dart';
import 'embedded_chatgpt_gateway.dart';
import 'android_chatgpt_gateway.dart';
import 'gemini_embedded_browser.dart';
import 'gemini_web_gateway.dart';

const _appTitle = 'AI 图片生成器';
const _appBackground = Color(0xFF121417);
bool _windowsWebViewSelfTest = false;
bool _windowsWebViewInputSelfTest = false;
const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
);
final ChatGptMultiAccountStore _chatGptMultiAccountStore =
    ChatGptMultiAccountStore(_secureStorage);
final EmbeddedChatGptGatewayManager _embeddedChatGptGateway =
    EmbeddedChatGptGatewayManager();
final AndroidChatGptGatewayManager _androidChatGptGateway =
    AndroidChatGptGatewayManager();
final GeminiWebGatewayManager _geminiWebGateway =
    GeminiWebGatewayManager(_secureStorage);
final GeminiEmbeddedBrowserRequestController
    _geminiEmbeddedBrowserRequestController =
    GeminiEmbeddedBrowserRequestController();

Future<Map<String, Object?>> _loadChatGptImageGatewayConfig() async {
  if (Platform.isWindows) {
    try {
      final configuration = await _embeddedChatGptGateway.configuration();
      await _chatGptMultiAccountStore.restoreGatewaySession(
        (token, accountId) => _embeddedChatGptGateway.setSessionToken(
          token,
          accountId: accountId,
        ),
      );
      return configuration;
    } catch (error) {
      debugPrint('Bundled ChatGPT image gateway unavailable: $error');
    }
  }
  if (Platform.isAndroid) {
    await _chatGptMultiAccountStore.restoreGatewaySession(
      (token, accountId) => _androidChatGptGateway.setSessionToken(
        token,
        accountId: accountId,
      ),
    );
    return _androidChatGptGateway.configuration();
  }
  final fallback = await loadCodexImageGatewayConfig();
  return <String, Object?>{
    ...fallback,
    'embedded': false,
    'port': Uri.tryParse(fallback['baseUrl'] ?? '')?.port ?? 18081,
  };
}

Future<Map<String, Object?>> _chatGptAccountSnapshot() =>
    _chatGptMultiAccountStore.snapshot();

Future<void> _activateChatGptAccount(String localAccountId) async {
  await _chatGptMultiAccountStore.selectAccount(localAccountId);
  if (Platform.isWindows) {
    final token = await _chatGptMultiAccountStore.readToken(localAccountId);
    await _embeddedChatGptGateway.setSessionToken(
      token,
      accountId: localAccountId,
    );
  } else if (Platform.isAndroid) {
    final token = await _chatGptMultiAccountStore.readToken(localAccountId);
    await _androidChatGptGateway.setSessionToken(
      token,
      accountId: localAccountId,
    );
  }
}

Future<Map<String, Object?>> _importChatGptSession(
  Map<String, dynamic> payload,
) async {
  final input = payload['input']?.toString() ?? '';
  final preferred = payload['preferredAccountId']?.toString();
  final account = await _chatGptMultiAccountStore.importSession(
    input,
    preferredLocalAccountId:
        preferred == null || preferred.trim().isEmpty ? null : preferred,
  );
  await _activateChatGptAccount(account.localAccountId);
  return _chatGptAccountSnapshot();
}

Future<Map<String, Object?>> _selectChatGptAccount(
  Map<String, dynamic> payload,
) async {
  final id = payload['accountId']?.toString() ?? '';
  await _activateChatGptAccount(id);
  return _chatGptAccountSnapshot();
}

Future<Map<String, Object?>> _deleteChatGptAccount(
  Map<String, dynamic> payload,
) async {
  final id = payload['accountId']?.toString() ?? '';
  final wasActive = await _chatGptMultiAccountStore.activeAccountId() == id;
  await _chatGptMultiAccountStore.deleteAccount(id);
  final active = await _chatGptMultiAccountStore.activeAccount();
  if (Platform.isWindows) {
    await _embeddedChatGptGateway.clearSessionToken(accountId: id);
    if (wasActive && active != null) {
      await _activateChatGptAccount(active.localAccountId);
    }
  } else if (Platform.isAndroid) {
    _androidChatGptGateway.clearSessionToken(accountId: id);
    if (wasActive && active != null) {
      await _activateChatGptAccount(active.localAccountId);
    }
  }
  return _chatGptAccountSnapshot();
}

Future<Map<String, Object?>> _setChatGptAutoSwitch(
  Map<String, dynamic> payload,
) async {
  await _chatGptMultiAccountStore.setAutoSwitch(payload['enabled'] != false);
  return _chatGptAccountSnapshot();
}

Future<Map<String, Object?>> _rotateChatGptAccount(
  Map<String, dynamic> payload,
) async {
  final status = payload['failedStatus']?.toString() == 'rate_limited'
      ? 'rate_limited'
      : 'authentication_failed';
  final reason = payload['reason']?.toString() ?? '';
  final next = await _chatGptMultiAccountStore.rotateAfterFailure(
    failedStatus: status,
    reason: reason,
  );
  if (next != null) await _activateChatGptAccount(next.localAccountId);
  return <String, Object?>{
    ...await _chatGptAccountSnapshot(),
    'rotated_to': next?.localAccountId ?? '',
    'all_unavailable': next == null,
  };
}

Future<Map<String, Object?>> _loadGeminiWebGatewayConfig() =>
    _geminiWebGateway.configuration();

Future<GeminiEmbeddedBrowserConfig> _loadGeminiEmbeddedBrowserConfig(
  String requestedProfileId,
) async {
  final gateway = await _geminiWebGateway.configuration();
  var profileId = requestedProfileId.trim();
  if (profileId.isEmpty) profileId = createGeminiEmbeddedProfileId();
  try {
    return GeminiEmbeddedBrowserConfig.fromGateway(
      gateway: gateway,
      profileId: profileId,
    );
  } on FormatException {
    profileId = createGeminiEmbeddedProfileId();
    return GeminiEmbeddedBrowserConfig.fromGateway(
      gateway: gateway,
      profileId: profileId,
    );
  }
}

Future<Map<String, Object?>> _selectGeminiAccount(
  Map<String, dynamic> payload,
) async {
  final accountId = payload['accountId']?.toString() ?? '';
  final snapshot = await _geminiWebGateway.selectAccount(accountId);
  _geminiEmbeddedBrowserRequestController.activate(accountId);
  return snapshot;
}

Future<Map<String, Object?>> _deleteGeminiAccount(
  Map<String, dynamic> payload,
) async {
  final accountId = payload['accountId']?.toString() ?? '';
  final snapshot = await _geminiWebGateway.deleteAccount(accountId);
  final next = snapshot['active_account_id']?.toString() ?? '';
  _geminiEmbeddedBrowserRequestController.activate(
    next.isNotEmpty ? next : createGeminiEmbeddedProfileId(),
  );
  // Let the embedded browser capture/dispose the previous profile before its
  // secure session or WebView2 data directory is removed.
  await Future<void>.delayed(const Duration(milliseconds: 800));
  try {
    await deleteGeminiEmbeddedProfileData(accountId);
  } catch (error) {
    debugPrint('Cannot remove deleted Gemini profile data: $error');
  }
  return snapshot;
}

Future<Map<String, Object?>> _setGeminiAutoSwitch(
  Map<String, dynamic> payload,
) async {
  await _geminiWebGateway.accountStore
      .setAutoSwitchEnabled(payload['enabled'] != false);
  return _geminiWebGateway.accountsSnapshot();
}

Future<bool> _openGeminiWebLogin([Map<String, dynamic>? payload]) async {
  final requested = payload?['accountId']?.toString().trim() ?? '';
  _geminiEmbeddedBrowserRequestController.show(
    requested.isEmpty ? createGeminiEmbeddedProfileId() : requested,
  );
  return true;
}

void _applyGeminiEmbeddedHostEvent(Map<String, Object?> event) {
  if (event['type'] != 'account_switch_requested') return;
  final accountId = event['active_account_id']?.toString() ?? '';
  if (accountId.isNotEmpty) {
    _geminiEmbeddedBrowserRequestController.activate(accountId);
  }
}

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

Future<Object?> _performSecretAction(
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

Future<void> _secureStorageOperationChain = Future<void>.value();

Future<Object?> _handleSecretAction(
  String action,
  Map<String, dynamic> payload,
) {
  final completer = Completer<Object?>();
  _secureStorageOperationChain =
      _secureStorageOperationChain.catchError((Object _) {}).then((_) async {
    try {
      completer.complete(await _performSecretAction(action, payload));
    } catch (error, stackTrace) {
      completer.completeError(error, stackTrace);
    }
  });
  return completer.future;
}

Future<void> main(List<String> arguments) async {
  WidgetsFlutterBinding.ensureInitialized();
  final authAccountArgument = arguments
      .where((value) => value.startsWith('--chatgpt-account-id='))
      .map((value) => value.substring('--chatgpt-account-id='.length))
      .firstOrNull;
  if (Platform.isWindows &&
      arguments.contains('--chatgpt-auth-window') &&
      authAccountArgument != null) {
    runApp(ChatGptAuthApp(
      accountId: validateLocalChatGptAccountId(authAccountArgument),
      clearSession: arguments.contains('--chatgpt-auth-clear-session'),
      closeAfterClear: arguments.contains('--chatgpt-auth-close-after-clear'),
    ));
    return;
  }
  _windowsWebViewSelfTest = arguments.contains('--windows-webview-self-test');
  _windowsWebViewInputSelfTest =
      arguments.contains('--windows-webview-input-self-test');
  try {
    await _geminiWebGateway.start();
    final geminiAccounts = await _geminiWebGateway.accountsSnapshot();
    final activeGeminiAccount =
        geminiAccounts['active_account_id']?.toString() ?? '';
    if (activeGeminiAccount.isNotEmpty) {
      _geminiEmbeddedBrowserRequestController.activate(activeGeminiAccount);
    }
  } catch (error) {
    debugPrint('Gemini embedded browser gateway unavailable: $error');
  }
  runApp(const AiImageGeneratorApp());
}

class ChatGptAuthApp extends StatelessWidget {
  const ChatGptAuthApp({
    super.key,
    required this.accountId,
    required this.clearSession,
    required this.closeAfterClear,
  });

  final String accountId;
  final bool clearSession;
  final bool closeAfterClear;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ChatGPT 登录',
      theme: ThemeData.dark(useMaterial3: true),
      home: ChatGptAuthShell(
        accountId: accountId,
        clearSession: clearSession,
        closeAfterClear: closeAfterClear,
      ),
    );
  }
}

class ChatGptAuthShell extends StatefulWidget {
  const ChatGptAuthShell({
    super.key,
    required this.accountId,
    required this.clearSession,
    required this.closeAfterClear,
  });

  final String accountId;
  final bool clearSession;
  final bool closeAfterClear;

  @override
  State<ChatGptAuthShell> createState() => _ChatGptAuthShellState();
}

bool isAllowedChatGptAuthNavigation(String value) {
  final uri = Uri.tryParse(value);
  if (uri == null) return false;
  if (uri.scheme == 'about') return uri.toString() == 'about:blank';
  if (uri.scheme != 'https') return false;
  final host = uri.host.toLowerCase();
  if (host == 'chatgpt.com' ||
      host.endsWith('.chatgpt.com') ||
      host == 'openai.com' ||
      host.endsWith('.openai.com')) {
    return true;
  }
  return const <String>{
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'challenges.cloudflare.com',
  }.contains(host);
}

class _ChatGptAuthShellState extends State<ChatGptAuthShell> {
  final ChatGptAccountStore _store = ChatGptAccountStore();
  windows_webview.WinWebViewController? _controller;
  String? _error;
  bool _ready = false;
  bool _sessionReady = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      final previous = await _store.readState(widget.accountId);
      await _store.writeState(previous.copyWith(
        status: widget.closeAfterClear ? 'signed_out' : 'opening_login',
      ));
      final controller = windows_webview.WinWebViewController(
        params: windows_webview.WindowsWebViewControllerCreationParams(
          userDataFolder:
              _store.profileDirectory(widget.accountId).absolute.path,
          suspendDuringDeactive: false,
          useTopLevelWindowHost: true,
        ),
      );
      await controller.setJavaScriptMode(
        mobile_webview.JavaScriptMode.unrestricted,
      );
      await controller.setBackgroundColor(const Color(0xFF101114));
      controller.onWebMessageReceived = (message) {
        unawaited(_handleAuthMessage(message));
      };
      await controller.addScriptToExecuteOnDocumentCreated(
        _chatGptAuthProbeScript,
      );
      await controller.setNavigationDelegate(
        windows_webview.WinNavigationDelegate(
          onNavigationRequest: (request) {
            return isAllowedChatGptAuthNavigation(request.url)
                ? mobile_webview.NavigationDecision.navigate
                : mobile_webview.NavigationDecision.prevent;
          },
          onPageFinished: (_) {
            unawaited(controller.runJavaScript(
              'window.__langbaiProbeChatGptSession && '
              'window.__langbaiProbeChatGptSession();',
            ));
          },
          onWebResourceError: (error) {
            if (mounted) {
              setState(() => _error = error.description);
            }
          },
        ),
      );
      if (widget.clearSession) {
        await controller.clearCookies();
        await controller.clearLocalStorage();
        await controller.clearCache();
        if (widget.closeAfterClear) {
          await _store.writeState(previous.copyWith(status: 'signed_out'));
          await controller.dispose();
          exit(0);
        }
      }
      _controller = controller;
      await controller.loadRequest(Uri.parse('https://chatgpt.com/'));
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _ready = true);
    } catch (error) {
      final previous = await _store.readState(widget.accountId);
      await _store.writeState(previous.copyWith(status: 'error'));
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _handleAuthMessage(dynamic rawMessage) async {
    try {
      final decoded =
          rawMessage is String ? jsonDecode(rawMessage) : rawMessage;
      if (decoded is! Map || decoded['langbaiChatGptAuth'] != 1) return;
      final previous = await _store.readState(widget.accountId);
      final incomingStatus = sanitizeChatGptAuthStatus(decoded['status']);
      final status = incomingStatus == 'signed_out' && !widget.closeAfterClear
          ? 'waiting_for_user'
          : incomingStatus;
      if (status == 'ready') {
        final sessionJson = decoded['session_json']?.toString() ?? '';
        if (sessionJson.isEmpty) {
          throw const FormatException(
            'ChatGPT session token was not returned by the login page.',
          );
        }
        await _chatGptMultiAccountStore.importSession(
          sessionJson,
          preferredLocalAccountId: widget.accountId,
        );
      }
      final record = ChatGptAccountRecord.fromJson(
        <String, Object?>{
          'local_account_id': widget.accountId,
          'display_name': decoded['display_name'],
          'masked_email': decoded['masked_email'],
          'plan_label': decoded['plan_label'],
          'last_verified_at':
              status == 'ready' ? DateTime.now().toUtc().toIso8601String() : '',
          'status': status,
        },
        expectedAccountId: widget.accountId,
      ).copyWith(
        displayName: status == 'ready' ? null : previous.displayName,
        maskedEmail: status == 'ready' ? null : previous.maskedEmail,
        planLabel: status == 'ready' ? null : previous.planLabel,
        lastVerifiedAt: status == 'ready' ? null : previous.lastVerifiedAt,
      );
      await _store.writeState(record);
      if (mounted) {
        setState(() {
          _sessionReady = status == 'ready';
          _error =
              status == 'protocol_changed' ? 'ChatGPT 登录状态协议发生变化，请更新软件。' : null;
        });
      }
      if (status == 'ready') {
        await Future<void>.delayed(const Duration(milliseconds: 350));
        await _controller?.dispose();
        exit(0);
      }
    } catch (_) {
      final previous = await _store.readState(widget.accountId);
      await _store.writeState(previous.copyWith(status: 'protocol_changed'));
      if (mounted) {
        setState(() => _error = '登录状态解析失败，请更新软件后重试。');
      }
    }
  }

  @override
  void dispose() {
    final controller = _controller;
    unawaited(() async {
      if (controller != null) await controller.dispose();
      final current = await _store.readState(widget.accountId);
      if (current.status != 'ready' && current.status != 'signed_out') {
        await _store.writeState(current.copyWith(status: 'closed'));
      }
    }());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF101114),
      appBar: AppBar(
        backgroundColor: const Color(0xFF17191D),
        title: const Text('登录 ChatGPT 官方账号'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Center(
              child: Text(
                _sessionReady ? '已验证，可以关闭窗口' : '仅在官方页面完成登录',
                style: TextStyle(
                  color: _sessionReady
                      ? const Color(0xFF6FE7B7)
                      : const Color(0xFFB9BEC8),
                ),
              ),
            ),
          ),
        ],
      ),
      body: _error != null
          ? Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFFFF8E9E)),
                  ),
                ),
              ),
            )
          : !_ready || _controller == null
              ? const Center(child: CircularProgressIndicator())
              : windows_webview.WinWebViewWidget(controller: _controller!),
    );
  }
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
const int _nativeFetchBridgeChunkSize = 192 * 1024;

class _NativeFetchTransfer {
  _NativeFetchTransfer(this.bytes) : createdAt = DateTime.now();

  final Uint8List bytes;
  final DateTime createdAt;
}

final Map<String, _NativeFetchTransfer> _nativeFetchTransfers =
    <String, _NativeFetchTransfer>{};

void _cleanupNativeFetchTransfers() {
  final cutoff = DateTime.now().subtract(const Duration(minutes: 10));
  _nativeFetchTransfers.removeWhere(
    (_, transfer) => transfer.createdAt.isBefore(cutoff),
  );
}

Map<String, Object?> _readNativeFetchChunk(Map<String, dynamic> payload) {
  final transferId = payload['transferId']?.toString() ?? '';
  final transfer = _nativeFetchTransfers[transferId];
  if (transfer == null) {
    throw PlatformException(
      code: 'missing_fetch_transfer',
      message: 'Image transfer has expired. Please reload the image.',
    );
  }
  final offset = int.tryParse(payload['offset']?.toString() ?? '') ?? 0;
  if (offset < 0 || offset > transfer.bytes.length) {
    throw PlatformException(
      code: 'invalid_fetch_offset',
      message: 'Image transfer offset is invalid.',
    );
  }
  final requested = int.tryParse(payload['length']?.toString() ?? '') ??
      _nativeFetchBridgeChunkSize;
  final length = requested.clamp(1, _nativeFetchBridgeChunkSize).toInt();
  final end = (offset + length).clamp(offset, transfer.bytes.length).toInt();
  return <String, Object?>{
    'base64': base64Encode(transfer.bytes.sublist(offset, end)),
    'nextOffset': end,
    'done': end >= transfer.bytes.length,
  };
}

bool _releaseNativeFetchTransfer(Map<String, dynamic> payload) {
  final transferId = payload['transferId']?.toString() ?? '';
  return _nativeFetchTransfers.remove(transferId) != null;
}

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
    if (responseType == 'chunkedBase64') {
      _cleanupNativeFetchTransfers();
      final transferId =
          'fetch_${DateTime.now().microsecondsSinceEpoch}_${responseBytes.length}';
      _nativeFetchTransfers[transferId] = _NativeFetchTransfer(responseBytes);
      result['transferId'] = transferId;
      result['byteLength'] = responseBytes.length;
      result['chunkSize'] = _nativeFetchBridgeChunkSize;
    } else if (responseType == 'base64') {
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
        case 'getChatGptAccounts':
          result = await _chatGptAccountSnapshot();
          break;
        case 'importChatGptSession':
          result = await _importChatGptSession(payload);
          break;
        case 'selectChatGptAccount':
        case 'activateChatGptAccount':
          result = await _selectChatGptAccount(payload);
          break;
        case 'deleteChatGptAccount':
          result = await _deleteChatGptAccount(payload);
          break;
        case 'setChatGptAutoSwitch':
          result = await _setChatGptAutoSwitch(payload);
          break;
        case 'rotateChatGptAccount':
          result = await _rotateChatGptAccount(payload);
          break;
        case 'openChatGptSessionPage':
          result = await _openSystemExternalUrl(
            'https://chatgpt.com/api/auth/session',
          );
          break;
        case 'loadCodexImageGatewayConfig':
          result = await _loadChatGptImageGatewayConfig();
          break;
        case 'loadGeminiWebGatewayConfig':
          result = await _loadGeminiWebGatewayConfig();
          break;
        case 'getGeminiAccounts':
          result = await _geminiWebGateway.accountsSnapshot();
          break;
        case 'selectGeminiAccount':
          result = await _selectGeminiAccount(payload);
          break;
        case 'deleteGeminiAccount':
          result = await _deleteGeminiAccount(payload);
          break;
        case 'setGeminiAutoSwitch':
          result = await _setGeminiAutoSwitch(payload);
          break;
        case 'openGeminiWebLogin':
          result = await _openGeminiWebLogin(payload);
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
        case 'nativeFetchBlobChunk':
          result = _readNativeFetchChunk(payload);
          break;
        case 'nativeFetchBlobRelease':
          result = _releaseNativeFetchTransfer(payload);
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

  Future<void> _handleGeminiEmbeddedEvent(
    Map<String, Object?> event,
  ) async {
    _applyGeminiEmbeddedHostEvent(event);
    await _controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onGeminiLoginState && '
      'window.AiGenAndroidBridge.onGeminiLoginState(${jsonEncode(event)});',
    );
    if (event['login_ready'] == true || event['status'] == 'ready') {
      final snapshot = await _geminiWebGateway.accountsSnapshot();
      await _controller.runJavaScript(
        'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onGeminiAccountChanged && '
        'window.AiGenAndroidBridge.onGeminiAccountChanged(${jsonEncode(snapshot)});',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _appBackground,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            mobile_webview.WebViewWidget(controller: _controller),
            GeminiMobileEmbeddedBrowser(
              requestController: _geminiEmbeddedBrowserRequestController,
              loadConfig: _loadGeminiEmbeddedBrowserConfig,
              onEvent: _handleGeminiEmbeddedEvent,
            ),
          ],
        ),
      ),
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

String collisionSafeFileName(
  String desiredName,
  bool Function(String candidate) exists,
) {
  if (!exists(desiredName)) return desiredName;
  final dot = desiredName.lastIndexOf('.');
  final hasExtension = dot > 0;
  final stem = hasExtension ? desiredName.substring(0, dot) : desiredName;
  final extension = hasExtension ? desiredName.substring(dot) : '';
  var copy = 1;
  while (true) {
    final candidate = '$stem（$copy）$extension';
    if (!exists(candidate)) return candidate;
    copy++;
  }
}

class _WindowsFileTransfer {
  _WindowsFileTransfer({
    required this.tempFile,
    required this.kind,
    required this.fileName,
    required this.folder,
  });

  final File tempFile;
  final String kind;
  final String fileName;
  final String folder;
  int bytesWritten = 0;
}

class _WindowsWebShellState extends State<WindowsWebShell>
    with WidgetsBindingObserver {
  windows_webview.WinWebViewController? _controller;
  final _pendingFileTransfers = <String, _WindowsFileTransfer>{};
  final ChatGptAccountStore _chatGptAccountStore = ChatGptAccountStore();

  bool _isReady = false;
  bool _isWindowSizeDegenerate = false;
  bool _trustedWindowsDocument = false;
  bool _isRebuildingWebView = false;
  bool _geminiBrowserVisible = false;
  int _webViewGeneration = 0;
  int _failedHealthChecks = 0;
  Timer? _webViewHealthTimer;
  Timer? _chatGptAuthTimer;
  String? _chatGptAccountId;
  String? _lastChatGptAuthFingerprint;
  bool _openingChatGptAuthWindow = false;
  String? _windowsIndexUrl;
  String? _errorTitle;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initializeWebView());
    unawaited(_initializeChatGptAuthMonitor());
  }

  Future<void> _initializeChatGptAuthMonitor() async {
    final account = await _chatGptAccountStore.ensurePrimaryAccount();
    _chatGptAccountId = account.localAccountId;
    await _publishChatGptAuthState(force: true);
    _chatGptAuthTimer?.cancel();
    _chatGptAuthTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => unawaited(_publishChatGptAuthState()),
    );
  }

  Future<Map<String, String>> _currentChatGptAuthState() async {
    final accountId = _chatGptAccountId ??
        (await _chatGptAccountStore.ensurePrimaryAccount()).localAccountId;
    _chatGptAccountId = accountId;
    return (await _chatGptAccountStore.readState(accountId)).toJson();
  }

  Future<void> _publishChatGptAuthState({bool force = false}) async {
    final state = await _currentChatGptAuthState();
    final fingerprint = jsonEncode(state);
    if (!force && fingerprint == _lastChatGptAuthFingerprint) return;
    final controller = _controller;
    if (controller == null || !_trustedWindowsDocument) return;
    await controller.runJavaScript(
      'window.AiGenChatGptAuth && '
      'window.AiGenChatGptAuth.onState(${jsonEncode(state)});',
    );
    _lastChatGptAuthFingerprint = fingerprint;
  }

  Future<Map<String, String>> _openChatGptAuthWindow({
    required bool clearSession,
    bool closeAfterClear = false,
  }) async {
    if (_openingChatGptAuthWindow) return _currentChatGptAuthState();
    _openingChatGptAuthWindow = true;
    try {
      final accountId = _chatGptAccountId ??
          (await _chatGptAccountStore.ensurePrimaryAccount()).localAccountId;
      _chatGptAccountId = accountId;
      final previous = await _chatGptAccountStore.readState(accountId);
      await _chatGptAccountStore.writeState(previous.copyWith(
        status: closeAfterClear ? 'signed_out' : 'opening_login',
      ));
      final arguments = <String>[
        '--chatgpt-auth-window',
        '--chatgpt-account-id=$accountId',
        if (clearSession) '--chatgpt-auth-clear-session',
        if (closeAfterClear) '--chatgpt-auth-close-after-clear',
      ];
      await Process.start(
        Platform.resolvedExecutable,
        arguments,
        mode: ProcessStartMode.detached,
      );
      await _publishChatGptAuthState(force: true);
      return _currentChatGptAuthState();
    } finally {
      _openingChatGptAuthWindow = false;
    }
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
      final controller = _controller;
      if (controller != null) {
        unawaited(() async {
          await controller.setVisibility(!degenerate && !_geminiBrowserVisible);
          if (!degenerate && !_geminiBrowserVisible) {
            await controller.requestFocus();
          }
        }()
            .catchError((Object error) {
          debugPrint('Cannot update Windows WebView visibility: $error');
        }));
      }
    }
  }

  Future<void> _initializeWebView() async {
    final generation = ++_webViewGeneration;
    windows_webview.WinWebViewController? controller;
    try {
      controller = windows_webview.WinWebViewController(
        params: windows_webview.WindowsWebViewControllerCreationParams(
          userDataFolder: _windowsWebViewDataPath(),
          suspendDuringDeactive: false,
          useTopLevelWindowHost: true,
        ),
      );
      await controller.setJavaScriptMode(
        mobile_webview.JavaScriptMode.unrestricted,
      );
      await controller.setBackgroundColor(_appBackground);
      controller.onWebMessageReceived = (message) {
        unawaited(_handleWindowsBridgeMessage(message));
      };
      await controller
          .addScriptToExecuteOnDocumentCreated(_windowsBridgeScript);
      controller.onProcessFailed = (kind) {
        if (generation == _webViewGeneration) {
          unawaited(_recoverWindowsWebView('WebView2 process failed ($kind)'));
        }
      };
      await controller.setNavigationDelegate(
        windows_webview.WinNavigationDelegate(
          onNavigationRequest: _handleWindowsNavigationRequest,
          onPageStarted: (url) {
            if (generation == _webViewGeneration) {
              _trustedWindowsDocument = _isTrustedWindowsUrl(url);
            }
          },
          onPageFinished: (url) {
            if (generation != _webViewGeneration) return;
            _trustedWindowsDocument = _isTrustedWindowsUrl(url);
            if (_trustedWindowsDocument) {
              _failedHealthChecks = 0;
              unawaited(_syncWindowsDownloadDirs());
              unawaited(controller!.requestFocus());
              if (_windowsWebViewSelfTest) {
                unawaited(_runWindowsWebViewSelfTest(controller));
              }
              if (_windowsWebViewInputSelfTest) {
                unawaited(_prepareWindowsWebViewInputSelfTest(controller));
              }
            }
          },
          onUrlChange: (change) {
            final url = change.url;
            if (generation == _webViewGeneration && url != null) {
              _trustedWindowsDocument = _isTrustedWindowsUrl(url);
            }
          },
          onWebResourceError: (error) {
            debugPrint(
                'Windows WebView navigation error: ${error.description}');
          },
        ),
      );

      final indexFile = _windowsAssetFile('index.html');
      if (!indexFile.existsSync()) {
        throw PlatformException(
          code: 'missing_asset',
          message: '找不到内置页面资源：${indexFile.path}',
        );
      }

      _windowsIndexUrl = Uri.file(indexFile.path).toString();
      _trustedWindowsDocument = true;
      _controller = controller;
      await controller.loadRequest(Uri.parse(_windowsIndexUrl!));
      if (generation != _webViewGeneration) {
        await controller.dispose();
        return;
      }
      if (!mounted) return;
      setState(() {
        _isReady = true;
        _errorTitle = null;
        _errorMessage = null;
      });
      _startWindowsWebViewHealthChecks();
    } on Object catch (error) {
      if (controller != null) await controller.dispose();
      if (generation == _webViewGeneration) _controller = null;
      if (!mounted) return;
      setState(() {
        _errorTitle = 'Windows WebView 启动失败';
        _errorMessage = error.toString();
      });
    }
  }

  String _windowsWebViewDataPath() {
    final localAppData = Platform.environment['LOCALAPPDATA'];
    if (localAppData == null || localAppData.trim().isEmpty) {
      throw const FileSystemException('LOCALAPPDATA is unavailable.');
    }
    return [
      localAppData,
      'flutter_webview_windows',
      'ai_image_generator',
    ].join(Platform.pathSeparator);
  }

  Future<mobile_webview.NavigationDecision> _handleWindowsNavigationRequest(
    mobile_webview.NavigationRequest request,
  ) async {
    final url = request.url;
    if (_isTrustedWindowsUrl(url) || url == 'about:blank') {
      return mobile_webview.NavigationDecision.navigate;
    }
    if (_isExternalHttpUrl(url)) await _openSystemExternalUrl(url);
    return mobile_webview.NavigationDecision.prevent;
  }

  void _startWindowsWebViewHealthChecks() {
    if (_windowsWebViewSelfTest) return;
    _webViewHealthTimer?.cancel();
    _webViewHealthTimer = Timer.periodic(
      const Duration(seconds: 20),
      (_) => unawaited(_checkWindowsWebViewHealth()),
    );
  }

  Future<void> _runWindowsWebViewSelfTest(
    windows_webview.WinWebViewController controller,
  ) async {
    try {
      final result = await controller.runJavaScriptReturningResult(r'''
(() => Boolean(
  window.__AI_GEN_APP_READY === true &&
  window.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW === true &&
  window.__AI_GEN_NATIVE_PLATFORM === "windows" &&
  window.FlutterDownload &&
  typeof window.FlutterDownload.postMessage === "function" &&
  (() => {
    const settingsButton = document.querySelector('#settingsBtn');
    const settingsModal = document.querySelector('#settingsModal');
    const closeSettings = document.querySelector('#closeSettings');
    const comicButton = document.querySelector('[data-mode="comic"]');
    const comicPanel = document.querySelector('#comicPanelSection');
    const languageButton = document.querySelector('#languageMenuButton');
    const languageMenu = document.querySelector('#languageMenu');
    const themeButton = document.querySelector('#themeToggle');
    if (!settingsButton || !settingsModal || !closeSettings || !comicButton ||
        !comicPanel || !languageButton || !languageMenu || !themeButton) return false;
    settingsButton.click();
    const settingsOpened = !settingsModal.classList.contains('hidden');
    closeSettings.click();
    comicButton.click();
    const comicOpened = comicButton.classList.contains('active') &&
      !comicPanel.classList.contains('hidden');
    languageButton.click();
    const languageOpened = !languageMenu.classList.contains('hidden');
    const themeBefore = document.documentElement.getAttribute('data-theme');
    themeButton.click();
    const themeChanged = document.documentElement.getAttribute('data-theme') !== themeBefore;
    return settingsOpened && comicOpened && languageOpened && themeChanged;
  })()
))()
''').timeout(const Duration(seconds: 10));
      exit(result == true || result.toString() == 'true' ? 0 : 3);
    } catch (error) {
      debugPrint('Windows WebView self-test failed: $error');
      exit(4);
    }
  }

  Future<void> _prepareWindowsWebViewInputSelfTest(
    windows_webview.WinWebViewController controller,
  ) async {
    try {
      await controller.runJavaScript(r'''
(() => {
  const button = document.querySelector('#settingsBtn');
  const modal = document.querySelector('#settingsModal');
  if (!button || !modal || !window.chrome?.webview) return;
  button.style.cssText += ';position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;visibility:visible!important;pointer-events:auto!important;opacity:0.02!important;';
  let trustedPointerDown = false;
  button.addEventListener('pointerdown', event => {
    trustedPointerDown = event.isTrusted === true;
    window.chrome.webview.postMessage({ id: '', action: 'inputSelfTestEvent', phase: 'pointerdown', trusted: event.isTrusted === true });
  }, { capture: true });
  button.addEventListener('click', event => {
    window.chrome.webview.postMessage({ id: '', action: 'inputSelfTestEvent', phase: 'click', trusted: event.isTrusted === true });
    setTimeout(() => {
      if (event.isTrusted === true && trustedPointerDown && window.__AI_GEN_APP_READY === true && !modal.classList.contains('hidden')) {
        window.chrome.webview.postMessage({ id: '', action: 'inputSelfTestPassed' });
      }
    }, 100);
  }, { capture: true });
  window.__AI_GEN_WINDOWS_INPUT_TEST_READY = true;
})()
''');
      await File(
        '${Directory.systemTemp.path}${Platform.pathSeparator}langbai_webview_input_ready.flag',
      ).writeAsString('ready', flush: true);
    } catch (error) {
      debugPrint('Windows WebView input self-test setup failed: $error');
      exit(5);
    }
  }

  Future<void> _checkWindowsWebViewHealth() async {
    final controller = _controller;
    if (controller == null ||
        !_isReady ||
        _isWindowSizeDegenerate ||
        _isRebuildingWebView) {
      return;
    }
    try {
      final result = await controller
          .runJavaScriptReturningResult('1')
          .timeout(const Duration(seconds: 8));
      if (result.toString() != '1') {
        throw StateError('unexpected health result: $result');
      }
      _failedHealthChecks = 0;
    } catch (error) {
      _failedHealthChecks++;
      debugPrint('Windows WebView health check failed: $error');
      if (_failedHealthChecks >= 2) {
        await _recoverWindowsWebView('WebView2 stopped responding');
      }
    }
  }

  Future<void> _recoverWindowsWebView(String reason) async {
    if (_isRebuildingWebView || !mounted) return;
    _isRebuildingWebView = true;
    _webViewHealthTimer?.cancel();
    final staleController = _controller;
    _controller = null;
    _trustedWindowsDocument = false;
    if (mounted) setState(() => _isReady = false);
    try {
      if (staleController != null) await staleController.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 250));
      await _initializeWebView();
      debugPrint('Windows WebView recovered: $reason');
    } catch (error) {
      debugPrint('Windows WebView recovery failed: $error');
    } finally {
      _isRebuildingWebView = false;
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

  Future<void> _handleWindowsBridgeMessage(dynamic rawMessage) async {
    if (!_trustedWindowsDocument) return;
    final payload = _decodeBridgePayload(rawMessage);
    if (payload == null) return;

    final id = payload['id']?.toString() ?? '';
    final action = payload['action']?.toString() ?? '';
    try {
      Object? result;
      switch (action) {
        case 'inputSelfTestEvent':
          if (!_windowsWebViewInputSelfTest) {
            throw PlatformException(
              code: 'forbidden_action',
              message: 'Input self-test is not enabled.',
            );
          }
          await File(
            '${Directory.systemTemp.path}${Platform.pathSeparator}langbai_webview_input_event.json',
          ).writeAsString(jsonEncode(payload), flush: true);
          result = true;
          break;
        case 'inputSelfTestPassed':
          if (!_windowsWebViewInputSelfTest) {
            throw PlatformException(
              code: 'forbidden_action',
              message: 'Input self-test is not enabled.',
            );
          }
          exit(0);
        case 'saveSecret':
        case 'loadSecret':
        case 'deleteSecret':
          result = await _handleSecretAction(action, payload);
          break;
        case 'getChatGptAccounts':
          result = await _chatGptAccountSnapshot();
          break;
        case 'importChatGptSession':
          result = await _importChatGptSession(payload);
          break;
        case 'selectChatGptAccount':
        case 'activateChatGptAccount':
          result = await _selectChatGptAccount(payload);
          break;
        case 'deleteChatGptAccount':
          result = await _deleteChatGptAccount(payload);
          break;
        case 'setChatGptAutoSwitch':
          result = await _setChatGptAutoSwitch(payload);
          break;
        case 'rotateChatGptAccount':
          result = await _rotateChatGptAccount(payload);
          break;
        case 'openChatGptSessionPage':
          result = await _openSystemExternalUrl(
            'https://chatgpt.com/api/auth/session',
          );
          break;
        case 'loadCodexImageGatewayConfig':
          result = await _loadChatGptImageGatewayConfig();
          break;
        case 'loadGeminiWebGatewayConfig':
          result = await _loadGeminiWebGatewayConfig();
          break;
        case 'getGeminiAccounts':
          result = await _geminiWebGateway.accountsSnapshot();
          break;
        case 'selectGeminiAccount':
          result = await _selectGeminiAccount(payload);
          break;
        case 'deleteGeminiAccount':
          result = await _deleteGeminiAccount(payload);
          break;
        case 'setGeminiAutoSwitch':
          result = await _setGeminiAutoSwitch(payload);
          break;
        case 'openGeminiWebLogin':
          result = await _openGeminiWebLogin(payload);
          break;
        case 'getChatGptAuthState':
          result = await _currentChatGptAuthState();
          break;
        case 'openChatGptLogin':
          result = await _openChatGptAuthWindow(clearSession: false);
          break;
        case 'reloginChatGpt':
          result = await _openChatGptAuthWindow(clearSession: true);
          break;
        case 'logoutChatGpt':
          result = await _openChatGptAuthWindow(
            clearSession: true,
            closeAfterClear: true,
          );
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
        case 'saveFileBegin':
          result = await _beginWindowsFileTransfer(payload);
          break;
        case 'saveFileChunk':
          result = await _appendWindowsFileTransfer(payload);
          break;
        case 'saveFileCommit':
          result = await _commitWindowsFileTransfer(payload);
          break;
        case 'saveFileAbort':
          result = await _abortWindowsFileTransfer(
            payload['transferId']?.toString() ?? '',
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
        case 'nativeFetchBlobChunk':
          result = _readNativeFetchChunk(payload);
          break;
        case 'nativeFetchBlobRelease':
          result = _releaseNativeFetchTransfer(payload);
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
    final encodedValue = encoded.trim();
    if (encodedValue.isEmpty) {
      throw PlatformException(
        code: 'empty_file',
        message: 'Cannot save an empty file.',
      );
    }
    late final Uint8List bytes;
    try {
      bytes = base64Decode(encodedValue);
    } on FormatException {
      throw PlatformException(
        code: 'invalid_data',
        message: 'Invalid base64 file data.',
      );
    }
    return _saveWindowsBytes(kind, fileName, bytes, folder);
  }

  Future<Directory> _resolveWindowsSaveDirectory(
    String kind,
    String folder,
  ) async {
    final baseDir = await _ensureWindowsDownloadDir(kind);
    var dir = baseDir;
    final trimmedFolder = folder.trim();
    if (trimmedFolder.isNotEmpty) {
      final safeParts = trimmedFolder
          .split(RegExp(r'[/\\]+'))
          .map(_sanitizeWindowsFileName)
          .where((part) => part.isNotEmpty && part != '.' && part != '..')
          .toList(growable: false);
      if (safeParts.isNotEmpty) {
        dir = [baseDir, ...safeParts].join(Platform.pathSeparator);
        await Directory(dir).create(recursive: true);
      }
    }
    return Directory(dir);
  }

  Future<String> _saveWindowsBytes(
    String kind,
    String fileName,
    List<int> bytes, [
    String folder = '',
  ]) async {
    if (bytes.isEmpty) {
      throw PlatformException(
        code: 'empty_file',
        message: 'Cannot save an empty file.',
      );
    }
    final directory = await _resolveWindowsSaveDirectory(kind, folder);
    final safeName = _sanitizeWindowsFileName(fileName);
    final uniqueName = collisionSafeFileName(
      safeName,
      (candidate) => File([
        directory.path,
        candidate,
      ].join(Platform.pathSeparator))
          .existsSync(),
    );
    final file = File([
      directory.path,
      uniqueName,
    ].join(Platform.pathSeparator));
    final partial = File('${file.path}.part');
    try {
      if (await partial.exists()) await partial.delete();
      await partial.writeAsBytes(bytes, flush: true);
      if (!await partial.exists() || await partial.length() != bytes.length) {
        throw PlatformException(
          code: 'incomplete_write',
          message: 'Saved file size does not match the source data.',
        );
      }
      await partial.rename(file.path);
      if (!await file.exists() || await file.length() != bytes.length) {
        throw PlatformException(
          code: 'incomplete_write',
          message: 'Final file size does not match the verified partial file.',
        );
      }
      return file.path;
    } catch (_) {
      if (await partial.exists()) await partial.delete();
      rethrow;
    }
  }

  String _windowsTransferId(Map<String, dynamic> payload) {
    final id = payload['transferId']?.toString() ?? '';
    if (!RegExp(r'^file_[A-Za-z0-9_-]{1,120}$').hasMatch(id)) {
      throw PlatformException(
        code: 'invalid_transfer',
        message: 'Invalid file transfer id.',
      );
    }
    return id;
  }

  Future<bool> _beginWindowsFileTransfer(Map<String, dynamic> payload) async {
    final id = _windowsTransferId(payload);
    await _abortWindowsFileTransfer(id);
    final tempFile = File([
      Directory.systemTemp.path,
      'ai-image-generator-$id.part',
    ].join(Platform.pathSeparator));
    await tempFile.parent.create(recursive: true);
    await tempFile.writeAsBytes(const <int>[], flush: true);
    _pendingFileTransfers[id] = _WindowsFileTransfer(
      tempFile: tempFile,
      kind: payload['kind']?.toString() ?? 'images',
      fileName: payload['fileName']?.toString() ?? 'download.bin',
      folder: payload['folder']?.toString() ?? '',
    );
    return true;
  }

  Future<int> _appendWindowsFileTransfer(Map<String, dynamic> payload) async {
    final id = _windowsTransferId(payload);
    final transfer = _pendingFileTransfers[id];
    if (transfer == null) {
      throw PlatformException(
        code: 'missing_transfer',
        message: 'File transfer was not started.',
      );
    }
    final encoded = payload['chunk']?.toString() ?? '';
    if (encoded.isEmpty || encoded.length > 384 * 1024) {
      throw PlatformException(
        code: 'invalid_chunk',
        message: 'File chunk is empty or too large.',
      );
    }
    late final Uint8List bytes;
    try {
      bytes = base64Decode(encoded);
    } on FormatException {
      throw PlatformException(
        code: 'invalid_chunk',
        message: 'File chunk is not valid base64.',
      );
    }
    if (bytes.isEmpty) {
      throw PlatformException(
        code: 'empty_chunk',
        message: 'Decoded file chunk is empty.',
      );
    }
    await transfer.tempFile.writeAsBytes(
      bytes,
      mode: FileMode.append,
      flush: true,
    );
    transfer.bytesWritten += bytes.length;
    return transfer.bytesWritten;
  }

  Future<String> _commitWindowsFileTransfer(
    Map<String, dynamic> payload,
  ) async {
    final id = _windowsTransferId(payload);
    final transfer = _pendingFileTransfers.remove(id);
    if (transfer == null) {
      throw PlatformException(
        code: 'missing_transfer',
        message: 'File transfer was not started.',
      );
    }
    try {
      final length = await transfer.tempFile.length();
      if (length <= 0 || length != transfer.bytesWritten) {
        throw PlatformException(
          code: 'incomplete_transfer',
          message: 'File transfer is empty or incomplete.',
        );
      }
      final directory = await _resolveWindowsSaveDirectory(
        transfer.kind,
        transfer.folder,
      );
      final safeName = _sanitizeWindowsFileName(transfer.fileName);
      final uniqueName = collisionSafeFileName(
        safeName,
        (candidate) => File([
          directory.path,
          candidate,
        ].join(Platform.pathSeparator))
            .existsSync(),
      );
      final target = File([
        directory.path,
        uniqueName,
      ].join(Platform.pathSeparator));
      await transfer.tempFile.copy(target.path);
      if (!await target.exists() || await target.length() != length) {
        if (await target.exists()) await target.delete();
        throw PlatformException(
          code: 'incomplete_write',
          message: 'Saved file size does not match the transferred data.',
        );
      }
      return target.path;
    } finally {
      if (await transfer.tempFile.exists()) {
        await transfer.tempFile.delete();
      }
    }
  }

  Future<bool> _abortWindowsFileTransfer(String id) async {
    final transfer = _pendingFileTransfers.remove(id);
    if (transfer != null && await transfer.tempFile.exists()) {
      await transfer.tempFile.delete();
    }
    return true;
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
      // exit(0) bypasses Flutter widget disposal, so dispose() cannot be the
      // only place that stops the bundled gateway. Stop the tracked child and
      // stale copies before Inno Setup starts replacing files.
      await _embeddedChatGptGateway.stopAllForUpdate();
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
    final controller = _controller;
    if (controller == null) return Future<void>.value();
    return controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.setDirs(${jsonEncode(_windowsDownloadDirs())});',
    );
  }

  Future<void> _resolveWindowsJs(String id, Object? result) {
    final controller = _controller;
    if (controller == null) return Future<void>.value();
    return controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.resolve(${jsonEncode(id)}, ${jsonEncode(result)});',
    );
  }

  Future<void> _rejectWindowsJs(String id, String message) {
    final controller = _controller;
    if (controller == null) return Future<void>.value();
    return controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.reject(${jsonEncode(id)}, ${jsonEncode(message)});',
    );
  }

  Future<void> _handleGeminiEmbeddedEvent(
    Map<String, Object?> event,
  ) async {
    _applyGeminiEmbeddedHostEvent(event);
    final controller = _controller;
    if (controller == null) return;
    await controller.runJavaScript(
      'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onGeminiLoginState && '
      'window.AiGenAndroidBridge.onGeminiLoginState(${jsonEncode(event)});',
    );
    if (event['login_ready'] == true || event['status'] == 'ready') {
      final snapshot = await _geminiWebGateway.accountsSnapshot();
      await controller.runJavaScript(
        'window.AiGenAndroidBridge && window.AiGenAndroidBridge.onGeminiAccountChanged && '
        'window.AiGenAndroidBridge.onGeminiAccountChanged(${jsonEncode(snapshot)});',
      );
    }
  }

  void _handleGeminiVisibilityChanged(bool visible) {
    if (_geminiBrowserVisible == visible) return;
    _geminiBrowserVisible = visible;
    final controller = _controller;
    if (controller == null) return;
    unawaited(controller
        .setVisibility(!visible && !_isWindowSizeDegenerate)
        .catchError((Object error) {
      debugPrint('Cannot switch between the app and Gemini WebView: $error');
    }));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _webViewHealthTimer?.cancel();
    _chatGptAuthTimer?.cancel();
    for (final transfer in _pendingFileTransfers.values) {
      unawaited(
          transfer.tempFile.delete().catchError((_) => transfer.tempFile));
    }
    _pendingFileTransfers.clear();
    final controller = _controller;
    unawaited(() async {
      if (controller != null) await controller.dispose();
    }());
    unawaited(_embeddedChatGptGateway.stop());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _appBackground,
      body: Stack(
        fit: StackFit.expand,
        children: [
          _buildBody(),
          GeminiWindowsEmbeddedBrowser(
            requestController: _geminiEmbeddedBrowserRequestController,
            loadConfig: _loadGeminiEmbeddedBrowserConfig,
            onEvent: _handleGeminiEmbeddedEvent,
            onVisibilityChanged: _handleGeminiVisibilityChanged,
            windowSuppressed: _isWindowSizeDegenerate,
          ),
        ],
      ),
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

    final controller = _controller;
    if (!_isReady || controller == null) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF879CFF)),
      );
    }

    if (_isWindowSizeDegenerate) {
      return const SizedBox.shrink();
    }

    return windows_webview.WinWebViewWidget(controller: controller);
  }
}

const _windowsBridgeScript = r'''
(() => {
  const path = location.pathname.replace(/\\/g, "/").toLowerCase();
  if (location.protocol !== "file:" || !path.endsWith("/flutter_assets/index.html")) return;
  window.__AI_GEN_NATIVE_PLATFORM = "windows";
  window.__AI_GEN_SECURE_STORAGE = true;
  window.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW = true;
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
  if (window.__AI_GEN_WINDOWS_LINK_BRIDGE_BOUND) return;
  window.__AI_GEN_WINDOWS_LINK_BRIDGE_BOUND = true;
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

const _chatGptAuthProbeScript = r'''
(() => {
  if (window.__LANGBAI_CHATGPT_AUTH_PROBE_INSTALLED) return;
  window.__LANGBAI_CHATGPT_AUTH_PROBE_INSTALLED = true;

  const postSafeState = (state) => {
    if (!window.chrome || !window.chrome.webview) return;
    window.chrome.webview.postMessage(JSON.stringify({
      langbaiChatGptAuth: 1,
      status: String(state.status || "error"),
      display_name: String(state.display_name || "").slice(0, 96),
      masked_email: String(state.masked_email || "").slice(0, 160),
      plan_label: String(state.plan_label || "").slice(0, 64),
      session_json: typeof state.session_json === "string"
        ? state.session_json.slice(0, 131072)
        : ""
    }));
  };

  const maskEmail = (value) => {
    const text = String(value || "").trim();
    const at = text.lastIndexOf("@");
    if (at <= 0 || at >= text.length - 1) return "";
    const local = text.slice(0, at);
    const domain = text.slice(at + 1);
    return `${local.slice(0, 1)}${"*".repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`;
  };

  const safePlan = (session) => {
    const candidates = [
      session && session.plan,
      session && session.plan_type,
      session && session.user && session.user.plan,
      session && session.account && session.account.plan_type
    ];
    const known = ["free", "plus", "pro", "team", "business", "enterprise"];
    for (const candidate of candidates) {
      const value = String(candidate || "").trim().toLowerCase();
      if (known.includes(value)) return value;
    }
    return "";
  };

  window.__langbaiProbeChatGptSession = async () => {
    if (location.hostname.toLowerCase() !== "chatgpt.com") return;
    postSafeState({ status: "verifying" });
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      if (response.status === 401 || response.status === 403) {
        postSafeState({ status: "signed_out" });
        return;
      }
      if (response.status === 429) {
        postSafeState({ status: "rate_limited" });
        return;
      }
      if (!response.ok) {
        postSafeState({ status: "error" });
        return;
      }
      const session = await response.json();
      if (!session || typeof session !== "object") {
        postSafeState({ status: "protocol_changed" });
        return;
      }
      const user = session.user;
      if (!user || typeof user !== "object") {
        postSafeState({ status: "signed_out" });
        return;
      }
      const expiresAt = Date.parse(String(session.expires || ""));
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        postSafeState({ status: "expired" });
        return;
      }
      postSafeState({
        status: "ready",
        display_name: String(user.name || "我的 ChatGPT"),
        masked_email: maskEmail(user.email),
        plan_label: safePlan(session),
        session_json: JSON.stringify(session)
      });
    } catch (_) {
      postSafeState({ status: "error" });
    }
  };

  if (location.hostname.toLowerCase() === "chatgpt.com") {
    setTimeout(() => window.__langbaiProbeChatGptSession(), 500);
    setInterval(() => window.__langbaiProbeChatGptSession(), 15000);
  }
})();
''';
