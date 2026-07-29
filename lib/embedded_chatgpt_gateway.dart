import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

const int embeddedGatewayFirstPort = 18081;
const int embeddedGatewayLastPort = 18100;
const String embeddedGatewayProcessName = 'langbai_chatgpt_gateway.exe';

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

class EmbeddedChatGptGatewayManager {
  EmbeddedChatGptGatewayManager({
    this.firstPort = embeddedGatewayFirstPort,
    this.lastPort = embeddedGatewayLastPort,
  });

  final int firstPort;
  final int lastPort;
  Process? _process;
  Future<Map<String, Object?>>? _startFuture;
  String _apiKey = '';
  String _bridgeSecret = '';
  int _port = 0;
  String _lastError = '';

  bool get running => _process != null && _port > 0;

  Future<Map<String, Object?>> configuration() =>
      _startFuture ??= _startInternal();

  Future<Map<String, Object?>> _startInternal() async {
    if (!Platform.isWindows) {
      throw const FileSystemException(
        'The bundled ChatGPT web image gateway is currently available on Windows only.',
      );
    }
    final override =
        (Platform.environment['LANGBAI_EMBEDDED_GATEWAY_EXECUTABLE'] ?? '')
            .trim();
    final executable = override.isNotEmpty
        ? File(override)
        : File(embeddedGatewayExecutablePath(
            executableDirectory: File(Platform.resolvedExecutable).parent.path,
          ));
    if (!await executable.exists()) {
      _lastError = 'Bundled image gateway executable is missing.';
      throw FileSystemException(_lastError, executable.path);
    }

    _apiKey = randomGatewaySecret();
    _bridgeSecret = randomGatewaySecret();
    _port = await _findAvailablePort();
    final dataDirectory = Directory(<String>[
      _localAppData(),
      'LangbaiImageStudio',
      'EmbeddedChatGptGateway',
    ].join(Platform.pathSeparator));
    await dataDirectory.create(recursive: true);

    final environment = <String, String>{
      ...Platform.environment,
      'CHATGPT2API_AUTH_KEY': _apiKey,
      'LANGBAI_WEB_BRIDGE_SECRET': _bridgeSecret,
      'CHATGPT2API_DATA_DIR': dataDirectory.path,
      'CHATGPT2API_CONFIG_FILE': <String>[
        dataDirectory.path,
        'config.json',
      ].join(Platform.pathSeparator),
      'LANGBAI_GATEWAY_PORT': '$_port',
      'LANGBAI_PARENT_PID': '$pid',
      'PYTHONUTF8': '1',
    };
    _process = await Process.start(
      executable.path,
      const <String>[],
      workingDirectory: executable.parent.path,
      environment: environment,
      mode: ProcessStartMode.normal,
    );
    unawaited(_process!.stdout.drain<void>());
    unawaited(_process!.stderr
        .transform(utf8.decoder)
        .listen((line) => _lastError = line.trim())
        .asFuture<void>()
        .catchError((Object _) {}));

    final deadline = DateTime.now().add(const Duration(seconds: 25));
    while (DateTime.now().isBefore(deadline)) {
      final exitCode = await _exitCodeIfFinished(_process!);
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
      if (await _healthReady()) {
        return <String, Object?>{
          'baseUrl': 'http://127.0.0.1:$_port/v1',
          'apiKey': _apiKey,
          'embedded': true,
          'port': _port,
        };
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    await stop();
    throw TimeoutException(
      _lastError.isEmpty
          ? 'Bundled image gateway did not become ready.'
          : _lastError,
      const Duration(seconds: 25),
    );
  }

  Future<void> setSessionToken(
    String accessToken, {
    required String accountId,
  }) async {
    final config = await configuration();
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
            const Duration(seconds: 10),
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
    final process = _process;
    _process = null;
    _port = 0;
    _startFuture = null;
    if (process == null) return;
    process.kill();
    try {
      await process.exitCode.timeout(const Duration(seconds: 3));
    } on TimeoutException {
      process.kill(ProcessSignal.sigkill);
    }
  }

  /// Stops both the gateway tracked by this app instance and stale gateways
  /// left by earlier hard application exits. Windows cannot replace a running
  /// executable, so this must finish before an update installer is launched.
  Future<void> stopAllForUpdate() async {
    await stop();
    if (!Platform.isWindows) return;
    final result = await Process.run(
      'taskkill.exe',
      const <String>['/F', '/IM', embeddedGatewayProcessName],
      runInShell: false,
    ).timeout(const Duration(seconds: 8));
    // taskkill returns 128 when no matching process exists.
    if (result.exitCode != 0 && result.exitCode != 128) {
      throw ProcessException(
        'taskkill.exe',
        const <String>['/F', '/IM', embeddedGatewayProcessName],
        '${result.stdout}\n${result.stderr}'.trim(),
        result.exitCode,
      );
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }

  Future<int> _findAvailablePort() async {
    for (var candidate = firstPort; candidate <= lastPort; candidate++) {
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

  Future<bool> _healthReady() async {
    final client = HttpClient()..findProxy = (_) => 'DIRECT';
    try {
      final request = await client.getUrl(
        Uri.parse('http://127.0.0.1:$_port/healthz'),
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
