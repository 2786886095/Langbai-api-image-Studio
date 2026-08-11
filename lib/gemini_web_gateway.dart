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
import 'secure_storage_queue.dart';

const String _geminiPairingKeyStorage = 'gemini_web_pairing_key_v1';
const String _geminiActiveAccountStorage = 'gemini_web_active_account_v1';
const int _geminiPortStart = 18160;
const int _geminiPortEnd = 18199;
const int _maxJsonBytes = 80 * 1024 * 1024;
const int _maxImageBytes = 60 * 1024 * 1024;
const Duration _companionLeaseDuration = Duration(minutes: 2);
const Duration _geminiRateLimitCooldown = Duration(minutes: 15);
const String geminiSelectorPackVersion = '2026.07.30.6';
final RegExp _geminiUuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
const Set<String> _geminiQuotaCodes = <String>{
  'gemini_rate_limited',
  'quota_exhausted',
  'insufficient_quota',
  'rate_limit_error',
  'rate_limited',
};
const Set<String> _geminiAuthenticationCodes = <String>{
  'gemini_login_required',
  'authentication_failed',
  'invalid_session',
  'session_expired',
  'unauthorized',
};

const Map<String, Set<String>> _geminiStatusTransitions = <String, Set<String>>{
  'queued': <String>{'preparing_temporary_chat'},
  'waiting_for_browser': <String>{'preparing_temporary_chat'},
  'preparing_temporary_chat': <String>{
    'preparing_temporary_chat',
    'uploading_references',
  },
  'uploading_references': <String>{
    'preparing_temporary_chat',
    'uploading_references',
    'submitting',
  },
  'submitting': <String>{'submitting', 'generating'},
  'generating': <String>{'generating', 'locating_full_size'},
  'locating_full_size': <String>{'locating_full_size'},
};

bool geminiStatusTransitionAllowed(
  GeminiImageTask task,
  String nextStatus,
) {
  if (<String>{
    'failed',
    'needs_login',
    'protocol_changed',
    'cancelled',
  }.contains(nextStatus)) {
    return true;
  }
  final allowed = _geminiStatusTransitions[task.status] ?? const <String>{};
  if (allowed.contains(nextStatus)) return true;

  // On process restart every non-terminal task is deliberately reset to
  // waiting_for_browser, then the claimed companion moves it to preparation.
  // A task that already owns a sanitized direct-image checkpoint must resume
  // at the download/save phase without pretending to submit the paid request
  // again. This narrowly scoped transition is therefore forward recovery, not
  // a general shortcut around the state machine.
  return task.status == 'preparing_temporary_chat' &&
      nextStatus == 'locating_full_size' &&
      task.recovery['phase'] == 'direct_image_ready';
}

Map<String, Object?>? _sanitizeGeminiTaskRecovery(Object? value) {
  if (value is! Map || value['phase']?.toString() != 'direct_image_ready') {
    return null;
  }
  final image = value['image'];
  if (image is! Map) return null;
  final rawUrl = image['url']?.toString().trim() ?? '';
  final uri = Uri.tryParse(rawUrl);
  if (uri == null || uri.scheme != 'https' || rawUrl.length > 8192) {
    return null;
  }
  const allowedHosts = <String>{
    'googleusercontent.com',
    'ggpht.com',
    'googleapis.com',
  };
  final host = uri.host.toLowerCase();
  if (!allowedHosts.any(
    (allowed) => host == allowed || host.endsWith('.$allowed'),
  )) {
    return null;
  }
  String bounded(Object? item, [int limit = 512]) =>
      (item?.toString() ?? '').substring(
        0,
        min(item?.toString().length ?? 0, limit),
      );
  return <String, Object?>{
    'phase': 'direct_image_ready',
    'image': <String, Object?>{
      'url': rawUrl,
      'image_id': bounded(image['image_id']),
      'cid': bounded(image['cid']),
      'rid': bounded(image['rid']),
      'rcid': bounded(image['rcid']),
    },
    'image_count': int.tryParse(value['image_count']?.toString() ?? '') ?? 1,
    'transport': bounded(value['transport'], 128),
  };
}

GeminiImageTask? findResumableGeminiCompanionTask(
  Iterable<GeminiImageTask> tasks, {
  required String accountId,
  required DateTime now,
}) {
  final matches = tasks
      .where((task) =>
          !task.terminal &&
          task.accountId == accountId &&
          task.claimId.isNotEmpty &&
          task.claimedAccountId == accountId &&
          task.claimExpiresAt != null &&
          task.claimExpiresAt!.isAfter(now))
      .toList()
    ..sort((left, right) => left.updatedAt.compareTo(right.updatedAt));
  return matches.firstOrNull;
}

String expiredGeminiClaimAction(GeminiImageTask task) {
  if (task.recovery['phase'] == 'direct_image_ready') {
    return 'resume_generated_image';
  }
  if (<String>{
    'submitting',
    'generating',
    'locating_full_size',
  }.contains(task.status)) {
    return 'fail_unknown_submission';
  }
  return 'requeue_before_submission';
}

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
  Future<void> _taskSubmissionChain = Future<void>.value();

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

  Future<GeminiAccountMetadata?> _activeAccountMetadata() async {
    if (_activeAccountId.isEmpty) return null;
    return (await accountStore.load())
        .where((account) => account.localAccountId == _activeAccountId)
        .firstOrNull;
  }

  int get port => _server?.port ?? 0;
  String get baseUrl => 'http://127.0.0.1:$port/v1';

  Future<void> start() async {
    if (_server != null) return;
    _pairingKey = await _loadOrCreatePairingKey();
    _activeAccountId = await SecureStorageQueue.run(() async =>
        (await secureStorage.read(key: _geminiActiveAccountStorage) ?? '')
            .trim());
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
      'selectorPackVersion': geminiSelectorPackVersion,
      'accounts':
          (await accountStore.load()).map(_accountSnapshotJson).toList(),
      'activeAccountId': _activeAccountId,
      'autoSwitch': await accountStore.autoSwitchEnabled(),
    };
  }

  Future<Map<String, Object?>> accountsSnapshot() async {
    final accounts = await accountStore.load();
    return <String, Object?>{
      'accounts': accounts.map(_accountSnapshotJson).toList(),
      'active_account_id': _activeAccountId,
      'auto_switch': await accountStore.autoSwitchEnabled(),
      'companion_connected': companionConnected,
      'ready_account_count':
          accounts.where((account) => _accountAvailable(account)).length,
    };
  }

  Future<Map<String, Object?>> selectAccount(String id) async {
    final accounts = await accountStore.load();
    if (!accounts.any((account) => account.localAccountId == id)) {
      throw StateError('Gemini account not found');
    }
    _activeAccountId = id;
    await SecureStorageQueue.run(
      () => secureStorage.write(
        key: _geminiActiveAccountStorage,
        value: _activeAccountId,
      ),
    );
    return accountsSnapshot();
  }

  Future<Map<String, Object?>> deleteAccount(String id) async {
    await accountStore.remove(id);
    if (_activeAccountId == id) {
      _activeAccountId = '';
      await SecureStorageQueue.run(
        () => secureStorage.delete(key: _geminiActiveAccountStorage),
      );
      await _switchActiveAccount(excluding: <String>{id});
    }
    return accountsSnapshot();
  }

  bool _accountConnected(String id) {
    final seen = _companionProfiles[id];
    return seen != null &&
        DateTime.now().difference(seen) < const Duration(seconds: 20);
  }

  bool _accountAvailable(GeminiAccountMetadata account) =>
      account.available && _accountConnected(account.localAccountId);

  bool _accountClaimReady(GeminiAccountMetadata account) =>
      account.loginReady &&
      account.status == 'ready' &&
      account.quotaState != 'exhausted' &&
      !account.coolingDown;

  bool _accountEligible(GeminiAccountMetadata account) => account.available;

  Map<String, Object?> _accountSnapshotJson(GeminiAccountMetadata account) =>
      <String, Object?>{
        ...account.toJson(),
        'browser_connected': _accountConnected(account.localAccountId),
        'logged_in': account.loginReady,
        'generation_ready': _accountAvailable(account),
        'selector_pack_compatible': account.status != 'protocol_changed',
        'task_ready': _accountAvailable(account),
        'queue_eligible': _accountEligible(account),
      };

  Future<void> _setActiveAccount(String id) async {
    _activeAccountId = id;
    if (id.isEmpty) {
      await SecureStorageQueue.run(
        () => secureStorage.delete(key: _geminiActiveAccountStorage),
      );
    } else {
      await SecureStorageQueue.run(
        () => secureStorage.write(
          key: _geminiActiveAccountStorage,
          value: id,
        ),
      );
    }
  }

  Future<GeminiAccountMetadata?> _switchActiveAccount({
    Set<String> excluding = const <String>{},
  }) async {
    if (!await accountStore.autoSwitchEnabled()) return null;
    final accounts = await accountStore.load();
    final next = accounts
        .where((account) =>
            !excluding.contains(account.localAccountId) &&
            _accountEligible(account))
        .firstOrNull;
    if (next != null) await _setActiveAccount(next.localAccountId);
    return next;
  }

  Future<GeminiAccountMetadata?> _submissionAccount() async {
    final accounts = await accountStore.load();
    final active = accounts
        .where((account) => account.localAccountId == _activeAccountId)
        .firstOrNull;
    // A persisted ready account remains a valid queue target while its hidden
    // WebView is still starting. The task will wait for that specific browser
    // profile instead of incorrectly claiming that no account exists.
    if (active != null && _accountEligible(active)) return active;
    return _switchActiveAccount(
      excluding:
          active == null ? const <String>{} : <String>{active.localAccountId},
    );
  }

  Future<(int, String, String)> _submissionAccountError() async {
    final accounts = await accountStore.load();
    if (accounts.isEmpty) {
      return (
        HttpStatus.conflict,
        'gemini_account_required',
        'Add and sign in to a Gemini account before submitting.',
      );
    }
    final active = accounts
        .where((account) => account.localAccountId == _activeAccountId)
        .firstOrNull;
    final candidates =
        active == null ? accounts : <GeminiAccountMetadata>[active];
    if (candidates.any((account) =>
        account.quotaState == 'exhausted' || account.coolingDown)) {
      return (
        HttpStatus.tooManyRequests,
        'gemini_rate_limited',
        'The selected Gemini account is in quota cooldown. Wait for the cooldown or select another account.',
      );
    }
    if (candidates.any((account) =>
        !account.loginReady ||
        <String>{'needs_login', 'session_expired'}.contains(account.status))) {
      return (
        HttpStatus.unauthorized,
        'gemini_login_required',
        'The selected Gemini account needs to sign in again.',
      );
    }
    return (
      HttpStatus.conflict,
      'gemini_account_not_ready',
      'The selected Gemini browser profile is not ready. Refresh the account status or sign in again.',
    );
  }

  String _normalizedUuid(Object? value) {
    final normalized = value?.toString().trim().toLowerCase() ?? '';
    return _geminiUuidPattern.hasMatch(normalized) ? normalized : '';
  }

  String _legacyAccountId(String profileId) => sha256
      .convert(utf8.encode('gemini:$profileId'))
      .toString()
      .substring(0, 32);

  String _errorCode(Object? error) {
    if (error is Map) {
      return (error['code'] ?? error['type'] ?? error['status'])
          .toString()
          .trim()
          .toLowerCase();
    }
    return '';
  }

  String _errorMessage(Object? error) {
    if (error is Map) {
      return (error['message'] ?? error['detail'] ?? error['error'] ?? '')
          .toString()
          .trim();
    }
    return error?.toString().trim() ?? '';
  }

  bool _quotaFailure(String code, String message) =>
      _geminiQuotaCodes.contains(code) ||
      RegExp(r'\b(quota|rate.?limit|too many requests)\b', caseSensitive: false)
          .hasMatch(message);

  bool _authenticationFailure(String code, String message) =>
      _geminiAuthenticationCodes.contains(code) ||
      RegExp(
        r'\b(login|required|signed out|session expired|unauthori[sz]ed)\b',
        caseSensitive: false,
      ).hasMatch(message);

  Future<GeminiAccountMetadata?> _recordAccountReport(
    String accountId, {
    required String status,
    bool? loginReady,
    Object? error,
  }) async {
    final accounts = await accountStore.load();
    final current = accounts
        .where((account) => account.localAccountId == accountId)
        .firstOrNull;
    if (current == null) return null;

    final now = DateTime.now().toUtc();
    final code = _errorCode(error);
    final message = _errorMessage(error);
    final quotaFailure = _quotaFailure(code, message);
    final authenticationFailure = _authenticationFailure(code, message);
    var nextStatus = status.trim().isEmpty ? current.status : status.trim();
    var nextLoginReady = loginReady ?? current.loginReady;
    var quotaState = current.quotaState;
    var cooldownUntil = current.cooldownUntil;
    var lastQuotaAt = current.lastQuotaAt;

    if (quotaFailure) {
      final exhausted = code.contains('quota') ||
          RegExp(r'\bquota\b', caseSensitive: false).hasMatch(message);
      nextStatus = exhausted ? 'quota_exhausted' : 'rate_limited';
      quotaState = exhausted ? 'exhausted' : 'cooldown';
      cooldownUntil = now.add(_geminiRateLimitCooldown).toIso8601String();
      lastQuotaAt = now.toIso8601String();
    } else if (authenticationFailure || nextStatus == 'needs_login') {
      nextStatus = 'needs_login';
      nextLoginReady = false;
    } else if (nextStatus == 'ready' && nextLoginReady) {
      final cooldown = DateTime.tryParse(current.cooldownUntil);
      if (<String>{'cooldown', 'exhausted'}.contains(current.quotaState) &&
          cooldown != null &&
          cooldown.isAfter(now)) {
        nextStatus = current.quotaState == 'exhausted'
            ? 'quota_exhausted'
            : 'rate_limited';
      } else {
        quotaState = 'available';
        cooldownUntil = '';
      }
    }

    final updated = current.copyWith(
      status: nextStatus,
      loginReady: nextLoginReady,
      quotaState: quotaState,
      cooldownUntil: cooldownUntil,
      lastErrorCode: code,
      lastQuotaAt: lastQuotaAt,
      lastVerifiedAt: now.toIso8601String(),
      lastError: message,
    );
    await accountStore.upsert(updated);

    if (_activeAccountId == accountId &&
        (quotaFailure || authenticationFailure || !updated.available)) {
      await _switchActiveAccount(excluding: <String>{accountId});
    }
    return updated;
  }

  Future<void> _recordAccountSuccess(String accountId) async {
    final account = (await accountStore.load())
        .where((item) => item.localAccountId == accountId)
        .firstOrNull;
    if (account == null) return;
    await accountStore.upsert(account.copyWith(
      status: 'ready',
      loginReady: true,
      quotaState: 'available',
      cooldownUntil: '',
      lastErrorCode: '',
      lastVerifiedAt: DateTime.now().toUtc().toIso8601String(),
      temporaryChatAvailable: true,
      fullsizeDownloadAvailable: true,
      lastError: '',
    ));
  }

  List<String> _taskAttemptedAccounts(GeminiImageTask task) {
    final value = task.audit['account_attempts'];
    if (value is! List) return <String>[];
    return value
        .map((item) => item.toString())
        .where((id) => id.isNotEmpty)
        .toList();
  }

  Future<bool> _requeueAfterAccountFailure(
    GeminiImageTask task,
    Object? error,
  ) async {
    final code = _errorCode(error);
    final message = _errorMessage(error);
    if (!_quotaFailure(code, message) &&
        !_authenticationFailure(code, message)) {
      return false;
    }

    await _recordAccountReport(
      task.accountId,
      status: _authenticationFailure(code, message)
          ? 'needs_login'
          : 'quota_exhausted',
      error: error,
    );
    if (!await accountStore.autoSwitchEnabled()) return false;

    final attempted = <String>{
      ..._taskAttemptedAccounts(task),
      task.accountId,
    };
    final next = await _switchActiveAccount(excluding: attempted);
    if (next == null) return false;

    task.audit = <String, Object?>{
      ...task.audit,
      'account_attempts': attempted.toList(),
      'last_account_error': <String, Object?>{
        'account_id': task.accountId,
        'code': code,
        'message': message,
        'at': DateTime.now().toUtc().toIso8601String(),
      },
      'auto_switched_to': next.localAccountId,
    };
    task.accountId = next.localAccountId;
    task.status = _accountConnected(next.localAccountId)
        ? 'queued'
        : 'waiting_for_browser';
    task.error = null;
    task.updatedAt = DateTime.now().toUtc();
    _clearClaim(task);
    return true;
  }

  Future<String> _loadOrCreatePairingKey() => SecureStorageQueue.run(() async {
        final existing =
            (await secureStorage.read(key: _geminiPairingKeyStorage) ?? '')
                .trim();
        if (RegExp(r'^[a-f0-9]{64}$').hasMatch(existing)) return existing;
        final random = Random.secure();
        final bytes = List<int>.generate(32, (_) => random.nextInt(256));
        final value = sha256.convert(bytes).toString();
        await secureStorage.write(key: _geminiPairingKeyStorage, value: value);
        return value;
      });

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
          'authorization,content-type,x-langbai-account-id,x-langbai-claim-id,x-langbai-audit')
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
        final activeAccount = await _activeAccountMetadata();
        final browserConnected = activeAccount != null &&
            _accountConnected(activeAccount.localAccountId);
        final selectorCompatible =
            activeAccount != null && activeAccount.status != 'protocol_changed';
        await _json(response, 200, <String, Object?>{
          'status': 'ok',
          'provider': 'gemini_web',
          'version': '1.6.32',
          'protocol_version': '1',
          'companion_connected': companionConnected,
          'session_available': browserConnected && activeAccount.loginReady,
          'generation_ready': browserConnected && activeAccount.available,
          'temporary_chat_available':
              activeAccount?.temporaryChatAvailable == true,
          'direct_protocol_available':
              activeAccount?.directProtocolAvailable == true,
          'fullsize_download_available':
              activeAccount?.fullsizeDownloadAvailable == true,
          'selector_pack_compatible': selectorCompatible,
        });
        return;
      }
      if (path == '/v1/capabilities' && request.method == 'GET') {
        final activeAccount = await _activeAccountMetadata();
        final browserConnected = activeAccount != null &&
            _accountConnected(activeAccount.localAccountId);
        await _json(
          response,
          200,
          geminiWebCapabilities(
            companionConnected: companionConnected,
            sessionAvailable: browserConnected && activeAccount.loginReady,
            generationReady: browserConnected && activeAccount.available,
            temporaryChatAvailable:
                activeAccount?.temporaryChatAvailable == true,
            directProtocolAvailable:
                activeAccount?.directProtocolAvailable == true,
            fullsizeDownloadAvailable:
                activeAccount?.fullsizeDownloadAvailable == true,
            selectorPackCompatible: activeAccount != null &&
                activeAccount.status != 'protocol_changed',
            effectiveConcurrency: _effectiveConcurrency,
          ),
        );
        return;
      }
      if (path == '/v1/accounts' && request.method == 'GET') {
        await _json(response, 200, await accountsSnapshot());
        return;
      }
      if (path == '/v1/accounts/auto-switch' && request.method == 'POST') {
        final body = await _readJson(request);
        final enabled = body['enabled'] != false;
        await accountStore.setAutoSwitchEnabled(enabled);
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
        final previousSubmission = _taskSubmissionChain;
        final submissionGate = Completer<void>();
        _taskSubmissionChain = submissionGate.future;
        try {
          try {
            await previousSubmission;
          } catch (_) {
            // A failed prior request must not permanently block later task
            // submissions.
          }
          final requestId = body['client_request_id']?.toString() ?? '';
          final duplicate = _tasks.values
              .where((task) =>
                  requestId.isNotEmpty && task.clientRequestId == requestId)
              .firstOrNull;
          if (duplicate != null) {
            if (jsonEncode(duplicate.request) != jsonEncode(body)) {
              await _json(response, HttpStatus.conflict, <String, Object?>{
                'error': <String, Object?>{
                  'code': 'idempotency_conflict',
                  'message':
                      'The same client_request_id was already used for a different Gemini request.',
                }
              });
            } else {
              await _json(response, 200, duplicate.toJson());
            }
            return;
          }
          final submissionAccount = await _submissionAccount();
          if (submissionAccount == null) {
            final (status, code, message) = await _submissionAccountError();
            await _json(response, status, <String, Object?>{
              'error': <String, Object?>{
                'code': code,
                'message': message,
              },
              'accounts': await accountsSnapshot(),
            });
            return;
          }
          final id =
              'gemini_${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 32).toRadixString(16)}';
          final task = GeminiImageTask(
            id: id,
            clientRequestId: requestId,
            request: body,
            status: _accountConnected(submissionAccount.localAccountId)
                ? 'queued'
                : 'waiting_for_browser',
            accountId: submissionAccount.localAccountId,
          );
          _tasks[id] = task;
          await _persistTasks();
          await _json(response, 202, task.toJson());
          return;
        } finally {
          if (!submissionGate.isCompleted) submissionGate.complete();
        }
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
        final accountUuid = _normalizedUuid(
          body['account_uuid'] ?? body['local_account_uuid'],
        );
        final accounts = await accountStore.load();
        final existing = accounts
            .where((account) =>
                (accountUuid.isNotEmpty &&
                    account.accountUuid == accountUuid) ||
                account.browserProfileId == profileId)
            .firstOrNull;
        // Existing hashed IDs remain stable so queued v1 tasks keep their
        // account binding. New embedded profiles use their local UUID directly.
        final localId = existing?.localAccountId ??
            (accountUuid.isNotEmpty
                ? accountUuid
                : _legacyAccountId(profileId));
        final selectorPackVersion =
            body['selector_pack_version']?.toString() ?? '';
        final selectorPackCompatible =
            selectorPackVersion == geminiSelectorPackVersion;
        final incomingStatus = body['status']?.toString() ?? 'unknown';
        final explicitReady = incomingStatus == 'ready';
        final explicitSignedOut = incomingStatus == 'needs_login';
        final uncertainIdentity = !explicitReady && !explicitSignedOut;
        final loginReady = selectorPackCompatible &&
            (explicitReady
                ? true
                : explicitSignedOut
                    ? false
                    : (existing?.loginReady ?? false));
        final retainedAccountState =
            existing != null && existing.coolingDown && !explicitSignedOut;
        final account = GeminiAccountMetadata(
          localAccountId: localId,
          accountUuid: accountUuid.isNotEmpty
              ? accountUuid
              : (existing?.accountUuid ?? ''),
          displayName: body['display_name']?.toString() ?? 'Gemini 浏览器账号',
          maskedEmail: body['masked_email']?.toString() ?? '',
          browserProfileId: profileId,
          platform: body['platform']?.toString() ?? Platform.operatingSystem,
          status: selectorPackCompatible
              ? (retainedAccountState
                  ? existing.status
                  : explicitReady
                      ? 'ready'
                      : explicitSignedOut
                          ? 'needs_login'
                          : (existing?.status ?? 'unknown'))
              : 'protocol_changed',
          loginReady: loginReady,
          quotaState: retainedAccountState
              ? existing.quotaState
              : (explicitReady
                  ? 'available'
                  : (existing?.quotaState ?? 'available')),
          cooldownUntil: retainedAccountState
              ? existing.cooldownUntil
              : (explicitReady ? '' : (existing?.cooldownUntil ?? '')),
          lastErrorCode: retainedAccountState ? existing.lastErrorCode : '',
          lastQuotaAt: existing?.lastQuotaAt ?? '',
          lastVerifiedAt: DateTime.now().toUtc().toIso8601String(),
          // The page probe recognizes both the stable temp-chat data-test-id
          // and an already-active temporary-chat surface. Do not retain a
          // historical true value after the page stops exposing the feature:
          // that created "ready" accounts that could never execute a task.
          temporaryChatAvailable: selectorPackCompatible &&
              !uncertainIdentity &&
              body['temporary_chat_available'] == true,
          directProtocolAvailable: selectorPackCompatible &&
              !uncertainIdentity &&
              body['direct_protocol_available'] == true,
          fullsizeDownloadAvailable: selectorPackCompatible &&
              (uncertainIdentity
                  ? (existing?.fullsizeDownloadAvailable ?? false)
                  : body['fullsize_download_available'] == true),
          effectiveConcurrency: int.tryParse(
                body['effective_concurrency']?.toString() ?? '',
              ) ??
              1,
          lastError: retainedAccountState
              ? existing.lastError
              : (body['last_error']?.toString() ?? ''),
        );
        await accountStore.upsert(account);
        _companionProfiles[localId] = DateTime.now();
        if (_activeAccountId.isEmpty) {
          await _setActiveAccount(localId);
        }
        _effectiveConcurrency = account.effectiveConcurrency.clamp(1, 10);
        await _json(response, 200, <String, Object?>{
          ...await accountsSnapshot(),
          'local_account_id': localId,
          'account_uuid': account.accountUuid,
          'auto_switch': await accountStore.autoSwitchEnabled(),
          'selector_pack_compatible': selectorPackCompatible,
          'expected_selector_pack_version': geminiSelectorPackVersion,
        });
        return;
      }
      if (path == '/v1/companion/account-report' && request.method == 'POST') {
        _lastCompanionSeen = DateTime.now();
        final body = await _readJson(request);
        final accountId = body['account_id']?.toString() ??
            request.headers.value('x-langbai-account-id') ??
            '';
        if (accountId.isEmpty ||
            !(await accountStore.load())
                .any((account) => account.localAccountId == accountId)) {
          await _json(response, 404, <String, Object?>{
            'error': <String, Object?>{'code': 'gemini_account_not_found'}
          });
          return;
        }
        _companionProfiles[accountId] = DateTime.now();
        await _recordAccountReport(
          accountId,
          status: body['status']?.toString() ?? 'unknown',
          loginReady:
              body['login_ready'] is bool ? body['login_ready'] as bool : null,
          error: body['error'],
        );
        await _json(response, 200, await accountsSnapshot());
        return;
      }
      if (path == '/v1/companion/tasks/next' && request.method == 'GET') {
        _lastCompanionSeen = DateTime.now();
        final accountId = request.headers.value('x-langbai-account-id') ?? '';
        final registeredAccount = (await accountStore.load())
            .where((account) => account.localAccountId == accountId)
            .firstOrNull;
        if (accountId.isEmpty || registeredAccount == null) {
          await _json(response, 403, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_account_mismatch',
              'message': 'The browser profile is not a registered account.',
            }
          });
          return;
        }
        if (!registeredAccount.loginReady ||
            <String>{'needs_login', 'session_expired'}
                .contains(registeredAccount.status)) {
          await _json(response, 401, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_login_required',
              'message': 'The Gemini browser profile needs to sign in again.',
            }
          });
          return;
        }
        if (registeredAccount.coolingDown ||
            registeredAccount.quotaState == 'exhausted' ||
            <String>{'rate_limited', 'quota_exhausted'}
                .contains(registeredAccount.status)) {
          await _json(response, 429, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_rate_limited',
              'message': 'The Gemini account is in quota cooldown.',
            }
          });
          return;
        }
        if (registeredAccount.status == 'protocol_changed') {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'selector_pack_outdated',
              'message': 'The Gemini selector pack is incompatible.',
            }
          });
          return;
        }
        if (!_accountClaimReady(registeredAccount)) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'gemini_account_not_ready',
              'message': 'The Gemini browser profile is still loading.',
            }
          });
          return;
        }
        final now = DateTime.now().toUtc();
        var reclaimed = false;
        for (final item in _tasks.values.where(
          (item) => !item.terminal && _claimExpired(item, now),
        )) {
          final expirationAction = expiredGeminiClaimAction(item);
          if (expirationAction == 'fail_unknown_submission') {
            item.status = 'failed';
            item.error = <String, Object?>{
              'code': 'gemini_submission_state_unknown',
              'message':
                  'The Gemini task lease expired after submission may have started. It was not resubmitted.',
            };
          } else {
            item.status = 'waiting_for_browser';
          }
          item.updatedAt = now;
          _clearClaim(item);
          reclaimed = true;
        }
        if (reclaimed) await _persistTasks();
        final activeClaims = _tasks.values
            .where((item) =>
                !item.terminal &&
                item.accountId == accountId &&
                item.claimId.isNotEmpty &&
                item.claimedAccountId == accountId &&
                !_claimExpired(item, now))
            .toList()
          ..sort((left, right) => left.updatedAt.compareTo(right.updatedAt));
        final resumableTask = findResumableGeminiCompanionTask(
          activeClaims,
          accountId: accountId,
          now: now,
        );
        if (resumableTask != null) {
          final task = resumableTask;
          // A single embedded account profile must never execute two Gemini
          // page automations at once. Return the same claim after navigation
          // and release any duplicate claims created by older builds.
          for (final duplicate in activeClaims.skip(1)) {
            duplicate.status = 'waiting_for_browser';
            duplicate.updatedAt = now;
            _clearClaim(duplicate);
          }
          _renewClaim(task);
          await _persistTasks();
          await _json(response, 200, <String, Object?>{
            ...task.toJson(includeRequest: true, includeRecovery: true),
            'request': task.request,
            'resumed_claim': true,
          });
          return;
        }
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
          ...task.toJson(includeRequest: true, includeRecovery: true),
          'request': task.request,
        });
        return;
      }
      final heartbeatMatch =
          RegExp(r'^/v1/companion/tasks/([^/]+)/heartbeat$').firstMatch(path);
      if (heartbeatMatch != null && request.method == 'POST') {
        _lastCompanionSeen = DateTime.now();
        final task = _tasks[heartbeatMatch.group(1)];
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
              'message': 'The Gemini task heartbeat claim is invalid.',
            }
          });
          return;
        }
        _renewClaim(task);
        await _persistTasks();
        await _json(response, 200, task.toJson());
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
        if (!geminiStatusTransitionAllowed(task, nextStatus)) {
          await _json(response, 409, <String, Object?>{
            'error': <String, Object?>{
              'code': 'invalid_status_transition',
              'message':
                  'Cannot move Gemini task from ${task.status} to $nextStatus.',
            }
          });
          return;
        }
        Map<String, Object?>? recovery;
        if (body.containsKey('recovery')) {
          recovery = _sanitizeGeminiTaskRecovery(body['recovery']);
          if (recovery == null) {
            await _json(response, 400, <String, Object?>{
              'error': <String, Object?>{
                'code': 'invalid_recovery_checkpoint',
                'message': 'The Gemini recovery checkpoint is invalid.',
              }
            });
            return;
          }
        }
        final error = body['error'];
        if (<String>{'failed', 'needs_login'}.contains(nextStatus) &&
            await _requeueAfterAccountFailure(task, error)) {
          await _persistTasks();
          await _json(response, 200, <String, Object?>{
            ...task.toJson(),
            'auto_switched': true,
            'retry_account_id': task.accountId,
          });
          return;
        }
        task.status = nextStatus;
        _renewClaim(task);
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
        if (recovery != null) task.recovery = recovery;
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
        task.error = null;
        task.recovery = const <String, Object?>{};
        task.updatedAt = DateTime.now().toUtc();
        _clearClaim(task);
        final auditHeader = request.headers.value('x-langbai-audit');
        if (auditHeader != null && auditHeader.isNotEmpty) {
          try {
            final decoded = jsonDecode(
              utf8.decode(
                base64Url.decode(base64Url.normalize(auditHeader)),
              ),
            );
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
        // The image result is already complete at this point. A secure-storage
        // metadata refresh must not turn a successful paid generation into an
        // HTTP 500 or make the browser submit it again.
        try {
          await _recordAccountSuccess(task.accountId);
        } catch (_) {}
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
