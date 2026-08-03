import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/services.dart';

import 'chatgpt_account_store.dart';

class _AndroidChatGptTask {
  _AndroidChatGptTask(this.id)
      : createdAt = DateTime.now().toUtc(),
        updatedAt = DateTime.now().toUtc();

  final String id;
  final DateTime createdAt;
  DateTime updatedAt;
  String status = 'queued';
  bool cancelRequested = false;
  Map<String, Object?>? result;
  Map<String, Object?>? error;

  Map<String, Object?> toJson() {
    final value = <String, Object?>{
      'id': id,
      'status': status,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
    if (result != null) value['result'] = result;
    if (error != null) value['error'] = error;
    return value;
  }
}

class AndroidChatGptGatewayManager {
  AndroidChatGptGatewayManager({
    this.firstPort = 18081,
    this.lastPort = 18100,
    MethodChannel? channel,
  }) : _channel = channel ??
            const MethodChannel(
              'com.aigen.ai_image_generator/chatgpt_gateway',
            );

  final int firstPort;
  final int lastPort;
  final MethodChannel _channel;
  final Map<String, String> _tokens = <String, String>{};
  final Map<String, _AndroidChatGptTask> _tasks =
      <String, _AndroidChatGptTask>{};
  HttpServer? _server;
  Future<Map<String, Object?>>? _startFuture;
  Future<void> _taskQueue = Future<void>.value();
  late String _apiKey;
  int _port = 0;

  Future<Map<String, Object?>> configuration() =>
      _startFuture ??= _startInternal();

  Future<Map<String, Object?>> _startInternal() async {
    if (!Platform.isAndroid) {
      throw const FileSystemException(
        'The Android ChatGPT gateway is available on Android only.',
      );
    }
    _apiKey = _randomSecret();
    for (var port = firstPort; port <= lastPort; port++) {
      try {
        _server = await HttpServer.bind(
          InternetAddress.loopbackIPv4,
          port,
          shared: false,
        );
        _port = port;
        break;
      } on SocketException {
        continue;
      }
    }
    if (_server == null) {
      throw SocketException(
        'No Android loopback gateway port is free in $firstPort-$lastPort.',
      );
    }
    unawaited(_server!.forEach(_handleRequest));
    return <String, Object?>{
      'baseUrl': 'http://127.0.0.1:$_port/v1',
      'apiKey': _apiKey,
      'embedded': true,
      'platform': 'android',
      'port': _port,
    };
  }

  Future<void> setSessionToken(
    String accessToken, {
    required String accountId,
  }) async {
    final id = validateLocalChatGptAccountId(accountId);
    final token = accessToken.trim();
    if (token.isEmpty) throw const FormatException('Access token is empty.');
    _tokens[id] = token;
    await configuration();
  }

  void clearSessionToken({String accountId = ''}) {
    if (accountId.trim().isEmpty) {
      _tokens.clear();
    } else {
      _tokens.remove(accountId.trim());
    }
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
    _port = 0;
    _startFuture = null;
    _tasks.clear();
    _tokens.clear();
  }

  Future<void> _handleRequest(HttpRequest request) async {
    try {
      _addCors(request.response);
      if (request.method == 'OPTIONS') {
        request.response.statusCode = HttpStatus.noContent;
        await request.response.close();
        return;
      }
      final path = request.uri.path;
      if (request.method == 'GET' && path == '/healthz') {
        await _json(request.response, <String, Object?>{
          'status': 'ok',
          'service': 'langbai-chatgpt-web-image-gateway',
          'platform': 'android',
          'session_available': _tokens.isNotEmpty,
        });
        return;
      }
      if (!_isAuthorized(request)) {
        await _error(
          request.response,
          HttpStatus.unauthorized,
          'invalid_api_key',
          'Invalid local Android gateway key.',
        );
        return;
      }
      if (request.method == 'GET' && path == '/v1/image-capabilities') {
        await _json(request.response, <String, Object?>{
          'image_only': true,
          'generations': true,
          'edits': true,
          'async_tasks': true,
          'models': const <String>['gpt-image-2'],
          'max_reference_images': 20,
          'default_concurrency': 5,
          'max_concurrency': 100,
          'dimension_modes': const <String>[
            'native',
            'strict_native',
            'exact_output',
          ],
          'quality_modes': const <String>['low', 'medium', 'high'],
          'session_provider': 'chatgpt-web-android',
        });
        return;
      }
      if (request.method == 'POST' && path == '/v1/image-tasks') {
        await _submit(request);
        return;
      }
      final taskMatch =
          RegExp(r'^/v1/image-tasks/([A-Za-z0-9_-]+)$').firstMatch(path);
      if (request.method == 'GET' && taskMatch != null) {
        final task = _tasks[taskMatch.group(1)];
        if (task == null) {
          await _error(
            request.response,
            HttpStatus.notFound,
            'image_task_not_found',
            'Image task not found.',
          );
        } else {
          await _json(request.response, task.toJson());
        }
        return;
      }
      final cancelMatch = RegExp(
        r'^/v1/image-tasks/([A-Za-z0-9_-]+)/cancel$',
      ).firstMatch(path);
      if (request.method == 'POST' && cancelMatch != null) {
        final task = _tasks[cancelMatch.group(1)];
        if (task == null) {
          await _error(
            request.response,
            HttpStatus.notFound,
            'image_task_not_found',
            'Image task not found.',
          );
        } else {
          task
            ..cancelRequested = true
            ..status = 'cancelled'
            ..updatedAt = DateTime.now().toUtc();
          await _json(request.response, <String, Object?>{
            'id': task.id,
            'status': 'cancelled',
          });
        }
        return;
      }
      await _error(
        request.response,
        HttpStatus.notFound,
        'not_found',
        'Route not found.',
      );
    } catch (error) {
      try {
        await _error(
          request.response,
          HttpStatus.internalServerError,
          'android_gateway_error',
          error.toString(),
        );
      } catch (_) {
        await request.response.close();
      }
    }
  }

  Future<void> _submit(HttpRequest request) async {
    final bodyText = await utf8.decoder.bind(request).join();
    final decoded = jsonDecode(bodyText);
    if (decoded is! Map) {
      await _error(
        request.response,
        HttpStatus.badRequest,
        'invalid_request',
        'Request body must be a JSON object.',
      );
      return;
    }
    final body = decoded.map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final accountId = (body['account_id'] ?? '').toString().trim();
    final token = _tokens[accountId];
    if (token == null || token.isEmpty) {
      await _error(
        request.response,
        HttpStatus.serviceUnavailable,
        'chatgpt_session_missing',
        'The selected ChatGPT account is not connected on Android.',
      );
      return;
    }
    final id =
        'android_webimg_${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 24).toRadixString(16)}';
    final task = _AndroidChatGptTask(id);
    _tasks[id] = task;
    _pruneTasks();
    _taskQueue = _taskQueue
        .catchError((Object _) {})
        .then((_) => _runTask(task, token, jsonEncode(body)));
    await _json(request.response, task.toJson());
  }

  Future<void> _runTask(
    _AndroidChatGptTask task,
    String token,
    String bodyJson,
  ) async {
    if (task.cancelRequested) return;
    task
      ..status = 'running'
      ..updatedAt = DateTime.now().toUtc();
    try {
      final raw = await _channel.invokeMethod<String>(
        'generate',
        <String, String>{
          'accessToken': token,
          'bodyJson': bodyJson,
        },
      );
      final decoded = jsonDecode(raw ?? '{}');
      if (decoded is! Map) {
        throw const FormatException('Android gateway returned invalid JSON.');
      }
      final mapped = decoded.map(
        (key, value) => MapEntry(key.toString(), value),
      );
      final failure = mapped['__error__'];
      if (task.cancelRequested) {
        task
          ..status = 'cancelled'
          ..result = null
          ..error = null;
      } else if (failure is Map) {
        task
          ..status = 'failed'
          ..error = failure.map(
            (key, value) => MapEntry(key.toString(), value),
          );
      } else {
        task
          ..status = 'succeeded'
          ..result = mapped;
      }
    } catch (error) {
      if (!task.cancelRequested) {
        task
          ..status = 'failed'
          ..error = <String, Object?>{
            'status': 502,
            'type': 'api_error',
            'code': 'android_gateway_error',
            'message': error.toString(),
          };
      }
    } finally {
      task.updatedAt = DateTime.now().toUtc();
    }
  }

  bool _isAuthorized(HttpRequest request) {
    final authorization =
        request.headers.value(HttpHeaders.authorizationHeader) ?? '';
    return authorization == 'Bearer $_apiKey';
  }

  void _pruneTasks() {
    final cutoff = DateTime.now().toUtc().subtract(const Duration(hours: 24));
    _tasks.removeWhere(
      (_, task) =>
          task.updatedAt.isBefore(cutoff) &&
          (task.status == 'succeeded' ||
              task.status == 'failed' ||
              task.status == 'cancelled'),
    );
  }

  void _addCors(HttpResponse response) {
    response.headers
      ..set('Access-Control-Allow-Origin', '*')
      ..set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      ..set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      ..set(HttpHeaders.cacheControlHeader, 'no-store');
  }

  Future<void> _json(
    HttpResponse response,
    Map<String, Object?> body, {
    int status = HttpStatus.ok,
  }) async {
    response
      ..statusCode = status
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(body));
    await response.close();
  }

  Future<void> _error(
    HttpResponse response,
    int status,
    String code,
    String message,
  ) =>
      _json(
        response,
        <String, Object?>{
          'error': <String, Object?>{
            'status': status,
            'type': 'api_error',
            'code': code,
            'message': message,
          },
        },
        status: status,
      );

  String _randomSecret() {
    final random = Random.secure();
    return List<int>.generate(32, (_) => random.nextInt(256))
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
  }
}
