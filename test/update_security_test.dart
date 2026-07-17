import 'package:flutter_test/flutter_test.dart';

import 'package:ai_image_generator/main.dart';

void main() {
  test('only this repository GitHub release assets are trusted for updates',
      () {
    expect(
      isTrustedReleaseAssetUrl(
        'https://github.com/2786886095/Langbai-api-image-Studio/releases/download/v1.3.20/AI-Image-Generator-Setup.exe',
      ),
      isTrue,
    );
    expect(
      isTrustedReleaseAssetUrl('https://example.com/Setup.exe'),
      isFalse,
    );
    expect(
      isTrustedReleaseAssetUrl(
        'http://github.com/2786886095/Langbai-api-image-Studio/releases/download/v1.3.20/Setup.exe',
      ),
      isFalse,
    );
    expect(
      isTrustedReleaseAssetUrl(
        'https://github.com/another/repository/releases/download/v1/Setup.exe',
      ),
      isFalse,
    );
  });
}
