import 'dart:convert';

import 'package:ai_image_generator/gemini_image_task.dart';
import 'package:ai_image_generator/gemini_size_capabilities.dart';
import 'package:ai_image_generator/gemini_web_gateway.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Gemini task persistence excludes result bytes and restores checkpoints',
      () {
    final task = GeminiImageTask(
      id: 'gemini_test',
      clientRequestId: 'client_test',
      request: <String, Object?>{
        'provider': 'geminiWeb',
        'temporary_chat_required': true,
        'n': 1,
      },
      status: 'queued',
      accountId: 'account_test',
      claimId: 'claim_test',
      claimedAccountId: 'account_test',
      claimExpiresAt: DateTime.utc(2026, 7, 29, 12),
    );

    final encoded = jsonEncode(<Object?>[task.toPersistenceJson()]);
    final restored = GeminiImageTask.decodeList(encoded).single;

    expect(restored.id, 'gemini_test');
    expect(restored.clientRequestId, 'client_test');
    expect(restored.accountId, 'account_test');
    expect(restored.claimId, 'claim_test');
    expect(restored.claimedAccountId, 'account_test');
    expect(restored.claimExpiresAt, DateTime.utc(2026, 7, 29, 12));
    expect(restored.request['provider'], 'geminiWeb');
    expect(restored.terminal, isFalse);
  });

  test('Gemini terminal states are explicit', () {
    for (final status in <String>[
      'succeeded',
      'failed',
      'needs_login',
      'protocol_changed',
      'cancelled',
    ]) {
      final task = GeminiImageTask(
        id: status,
        clientRequestId: status,
        request: const <String, Object?>{},
        status: status,
      );
      expect(task.terminal, isTrue, reason: status);
    }
  });

  test('Gemini capabilities preserve temporary-chat and size guarantees', () {
    final capabilities = geminiWebCapabilities(
      companionConnected: true,
      sessionAvailable: true,
      generationReady: true,
      temporaryChatAvailable: true,
      fullsizeDownloadAvailable: true,
      selectorPackCompatible: true,
      effectiveConcurrency: 2,
    );

    expect(capabilities['provider'], 'gemini_web');
    expect(capabilities['temporary_chat_required'], isTrue);
    expect(capabilities['fullsize_download'], isTrue);
    expect(capabilities['effective_concurrency'], 2);
    expect(
      capabilities['dimension_modes'],
      containsAll(<String>[
        'native_fullsize',
        'strict_native',
        'exact_output',
        'local_4k_upscale',
      ]),
    );
  });

  test('Gemini companion resumes the oldest live claim after navigation', () {
    final now = DateTime.utc(2026, 7, 29, 12);
    GeminiImageTask task(
      String id, {
      String accountId = 'account-a',
      String claimId = 'claim',
      Duration expiresIn = const Duration(minutes: 1),
      Duration updatedAgo = Duration.zero,
    }) =>
        GeminiImageTask(
          id: id,
          clientRequestId: id,
          request: const <String, Object?>{},
          status: 'preparing_temporary_chat',
          accountId: accountId,
          claimId: claimId,
          claimedAccountId: accountId,
          claimExpiresAt: now.add(expiresIn),
          updatedAt: now.subtract(updatedAgo),
        );

    final selected = findResumableGeminiCompanionTask(
      <GeminiImageTask>[
        task('newer', updatedAgo: const Duration(seconds: 5)),
        task('expired', expiresIn: const Duration(seconds: -1)),
        task('wrong-account', accountId: 'account-b'),
        task('older', updatedAgo: const Duration(seconds: 20)),
      ],
      accountId: 'account-a',
      now: now,
    );

    expect(selected?.id, 'older');
  });
}
