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
      recovery: const <String, Object?>{
        'phase': 'direct_image_ready',
        'image': <String, Object?>{
          'url': 'https://lh3.googleusercontent.com/example'
        },
      },
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
    expect(restored.recovery['phase'], 'direct_image_ready');
    expect(
      task.toJson().containsKey('recovery'),
      isFalse,
      reason: 'Recovery URLs are private companion checkpoints.',
    );
    expect(restored.terminal, isFalse);
  });

  test('direct protocol capability does not claim verified Temporary Chat', () {
    final capabilities = geminiWebCapabilities(
      companionConnected: true,
      sessionAvailable: true,
      generationReady: true,
      temporaryChatAvailable: false,
      directProtocolAvailable: true,
      fullsizeDownloadAvailable: true,
      selectorPackCompatible: true,
    );
    expect(capabilities['temporary_chat_available'], isFalse);
    expect(capabilities['direct_protocol_available'], isTrue);
    expect(capabilities['temporary_chat_required'], isFalse);
    expect(capabilities['temporary_chat_requested_by_direct_protocol'], isTrue);
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

  test('expired post-submit claims never become a fresh paid submission', () {
    GeminiImageTask task(String status, {bool recoverable = false}) =>
        GeminiImageTask(
          id: status,
          clientRequestId: status,
          request: const <String, Object?>{},
          status: status,
          recovery: recoverable
              ? const <String, Object?>{'phase': 'direct_image_ready'}
              : const <String, Object?>{},
        );

    expect(
      expiredGeminiClaimAction(task('uploading_references')),
      'requeue_before_submission',
    );
    for (final status in <String>[
      'submitting',
      'generating',
      'locating_full_size',
    ]) {
      expect(
        expiredGeminiClaimAction(task(status)),
        'fail_unknown_submission',
        reason: status,
      );
    }
    expect(
      expiredGeminiClaimAction(
        task('locating_full_size', recoverable: true),
      ),
      'resume_generated_image',
    );
  });

  test('generated image checkpoint resumes directly at full-size recovery', () {
    GeminiImageTask task({required bool recoverable}) => GeminiImageTask(
          id: recoverable ? 'recoverable' : 'plain',
          clientRequestId: recoverable ? 'recoverable' : 'plain',
          request: const <String, Object?>{},
          status: 'preparing_temporary_chat',
          recovery: recoverable
              ? const <String, Object?>{
                  'phase': 'direct_image_ready',
                  'image': <String, Object?>{
                    'url': 'https://lh3.googleusercontent.com/example',
                  },
                }
              : const <String, Object?>{},
        );

    expect(
      geminiStatusTransitionAllowed(
          task(recoverable: true), 'locating_full_size'),
      isTrue,
    );
    expect(
      geminiStatusTransitionAllowed(
          task(recoverable: false), 'locating_full_size'),
      isFalse,
    );
    expect(
      geminiStatusTransitionAllowed(task(recoverable: true), 'submitting'),
      isFalse,
    );
  });
}
