import 'package:ai_image_generator/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ChatGPT auth window allows only official and identity-provider pages',
      () {
    for (final url in <String>[
      'https://chatgpt.com/',
      'https://auth.openai.com/authorize',
      'https://accounts.google.com/o/oauth2/auth',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      'https://login.live.com/oauth20_authorize.srf',
      'https://appleid.apple.com/auth/authorize',
      'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/',
      'about:blank',
    ]) {
      expect(isAllowedChatGptAuthNavigation(url), isTrue, reason: url);
    }
  });

  test('ChatGPT auth window rejects arbitrary or insecure navigation', () {
    for (final url in <String>[
      'http://chatgpt.com/',
      'https://chatgpt.com.example.test/',
      'https://example.test/phishing',
      'file:///C:/secret.txt',
      'javascript:alert(1)',
      'about:config',
    ]) {
      expect(isAllowedChatGptAuthNavigation(url), isFalse, reason: url);
    }
  });
}
