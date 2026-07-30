import 'package:ai_image_generator/gemini_account_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ready account requires current temporary-chat capability', () {
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
      ready.copyWith(temporaryChatAvailable: false).available,
      isFalse,
      reason:
          'A signed-in page without Temporary Chat must not be shown as task-ready.',
    );
    expect(
      ready.copyWith(fullsizeDownloadAvailable: false).available,
      isFalse,
    );
    expect(ready.copyWith(loginReady: false).available, isFalse);
  });

  test(
      'direct protocol capability can replace a visible Temporary Chat control',
      () {
    const direct = GeminiAccountMetadata(
      localAccountId: 'account-direct',
      status: 'ready',
      loginReady: true,
      quotaState: 'available',
      temporaryChatAvailable: false,
      directProtocolAvailable: true,
      fullsizeDownloadAvailable: true,
    );
    expect(direct.available, isTrue);
    expect(direct.toJson()['direct_protocol_available'], isTrue);
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

  test('explicit login failure is not overwritten by a stale ready status', () {
    final restored = GeminiAccountMetadata.fromJson(<String, dynamic>{
      'local_account_id': 'expired-account',
      'status': 'ready',
      'login_ready': false,
      'quota_state': 'available',
      'fullsize_download_available': true,
    });

    expect(restored.loginReady, isFalse);
    expect(restored.available, isFalse);
  });
}
