enum DesktopProxyKind { direct, http, socks5 }

class DesktopProxyResolution {
  const DesktopProxyResolution({
    required this.valid,
    required this.findProxy,
    required this.kind,
    this.host,
    this.port,
    this.error,
  });

  final bool valid;
  final String findProxy;
  final DesktopProxyKind kind;
  final String? host;
  final int? port;
  final String? error;
}

const String defaultDesktopProxyMode = 'http7890';

String _normalizeDesktopProxyMode(String? mode) {
  final value = (mode ?? '').trim();
  return const {'http7890', 'socks10808', 'direct', 'custom'}.contains(value)
      ? value
      : defaultDesktopProxyMode;
}

String? _presetProxyUrl(String mode) {
  switch (mode) {
    case 'http7890':
      return 'http://127.0.0.1:7890';
    case 'socks10808':
      return 'socks5://127.0.0.1:10808';
    case 'direct':
      return '';
    default:
      return null;
  }
}

DesktopProxyResolution resolveDesktopProxyFindProxy({
  required bool desktopPlatform,
  String? mode,
  String? proxyUrl,
}) {
  if (!desktopPlatform) {
    return const DesktopProxyResolution(
      valid: true,
      findProxy: 'DIRECT',
      kind: DesktopProxyKind.direct,
    );
  }

  final normalizedMode = _normalizeDesktopProxyMode(mode);
  final url = normalizedMode == 'custom'
      ? (proxyUrl ?? '').trim()
      : (_presetProxyUrl(normalizedMode) ?? '');

  if (normalizedMode == 'direct') {
    return const DesktopProxyResolution(
      valid: true,
      findProxy: 'DIRECT',
      kind: DesktopProxyKind.direct,
    );
  }

  final uri = Uri.tryParse(url);
  if (uri == null ||
      uri.host.isEmpty ||
      !uri.hasPort ||
      uri.userInfo.isNotEmpty ||
      !(uri.path.isEmpty || uri.path == '/')) {
    return const DesktopProxyResolution(
      valid: false,
      findProxy: 'DIRECT',
      kind: DesktopProxyKind.direct,
      error:
          'Invalid custom proxy URL. Use http://host:port, https://host:port, or socks5://host:port.',
    );
  }

  final scheme = uri.scheme.toLowerCase();
  if (scheme == 'http' || scheme == 'https') {
    return DesktopProxyResolution(
      valid: true,
      findProxy: 'PROXY ${uri.host}:${uri.port}',
      kind: DesktopProxyKind.http,
      host: uri.host,
      port: uri.port,
    );
  }
  if (scheme == 'socks5') {
    return DesktopProxyResolution(
      valid: true,
      // dart:io only understands DIRECT and HTTP PROXY directives. SOCKS5 is
      // connected through HttpClient.connectionFactory in main.dart.
      findProxy: 'DIRECT',
      kind: DesktopProxyKind.socks5,
      host: uri.host,
      port: uri.port,
    );
  }

  return const DesktopProxyResolution(
    valid: false,
    findProxy: 'DIRECT',
    kind: DesktopProxyKind.direct,
    error:
        'Invalid custom proxy URL. Use http://host:port, https://host:port, or socks5://host:port.',
  );
}
