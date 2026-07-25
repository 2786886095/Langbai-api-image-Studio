import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_win_floating/webview_win_floating.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('webview_win_floating');
  const codec = StandardMethodCodec();

  test('windowed WebView bridge installs startup script and reports failure',
      () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'create') return true;
      if (call.method == 'runJavascript') return '1';
      return null;
    });

    final controller = WinWebViewController(
      params: const WindowsWebViewControllerCreationParams(
        userDataFolder: r'C:\test-profile',
        suspendDuringDeactive: false,
        useTopLevelWindowHost: true,
      ),
    );
    var failedKind = -1;
    Object? rawBridgeMessage;
    controller.onProcessFailed = (kind) => failedKind = kind;
    controller.onWebMessageReceived = (message) => rawBridgeMessage = message;

    await controller.addScriptToExecuteOnDocumentCreated(
      'window.__WINDOWED_TEST__ = true;',
    );
    expect(await controller.runJavaScriptReturningResult('1'), 1);

    final create = calls.firstWhere((call) => call.method == 'create');
    expect((create.arguments as Map)['useTopLevelWindowHost'], isTrue);
    final webviewId = (create.arguments as Map)['webviewId'] as int;
    final inboundDone = Completer<void>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      channel.name,
      codec.encodeMethodCall(MethodCall('onProcessFailed', {
        'webviewId': webviewId,
        'kind': 2,
      })),
      (_) => inboundDone.complete(),
    );
    await inboundDone.future;

    final messageDone = Completer<void>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      channel.name,
      codec.encodeMethodCall(MethodCall('OnWebMessageReceived', {
        'webviewId': webviewId,
        'message': '{"id":"bridge-test"}',
      })),
      (_) => messageDone.complete(),
    );
    await messageDone.future;

    expect(failedKind, 2);
    expect(rawBridgeMessage, isA<Map>());
    expect(
      calls.any((call) => call.method == 'addScriptToExecuteOnDocumentCreated'),
      isTrue,
    );

    await controller.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
}
