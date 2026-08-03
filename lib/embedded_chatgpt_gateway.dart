import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';

const int embeddedGatewayFirstPort = 18081;
const int embeddedGatewayLastPort = 18100;
const String embeddedGatewayProcessName = 'langbai_chatgpt_gateway.exe';

typedef EmbeddedGatewayStartAttempt = Future<Map<String, Object?>> Function();

String randomGatewaySecret({int bytes = 32, Random? random}) {
  final source = random ?? Random.secure();
  return List<int>.generate(bytes, (_) => source.nextInt(256))
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
}

String embeddedGatewayExecutablePath({
  required String executableDirectory,
  bool isWindows = true,
}) {
  return <String>[
    executableDirectory,
    'chatgpt_gateway',
    isWindows ? 'langbai_chatgpt_gateway.exe' : 'langbai_chatgpt_gateway',
  ].join(Platform.pathSeparator);
}

bool isLikelyGatewayPortBindingFailure(Object error, String stderr) {
  final text = '$error\n$stderr'.toLowerCase();
  return text.contains('address already in use') ||
      text.contains('only one usage of each socket address') ||
      text.contains('errno 10048') ||
      text.contains('winerror 10048') ||
      (text.contains('bind') && text.contains('port'));
}

String gatewayStopByPathPowerShell(String executablePath) {
  final escaped = File(executablePath).absolute.path.replaceAll("'", "''");
  return r'''$target=[IO.Path]::GetFullPath('''
      "'$escaped'"
      r'''); Get-CimInstance Win32_Process -Filter "Name='langbai_chatgpt_gateway.exe'" | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq $target) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }''';
}

class SessionActivationCoordinator {
  final Map<String, String> _appliedFingerprints = <String, String>{};
  final Map<String, Future<void>> _inFlight = <String, Future<void>>{};
  int _generation = 0;

  Future<void> activate({
    required String accountId,
    required String fingerprint,
    required Future<void> Function() apply,
  }) {
    if (_appliedFingerprints[accountId] == fingerprint) {
      return Future<void>.value();
    }
    final key = '$accountId:$fingerprint';
    final existing = _inFlight[key];
    if (existing != null) return existing;

    final generation = _generation;
    late Future<void> future;
    future = Future<void>.sync(apply).then((_) {
      if (generation != _generation) {
        throw const HttpException(
          'Gateway session activation was invalidated by a restart.',
        );
      }
      _appliedFingerprints[accountId] = fingerprint;
    }).whenComplete(() {
      if (identical(_inFlight[key], future)) _inFlight.remove(key);
    });
    _inFlight[key] = future;
    return future;
  }

  void clear([String accountId = '']) {
    _generation++;
    if (accountId.isEmpty) {
      _appliedFingerprints.clear();
      _inFlight.clear();
      return;
    }
    _appliedFingerprints.remove(accountId);
    _inFlight.removeWhere((key, _) => key.startsWith('$accountId:'));
  }
}

class EmbeddedChatGptGatewayManager {
  EmbeddedChatGptGatewayManager({
    this.firstPort = embeddedGatewayFirstPort,
    this.lastPort = embeddedGatewayLastPort,
    this.startupTimeout = const Duration(seconds: 25),
    EmbeddedGatewayStartAttempt? startAttemptForTesting,
  }) : _startAttemptForTesting = startAttemptForTesting;

  final int firstPort;
  final int lastPort;
  final Duration startupTimeout;
  final EmbeddedGatewayStartAttempt? _startAttemptForTesting;
  Process? _process;
  Future<Map<String, Object?>>? _startFuture;
  String _apiKey = '';
  String _bridgeSecret = '';
  int _port = 0;
  String _lastError = '';
  bool _gatewayReady = false;
  bool _stopping = false;
  final SessionActivationCoordinator _sessionActivation =
      SessionActivationCoordinator();

  bool get running => _gatewayReady && _process != null && _port > 0;

  Future<Map<String, Object?>> configuration() {
    final existing = _startFuture;
    if (existing != null) return existing;
    final attempt = _runStartAttempt();
    _startFuture = attempt;
    return attempt;
  }

  Future<Map<String, Object?>> _runStartAttempt() async {
    try {
      final result =
          await (_startAttemptForTesting?.call() ?? _startInternal());
      if (_startAttemptForTesting != null) _startFuture = null;
      return result;
    } catch (_) {
      await _resetAfterFailedStart();
      _startFuture = null;
      rethrow;
    }
  }

  Future<Map<String, Object?>> _startInternal() async {
    if (!Platform.isWindows) {
      throw const FileSystemException(
        'The bundled ChatGPT web image gateway is currently available on Windows only.',
      );
    }
    final executable = _resolveExecutable();
    if (!await executable.exists()) {
      _lastError = 'Bundled image gateway executable is missing.';
      throw FileSystemException(_lastError, executable.path);
    }

    final dataDirectory = Directory(<String>[
      _localAppData(),
      'LangbaiImageStudio',
      'EmbeddedChatGptGateway',
    ].join(Platform.pathSeparator));
    await dataDirectory.create(recursive: true);
    _apiKey = randomGatewaySecret();
    _bridgeSecret = randomGatewaySecret();
    _lastError = '';
    _sessionActivation.clear();

    final attemptedPorts = <int>{};
    final maxPortAttempts = min(3, lastPort - firstPort + 1);
    Object? lastPortError;
    for (var attempt = 0; attempt < maxPortAttempts; attempt++) {
      final candidate = await _findAvailablePort(excluding: attemptedPorts);
      attemptedPorts.add(candidate);
      _port = candidate;
      try {
        return await _launchAtPort(
          executable: executable,
          dataDirectory: dataDirectory,
          port: candidate,
        );
      } catch (error) {
        lastPortError = error;
        final retryPort = attempt + 1 < maxPortAttempts &&
            isLikelyGatewayPortBindingFailure(error, _lastError);
        await _stopTrackedProcess(clearSecrets: false);
        if (!retryPort) rethrow;
      }
    }
    throw StateError(
      'Bundled image gateway could not bind a port: $lastPortError',
    );
  }

  File _resolveExecutable() {
    final override =
        (Platform.environment['LANGBAI_EMBEDDED_GATEWAY_EXECUTABLE'] ?? '')
            .trim();
    return override.isNotEmpty
        ? File(override)
        : File(embeddedGatewayExecutablePath(
            executableDirectory: File(Platform.resolvedExecutable).parent.path,
          ));
  }

  Future<Map<String, Object?>> _launchAtPort({
    required File executable,
    required Directory dataDirectory,
    required int port,
  }) async {
    final environment = <String, String>{
      ...Platform.environment,
      'CHATGPT2API_AUTH_KEY': _apiKey,
      'LANGBAI_WEB_BRIDGE_SECRET': _bridgeSecret,
      'CHATGPT2API_DATA_DIR': dataDirectory.path,
      'CHATGPT2API_CONFIG_FILE': <String>[
        dataDirectory.path,
        'config.json',
      ].join(Platform.pathSeparator),
      'LANGBAI_GATEWAY_PORT': '$port',
      'LANGBAI_PARENT_PID': '$pid',
      'PYTHONUTF8': '1',
    };
    final launched = await Process.start(
      executable.path,
      const <String>[],
      workingDirectory: executable.parent.path,
      environment: environment,
      mode: ProcessStartMode.normal,
    );
    _process = launched;
    _gatewayReady = false;
    unawaited(launched.stdout.drain<void>());
    unawaited(launched.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) {
          final value = line.trim();
          if (value.isNotEmpty) _lastError = value;
        })
        .asFuture<void>()
        .catchError((Object _) {}));
    _watchProcessExit(launched);

    final deadline = DateTime.now().add(startupTimeout);
    while (DateTime.now().isBefore(deadline)) {
      final exitCode = await _exitCodeIfFinished(launched);
      if (exitCode != null) {
        throw ProcessException(
          executable.path,
          const <String>[],
          _lastError.isEmpty
              ? 'Bundled image gateway exited with code $exitCode.'
              : _lastError,
          exitCode,
        );
      }
      if (identical(_process, launched) && await _healthReady(port)) {
        _gatewayReady = true;
        return <String, Object?>{
          'baseUrl': 'http://127.0.0.1:$port/v1',
          'apiKey': _apiKey,
          'embedded': true,
          'port': port,
        };
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    throw TimeoutException(
      _lastError.isEmpty
          ? 'Bundled image gateway did not become ready.'
          : _lastError,
      startupTimeout,
    );
  }

  void _watchProcessExit(Process process) {
    unawaited(process.exitCode.then((exitCode) {
      if (!identical(_process, process)) return;
      final wasReady = _gatewayReady;
      _process = null;
      _gatewayReady = false;
      _port = 0;
      _apiKey = '';
      _bridgeSecret = '';
      _sessionActivation.clear();
      if (!_stopping && _lastError.isEmpty) {
        _lastError = 'Bundled image gateway exited with code $exitCode.';
      }
      if (wasReady) _startFuture = null;
    }));
  }

  Future<void> setSessionToken(
    String accessToken, {
    required String accountId,
  }) async {
    final tokenFingerprint =
        sha256.convert(utf8.encode(accessToken)).toString();
    final config = await configuration();
    return _sessionActivation.activate(
      accountId: accountId,
      fingerprint: tokenFingerprint,
      apply: () => _applySessionToken(accessToken, accountId, config),
    );
  }

  Future<void> _applySessionToken(
    String accessToken,
    String accountId,
    Map<String, Object?> config,
  ) async {
    final baseUrl = (config['baseUrl'] ?? '').toString();
    final endpoint = Uri.parse(baseUrl).replace(
      path: '/session-bridge/v1/token',
    );
    final client = HttpClient()..findProxy = (_) => 'DIRECT';
    try {
      final request = await client.postUrl(endpoint);
      request.headers
        ..set(HttpHeaders.contentTypeHeader, 'application/json')
        ..set('X-Langbai-Bridge-Secret', _bridgeSecret);
      request.write(jsonEncode(<String, String>{
        'access_token': accessToken,
        'account_id': accountId,
      }));
      final response = await request.close().timeout(
            const Duration(seconds: 20),
          );
      final body = await utf8.decoder.bind(response).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException(
          'Gateway session update failed (${response.statusCode}): $body',
          uri: endpoint,
        );
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<void> clearSessionToken({String accountId = ''}) async {
    if (accountId.isEmpty) {
      _sessionActivation.clear();
    } else {
      _sessionActivation.clear(accountId);
    }
    if (!running) return;
    final endpoint = Uri.parse(
      'http://127.0.0.1:$_port/session-bridge/v1/token',
    ).replace(queryParameters: <String, String>{
      'account_id': accountId,
    });
    final client = HttpClient()..findProxy = (_) => 'DIRECT';
    try {
      final request = await client.deleteUrl(endpoint);
      request.headers.set('X-Langbai-Bridge-Secret', _bridgeSecret);
      await request.close().timeout(const Duration(seconds: 5));
    } finally {
      client.close(force: true);
    }
  }

  Future<void> stop() async {
    _startFuture = null;
    await _stopTrackedProcess(clearSecrets: true);
  }

  Future<void> _stopTrackedProcess({required bool clearSecrets}) async {
    final process = _process;
    _stopping = true;
    _process = null;
    _gatewayReady = false;
    _port = 0;
    _sessionActivation.clear();
    if (clearSecrets) {
      _apiKey = '';
      _bridgeSecret = '';
    }
    try {
      if (process == null) return;
      process.kill();
      try {
        await process.exitCode.timeout(const Duration(seconds: 3));
      } on TimeoutException {
        process.kill(ProcessSignal.sigkill);
        await process.exitCode.timeout(const Duration(seconds: 3));
      }
    } finally {
      _stopping = false;
    }
  }

  Future<void> _resetAfterFailedStart() async {
    await _stopTrackedProcess(clearSecrets: true);
    _port = 0;
    _gatewayReady = false;
  }

  /// Stops only the helper started from this installation directory. Other
  /// installed, portable, or test copies must keep their own tasks alive.
  Future<void> stopAllForUpdate() async {
    await stop();
    if (!Platform.isWindows) return;
    final executable = _resolveExecutable();
    final result = await Process.run(
      'powershell.exe',
      <String>[
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        gatewayStopByPathPowerShell(executable.path),
      ],
      runInShell: false,
    ).timeout(const Duration(seconds: 12));
    if (result.exitCode != 0) {
      throw ProcessException(
        'powershell.exe',
        const <String>[],
        '${result.stdout}\n${result.stderr}'.trim(),
        result.exitCode,
      );
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }

  Future<int> _findAvailablePort({Set<int> excluding = const <int>{}}) async {
    for (var candidate = firstPort; candidate <= lastPort; candidate++) {
      if (excluding.contains(candidate)) continue;
      try {
        final socket = await ServerSocket.bind(
          InternetAddress.loopbackIPv4,
          candidate,
          shared: false,
        );
        await socket.close();
        return candidate;
      } on SocketException {
        continue;
      }
    }
    throw SocketException(
      'No free loopback port is available in $firstPort-$lastPort.',
    );
  }

  Future<bool> _healthReady(int port) async {
    final client = HttpClient()..findProxy = (_) => 'DIRECT';
    try {
      final request = await client.getUrl(
        Uri.parse('http://127.0.0.1:$port/healthz'),
      );
      final response =
          await request.close().timeout(const Duration(seconds: 2));
      final body = await utf8.decoder.bind(response).join();
      if (response.statusCode != 200) return false;
      final decoded = jsonDecode(body);
      return decoded is Map &&
          decoded['status'] == 'ok' &&
          decoded['service'] == 'langbai-chatgpt-web-image-gateway';
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  Future<int?> _exitCodeIfFinished(Process process) async {
    try {
      return await process.exitCode.timeout(Duration.zero);
    } on TimeoutException {
      return null;
    }
  }

  String _localAppData() {
    final value = (Platform.environment['LOCALAPPDATA'] ?? '').trim();
    if (value.isEmpty) {
      throw const FileSystemException('LOCALAPPDATA is unavailable.');
    }
    return value;
  }
}
