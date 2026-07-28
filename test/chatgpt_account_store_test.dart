import 'dart:convert';
import 'dart:io';

import 'package:ai_image_generator/chatgpt_account_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ChatGptAccountStore', () {
    late Directory tempRoot;
    late ChatGptAccountStore store;

    setUp(() async {
      tempRoot =
          await Directory.systemTemp.createTemp('langbai-chatgpt-store-');
      store = ChatGptAccountStore(localAppData: tempRoot.path);
    });

    tearDown(() async {
      if (await tempRoot.exists()) {
        await tempRoot.delete(recursive: true);
      }
    });

    test('creates one UUID account in an isolated profile directory', () async {
      final account = await store.ensurePrimaryAccount();

      expect(
        validateLocalChatGptAccountId(account.localAccountId),
        account.localAccountId,
      );
      expect(await store.profileDirectory(account.localAccountId).exists(),
          isTrue);
      expect(
        store.profileDirectory(account.localAccountId).path,
        contains(
          '${Platform.pathSeparator}$chatGptProfilesDirectoryName'
          '${Platform.pathSeparator}${account.localAccountId}',
        ),
      );
      expect((await store.readAccounts()).length, 1);
    });

    test('persists only sanitized account metadata', () async {
      final account = await store.ensurePrimaryAccount();
      final ready = ChatGptAccountRecord.fromJson(
        <String, Object?>{
          'local_account_id': account.localAccountId,
          'display_name': '  测试\n账号  ',
          'masked_email': 't***@example.com',
          'plan_label': 'plus',
          'last_verified_at': '2026-07-29T01:02:03Z',
          'status': 'ready',
          'access_token': 'must-not-survive',
          'cookie': 'must-not-survive',
        },
        expectedAccountId: account.localAccountId,
      );

      await store.writeState(ready);
      final raw = await store.stateFile(account.localAccountId).readAsString();
      final json = jsonDecode(raw) as Map<String, dynamic>;

      expect(
          json.keys,
          unorderedEquals(<String>[
            'local_account_id',
            'display_name',
            'masked_email',
            'plan_label',
            'last_verified_at',
            'status',
          ]));
      expect(json['display_name'], '测试 账号');
      expect(json['masked_email'], 't***@example.com');
      expect(raw, isNot(contains('must-not-survive')));
    });

    test('rejects unmasked email and profile path traversal', () {
      final id = createLocalChatGptAccountId();
      final account = ChatGptAccountRecord.fromJson(
        <String, Object?>{
          'masked_email': 'private@example.com',
          'status': 'ready',
        },
        expectedAccountId: id,
      );

      expect(account.maskedEmail, isEmpty);
      expect(
        () => store.profileDirectory('..${Platform.pathSeparator}escape'),
        throwsFormatException,
      );
    });

    test('malformed state falls back without deleting the profile', () async {
      final account = await store.ensurePrimaryAccount();
      final state = store.stateFile(account.localAccountId);
      await state.writeAsString('{broken json', flush: true);

      final recovered = await store.readState(account.localAccountId);

      expect(recovered.status, 'signed_out');
      expect(await store.profileDirectory(account.localAccountId).exists(),
          isTrue);
      expect(await state.exists(), isTrue);
    });
  });
}
