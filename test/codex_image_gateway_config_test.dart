import 'dart:io';

import 'package:ai_image_generator/codex_image_gateway_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final lowerA64 = List<String>.filled(64, 'a').join();
  final upperA64 = List<String>.filled(64, 'A').join();
  final lowerA63 = List<String>.filled(63, 'a').join();
  final lowerB64 = List<String>.filled(64, 'b').join();

  test('validates only the expected local gateway key format', () {
    expect(isValidCodexImageGatewayKey(lowerA64), isTrue);
    expect(isValidCodexImageGatewayKey(upperA64), isFalse);
    expect(isValidCodexImageGatewayKey(lowerA63), isFalse);
  });

  test('builds the key path below LOCALAPPDATA', () {
    expect(
      codexImageGatewayKeyPath(r'C:\Users\Test\AppData\Local', separator: r'\'),
      r'C:\Users\Test\AppData\Local\LangbaiCodexImageGateway\local-api-key.txt',
    );
  });

  test('rejects loading outside the Windows app', () async {
    expect(
      () => loadCodexImageGatewayConfig(
        isWindows: false,
        environment: const <String, String>{},
      ),
      throwsA(isA<FileSystemException>()),
    );
  });

  test('loads a valid key without exposing any other local credential',
      () async {
    final result = await loadCodexImageGatewayConfig(
      isWindows: true,
      environment: const <String, String>{'LOCALAPPDATA': r'C:\Local'},
      readText: (_) async => '$lowerB64\n',
    );
    expect(result, <String, String>{
      'baseUrl': codexImageGatewayBaseUrl,
      'apiKey': lowerB64,
    });
    expect(result.keys, unorderedEquals(<String>['baseUrl', 'apiKey']));
  });

  test('rejects malformed key-file content', () async {
    expect(
      () => loadCodexImageGatewayConfig(
        isWindows: true,
        environment: const <String, String>{'LOCALAPPDATA': r'C:\Local'},
        readText: (_) async => 'not-a-key',
      ),
      throwsA(isA<FormatException>()),
    );
  });
}
