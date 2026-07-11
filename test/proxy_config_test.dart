import 'package:flutter_test/flutter_test.dart';

import 'package:ai_image_generator/proxy_config.dart';

void main() {
  test('default desktop proxy resolves to HTTP 7890', () {
    final proxy = resolveDesktopProxyFindProxy(desktopPlatform: true);
    expect(proxy.valid, isTrue);
    expect(proxy.findProxy, 'PROXY 127.0.0.1:7890');
  });

  test('SOCKS5 preset resolves to SOCKS 10808', () {
    final proxy = resolveDesktopProxyFindProxy(
      desktopPlatform: true,
      mode: 'socks10808',
    );
    expect(proxy.valid, isTrue);
    expect(proxy.findProxy, 'DIRECT');
    expect(proxy.kind, DesktopProxyKind.socks5);
    expect(proxy.host, '127.0.0.1');
    expect(proxy.port, 10808);
  });

  test('direct mode resolves to DIRECT', () {
    final proxy = resolveDesktopProxyFindProxy(
      desktopPlatform: true,
      mode: 'direct',
    );
    expect(proxy.valid, isTrue);
    expect(proxy.findProxy, 'DIRECT');
  });

  test('custom HTTP and SOCKS5 proxy URLs are accepted', () {
    final http = resolveDesktopProxyFindProxy(
      desktopPlatform: true,
      mode: 'custom',
      proxyUrl: 'http://127.0.0.1:7890',
    );
    final socks = resolveDesktopProxyFindProxy(
      desktopPlatform: true,
      mode: 'custom',
      proxyUrl: 'socks5://127.0.0.1:10808',
    );
    expect(http.findProxy, 'PROXY 127.0.0.1:7890');
    expect(http.kind, DesktopProxyKind.http);
    expect(socks.findProxy, 'DIRECT');
    expect(socks.kind, DesktopProxyKind.socks5);
  });

  test('invalid custom proxy URL is rejected on desktop', () {
    final proxy = resolveDesktopProxyFindProxy(
      desktopPlatform: true,
      mode: 'custom',
      proxyUrl: '127.0.0.1:7890',
    );
    expect(proxy.valid, isFalse);
    expect(proxy.findProxy, 'DIRECT');
    expect(proxy.error, isNotEmpty);
  });

  test('non-desktop platforms ignore desktop proxy settings', () {
    final proxy = resolveDesktopProxyFindProxy(
      desktopPlatform: false,
      mode: 'custom',
      proxyUrl: 'not a proxy',
    );
    expect(proxy.valid, isTrue);
    expect(proxy.findProxy, 'DIRECT');
  });
}
