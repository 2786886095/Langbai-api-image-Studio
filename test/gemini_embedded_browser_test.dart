import 'package:ai_image_generator/gemini_embedded_browser.dart';
import 'package:flutter_test/flutter_test.dart';

const String _profileId = '123e4567-e89b-42d3-a456-426614174000';

void main() {
  test('embedded config keeps the real gateway key out of page JavaScript', () {
    const realKey = 'local-secret-that-must-stay-in-dart';
    final config = GeminiEmbeddedBrowserConfig.fromGateway(
      gateway: const <String, Object?>{
        'baseUrl': 'http://127.0.0.1:18160/v1/',
        'apiKey': realKey,
      },
      profileId: _profileId,
    );

    final safe = config.toSafeJavaScriptConfig('windows');
    expect(config.baseUrl, 'http://127.0.0.1:18160/v1');
    expect(config.apiKey, realKey);
    expect(safe['pairingKey'], isNot(realKey));
    expect(safe.values, isNot(contains(realKey)));
    expect(safe['profileId'], _profileId);
    expect(safe['nativeTransport'], 'postMessage');
  });

  test('embedded config rejects non-loopback gateways and invalid profiles',
      () {
    expect(
      () => GeminiEmbeddedBrowserConfig.fromGateway(
        gateway: const <String, Object?>{
          'baseUrl': 'https://example.com/v1',
          'apiKey': 'secret',
        },
        profileId: _profileId,
      ),
      throwsFormatException,
    );
    expect(
      () => GeminiEmbeddedBrowserConfig.fromGateway(
        gateway: const <String, Object?>{
          'baseUrl': 'http://127.0.0.1:18160/v1',
          'apiKey': 'secret',
        },
        profileId: 'not-a-uuid',
      ),
      throwsFormatException,
    );
  });

  test('only Gemini and Google sign-in pages can navigate at top level', () {
    expect(
      isAllowedGeminiTopLevelNavigation('https://gemini.google.com/app'),
      isTrue,
    );
    expect(
      isAllowedGeminiTopLevelNavigation(
        'https://accounts.google.com/v3/signin/identifier',
      ),
      isTrue,
    );
    expect(
      isAllowedGeminiTopLevelNavigation('https://example.com/phishing'),
      isFalse,
    );
    expect(
        isAllowedGeminiTopLevelNavigation('http://gemini.google.com'), isFalse);
  });

  test('request controller switches profiles and collapses login UI', () {
    final controller = GeminiEmbeddedBrowserRequestController();
    final second = createGeminiEmbeddedProfileId();

    controller.show(_profileId);
    expect(controller.visible, isTrue);
    expect(controller.profileId, _profileId);

    controller.collapse();
    expect(controller.visible, isFalse);

    controller.activate(second);
    expect(controller.visible, isFalse);
    expect(controller.profileId, second);
    expect(controller.requestRevision, greaterThanOrEqualTo(2));
  });
}
