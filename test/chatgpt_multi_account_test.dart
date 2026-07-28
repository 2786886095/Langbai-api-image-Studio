import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ai_image_generator/chatgpt_multi_account.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  String tokenFor({
    required String sub,
    String email = 'alice@example.com',
    int? exp,
  }) {
    String part(Object value) =>
        base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
    return '${part(<String, String>{'alg': 'none'})}.'
        '${part(<String, Object?>{
          'sub': sub,
          'email': email,
          'name': 'Alice',
          'exp': exp ??
              DateTime.now()
                      .add(const Duration(days: 1))
                      .millisecondsSinceEpoch ~/
                  1000,
        })}.signature-value-that-is-long-enough';
  }

  test('parser accepts full session JSON and masks identity', () {
    final parsed = ParsedChatGptSession.parse(jsonEncode(<String, Object?>{
      'accessToken': tokenFor(sub: 'account-1'),
      'expires': DateTime.now().add(const Duration(hours: 2)).toIso8601String(),
      'user': <String, String>{
        'id': 'account-1',
        'name': 'Alice Example',
        'email': 'alice@example.com',
      },
      'plan': 'plus',
    }));

    expect(parsed.accessToken, contains('.'));
    expect(parsed.accountFingerprint, hasLength(64));
    expect(parsed.displayName, 'Alice Example');
    expect(parsed.maskedEmail, 'a****@example.com');
    expect(parsed.planLabel, 'plus');
  });

  test('parser accepts a raw bearer token', () {
    final token = tokenFor(sub: 'account-2');
    final parsed = ParsedChatGptSession.parse('Bearer $token');
    expect(parsed.accessToken, token);
    expect(parsed.displayName, 'Alice');
    expect(parsed.maskedEmail, 'a****@example.com');
  });

  test('duplicate account import updates the token in place', () async {
    const storage = FlutterSecureStorage();
    final store = ChatGptMultiAccountStore(storage);
    final firstToken = tokenFor(sub: 'same-account');
    final secondToken = tokenFor(sub: 'same-account', email: 'new@example.com');

    final first = await store.importSession(firstToken);
    final second = await store.importSession(secondToken);
    final accounts = await store.readAccounts();

    expect(accounts, hasLength(1));
    expect(second.localAccountId, first.localAccountId);
    expect(await store.readToken(first.localAccountId), secondToken);
  });

  test('rotation follows list order and skips unavailable accounts', () async {
    const storage = FlutterSecureStorage();
    final store = ChatGptMultiAccountStore(storage);
    final one = await store.importSession(tokenFor(sub: 'one'));
    final two = await store.importSession(tokenFor(sub: 'two'));
    final three = await store.importSession(tokenFor(sub: 'three'));
    await store.selectAccount(one.localAccountId);
    await store.markAccount(two.localAccountId, status: 'expired');

    final next = await store.rotateAfterFailure(
      failedStatus: 'rate_limited',
      reason: 'quota exhausted',
    );

    expect(next?.localAccountId, three.localAccountId);
    expect(await store.activeAccountId(), three.localAccountId);
  });

  test('auto switch can be disabled', () async {
    const storage = FlutterSecureStorage();
    final store = ChatGptMultiAccountStore(storage);
    final one = await store.importSession(tokenFor(sub: 'one'));
    await store.importSession(tokenFor(sub: 'two'));
    await store.selectAccount(one.localAccountId);
    await store.setAutoSwitch(false);

    final next = await store.rotateAfterFailure(
      failedStatus: 'authentication_failed',
      reason: '401',
    );

    expect(next, isNull);
    expect(await store.activeAccountId(), one.localAccountId);
  });

  test('tokens are stored separately from account metadata', () async {
    const storage = FlutterSecureStorage();
    final store = ChatGptMultiAccountStore(storage);
    final token = tokenFor(sub: 'separate-secret');
    final account = await store.importSession(token);
    final metadata = await storage.read(key: chatGptAccountsSecureKey);

    expect(metadata, isNot(contains(token)));
    expect(
      await storage.read(key: store.tokenKey(account.localAccountId)),
      token,
    );
  });
}
