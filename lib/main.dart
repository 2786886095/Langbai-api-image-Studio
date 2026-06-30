import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AiImageGeneratorApp());
}

class AiImageGeneratorApp extends StatelessWidget {
  const AiImageGeneratorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'AI 图片生成器',
      home: WebShell(),
    );
  }
}

class WebShell extends StatefulWidget {
  const WebShell({super.key});

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> with WidgetsBindingObserver {
  static const MethodChannel _downloads =
      MethodChannel('com.aigen.ai_image_generator/downloads');

  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF101310))
      ..setNavigationDelegate(
        NavigationDelegate(onPageFinished: (_) => _syncDownloadDirs()),
      )
      ..addJavaScriptChannel(
        'FlutterDownload',
        onMessageReceived: _handleDownloadMessage,
      )
      ..loadFlutterAsset('index.html');

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(false);
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
    FileSelectorParams params,
  ) async {
    final result = await _downloads.invokeMethod<List<dynamic>>('chooseFiles', {
      'acceptTypes': params.acceptTypes,
      'allowMultiple': params.mode == FileSelectorMode.openMultiple,
    });
    return (result ?? <dynamic>[]).map((item) => item.toString()).toList();
  }

  Future<void> _handleDownloadMessage(JavaScriptMessage message) async {
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
        case 'nativeFetch':
          result = await _nativeFetch(payload);
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
      Map<String, dynamic> payload) async {
    final url = payload['url']?.toString() ?? '';
    final method = payload['method']?.toString().toUpperCase() ?? 'GET';
    final responseType = payload['responseType']?.toString() ?? '';
    final isMultipart = payload['bodyType']?.toString() == 'formData';
    final headers = (payload['headers'] as Map?)
            ?.map((key, value) => MapEntry(key.toString(), value.toString())) ??
        <String, String>{};
    final body = payload['body']?.toString();

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30);
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
      backgroundColor: const Color(0xFF101310),
      body: SafeArea(child: WebViewWidget(controller: _controller)),
    );
  }
}
