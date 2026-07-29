import 'dart:async';
import 'dart:typed_data';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'gemini_account_store.dart';
import 'gemini_image_task.dart';
import 'gemini_size_capabilities.dart';

const String _geminiPairingKeyStorage = 'gemini_web_pairing_key_v1';
const String _geminiActiveAccountStorage = 'gemini_web_active_account_v1';
const int _geminiPortStart = 18160;
const int _geminiPortEnd = 18199;
const int _maxJsonBytes = 80 * 1024 * 1024;
const int _maxImageBytes = 60 * 1024 * 1024;
const Duration _companionLeaseDuration = Duration(seconds: 45);
const String _geminiSelectorPackVersion = '2026.07.29.1';

const Map<String, Set<String>> _geminiStatusTransitions = <String, Set<String>>{
  'queued': <String>{'preparing_temporary_chat'},
  'waiting_for_browser': <String>{'preparing_temporary_chat'},
  'preparing_temporary_chat': <String>{
    'preparing_temporary_chat',
    'uploading_references',
  },
  'uploading_references': <String>{
    'uploading_references',
    'submitting',
  },
  'submitting': <String>{'submitting', 'generating'},
  'generating': <String>{'generating', 'locating_full_size'},
  'locating_full_size': <String>{'locating_full_size'},
};

class GeminiWebGatewayManager {
  GeminiWebGatewayManager(this.secureStorage)
      : accountStore = GeminiAccountStore(secureStorage);

  final FlutterSecureStorage secureStorage;
  final GeminiAccountStore accountStore;
  final Map<String, GeminiImageTask> _tasks = <String, GeminiImageTask>{};
  HttpServer? _server;
  String _pairingKey = '';
  Directory? _root;
  DateTime? _lastCompanionSeen;
  final Map<String, DateTime> _companionProfiles = <String, DateTime>{};
  String _activeAccountId = '';
  int _effectiveConcurrency = 1;
  Future<void> _persistenceChain = Future<void>.value();

  bool get running => _server != null;
  bool get companionConnected =>
      _lastCompanionSeen != null &&
      DateTime.now().difference(_lastCompanionSeen!) <
          const Duration(seconds: 20);
  bool get activeSessionAvailable {
    final seen = _companionProfiles[_activeAccountId];
    return _activeAccountId.isNotEmpty &&
        seen != null &&
        DateTime.now().difference(seen) < const Duration(seconds: 20);
  }

  int get port => _server?.port ?? 0;
  String get baseUrl => 'http://127.0.0.1:$port/v1';

  Future<void> start() async {
    if (_server != null) return;
    _pairingKey = await _loadOrCreatePairingKey();
    _activeAccountId =
        (await secureStorage.read(key: _geminiActiveAccountStorage) ?? '')
            .trim();
    final accountIds =
        (await accountStore.load()).map((account) => account.localAccountId);
    if (_activeAccountId.isNotEmpty && !accountIds.contains(_activeAccountId)) {
      _activeAccountId = '';
    }
    _root = await _resolveRoot();
    await _root!.create(recursive: true);
    await _loadTasks();
    await _pruneExpiredTasks();
    Object? lastError;
    for (var candidate = _geminiPortStart;
        candidate <= _geminiPortEnd;
        candidate++) {
      try {
        _server = await HttpServer.bind(
          InternetAddress.loopbackIPv4,
          candidate,
          shared: false,
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (_server == null) {
      throw StateError(
        'No free Gemini companion port in $_geminiPortStart-$_geminiPortEnd: $lastError',
      );
    }
    unawaited(_serve(_server!));
  }

  Future<void> stop() async {
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }

  Future<Map<String, Object?>> configuration() async {
    await start();
    return <String, Object?>{
      'baseUrl': baseUrl,
      'apiKey': _pairingKey,
      'embedded': true,
      'provider': 'gemini_web',
      'companionConnected': companionConnected,
      'selectorPackVersion': _geminiSelectorPackVersion,
      'accounts': (await accountStore.load())
          .map((account) => account.toJson())
          .toList(),
      'activeAccountId': _activeAccountId,
    };
  }

  Future<Map<String, Object?>> accountsSnapshot() async => <String, Object?>{
        'accounts': (await accountStore.load())
            .map((account) => account.toJson())
            .toList(),
        'active_account_id': _activeAccountId,
        'companion_connected': companionConnected,
      };

  Future<Map<String, Object?>> selectAccount(String id) async {
    final accounts = await accountStore.load();
    if (!accounts.any((account) => account.localAccountId == id)) {
      throw StateError('Gemini account not found');
    }
    _activeAccountId = id;
    await secureStorage.write(
      key: _geminiActiveAccountStorage,
      value: _activeAccountId,
    );
    return accountsSnapshot();
  }

  Future<Map<String, Object?>> deleteAccount(String id) async {
    await accountStore.remove(id);
    if (_activeAccountId == id) {
      _activeAccountId = '';
      await secureStorage.delete(key: _geminiActiveAccountStorage);
    }
    return accountsSnapshot();
  }

  Future<String> _loadOrCreatePairingKey() async {
    final existing =
        (await secureStorage.read(key: _geminiPairingKeyStorage) ?? '').trim();
    if (RegExp(r'^[a-f0-9]{64}$').hasMatch(existing)) return existing;
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    final value = sha256.convert(bytes).toString();
    await secureStorage.write(key: _geminiPairingKeyStorage, value: value);
    return value;
  }

  Future<Directory> _resolveRoot() async {
    final env = Platform.environment;
    String base;
    if (Platform.isWindows) {
      base = env['LOCALAPPDATA'] ?? Directory.systemTemp.path;
    } else if (Platform.isMacOS) {
      base = [
        env['HOME'] ?? Directory.systemTemp.path,
        'Library',
        'Application Support'
      ].join(Platform.pathSeparator);
    } else if (Platform.isLinux) {
      base = env['XDG_DATA_HOME'] ??
          [env['HOME'] ?? Directory.systemTemp.path, '.local', 'share']
              .join(Platform.pathSeparator);
    } else {
      base = Directory.systemTemp.path;
    }
    return Directory([base, 'AI Image Generator', 'gemini_companion']
        .join(Platform.pathSeparator));
  }

  File get _tasksFile =>
      File([_root!.path, 'tasks.json'].join(Platform.pathSeparator));
  Directory get _imagesDirectory =>
      Directory([_root!.path, 'images'].join(Platform.pathSeparator));

  Future<void> _loadTasks() async {
    final file = _tasksFile;
    if (!await file.exists()) return;
    try {
      for (final task
          in GeminiImageTask.decodeList(await file.readAsString())) {
        if (!task.terminal) {
          task.status = 'waiting_for_browser';
          _clearClaim(task);
        }
        _tasks[task.id] = task;
      }
    } catch (_) {
      // A damaged checkpoint is ignored without touching browser sessions.
    }
  }

  Future<void> _persistTasks() async {
    final previous = _persistenceChain;
    final completer = Completer<void>();
    _persistenceChain = completer.future;
    try {
      await previous;
    } catch (_) {
      // A failed write must not permanently poison later persistence calls.
    }
    try {
      await _root!.create(recursive: true);
      final temporary = File(
        '${_tasksFile.path}.${DateTime.now().microsecondsSinceEpoch}.${Random.secure().nextInt(1 << 32)}.part',
      );
      await temporary.writeAsString(
        jsonEncode(
            _tasks.values.map((task) => task.toPersistenceJson()).toList()),
        flush: true,
      );
      if (await _tasksFile.exists()) await _tasksFile.delete();
      await temporary.rename(_tasksFile.path);
    } finally {
      completer.complete();
    }
  }

  String _newClaimId() {
    final random = Random.secure();
    return List<int>.generate(24, (_) => random.nextInt(256))
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
  }

  bool _claimExpired(GeminiImageTask task, DateTime now) =>
      task.claimId.isNotEmpty &&
      (task.claimExpiresAt == null || !task.claimExpiresAt!.isAfter(now));

  void _clearClaim(GeminiImageTask task) {
    task.claimId = '';
    task.claimedAccountId = '';
    task.claimExpiresAt = null;
  }

  bool _claimMatches(
    GeminiImageTask task,
    HttpRequest request,
    Map<String, dynamic>? body,
  ) {
    final claimId = body?['claim_id']?.toString() ??
        request.headers.value('x-langbai-claim-id') ??
        '';
    final accountId = body?['account_id']?.toString() ??
        request.headers.value('x-langbai-account-id') ??
        '';
    return task.claimId.isNotEmpty &&
        task.claimExpiresAt != null &&
        task.claimExpiresAt!.isAfter(DateTime.now().toUtc()) &&
        claimId == task.claimId &&
        accountId.isNotEmpty &&
        accountId == task.accountId &&
        accountId == task.claimedAccountId;
  }

  void _renewClaim(GeminiImageTask task) {
    task.claimExpiresAt = DateTime.now().toUtc().add(_companionLeaseDuration);
    task.updatedAt = DateTime.now().toUtc();
  }

  Future<void> _pruneExpiredTasks() async {
    final cutoff = DateTime.now().toUtc().subtract(const Duration(days: 30));
    final expired =
        _tasks.values.where((task) => task.updatedAt.isBefore(cutoff)).toList();
    for (final task in expired) {
      if (task.resultFile.isNotEmpty) {
        final file = File(task.resultFile);
        if (await file.exists()) {
          try {
            await file.delete();
          } catch (_) {}
        }
      }
      _tasks.remove(task.id);
    }
    if (expired.isNotEmpty) await _persistTasks();
  }

  Future<void> _serve(HttpServer server) async {
    await for (final request in server) {
      unawaited(_handle(request));
    }
  }

  void _cors(HttpResponse response) {
    response.headers
      ..set('Access-Control-Allow-Origin', '*')
      ..set('Access-Control-Allow-Headers',
          'authorization,content-type,x-langbai-account-id,x-langbai-audit')
      ..set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
      ..set('Cache-Control', 'no-store')
      ..set('X-Content-Type-Options', 'nosniff');
  }

  bool _authorized(HttpRequest request) {
    final header = request.headers.value(HttpHeaders.authorizationHeader) ?? '';
    return header == 'Bearer $_pairingKey';
  }

  Future<void> _json(
    HttpResponse response,
    int status,
    Object value,
  ) async {
    _cors(response);
    response.statusCode = status;
    response.headers.contentType = ContentType.json;
    response.write(jsonEncode(value));
    await response.close();
  }

  Future<List<int>> _readBytes(HttpRequest request, int maximum) async {
    final builder = BytesBuilder(copy: false);
    var total = 0;
    await for (final chunk in request) {
      total += chunk.length;
      if (total > maximum) {
        throw const HttpException('payload_too_large');
      }
      builder.add(chunk);
    }
    return builder.takeBytes();
  }

  Future<Map<String, dynamic>> _readJson(HttpRequest request) async {
    final bytes = await _readBytes(request, _maxJsonBytes);
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! Map) throw const FormatException('JSON object required');
    return decoded.map((key, value) => MapEntry(key.toString(), value));
  }

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    _cors(response);
    if (request.method == 'OPTIONS') {
      response.statusCode = HttpStatus.noContent;
      await response.close();
      return;
    }
    final path = request.uri.path;
    try {
      if (path == '/discover' && request.method == 'GET') {
        await _json(response, 200,
            <String, Object?>{'provider': 'gemini_web', 'port': port});
        return;
      }
      if (!_authorized(request)) {
        await _json(response, 401, <String, Object?>{
          'error': <String, Object?>{
            'code': 'invalid_pairing_key',
            'message': 'Gemini companion pairing key is invalid.'
          }
        });
        return;
      }
      if (path == '/healthz' && request.method == 'GET') {
        await _json(response, 200, <String, Object?>{
          'status': 'ok',
          'provider': 'gemini_web',
          'version': '1.6.0',
          'companion_connected': companionConnected,
          'session_available': activeSessionAvailable,
          'temporary_chat_available': companionConnected,
          'fullsize_download_available': companionConnected,
        });
        return;
      }
      if (path == '/v1/capabilities' && request.method == 'GET') {
        await _json(
          response,
          200,
          geminiWebCapabilities(
            companionConnected: companionConnected,
            sessionAvailable: activeSessionAvailable,
            effectiveConcurrency: _effectiveConcurrency,
          ),
        );
        return;
      }
      if (path == '/v1/accounts' && request.method == 'GET') {
        await _json(response, 200, await accountsSnapshot());
        return;
      }
      if (path == '/v1/image-tasks' && request.method == 'POST') {
        final body = await _readJson(request);
        if (body['provider'] != 'geminiWeb' ||
            body['temporary_chat_required'] != true ||
            body['n'] != 1) {
          await _json(response, 400, <String, Object?>{
            'error': <String, Object?>{
              'code': 'invalid_parameters',
              'message':
                  'Gemini tasks require provider=geminiWeb, temporary chat, and n=1.'
            }
          });
          return;
        }
        final registeredAccounts = await accountStore.load();
        if (_activeAccountId.isEmpty ||
            !registeredAccounts.any(
              (account) => account.localAccountId == _activeAccountId,
            )) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_account_required',
              'message':
                  'Select a connected Gemini browser account before submitting.',
            }
          });
          return;
        }
        final requestId = body['client_request_id']?.toString() ?? '';
        final duplicate = _tasks.values
            .where((task) =>
                requestId.isNotEmpty && task.clientRequestId == requestId)
            .firstOrNull;
        if (duplicate != null) {
          await _json(response, 200, duplicate.toJson());
          return;
        }
        final id =
            'gemini_${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 32).toRadixString(16)}';
        final task = GeminiImageTask(
          id: id,
          clientRequestId: requestId,
          request: body,
          status: companionConnected ? 'queued' : 'waiting_for_browser',
          accountId: _activeAccountId,
        );
        _tasks[id] = task;
        await _persistTasks();
        await _json(response, 202, task.toJson());
        return;
      }
      final taskMatch = RegExp(r'^/v1/image-tasks/([^/]+)$').firstMatch(path);
      if (taskMatch != null && request.method == 'GET') {
        final task = _tasks[taskMatch.group(1)];
        if (task == null) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'task_not_found'}
          });
        } else {
          await _json(response, 200, task.toJson());
        }
        return;
      }
      final cancelMatch =
          RegExp(r'^/v1/image-tasks/([^/]+)/cancel$').firstMatch(path);
      if (cancelMatch != null && request.method == 'POST') {
        final task = _tasks[cancelMatch.group(1)];
        if (task == null) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'task_not_found'}
          });
          return;
        }
        if (!task.terminal) {
          task.status = 'cancelled';
          task.updatedAt = DateTime.now().toUtc();
          _clearClaim(task);
          await _persistTasks();
        }
        await _json(response, 200, task.toJson());
        return;
      }
      final fileMatch =
          RegExp(r'^/v1/image-tasks/([^/]+)/files/0$').firstMatch(path);
      if (fileMatch != null && request.method == 'GET') {
        final task = _tasks[fileMatch.group(1)];
        final file = task == null || task.resultFile.isEmpty
            ? null
            : File(task.resultFile);
        if (file == null || !await file.exists()) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'image_not_found'}
          });
          return;
        }
        response.statusCode = 200;
        final headerBytes = await file.openRead(0, 16).fold<List<int>>(
          <int>[],
          (buffer, chunk) => buffer..addAll(chunk),
        );
        response.headers.contentType =
            _detectImageType(headerBytes)?.$1 ?? ContentType.binary;
        response.headers.contentLength = await file.length();
        await response.addStream(file.openRead());
        await response.close();
        return;
      }
      if (path == '/v1/companion/identity' && request.method == 'POST') {
        _lastCompanionSeen = DateTime.now();
        final body = await _readJson(request);
        final profileId = body['browser_profile_id']?.toString() ?? '';
        if (profileId.isEmpty) {
          await _json(response, 400, <String, Object?>{
            'error': <String, Object?>{'code': 'profile_id_required'}
          });
          return;
        }
        final localId = sha256
            .convert(utf8.encode('gemini:$profileId'))
            .toString()
            .substring(0, 32);
        final selectorPackVersion =
            body['selector_pack_version']?.toString() ?? '';
        final selectorPackCompatible =
            selectorPackVersion == _geminiSelectorPackVersion;
        final account = GeminiAccountMetadata(
          localAccountId: localId,
          displayName: body['display_name']?.toString() ?? 'Gemini 浏览器账号',
          maskedEmail: body['masked_email']?.toString() ?? '',
          browserProfileId: profileId,
          platform: body['platform']?.toString() ?? Platform.operatingSystem,
          status: selectorPackCompatible
              ? (body['status']?.toString() ?? 'ready')
              : 'protocol_changed',
          lastVerifiedAt: DateTime.now().toUtc().toIso8601String(),
          temporaryChatAvailable: selectorPackCompatible &&
              body['temporary_chat_available'] == true,
          fullsizeDownloadAvailable: selectorPackCompatible &&
              body['fullsize_download_available'] == true,
          effectiveConcurrency: int.tryParse(
                body['effective_concurrency']?.toString() ?? '',
              ) ??
              1,
          lastError: body['last_error']?.toString() ?? '',
        );
        await accountStore.upsert(account);
        _companionProfiles[localId] = DateTime.now();
        if (_activeAccountId.isEmpty) {
          _activeAccountId = localId;
          await secureStorage.write(
            key: _geminiActiveAccountStorage,
            value: _activeAccountId,
          );
        }
        _effectiveConcurrency = account.effectiveConcurrency.clamp(1, 10);
        await _json(response, 200, <String, Object?>{
          ...await accountsSnapshot(),
          'local_account_id': localId,
          'selector_pack_compatible': selectorPackCompatible,
          'expected_selector_pack_version': _geminiSelectorPackVersion,
        });
        return;
      }
      if (path == '/v1/companion/tasks/next' && request.method == 'GET') {
        _lastCompanionSeen = DateTime.now();
        final accountId = request.headers.value('x-langbai-account-id') ?? '';
        final registeredAccount = (await accountStore.load())
            .where((account) => account.localAccountId == accountId)
            .firstOrNull;
        if (accountId.isEmpty ||
            registeredAccount == null ||
            registeredAccount.status != 'ready' ||
            !registeredAccount.temporaryChatAvailable ||
            !registeredAccount.fullsizeDownloadAvailable) {
          await _json(response, 403, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_account_mismatch',
              'message': 'The browser profile is not a registered account.',
            }
          });
          return;
        }
        final now = DateTime.now().toUtc();
        var reclaimed = false;
        for (final item in _tasks.values.where(
          (item) => !item.terminal && _claimExpired(item, now),
        )) {
          item.status = 'waiting_for_browser';
          item.updatedAt = now;
          _clearClaim(item);
          reclaimed = true;
        }
        if (reclaimed) await _persistTasks();
        final task = _tasks.values
            .where((item) =>
                !item.terminal &&
                <String>{'queued', 'waiting_for_browser'}
                    .contains(item.status) &&
                item.accountId.isNotEmpty &&
                item.accountId == accountId)
            .firstOrNull;
        if (task == null) {
          response.statusCode = HttpStatus.noContent;
          await response.close();
          return;
        }
        task.status = 'preparing_temporary_chat';
        task.claimId = _newClaimId();
        task.claimedAccountId = accountId;
        _renewClaim(task);
        await _persistTasks();
        await _json(response, 200, <String, Object?>{
          ...task.toJson(includeRequest: true),
          'request': task.request,
        });
        return;
      }
      final eventMatch =
          RegExp(r'^/v1/companion/tasks/([^/]+)/events$').firstMatch(path);
      if (eventMatch != null && request.method == 'POST') {
        _lastCompanionSeen = DateTime.now();
        final task = _tasks[eventMatch.group(1)];
        if (task == null) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'task_not_found'}
          });
          return;
        }
        if (task.terminal) {
          await _json(response, 200, task.toJson());
          return;
        }
        final body = await _readJson(request);
        if (!_claimMatches(task, request, body)) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'stale_or_wrong_task_claim',
              'message':
                  'The Gemini task claim is missing, expired, or owned by another account.',
            }
          });
          return;
        }
        final nextStatus = body['status']?.toString() ?? task.status;
        final allowed =
            _geminiStatusTransitions[task.status] ?? const <String>{};
        final terminalTransition = <String>{
          'failed',
          'needs_login',
          'protocol_changed',
          'cancelled',
        }.contains(nextStatus);
        if (!terminalTransition && !allowed.contains(nextStatus)) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'invalid_status_transition',
              'message':
                  'Cannot move Gemini task from ${task.status} to $nextStatus.',
            }
          });
          return;
        }
        task.status = nextStatus;
        _renewClaim(task);
        final error = body['error'];
        if (error is Map) {
          task.error =
              error.map((key, value) => MapEntry(key.toString(), value));
        }
        final audit = body['audit'];
        if (audit is Map) {
          task.audit = audit.map(
            (key, value) => MapEntry(key.toString(), value),
          );
        }
        if (task.terminal) _clearClaim(task);
        await _persistTasks();
        await _json(response, 200, task.toJson());
        return;
      }
      final resultMatch =
          RegExp(r'^/v1/companion/tasks/([^/]+)/result$').firstMatch(path);
      if (resultMatch != null && request.method == 'POST') {
        _lastCompanionSeen = DateTime.now();
        final task = _tasks[resultMatch.group(1)];
        if (task == null) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'task_not_found'}
          });
          return;
        }
        if (task.terminal) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'task_already_terminal',
              'message': 'The Gemini task is already ${task.status}.',
            }
          });
          return;
        }
        if (!_claimMatches(task, request, null)) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'stale_or_wrong_task_claim',
              'message': 'The Gemini task result claim is invalid.',
            }
          });
          return;
        }
        final bytes = await _readBytes(request, _maxImageBytes);
        final imageType = _detectImageType(bytes);
        if (bytes.length < 128 || imageType == null) {
          await _json(response, 400, <String, Object?>{
            'error': <String, Object?>{'code': 'image_decode_failed'}
          });
          return;
        }
        await _imagesDirectory.create(recursive: true);
        final temporary = File([_imagesDirectory.path, '${task.id}.part']
            .join(Platform.pathSeparator));
        final target = File([
          _imagesDirectory.path,
          '${task.id}.${imageType.$2}'
        ].join(Platform.pathSeparator));
        await temporary.writeAsBytes(bytes, flush: true);
        if (await target.exists()) await target.delete();
        await temporary.rename(target.path);
        task.resultFile = target.path;
        task.status = 'succeeded';
        task.updatedAt = DateTime.now().toUtc();
        _clearClaim(task);
        final auditHeader = request.headers.value('x-langbai-audit');
        if (auditHeader != null && auditHeader.isNotEmpty) {
          try {
            final decoded =
                jsonDecode(utf8.decode(base64Url.decode(auditHeader)));
            if (decoded is Map) {
              task.audit = decoded.map(
                (key, value) => MapEntry(key.toString(), value),
              );
            }
          } catch (_) {}
        }
        task.audit = <String, Object?>{
          ...task.audit,
          'output_sha256': sha256.convert(bytes).toString(),
        };
        await _persistTasks();
        await _json(response, 200, task.toJson());
        return;
      }
      await _json(response, 404, <String, Object?>{
        'error': <String, Object?>{'code': 'not_found'}
      });
    } on HttpException catch (error) {
      await _json(response, 413, <String, Object?>{
        'error': <String, Object?>{
          'code': 'payload_too_large',
          'message': error.message
        }
      });
    } on FormatException catch (error) {
      await _json(response, 400, <String, Object?>{
        'error': <String, Object?>{
          'code': 'invalid_json',
          'message': error.message
        }
      });
    } catch (error) {
      await _json(response, 500, <String, Object?>{
        'error': <String, Object?>{
          'code': 'internal_error',
          'message': error.toString()
        }
      });
    }
  }

  (ContentType, String)? _detectImageType(List<int> bytes) {
    if (bytes.length >= 8 &&
        bytes[0] == 0x89 &&
        bytes[1] == 0x50 &&
        bytes[2] == 0x4e &&
        bytes[3] == 0x47 &&
        bytes[4] == 0x0d &&
        bytes[5] == 0x0a &&
        bytes[6] == 0x1a &&
        bytes[7] == 0x0a) {
      return (ContentType('image', 'png'), 'png');
    }
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return (ContentType('image', 'jpeg'), 'jpg');
    }
    if (bytes.length >= 12 &&
        ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
        ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WEBP') {
      return (ContentType('image', 'webp'), 'webp');
    }
    return null;
  }
}
