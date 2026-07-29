import 'package:ai_image_generator/gemini_account_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ready account is eligible only with required web capabilities', () {
    const ready = GeminiAccountMetadata(
      localAccountId: 'account-a',
      status: 'ready',
      loginReady: true,
      quotaState: 'available',
      temporaryChatAvailable: true,
      fullsizeDownloadAvailable: true,
    );
    expect(ready.available, isTrue);
    expect(
      ready.copyWith(fullsizeDownloadAvailable: false).available,
      isFalse,
    );
    expect(ready.copyWith(loginReady: false).available, isFalse);
  });

  test('quota and cooldown state make an account unavailable', () {
    const ready = GeminiAccountMetadata(
      localAccountId: 'account-a',
      status: 'ready',
      loginReady: true,
      quotaState: 'available',
      temporaryChatAvailable: true,
      fullsizeDownloadAvailable: true,
    );
    expect(ready.copyWith(quotaState: 'exhausted').available, isFalse);
    expect(
      ready
          .copyWith(
            quotaState: 'cooldown',
            cooldownUntil: DateTime.now()
                .toUtc()
                .add(const Duration(minutes: 5))
                .toIso8601String(),
          )
          .available,
      isFalse,
    );
  });

  test('legacy ready account metadata restores login state without secrets',
      () {
    final restored = GeminiAccountMetadata.fromJson(<String, dynamic>{
      'local_account_id': 'legacy-account',
      'status': 'ready',
      'temporary_chat_available': true,
      'fullsize_download_available': true,
    });
    final serialized = restored.toJson();

    expect(restored.loginReady, isTrue);
    expect(serialized['local_account_id'], 'legacy-account');
    expect(serialized.keys, isNot(contains('cookie')));
    expect(serialized.keys, isNot(contains('token')));
    expect(serialized.keys, isNot(contains('authorization')));
  });
}
