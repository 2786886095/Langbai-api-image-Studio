import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_win_floating/webview_win_floating.dart';
import 'package:ai_image_generator/main.dart';

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
        profileName: 'profile-a',
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
    await controller.dispatchTrustedTextInput('分镜提示词');

    final create = calls.firstWhere((call) => call.method == 'create');
    expect((create.arguments as Map)['useTopLevelWindowHost'], isTrue);
    expect((create.arguments as Map)['profileName'], 'profile-a');
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
    final trustedTextCall = calls.firstWhere(
      (call) => call.method == 'dispatchTrustedTextInput',
    );
    expect((trustedTextCall.arguments as Map)['text'], '分镜提示词');
    expect(
      (trustedTextCall.arguments as Map)['webviewId'],
      webviewId,
    );

    await controller.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('Windows health snapshot rejects startup errors and missing controls',
      () {
    final healthy = WindowsAppHealthSnapshot.fromJavaScriptResult(
      '{"ready":true,"error":"","missing":[]}',
    );
    expect(healthy.healthy, isTrue);

    final failed = WindowsAppHealthSnapshot.fromJavaScriptResult(
      '"{\\"ready\\":false,\\"error\\":\\"bootstrap failed\\",'
      '\\"missing\\":[\\"#settingsBtn\\"]}"',
    );
    expect(failed.healthy, isFalse);
    expect(failed.startupError, 'bootstrap failed');
    expect(failed.missingControls, contains('#settingsBtn'));
  });

  test('main WebView explicitly retains the legacy default profile', () {
    expect(windowsMainWebViewProfileName, 'Default');
    expect(windowsSelfTestWebViewProfileName, isNot('Default'));
  });

  test('auxiliary WebView2 process failures do not reload the editor', () {
    expect(windowsProcessFailureRequiresRebuild(0), isTrue);
    expect(windowsProcessFailureRequiresRebuild(1), isTrue);
    for (final kind in <int>[2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(
        windowsProcessFailureRequiresRebuild(kind),
        isFalse,
        reason: 'WebView2 can recover auxiliary process kind $kind itself.',
      );
    }
  });
}
