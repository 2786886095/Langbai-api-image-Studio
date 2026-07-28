import 'dart:math';
import 'dart:io';

import 'package:ai_image_generator/embedded_chatgpt_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('gateway secrets are 64 lowercase hexadecimal characters', () {
    final value = randomGatewaySecret(random: Random(7));
    expect(value, matches(RegExp(r'^[a-f0-9]{64}$')));
  });

  test('gateway executable uses a private sibling directory', () {
    final value = embeddedGatewayExecutablePath(
      executableDirectory: r'C:\Program Files\Langbai',
    );
    expect(
      value,
      endsWith(
          'chatgpt_gateway${Platform.pathSeparator}langbai_chatgpt_gateway.exe'),
    );
  });
}
