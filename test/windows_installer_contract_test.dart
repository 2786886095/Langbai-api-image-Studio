import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Windows installer has safe silent launch and gateway lock contracts',
      () async {
    final source = await File('windows/installer/setup.iss').readAsString();

    expect(source, contains('ChineseSimplified.isl'));
    expect(source, contains('/LANGBAILAUNCH'));
    expect(source, contains('skipifsilent'));
    expect(source, contains('ShouldOfferInteractiveLaunch'));
    expect(source, contains('IsLangbaiLaunchRequested'));
    expect(source, contains(r'$_.ExecutablePath'));
    expect(source, contains('[IO.File]::Open'));
    expect(source, contains('[IO.FileShare]::None'));
    expect(source, contains('THIRD_PARTY_NOTICES.md'));
    expect(source, contains(r'THIRD_PARTY_LICENSES\*'));
    expect(
      await File('THIRD_PARTY_LICENSES/chatgpt2api-MIT.txt').readAsString(),
      contains('MIT License'),
    );
    expect(source, isNot(contains('/F /IM "{#MyGatewayExeName}"')));
  });
}
